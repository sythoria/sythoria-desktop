use crate::{AppError, FileTokenRegistry};
use image::{
    codecs::{jpeg::JpegEncoder, png::PngEncoder},
    imageops::{overlay, resize, FilterType},
    ExtendedColorType, ImageEncoder, RgbaImage,
};
use serde::{Deserialize, Serialize};
use std::{
    cmp::Reverse,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{LazyLock, Mutex, MutexGuard},
    time::{Duration, SystemTime},
};
use tauri::{AppHandle, Manager, WebviewWindow};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;
use xcap::{Monitor, Window as XcapWindow};

const MAX_DELAY_SECONDS: u64 = 30;
const MAX_CAPTURE_PIXELS: u64 = 150_000_000;
const MAX_OUTPUT_BYTES: u64 = 100 * 1024 * 1024;
const MAX_CLEAN_VALUE: u64 = 1_000_000;
const EPHEMERAL_MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);

static ACTIVE_CAPTURE: LazyLock<Mutex<Option<CancellationToken>>> =
    LazyLock::new(|| Mutex::new(None));

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CaptureTarget {
    Primary,
    All,
    Window,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CaptureFormat {
    Png,
    Jpeg,
}

impl CaptureFormat {
    fn extension(self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Jpeg => "jpg",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CleanType {
    Count,
    Size,
    Age,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureOptions {
    pub format: CaptureFormat,
    pub quality: u8,
    pub delay_seconds: u64,
    pub hide_window: bool,
    pub custom_folder: Option<String>,
    #[serde(default)]
    pub persist_to_gallery: bool,
    pub max_output_bytes: Option<u64>,
}

impl CaptureOptions {
    fn validate(&self) -> Result<(), AppError> {
        if !(10..=100).contains(&self.quality) {
            return Err(config_error("Image quality must be between 10 and 100"));
        }
        if self.delay_seconds > MAX_DELAY_SECONDS {
            return Err(config_error(format!(
                "Capture delay cannot exceed {MAX_DELAY_SECONDS} seconds"
            )));
        }
        if let Some(max_bytes) = self.max_output_bytes {
            if !(64 * 1024..=MAX_OUTPUT_BYTES).contains(&max_bytes) {
                return Err(config_error(
                    "Maximum output size must be between 64 KB and 100 MB",
                ));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppshotFileMetadata {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub timestamp: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureResult {
    pub path: String,
    pub token: String,
    pub name: String,
    pub size: u64,
    pub width: u32,
    pub height: u32,
    pub is_ephemeral: bool,
}

#[derive(Debug)]
struct EncodedCapture {
    bytes: Vec<u8>,
    width: u32,
    height: u32,
}

struct ActiveCaptureGuard;

impl Drop for ActiveCaptureGuard {
    fn drop(&mut self) {
        if let Ok(mut active) = ACTIVE_CAPTURE.lock() {
            *active = None;
        }
    }
}

struct WindowRestoreGuard {
    window: Option<WebviewWindow>,
    was_visible: bool,
    was_minimized: bool,
    was_maximized: bool,
    was_focused: bool,
    changed: bool,
}

impl WindowRestoreGuard {
    fn unchanged() -> Self {
        Self {
            window: None,
            was_visible: false,
            was_minimized: false,
            was_maximized: false,
            was_focused: false,
            changed: false,
        }
    }

    fn minimize(app: &AppHandle) -> Result<Self, AppError> {
        let Some(window) = app.get_webview_window("main") else {
            return Ok(Self::unchanged());
        };

        let was_visible = window.is_visible().unwrap_or(true);
        let was_minimized = window.is_minimized().unwrap_or(false);
        let was_maximized = window.is_maximized().unwrap_or(false);
        let was_focused = window.is_focused().unwrap_or(false);
        let mut guard = Self {
            window: Some(window.clone()),
            was_visible,
            was_minimized,
            was_maximized,
            was_focused,
            changed: false,
        };

        if was_visible && !was_minimized {
            window.minimize()?;
            guard.changed = true;
        }
        Ok(guard)
    }

    fn restore(&mut self) {
        if !self.changed {
            return;
        }
        let Some(window) = &self.window else {
            return;
        };

        if self.was_visible {
            let _ = window.show();
            if self.was_minimized {
                let _ = window.minimize();
            } else {
                let _ = window.unminimize();
            }
            if self.was_maximized {
                let _ = window.maximize();
            }
            if self.was_focused {
                let _ = window.set_focus();
            }
        } else {
            let _ = window.hide();
        }
        self.changed = false;
    }
}

impl Drop for WindowRestoreGuard {
    fn drop(&mut self) {
        self.restore();
    }
}

fn config_error(message: impl Into<String>) -> AppError {
    AppError::ConfigIo(message.into())
}

fn lock_active_capture() -> Result<MutexGuard<'static, Option<CancellationToken>>, AppError> {
    ACTIVE_CAPTURE
        .lock()
        .map_err(|_| config_error("Appshot capture state is unavailable"))
}

fn begin_capture() -> Result<(ActiveCaptureGuard, CancellationToken), AppError> {
    let mut active = lock_active_capture()?;
    if active.is_some() {
        return Err(config_error(
            "Another Appshot capture is already in progress",
        ));
    }
    let token = CancellationToken::new();
    *active = Some(token.clone());
    Ok((ActiveCaptureGuard, token))
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
        let _ = unsafe { CGRequestScreenCaptureAccess() };
        let has_permission = unsafe { CGPreflightScreenCaptureAccess() };
        if !has_permission && !first_time {
            let _ = tokio::process::Command::new("open")
                .arg(
                    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
                )
                .spawn();
        }
        has_permission
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = first_time;
        true
    }
}

#[tauri::command]
pub fn cancel_appshot_capture() -> Result<bool, AppError> {
    let active = lock_active_capture()?;
    if let Some(token) = active.as_ref() {
        token.cancel();
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub async fn capture_screen(
    app: AppHandle,
    target: CaptureTarget,
    options: CaptureOptions,
) -> Result<CaptureResult, AppError> {
    options.validate()?;
    let (_active_guard, cancellation) = begin_capture()?;

    if options.delay_seconds > 0 {
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(options.delay_seconds)) => {}
            _ = cancellation.cancelled() => return Err(config_error("Appshot capture cancelled")),
        }
    }
    if cancellation.is_cancelled() {
        return Err(config_error("Appshot capture cancelled"));
    }

    let mut restore_guard = if options.hide_window && target != CaptureTarget::Window {
        let guard = WindowRestoreGuard::minimize(&app)?;
        tokio::time::sleep(Duration::from_millis(450)).await;
        guard
    } else {
        WindowRestoreGuard::unchanged()
    };

    if cancellation.is_cancelled() {
        return Err(config_error("Appshot capture cancelled"));
    }

    let output_dir = resolve_output_directory(
        &app,
        options.custom_folder.as_deref(),
        options.persist_to_gallery,
    )?;
    let format = options.format;
    let quality = options.quality;
    let max_output_bytes = options.max_output_bytes;

    let capture = tokio::task::spawn_blocking(move || {
        let image = capture_target(target)?;
        validate_capture_dimensions(&image)?;
        let encoded = encode_with_limit(image, format, quality, max_output_bytes)?;
        let output_path = write_capture_atomically(&output_dir, format, &encoded.bytes)?;
        Ok::<_, AppError>((output_path, encoded))
    })
    .await
    .map_err(|error| config_error(format!("Appshot worker failed: {error}")))??;

    restore_guard.restore();
    let (output_path, encoded) = capture;
    let size = fs::metadata(&output_path)?.len();
    let name = output_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("appshot")
        .to_string();

    let token_registry = app.state::<FileTokenRegistry>();
    let token = if options.persist_to_gallery {
        token_registry.register(output_path.clone())
    } else {
        token_registry.register_ephemeral(output_path.clone())
    };

    Ok(CaptureResult {
        path: output_path.to_string_lossy().into_owned(),
        token,
        name,
        size,
        width: encoded.width,
        height: encoded.height,
        is_ephemeral: !options.persist_to_gallery,
    })
}

fn capture_target(target: CaptureTarget) -> Result<RgbaImage, AppError> {
    match target {
        CaptureTarget::Primary => capture_primary_monitor(),
        CaptureTarget::All => capture_all_monitors(),
        CaptureTarget::Window => capture_sythoria_window(),
    }
}

fn capture_primary_monitor() -> Result<RgbaImage, AppError> {
    let monitors = Monitor::all().map_err(|error| config_error(error.to_string()))?;
    let monitor = monitors
        .iter()
        .find(|monitor| monitor.is_primary().unwrap_or(false))
        .or_else(|| monitors.first())
        .ok_or_else(|| config_error("No display is available for capture"))?;
    monitor
        .capture_image()
        .map_err(|error| config_error(format!("Failed to capture primary display: {error}")))
}

fn capture_all_monitors() -> Result<RgbaImage, AppError> {
    let monitors = Monitor::all().map_err(|error| config_error(error.to_string()))?;
    if monitors.is_empty() {
        return Err(config_error("No displays are available for capture"));
    }

    let mut captured = Vec::with_capacity(monitors.len());
    for monitor in monitors {
        let x = i64::from(
            monitor
                .x()
                .map_err(|error| config_error(error.to_string()))?,
        );
        let y = i64::from(
            monitor
                .y()
                .map_err(|error| config_error(error.to_string()))?,
        );
        let image = monitor
            .capture_image()
            .map_err(|error| config_error(format!("Failed to capture a display: {error}")))?;
        captured.push((x, y, image));
    }

    let min_x = captured.iter().map(|(x, _, _)| *x).min().unwrap_or(0);
    let min_y = captured.iter().map(|(_, y, _)| *y).min().unwrap_or(0);
    let max_x = captured
        .iter()
        .map(|(x, _, image)| x.saturating_add(i64::from(image.width())))
        .max()
        .unwrap_or(0);
    let max_y = captured
        .iter()
        .map(|(_, y, image)| y.saturating_add(i64::from(image.height())))
        .max()
        .unwrap_or(0);
    let width = u32::try_from(max_x.saturating_sub(min_x))
        .map_err(|_| config_error("Combined display width is too large"))?;
    let height = u32::try_from(max_y.saturating_sub(min_y))
        .map_err(|_| config_error("Combined display height is too large"))?;

    validate_pixel_count(width, height)?;
    let mut canvas = RgbaImage::new(width, height);
    for (x, y, image) in captured {
        overlay(&mut canvas, &image, x - min_x, y - min_y);
    }
    Ok(canvas)
}

fn capture_sythoria_window() -> Result<RgbaImage, AppError> {
    let process_id = std::process::id();
    let windows = XcapWindow::all().map_err(|error| config_error(error.to_string()))?;
    let mut candidates: Vec<XcapWindow> = windows
        .into_iter()
        .filter(|window| window.pid().ok() == Some(process_id))
        .filter(|window| !window.is_minimized().unwrap_or(true))
        .collect();

    candidates.sort_by_key(|window| {
        let focused = window.is_focused().unwrap_or(false);
        let area = u64::from(window.width().unwrap_or(0)) * u64::from(window.height().unwrap_or(0));
        (focused, area)
    });
    let window = candidates
        .pop()
        .ok_or_else(|| config_error("The Sythoria window is not available for capture"))?;
    window
        .capture_image()
        .map_err(|error| config_error(format!("Failed to capture the Sythoria window: {error}")))
}

fn validate_capture_dimensions(image: &RgbaImage) -> Result<(), AppError> {
    if image.width() == 0 || image.height() == 0 {
        return Err(config_error("The captured image is empty"));
    }
    validate_pixel_count(image.width(), image.height())
}

fn validate_pixel_count(width: u32, height: u32) -> Result<(), AppError> {
    let pixels = u64::from(width)
        .checked_mul(u64::from(height))
        .ok_or_else(|| config_error("Capture dimensions overflow"))?;
    if pixels > MAX_CAPTURE_PIXELS {
        return Err(config_error(format!(
            "Capture is too large ({width}x{height}); reduce the selected display area"
        )));
    }
    Ok(())
}

fn encode_with_limit(
    mut image: RgbaImage,
    format: CaptureFormat,
    quality: u8,
    max_output_bytes: Option<u64>,
) -> Result<EncodedCapture, AppError> {
    for _ in 0..6 {
        let bytes = encode_image(&image, format, quality)?;
        let within_limit = max_output_bytes
            .map(|limit| bytes.len() as u64 <= limit)
            .unwrap_or(true);
        if within_limit {
            return Ok(EncodedCapture {
                bytes,
                width: image.width(),
                height: image.height(),
            });
        }

        let limit = max_output_bytes.unwrap_or(MAX_OUTPUT_BYTES) as f64;
        let ratio = ((limit / bytes.len() as f64).sqrt() * 0.9).clamp(0.25, 0.85);
        let next_width = ((image.width() as f64 * ratio).round() as u32).max(320);
        let next_height = ((image.height() as f64 * ratio).round() as u32).max(200);
        if next_width >= image.width() || next_height >= image.height() {
            break;
        }
        image = resize(&image, next_width, next_height, FilterType::Lanczos3);
    }

    Err(config_error(
        "Captured image could not be reduced below the attachment size limit",
    ))
}

fn encode_image(
    image: &RgbaImage,
    format: CaptureFormat,
    quality: u8,
) -> Result<Vec<u8>, AppError> {
    let mut bytes = Vec::new();
    match format {
        CaptureFormat::Png => {
            PngEncoder::new(&mut bytes)
                .write_image(
                    image.as_raw(),
                    image.width(),
                    image.height(),
                    ExtendedColorType::Rgba8,
                )
                .map_err(|error| config_error(format!("Failed to encode PNG: {error}")))?;
        }
        CaptureFormat::Jpeg => {
            let rgb = image::DynamicImage::ImageRgba8(image.clone()).to_rgb8();
            JpegEncoder::new_with_quality(&mut bytes, quality)
                .encode(
                    rgb.as_raw(),
                    rgb.width(),
                    rgb.height(),
                    ExtendedColorType::Rgb8,
                )
                .map_err(|error| config_error(format!("Failed to encode JPEG: {error}")))?;
        }
    }
    Ok(bytes)
}

fn write_capture_atomically(
    directory: &Path,
    format: CaptureFormat,
    bytes: &[u8],
) -> Result<PathBuf, AppError> {
    fs::create_dir_all(directory)?;
    let unique = Uuid::new_v4().simple().to_string();
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S_%3f");
    let filename = format!("appshot_{timestamp}_{unique}.{}", format.extension());
    let output_path = directory.join(filename);
    let temporary_path = directory.join(format!(".appshot-{unique}.tmp"));

    let write_result = (|| -> Result<(), AppError> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary_path)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temporary_path, &output_path)?;
        Ok(())
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    write_result?;
    Ok(output_path)
}

fn resolve_output_directory(
    app: &AppHandle,
    custom_folder: Option<&str>,
    persist_to_gallery: bool,
) -> Result<PathBuf, AppError> {
    if !persist_to_gallery {
        let cache_dir = app.path().app_cache_dir()?.join("appshots");
        fs::create_dir_all(&cache_dir)?;
        prune_ephemeral_directory(&cache_dir);
        return cache_dir
            .canonicalize()
            .map_err(|error| config_error(format!("Failed to prepare Appshot cache: {error}")));
    }
    resolve_gallery_directory(app, custom_folder)
}

fn resolve_gallery_directory(
    app: &AppHandle,
    custom_folder: Option<&str>,
) -> Result<PathBuf, AppError> {
    if let Some(folder) = custom_folder.filter(|folder| !folder.trim().is_empty()) {
        let selected = PathBuf::from(folder);
        if !selected.is_dir() {
            return Err(config_error(
                "The custom Appshot folder must already exist and be a directory",
            ));
        }
        let canonical = selected.canonicalize().map_err(|error| {
            config_error(format!(
                "Failed to resolve the custom Appshot folder: {error}"
            ))
        })?;
        if !is_path_in_allowed_bases(app, &canonical)? {
            return Err(config_error(
                "The Appshot folder must be inside Pictures, Documents, Downloads, Desktop, or App Data",
            ));
        }
        return Ok(canonical);
    }

    let default = app.path().app_data_dir()?.join("appshots");
    fs::create_dir_all(&default)?;
    default
        .canonicalize()
        .map_err(|error| config_error(format!("Failed to prepare the Appshot gallery: {error}")))
}

fn is_path_in_allowed_bases(app: &AppHandle, canonical_path: &Path) -> Result<bool, AppError> {
    let bases = [
        app.path().app_data_dir().ok(),
        app.path().picture_dir().ok(),
        app.path().document_dir().ok(),
        app.path().download_dir().ok(),
        app.path().desktop_dir().ok(),
    ];

    let mut canonical_bases = Vec::new();
    for base in bases.into_iter().flatten() {
        if !base.exists() {
            continue;
        }
        let canonical_base = base.canonicalize().map_err(|error| {
            config_error(format!(
                "Failed to validate an allowed Appshot directory: {error}"
            ))
        })?;
        canonical_bases.push(canonical_base);
    }
    Ok(path_is_within_bases(canonical_path, &canonical_bases))
}

fn path_is_within_bases(canonical_path: &Path, canonical_bases: &[PathBuf]) -> bool {
    canonical_bases
        .iter()
        .any(|base| canonical_path.starts_with(base))
}

fn prune_ephemeral_directory(directory: &Path) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let path = entry.path();
        if !is_appshot_file(&path) {
            continue;
        }
        let is_expired = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .map(|age| age > EPHEMERAL_MAX_AGE)
            .unwrap_or(false);
        if is_expired {
            let _ = fs::remove_file(path);
        }
    }
}

fn is_appshot_file(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    let lowercase = name.to_ascii_lowercase();
    lowercase.starts_with("appshot_")
        && (lowercase.ends_with(".png")
            || lowercase.ends_with(".jpg")
            || lowercase.ends_with(".jpeg"))
}

fn collect_appshots(directory: &Path) -> Result<Vec<(PathBuf, u64, SystemTime)>, AppError> {
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() || !is_appshot_file(&path) {
            continue;
        }
        let metadata = entry.metadata()?;
        files.push((path, metadata.len(), metadata.modified()?));
    }
    Ok(files)
}

#[tauri::command]
pub async fn list_appshots(
    app: AppHandle,
    custom_folder: Option<String>,
) -> Result<Vec<AppshotFileMetadata>, AppError> {
    let directory = resolve_gallery_directory(&app, custom_folder.as_deref())?;
    tokio::task::spawn_blocking(move || {
        let mut files = collect_appshots(&directory)?;
        files.sort_by_key(|item| Reverse(item.2));
        Ok(files
            .into_iter()
            .map(|(path, size, modified)| {
                let timestamp = chrono::DateTime::<chrono::Local>::from(modified)
                    .format("%Y-%m-%d %H:%M:%S")
                    .to_string();
                AppshotFileMetadata {
                    name: path
                        .file_name()
                        .and_then(|name| name.to_str())
                        .unwrap_or("appshot")
                        .to_string(),
                    path: path.to_string_lossy().into_owned(),
                    size,
                    timestamp,
                }
            })
            .collect())
    })
    .await
    .map_err(|error| config_error(format!("Appshot gallery worker failed: {error}")))?
}

#[tauri::command]
pub async fn select_appshot_folder(app: AppHandle) -> Result<Option<String>, AppError> {
    use tauri_plugin_dialog::DialogExt;
    let selection = app
        .dialog()
        .file()
        .set_title("Select Appshot Save Folder")
        .blocking_pick_folder();
    let Some(selection) = selection else {
        return Ok(None);
    };
    let path = match selection {
        tauri_plugin_dialog::FilePath::Path(path) => path,
        tauri_plugin_dialog::FilePath::Url(url) => url
            .to_file_path()
            .map_err(|_| config_error("The selected folder URL is invalid"))?,
    };
    if !path.is_dir() {
        return Err(config_error("The selected Appshot folder does not exist"));
    }
    let canonical = path.canonicalize()?;
    if !is_path_in_allowed_bases(&app, &canonical)? {
        return Err(config_error(
            "The selected folder must be inside Pictures, Documents, Downloads, Desktop, or App Data",
        ));
    }
    Ok(Some(canonical.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn delete_appshot(
    app: AppHandle,
    path: String,
    custom_folder: Option<String>,
) -> Result<(), AppError> {
    let directory = resolve_gallery_directory(&app, custom_folder.as_deref())?;
    let requested = PathBuf::from(path);
    tokio::task::spawn_blocking(move || {
        let canonical_file = requested
            .canonicalize()
            .map_err(|_| config_error("Appshot file was not found"))?;
        if !canonical_file.starts_with(&directory) || !is_appshot_file(&canonical_file) {
            return Err(config_error("Access denied: invalid Appshot file"));
        }
        fs::remove_file(canonical_file)?;
        Ok(())
    })
    .await
    .map_err(|error| config_error(format!("Appshot delete worker failed: {error}")))?
}

#[tauri::command]
pub async fn clear_appshots(
    app: AppHandle,
    custom_folder: Option<String>,
) -> Result<u32, AppError> {
    let directory = resolve_gallery_directory(&app, custom_folder.as_deref())?;
    tokio::task::spawn_blocking(move || clear_appshot_files(&directory))
        .await
        .map_err(|error| config_error(format!("Appshot clear worker failed: {error}")))?
}

fn clear_appshot_files(directory: &Path) -> Result<u32, AppError> {
    let mut deleted = 0;
    let mut failures = Vec::new();
    for (path, _, _) in collect_appshots(directory)? {
        match fs::remove_file(&path) {
            Ok(()) => deleted += 1,
            Err(error) => failures.push(format!("{}: {error}", path.display())),
        }
    }
    if failures.is_empty() {
        Ok(deleted)
    } else {
        Err(config_error(format!(
            "Deleted {deleted} Appshots, but {} files failed: {}",
            failures.len(),
            failures.join("; ")
        )))
    }
}

#[tauri::command]
pub async fn wipe_appshot_data(
    app: AppHandle,
    custom_folder: Option<String>,
) -> Result<u32, AppError> {
    let mut directories = vec![
        app.path().app_data_dir()?.join("appshots"),
        app.path().app_cache_dir()?.join("appshots"),
    ];
    if let Some(folder) = custom_folder.filter(|folder| !folder.trim().is_empty()) {
        let candidate = PathBuf::from(folder);
        if candidate.is_dir() {
            let canonical = candidate.canonicalize()?;
            if is_path_in_allowed_bases(&app, &canonical)? {
                directories.push(canonical);
            }
        }
    }
    directories.sort();
    directories.dedup();

    tokio::task::spawn_blocking(move || {
        let mut deleted = 0;
        for directory in directories {
            deleted += clear_appshot_files(&directory)?;
            let _ = fs::remove_dir(&directory);
        }
        Ok(deleted)
    })
    .await
    .map_err(|error| config_error(format!("Appshot wipe worker failed: {error}")))?
}

#[tauri::command]
pub async fn run_appshots_clean(
    app: AppHandle,
    token_registry: tauri::State<'_, FileTokenRegistry>,
    clean_type: CleanType,
    clean_value: u64,
    custom_folder: Option<String>,
) -> Result<u32, AppError> {
    if clean_value == 0 || clean_value > MAX_CLEAN_VALUE {
        return Err(config_error("Cleanup value is outside the supported range"));
    }
    let directory = resolve_gallery_directory(&app, custom_folder.as_deref())?;
    let protected_paths = token_registry.registered_paths();

    tokio::task::spawn_blocking(move || {
        let mut files = collect_appshots(&directory)?;
        files.retain(|(path, _, _)| !protected_paths.contains(path));
        files.sort_by_key(|item| item.2);
        let mut to_delete = Vec::new();

        match clean_type {
            CleanType::Count => {
                let excess = files.len().saturating_sub(clean_value as usize);
                to_delete.extend(files.iter().take(excess).map(|item| item.0.clone()));
            }
            CleanType::Size => {
                let max_bytes = clean_value
                    .checked_mul(1024 * 1024)
                    .ok_or_else(|| config_error("Cleanup size limit overflowed"))?;
                let mut total: u64 = files.iter().map(|item| item.1).sum();
                for (path, size, _) in &files {
                    if total <= max_bytes {
                        break;
                    }
                    to_delete.push(path.clone());
                    total = total.saturating_sub(*size);
                }
            }
            CleanType::Age => {
                let max_age = Duration::from_secs(
                    clean_value
                        .checked_mul(24 * 60 * 60)
                        .ok_or_else(|| config_error("Cleanup age limit overflowed"))?,
                );
                let now = SystemTime::now();
                to_delete.extend(files.iter().filter_map(|(path, _, modified)| {
                    now.duration_since(*modified)
                        .ok()
                        .filter(|age| *age > max_age)
                        .map(|_| path.clone())
                }));
            }
        }

        let mut deleted = 0;
        for path in to_delete {
            if fs::remove_file(path).is_ok() {
                deleted += 1;
            }
        }
        Ok(deleted)
    })
    .await
    .map_err(|error| config_error(format!("Appshot cleanup worker failed: {error}")))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::ImageFormat;

    fn sample_image(width: u32, height: u32) -> RgbaImage {
        RgbaImage::from_fn(width, height, |x, y| {
            image::Rgba([(x % 255) as u8, (y % 255) as u8, 128, 200])
        })
    }

    #[test]
    fn jpeg_encoding_accepts_rgba_capture_data() {
        let encoded = encode_image(&sample_image(32, 24), CaptureFormat::Jpeg, 85).unwrap();
        let decoded = image::load_from_memory_with_format(&encoded, ImageFormat::Jpeg).unwrap();
        assert_eq!(decoded.width(), 32);
        assert_eq!(decoded.height(), 24);
    }

    #[test]
    fn png_encoding_preserves_dimensions() {
        let encoded = encode_image(&sample_image(20, 10), CaptureFormat::Png, 85).unwrap();
        let decoded = image::load_from_memory_with_format(&encoded, ImageFormat::Png).unwrap();
        assert_eq!(decoded.width(), 20);
        assert_eq!(decoded.height(), 10);
    }

    #[test]
    fn size_limit_resizes_large_capture() {
        let original = sample_image(1600, 1200);
        let encoded =
            encode_with_limit(original, CaptureFormat::Jpeg, 85, Some(64 * 1024)).unwrap();
        assert!(encoded.bytes.len() <= 64 * 1024);
        assert!(encoded.width < 1600);
        assert!(encoded.height < 1200);
    }

    #[test]
    fn capture_options_reject_invalid_values() {
        let options = CaptureOptions {
            format: CaptureFormat::Png,
            quality: 0,
            delay_seconds: MAX_DELAY_SECONDS + 1,
            hide_window: false,
            custom_folder: None,
            persist_to_gallery: false,
            max_output_bytes: None,
        };
        assert!(options.validate().is_err());
    }

    #[test]
    fn atomic_writer_uses_unique_names_and_leaves_no_temp_files() {
        let directory =
            std::env::temp_dir().join(format!("sythoria-appshot-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let first = write_capture_atomically(&directory, CaptureFormat::Png, b"one").unwrap();
        let second = write_capture_atomically(&directory, CaptureFormat::Png, b"two").unwrap();
        assert_ne!(first, second);
        assert!(first.exists());
        assert!(second.exists());
        assert!(fs::read_dir(&directory)
            .unwrap()
            .flatten()
            .all(|entry| entry.path().extension().and_then(|ext| ext.to_str()) != Some("tmp")));
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn canonical_containment_rejects_parent_traversal_outside_allowed_base() {
        let root =
            std::env::temp_dir().join(format!("sythoria-appshot-path-test-{}", Uuid::new_v4()));
        let allowed = root.join("allowed");
        let outside = root.join("outside");
        fs::create_dir_all(&allowed).unwrap();
        fs::create_dir_all(&outside).unwrap();

        let canonical_allowed = allowed.canonicalize().unwrap();
        let traversal = allowed.join("..").join("outside").canonicalize().unwrap();
        assert!(!path_is_within_bases(&traversal, &[canonical_allowed]));

        fs::remove_dir_all(root).unwrap();
    }
}
