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

#[tauri::command]
pub async fn capture_screen(app: AppHandle, target: String, options: CaptureOptions) -> Result<String, AppError> {
    // 1. Hide/minimize main window if checked
    if options.hide_window {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.minimize();
            // Wait a brief moment to allow minimization animation to complete
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        }
    }

    // 2. Handle countdown delay
    if options.delay_seconds > 0 {
        tokio::time::sleep(std::time::Duration::from_secs(options.delay_seconds)).await;
    }

    // 3. Capture screen
    let monitors = Monitor::all().map_err(|e| AppError::ConfigIo(e.to_string()))?;
    if monitors.is_empty() {
        return Err(AppError::ConfigIo("No monitors found".to_string()));
    }

    let monitor = match target.as_str() {
        "primary" => monitors.into_iter().find(|m| m.is_primary().unwrap_or(false))
            .ok_or_else(|| AppError::ConfigIo("Primary monitor not found".to_string()))?,
        _ => monitors.into_iter().next().ok_or_else(|| AppError::ConfigIo("No monitors found".to_string()))?,
    };

    let img = monitor.capture_image().map_err(|e| AppError::ConfigIo(e.to_string()))?;

    // 4. Resolve save folder
    let base_path = match options.custom_folder {
        Some(ref f) if !f.is_empty() => PathBuf::from(f),
        _ => app.path().app_data_dir()?.join("appshots"),
    };
    std::fs::create_dir_all(&base_path)?;

    // 5. Generate filename
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
    let ext = if options.format.to_lowercase() == "jpeg" { "jpg" } else { "png" };
    let filename = format!("appshot_{}.{}", timestamp, ext);
    let output_path = base_path.join(&filename);

    // 6. Save image using image crate codecs
    if options.format.to_lowercase() == "jpeg" {
        let file = std::fs::File::create(&output_path)?;
        let ref mut writer = std::io::BufWriter::new(file);
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(writer, options.quality);
        encoder.encode(&img, img.width(), img.height(), image::ExtendedColorType::Rgba8)
            .map_err(|e| AppError::ConfigIo(format!("Failed to encode JPEG: {}", e)))?;
    } else {
        img.save(&output_path)
            .map_err(|e| AppError::ConfigIo(format!("Failed to save PNG: {}", e)))?;
    }

    // 7. Restore window
    if options.hide_window {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }

    Ok(output_path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn list_appshots(app: AppHandle, custom_folder: Option<String>) -> Result<Vec<AppshotFileMetadata>, AppError> {
    let base_path = match custom_folder {
        Some(ref f) if !f.is_empty() => PathBuf::from(f),
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
            let name = path.file_name().unwrap_or_default().to_string_lossy().into_owned();
            if name.starts_with("appshot_") && (name.ends_with(".png") || name.ends_with(".jpg")) {
                let metadata = entry.metadata()?;
                let size = metadata.len();
                let timestamp = metadata.created()
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

#[tauri::command]
pub async fn delete_appshot(path: String) -> Result<(), AppError> {
    let file_path = PathBuf::from(&path);
    if file_path.exists() {
        std::fs::remove_file(file_path)?;
    }
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
        Some(ref f) if !f.is_empty() => PathBuf::from(f),
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
            let name = path.file_name().unwrap_or_default().to_string_lossy().into_owned();
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
