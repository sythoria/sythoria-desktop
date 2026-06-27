use crate::AppError;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use xcap::Monitor;

#[allow(dead_code)]
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CaptureOptions {
    pub format: String,
    pub quality: u8,
    pub delay_seconds: u64,
    pub include_cursor: bool,
    pub hide_window: bool,
    pub custom_folder: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppshotFileMetadata {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub timestamp: String,
}

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

#[tauri::command]
pub async fn has_screen_capture_permission() -> bool {
    #[cfg(target_os = "macos")]
    {
        unsafe { CGPreflightScreenCaptureAccess() }
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

#[tauri::command]
pub async fn request_screen_capture_permission(first_time: bool) -> bool {
    #[cfg(target_os = "macos")]
    {
        // 1. Request access (triggers macOS screen recording permission dialog)
        let _ = unsafe { CGRequestScreenCaptureAccess() };

        // 2. Check if permission is now granted
        let has_perm = unsafe { CGPreflightScreenCaptureAccess() };

        // 3. If not granted and it's not the first time, deep link to System Settings
        if !has_perm && !first_time {
            let _ = tokio::process::Command::new("open")
                .arg(
                    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
                )
                .spawn();
        }

        has_perm
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = first_time;
        true
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureResult {
    pub path: String,
    pub token: String,
    pub name: String,
    pub size: u64,
}

#[tauri::command]
pub async fn capture_screen(
    app: AppHandle,
    target: String,
    options: CaptureOptions,
) -> Result<CaptureResult, AppError> {
    let hide_window = options.hide_window;

    // 1. Hide/minimize main window if checked
    if hide_window {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.minimize();
            // Wait to allow minimization animation to complete fully
            tokio::time::sleep(std::time::Duration::from_millis(800)).await;
        }
    }

    // 2. Handle countdown delay
    if options.delay_seconds > 0 {
        tokio::time::sleep(std::time::Duration::from_secs(options.delay_seconds)).await;
    }

    // Resolve base path on this thread
    let base_path = match &options.custom_folder {
        Some(f) if !f.is_empty() => {
            let p = PathBuf::from(f);
            if !is_path_in_appshot_whitelist(&app, &p)? {
                return Err(AppError::ConfigIo("Access denied: Custom appshot folder is not inside whitelisted paths".to_string()));
            }
            p
        }
        _ => app.path().app_data_dir()?.join("appshots"),
    };

    // Offload CPU-bound capturing, file writes, and image encoding to spawn_blocking
    let output_path = tokio::task::spawn_blocking(move || -> Result<PathBuf, AppError> {
        // 3. Capture screen
        let monitors = Monitor::all().map_err(|e| AppError::ConfigIo(e.to_string()))?;
        if monitors.is_empty() {
            return Err(AppError::ConfigIo("No monitors found".to_string()));
        }

        let monitor = match target.as_str() {
            "primary" => monitors
                .into_iter()
                .find(|m| m.is_primary().unwrap_or(false))
                .ok_or_else(|| AppError::ConfigIo("Primary monitor not found".to_string()))?,
            _ => monitors
                .into_iter()
                .next()
                .ok_or_else(|| AppError::ConfigIo("No monitors found".to_string()))?,
        };

        let img = monitor
            .capture_image()
            .map_err(|e| AppError::ConfigIo(e.to_string()))?;

        // 4. Resolve save folder
        std::fs::create_dir_all(&base_path)?;

        // 5. Generate filename
        let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
        let ext = if options.format.to_lowercase() == "jpeg" {
            "jpg"
        } else {
            "png"
        };
        let filename = format!("appshot_{}.{}", timestamp, ext);
        let output_path = base_path.join(&filename);

        // 6. Save image using image crate codecs
        if options.format.to_lowercase() == "jpeg" {
            let file = std::fs::File::create(&output_path)?;
            let ref mut writer = std::io::BufWriter::new(file);
            let mut encoder =
                image::codecs::jpeg::JpegEncoder::new_with_quality(writer, options.quality);
            encoder
                .encode(
                    &img,
                    img.width(),
                    img.height(),
                    image::ExtendedColorType::Rgba8,
                )
                .map_err(|e| AppError::ConfigIo(format!("Failed to encode JPEG: {}", e)))?;
        } else {
            img.save(&output_path)
                .map_err(|e| AppError::ConfigIo(format!("Failed to save PNG: {}", e)))?;
        }

        Ok(output_path)
    })
    .await
    .map_err(|e| AppError::ConfigIo(format!("Thread join error: {}", e)))??;

    // 7. Restore window
    if hide_window {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }

    let size = std::fs::metadata(&output_path).map(|m| m.len()).unwrap_or(0);
    let name = output_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    let token_registry = app.state::<crate::FileTokenRegistry>();
    let token = token_registry.register(output_path.clone());

    Ok(CaptureResult {
        path: output_path.to_string_lossy().into_owned(),
        token,
        name,
        size,
    })
}

#[tauri::command]
pub async fn list_appshots(
    app: AppHandle,
    custom_folder: Option<String>,
) -> Result<Vec<AppshotFileMetadata>, AppError> {
    let base_path = match custom_folder {
        Some(ref f) if !f.is_empty() => {
            let p = PathBuf::from(f);
            if !is_path_in_appshot_whitelist(&app, &p)? {
                return Err(AppError::ConfigIo("Access denied: Custom appshot folder is not inside whitelisted paths".to_string()));
            }
            p
        }
        _ => app.path().app_data_dir()?.join("appshots"),
    };
    if !base_path.exists() {
        return Ok(Vec::new());
    }

    let mut list = Vec::new();
    let entries = std::fs::read_dir(base_path)?;
    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() {
            let name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            if name.starts_with("appshot_") && (name.ends_with(".png") || name.ends_with(".jpg")) {
                let metadata = entry.metadata()?;
                let size = metadata.len();
                let timestamp = metadata
                    .created()
                    .or_else(|_| metadata.modified())
                    .map(|system_time| {
                        let datetime: chrono::DateTime<chrono::Local> = system_time.into();
                        datetime.format("%Y-%m-%d %H:%M:%S").to_string()
                    })
                    .unwrap_or_else(|_| String::new());

                list.push(AppshotFileMetadata {
                    path: path.to_string_lossy().into_owned(),
                    name,
                    size,
                    timestamp,
                });
            }
        }
    }

    // Sort by timestamp/name descending (newest first)
    list.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(list)
}

fn is_path_in_appshot_whitelist(app: &AppHandle, path: &PathBuf) -> Result<bool, AppError> {
    let canonical_path = match path.canonicalize() {
        Ok(p) => p,
        Err(_) => path.clone(),
    };

    let whitelisted_bases = [
        app.path().app_data_dir().ok(),
        app.path().picture_dir().ok(),
        app.path().document_dir().ok(),
        app.path().download_dir().ok(),
        app.path().desktop_dir().ok(),
    ];

    for base in whitelisted_bases.into_iter().flatten() {
        if let Ok(canonical_base) = base.canonicalize() {
            if canonical_path.starts_with(&canonical_base) {
                return Ok(true);
            }
        } else if canonical_path.starts_with(&base) {
            return Ok(true);
        }
    }

    Ok(false)
}

#[tauri::command]
pub async fn select_appshot_folder(app: AppHandle) -> Result<Option<String>, AppError> {
    use tauri_plugin_dialog::DialogExt;
    let folder_path = app
        .dialog()
        .file()
        .set_title("Select Appshot Save Folder")
        .blocking_pick_folder();

    if let Some(path) = folder_path {
        let path_buf = match path {
            tauri_plugin_dialog::FilePath::Path(p) => p,
            tauri_plugin_dialog::FilePath::Url(u) => {
                if let Ok(p) = u.to_file_path() {
                    p
                } else {
                    return Err(AppError::ConfigIo("Invalid folder path URL".to_string()));
                }
            }
        };

        if !is_path_in_appshot_whitelist(&app, &path_buf)? {
            return Err(AppError::ConfigIo(
                "Access denied: Target folder must be inside user directory (Pictures, Documents, Downloads, Desktop, or App Data).".to_string()
            ));
        }

        Ok(Some(path_buf.to_string_lossy().into_owned()))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn delete_appshot(
    app: AppHandle,
    path: String,
    custom_folder: Option<String>,
) -> Result<(), AppError> {
    let file_path = PathBuf::from(&path);

    // 1. Check filename pattern
    let filename = file_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::ConfigIo("Invalid filename".to_string()))?;

    let name_lower = filename.to_lowercase();
    let is_valid_pattern = name_lower.starts_with("appshot_")
        && (name_lower.ends_with(".png") || name_lower.ends_with(".jpg") || name_lower.ends_with(".jpeg"));

    if !is_valid_pattern {
        return Err(AppError::ConfigIo("Access denied: File does not match appshot pattern".to_string()));
    }

    // 2. Resolve base path and verify whitelist
    let base_path = match custom_folder {
        Some(ref f) if !f.is_empty() => {
            let p = PathBuf::from(f);
            if !is_path_in_appshot_whitelist(&app, &p)? {
                return Err(AppError::ConfigIo("Access denied: Target folder is not whitelisted".to_string()));
            }
            p
        }
        _ => app.path().app_data_dir()?.join("appshots"),
    };

    // 3. Check folder containment
    let canonical_file = match file_path.canonicalize() {
        Ok(p) => p,
        Err(_) => return Err(AppError::ConfigIo("File not found".to_string())),
    };

    let canonical_base = match base_path.canonicalize() {
        Ok(p) => p,
        Err(_) => return Err(AppError::ConfigIo("Folder not found".to_string())),
    };

    if !canonical_file.starts_with(&canonical_base) {
        return Err(AppError::ConfigIo("Access denied: File is outside appshots directory".to_string()));
    }

    std::fs::remove_file(canonical_file)?;
    Ok(())
}

#[tauri::command]
pub async fn run_appshots_clean(
    app: AppHandle,
    clean_type: String,
    clean_value: u64,
    custom_folder: Option<String>,
) -> Result<u32, AppError> {
    let base_path = match custom_folder {
        Some(ref f) if !f.is_empty() => {
            let p = PathBuf::from(f);
            if !is_path_in_appshot_whitelist(&app, &p)? {
                return Err(AppError::ConfigIo("Access denied: Custom appshot folder is not inside whitelisted paths".to_string()));
            }
            p
        }
        _ => app.path().app_data_dir()?.join("appshots"),
    };
    if !base_path.exists() {
        return Ok(0);
    }

    let mut list = Vec::new();
    let entries = std::fs::read_dir(&base_path)?;
    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() {
            let name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            if name.starts_with("appshot_") && (name.ends_with(".png") || name.ends_with(".jpg")) {
                let metadata = entry.metadata()?;
                let size = metadata.len();
                let modified = metadata.modified()?;
                list.push((path, size, modified));
            }
        }
    }

    // Sort by modified ascending (oldest first)
    list.sort_by(|a, b| a.2.cmp(&b.2));

    let mut deleted_count = 0;

    match clean_type.as_str() {
        "count" => {
            // Keep at most clean_value items
            if list.len() > clean_value as usize {
                let to_delete = list.len() - clean_value as usize;
                for i in 0..to_delete {
                    if std::fs::remove_file(&list[i].0).is_ok() {
                        deleted_count += 1;
                    }
                }
            }
        }
        "size" => {
            // Keep directory size under clean_value megabytes (converted to bytes)
            let max_bytes = clean_value * 1024 * 1024;
            let mut current_total_bytes: u64 = list.iter().map(|item| item.1).sum();

            for item in &list {
                if current_total_bytes <= max_bytes {
                    break;
                }
                if std::fs::remove_file(&item.0).is_ok() {
                    deleted_count += 1;
                    current_total_bytes -= item.1;
                }
            }
        }
        "age" => {
            // Delete files older than clean_value days
            let now = std::time::SystemTime::now();
            let max_age_duration = std::time::Duration::from_secs(clean_value * 24 * 60 * 60);

            for item in list {
                if let Ok(age) = now.duration_since(item.2) {
                    if age > max_age_duration {
                        if std::fs::remove_file(&item.0).is_ok() {
                            deleted_count += 1;
                        }
                    }
                }
            }
        }
        _ => {}
    }

    Ok(deleted_count)
}
