use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use futures_util::StreamExt;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::client_builder;
use crate::AppError;

fn convert_to_mono(samples: &[f32], channels: u16) -> Vec<f32> {
    if channels == 1 {
        return samples.to_vec();
    }
    let mut mono = Vec::with_capacity(samples.len() / channels as usize);
    for chunk in samples.chunks_exact(channels as usize) {
        let sum: f32 = chunk.iter().sum();
        mono.push(sum / channels as f32);
    }
    mono
}

fn resample(samples: &[f32], source_rate: u32, target_rate: u32) -> Vec<f32> {
    if source_rate == target_rate || samples.is_empty() {
        return samples.to_vec();
    }
    let ratio = source_rate as f64 / target_rate as f64;
    let new_length = (samples.len() as f64 / ratio).round() as usize;
    let mut result = Vec::with_capacity(new_length);
    for i in 0..new_length {
        let orig_idx = i as f64 * ratio;
        let index_below = orig_idx.floor() as usize;
        let index_above = orig_idx.ceil() as usize;
        let weight = orig_idx - index_below as f64;
        let val_below = samples[index_below];
        let val_above = if index_above < samples.len() {
            samples[index_above]
        } else {
            val_below
        };
        result.push(val_below + weight as f32 * (val_above - val_below));
    }
    result
}

struct SendSyncStream(cpal::Stream);
unsafe impl Send for SendSyncStream {}
unsafe impl Sync for SendSyncStream {}

static RECORDED_SAMPLES: LazyLock<Arc<Mutex<Vec<f32>>>> =
    LazyLock::new(|| Arc::new(Mutex::new(Vec::new())));

static RECORDING_STREAM: LazyLock<Mutex<Option<SendSyncStream>>> =
    LazyLock::new(|| Mutex::new(None));

#[tauri::command]
pub async fn start_recording() -> Result<(), AppError> {
    if let Ok(mut samples) = RECORDED_SAMPLES.lock() {
        samples.clear();
    }

    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| AppError::ConfigIo("No default input device found".to_string()))?;

    let config = device
        .default_input_config()
        .map_err(|e| AppError::ConfigIo(format!("Failed to get default input config: {}", e)))?;

    let channels = config.channels();
    let samples_clone = RECORDED_SAMPLES.clone();

    let error_callback = |err| {
        log::error!("An error occurred on the audio stream: {}", err);
    };

    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => device.build_input_stream(
            config.into(),
            move |data: &[f32], _| {
                if let Ok(mut samples) = samples_clone.lock() {
                    let mono = convert_to_mono(data, channels);
                    samples.extend_from_slice(&mono);
                }
            },
            error_callback,
            None,
        ),
        cpal::SampleFormat::I16 => device.build_input_stream(
            config.into(),
            move |data: &[i16], _| {
                if let Ok(mut samples) = samples_clone.lock() {
                    let mut float_data = vec![0.0f32; data.len()];
                    for (i, &s) in data.iter().enumerate() {
                        float_data[i] = s as f32 / 32768.0;
                    }
                    let mono = convert_to_mono(&float_data, channels);
                    samples.extend_from_slice(&mono);
                }
            },
            error_callback,
            None,
        ),
        cpal::SampleFormat::U16 => device.build_input_stream(
            config.into(),
            move |data: &[u16], _| {
                if let Ok(mut samples) = samples_clone.lock() {
                    let mut float_data = vec![0.0f32; data.len()];
                    for (i, &s) in data.iter().enumerate() {
                        float_data[i] = (s as f32 - 32768.0) / 32768.0;
                    }
                    let mono = convert_to_mono(&float_data, channels);
                    samples.extend_from_slice(&mono);
                }
            },
            error_callback,
            None,
        ),
        _ => return Err(AppError::ConfigIo("Unsupported sample format".to_string())),
    }
    .map_err(|e| AppError::ConfigIo(format!("Failed to build input stream: {}", e)))?;

    stream
        .play()
        .map_err(|e| AppError::ConfigIo(format!("Failed to play stream: {}", e)))?;

    if let Ok(mut active_stream) = RECORDING_STREAM.lock() {
        *active_stream = Some(SendSyncStream(stream));
    }

    Ok(())
}

#[tauri::command]
pub async fn stop_recording() -> Result<(), AppError> {
    if let Ok(mut active_stream) = RECORDING_STREAM.lock() {
        if let Some(SendSyncStream(stream)) = active_stream.take() {
            let _ = stream.pause();
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn get_recorded_samples() -> Result<Vec<f32>, AppError> {
    let samples = if let Ok(samples) = RECORDED_SAMPLES.lock() {
        samples.clone()
    } else {
        return Err(AppError::ConfigIo(
            "Failed to lock recorded samples".to_string(),
        ));
    };

    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| AppError::ConfigIo("No default input device found".to_string()))?;
    let config = device
        .default_input_config()
        .map_err(|e| AppError::ConfigIo(format!("Failed to get default input config: {}", e)))?;
    let sample_rate = config.sample_rate();

    let resampled = resample(&samples, sample_rate, 16000);
    Ok(resampled)
}

static WHISPER_CONTEXT_CACHE: LazyLock<Mutex<Option<(String, WhisperContext)>>> =
    LazyLock::new(|| Mutex::new(None));

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct WhisperDownloadProgress {
    model_id: String,
    downloaded: u64,
    total: Option<u64>,
    percentage: f32,
    done: bool,
}

struct ActiveWhisperDownload {
    operation_id: u64,
    cancelled: Arc<AtomicBool>,
    cancel_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

#[derive(Default)]
struct WhisperDownloadState {
    active: Option<ActiveWhisperDownload>,
}

struct WhisperDownloadRegistration {
    cancelled: Arc<AtomicBool>,
    cancel_rx: tokio::sync::oneshot::Receiver<()>,
}

impl WhisperDownloadState {
    fn begin(&mut self, operation_id: u64) -> Result<WhisperDownloadRegistration, AppError> {
        if self.active.is_some() {
            return Err(AppError::ConfigIo(
                "A Whisper model download is already in progress".to_string(),
            ));
        }

        let cancelled = Arc::new(AtomicBool::new(false));
        let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel();
        self.active = Some(ActiveWhisperDownload {
            operation_id,
            cancelled: cancelled.clone(),
            cancel_tx: Some(cancel_tx),
        });

        Ok(WhisperDownloadRegistration {
            cancelled,
            cancel_rx,
        })
    }

    fn cancel_active(&mut self) {
        if let Some(active) = self.active.as_mut() {
            active.cancelled.store(true, Ordering::SeqCst);
            if let Some(cancel_tx) = active.cancel_tx.take() {
                let _ = cancel_tx.send(());
            }
        }
    }

    fn finish(&mut self, operation_id: u64) {
        if self
            .active
            .as_ref()
            .is_some_and(|active| active.operation_id == operation_id)
        {
            self.active = None;
        }
    }
}

static WHISPER_DOWNLOAD_STATE: LazyLock<Mutex<WhisperDownloadState>> =
    LazyLock::new(|| Mutex::new(WhisperDownloadState::default()));
static NEXT_WHISPER_DOWNLOAD_ID: AtomicU64 = AtomicU64::new(1);

const MAX_WHISPER_MODEL_BYTES: u64 = 4 * 1024 * 1024 * 1024;

fn whisper_download_staging_paths(models_dir: &Path, operation_id: u64) -> (PathBuf, PathBuf) {
    let process_id = std::process::id();
    (
        models_dir.join(format!(
            ".whisper-download-{process_id}-{operation_id}.part"
        )),
        models_dir.join(format!(
            ".whisper-download-{process_id}-{operation_id}.backup"
        )),
    )
}

async fn remove_partial_download(partial_path: &Path) {
    if let Err(error) = tokio::fs::remove_file(partial_path).await {
        if error.kind() != std::io::ErrorKind::NotFound {
            log::warn!(
                "Failed to remove partial Whisper download {}: {}",
                partial_path.display(),
                error
            );
        }
    }
}

async fn promote_whisper_download(
    partial_path: &Path,
    destination_path: &Path,
    _backup_path: &Path,
) -> Result<(), AppError> {
    match tokio::fs::symlink_metadata(destination_path).await {
        Ok(metadata) if !metadata.file_type().is_file() => {
            return Err(AppError::ConfigIo(format!(
                "Refusing to replace non-file Whisper model destination: {}",
                destination_path.display()
            )));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }

    #[cfg(not(target_os = "windows"))]
    {
        tokio::fs::rename(partial_path, destination_path).await?;
    }

    // Windows rename does not replace an existing file. Preserve the old model as a
    // uniquely named backup until the fully validated partial download is in place.
    #[cfg(target_os = "windows")]
    {
        let destination_exists = tokio::fs::try_exists(destination_path).await?;
        if !destination_exists {
            tokio::fs::rename(partial_path, destination_path).await?;
            return Ok(());
        }

        tokio::fs::rename(destination_path, _backup_path).await?;
        if let Err(promote_error) = tokio::fs::rename(partial_path, destination_path).await {
            return match tokio::fs::rename(_backup_path, destination_path).await {
                Ok(()) => Err(promote_error.into()),
                Err(restore_error) => Err(AppError::ConfigIo(format!(
                    "Failed to promote Whisper model ({promote_error}) and restore the previous model ({restore_error}); the previous model remains at {}",
                    _backup_path.display()
                ))),
            };
        }

        if let Err(error) = tokio::fs::remove_file(_backup_path).await {
            log::warn!(
                "Whisper model was updated, but its temporary backup could not be removed at {}: {}",
                _backup_path.display(),
                error
            );
        }
    }

    Ok(())
}

fn validate_whisper_model_file_name(file_name: &str) -> Result<&str, AppError> {
    if file_name.is_empty() || file_name.len() > 255 {
        return Err(AppError::AppPath(
            "Invalid Whisper model file name".to_string(),
        ));
    }

    // Reject both platform separators so a persisted model name stays safe if the
    // app data directory is later used on another operating system.
    if file_name.contains(['/', '\\', '\0']) {
        return Err(AppError::AppPath(
            "Whisper model file name must not contain a path".to_string(),
        ));
    }

    let path = Path::new(file_name);
    let mut components = path.components();
    let is_single_file =
        matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none();
    if !is_single_file || path.file_name().and_then(|name| name.to_str()) != Some(file_name) {
        return Err(AppError::AppPath(
            "Whisper model file name must not contain a path".to_string(),
        ));
    }

    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default();
    if !extension.eq_ignore_ascii_case("bin") && !extension.eq_ignore_ascii_case("gguf") {
        return Err(AppError::AppPath(
            "Whisper model file must use a .bin or .gguf extension".to_string(),
        ));
    }

    Ok(file_name)
}

fn whisper_file_name_from_url(url: &str) -> Result<String, AppError> {
    let parsed = url::Url::parse(url)
        .map_err(|e| AppError::RequestFailed(format!("Invalid model URL: {e}")))?;
    if parsed.scheme() != "https" {
        return Err(AppError::RequestFailed(
            "Whisper models must be downloaded over HTTPS".to_string(),
        ));
    }

    let file_name = parsed
        .path_segments()
        .and_then(|mut segments| segments.rfind(|segment| !segment.is_empty()))
        .ok_or_else(|| AppError::AppPath("Model URL does not contain a file name".to_string()))?;
    validate_whisper_model_file_name(file_name)?;
    Ok(file_name.to_string())
}

#[tauri::command]
pub async fn cancel_whisper_download() -> Result<(), AppError> {
    WHISPER_DOWNLOAD_STATE
        .lock()
        .map_err(|e| AppError::ConfigIo(format!("Poisoned lock: {}", e)))?
        .cancel_active();
    Ok(())
}

#[tauri::command]
pub async fn download_whisper_model(
    app: AppHandle,
    model_id: String,
    url: String,
) -> Result<String, AppError> {
    let operation_id = NEXT_WHISPER_DOWNLOAD_ID.fetch_add(1, Ordering::Relaxed);
    let WhisperDownloadRegistration {
        cancelled,
        mut cancel_rx,
    } = WHISPER_DOWNLOAD_STATE
        .lock()
        .map_err(|e| AppError::ConfigIo(format!("Poisoned lock: {}", e)))?
        .begin(operation_id)?;

    struct DownloadStateGuard {
        operation_id: u64,
    }
    impl Drop for DownloadStateGuard {
        fn drop(&mut self) {
            if let Ok(mut state) = WHISPER_DOWNLOAD_STATE.lock() {
                state.finish(self.operation_id);
            }
        }
    }
    let _state_guard = DownloadStateGuard { operation_id };

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::AppPath(e.to_string()))?;
    let models_dir = app_data_dir.join("whisper_models");
    fs::create_dir_all(&models_dir)?;

    let file_name = whisper_file_name_from_url(&url)?;
    let destination_path = models_dir.join(&file_name);
    let (partial_path, backup_path) = whisper_download_staging_paths(&models_dir, operation_id);

    let result = async {
        let client = client_builder()
            .build()
            .map_err(|e| AppError::RequestFailed(e.to_string()))?;

        let res = tokio::select! {
            _ = &mut cancel_rx => {
                return Err(AppError::ConfigIo("Download cancelled by user".to_string()));
            }
            res_result = client.get(&url).send() => {
                res_result.map_err(|e| AppError::RequestFailed(e.to_string()))?
            }
        };
        if !res.status().is_success() {
            return Err(AppError::RequestFailed(format!(
                "Model download failed with HTTP status {}",
                res.status()
            )));
        }
        let total_size = res.content_length();
        if total_size.is_some_and(|size| size > MAX_WHISPER_MODEL_BYTES) {
            return Err(AppError::RequestFailed(format!(
                "Whisper model exceeds the {} GiB download limit",
                MAX_WHISPER_MODEL_BYTES / (1024 * 1024 * 1024)
            )));
        }

        let mut file = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&partial_path)
            .await?;
        let mut stream = res.bytes_stream();
        let mut downloaded = 0u64;
        let mut last_emit_time = std::time::Instant::now();
        let mut last_emitted_percentage = -1.0f32;

        loop {
            tokio::select! {
                _ = &mut cancel_rx => {
                    return Err(AppError::ConfigIo("Download cancelled by user".to_string()));
                }
                chunk_result_opt = stream.next() => {
                    match chunk_result_opt {
                        Some(chunk_result) => {
                            if cancelled.load(Ordering::SeqCst) {
                                return Err(AppError::ConfigIo("Download cancelled by user".to_string()));
                            }
                            let chunk = chunk_result.map_err(|e| AppError::RequestFailed(e.to_string()))?;
                            let next_downloaded = downloaded.saturating_add(chunk.len() as u64);
                            if next_downloaded > MAX_WHISPER_MODEL_BYTES {
                                return Err(AppError::RequestFailed(format!(
                                    "Whisper model exceeds the {} GiB download limit",
                                    MAX_WHISPER_MODEL_BYTES / (1024 * 1024 * 1024)
                                )));
                            }
                            if total_size.is_some_and(|total| next_downloaded > total) {
                                return Err(AppError::RequestFailed(
                                    "Whisper model download exceeded its declared content length".to_string(),
                                ));
                            }
                            file.write_all(&chunk).await?;
                            downloaded = next_downloaded;

                            let percentage = total_size
                                .map(|total| (downloaded as f32 / total as f32) * 100.0)
                                .unwrap_or(0.0);

                            let now = std::time::Instant::now();
                            let should_emit = if total_size.is_some() {
                                (percentage - last_emitted_percentage) >= 1.0
                                    || now.duration_since(last_emit_time)
                                        >= std::time::Duration::from_millis(100)
                            } else {
                                now.duration_since(last_emit_time)
                                    >= std::time::Duration::from_millis(100)
                            };

                            if should_emit {
                                last_emit_time = now;
                                last_emitted_percentage = percentage;
                                let _ = app.emit(
                                    "whisper-download-progress",
                                    WhisperDownloadProgress {
                                        model_id: model_id.clone(),
                                        downloaded,
                                        total: total_size,
                                        percentage,
                                        done: false,
                                    },
                                );
                            }
                        }
                        None => break,
                    }
                }
            }
        }

        if downloaded == 0 {
            return Err(AppError::RequestFailed(
                "Whisper model download was empty".to_string(),
            ));
        }
        if total_size.is_some_and(|total| downloaded != total) {
            return Err(AppError::RequestFailed(format!(
                "Whisper model download was incomplete: received {downloaded} of {} bytes",
                total_size.unwrap_or_default()
            )));
        }

        file.flush().await?;
        file.sync_all().await?;
        drop(file);

        if cancelled.load(Ordering::SeqCst) {
            return Err(AppError::ConfigIo(
                "Download cancelled by user".to_string(),
            ));
        }

        promote_whisper_download(&partial_path, &destination_path, &backup_path).await?;

        let _ = app.emit(
            "whisper-download-progress",
            WhisperDownloadProgress {
                model_id: model_id.clone(),
                downloaded,
                total: total_size,
                percentage: 100.0,
                done: true,
            },
        );

        Ok(destination_path.to_string_lossy().to_string())
    }
    .await;

    if result.is_err() {
        remove_partial_download(&partial_path).await;
    }

    result
}

#[tauri::command]
pub async fn check_downloaded_whisper_models(app: AppHandle) -> Result<Vec<String>, AppError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::AppPath(e.to_string()))?;
    let models_dir = app_data_dir.join("whisper_models");
    if !models_dir.exists() {
        return Ok(vec![]);
    }

    let mut downloaded = Vec::new();
    let mut entries = fs::read_dir(models_dir)?;
    while let Some(Ok(entry)) = entries.next() {
        if let Some(name) = entry.file_name().to_str() {
            if name.ends_with(".bin") {
                downloaded.push(name.to_string());
            }
        }
    }
    Ok(downloaded)
}

#[tauri::command]
pub async fn delete_whisper_model(app: AppHandle, file_name: String) -> Result<(), AppError> {
    let file_name = validate_whisper_model_file_name(&file_name)?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::AppPath(e.to_string()))?;
    let model_path = app_data_dir.join("whisper_models").join(file_name);
    if model_path.exists() {
        fs::remove_file(model_path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        promote_whisper_download, remove_partial_download, validate_whisper_model_file_name,
        whisper_download_staging_paths, whisper_file_name_from_url, WhisperDownloadState,
        NEXT_WHISPER_DOWNLOAD_ID,
    };
    use std::path::PathBuf;
    use std::sync::atomic::Ordering;

    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            let test_id = NEXT_WHISPER_DOWNLOAD_ID.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "sythoria-whisper-download-test-{}-{test_id}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).expect("create test directory");
            Self(path)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn whisper_model_file_name_accepts_supported_basenames() {
        assert!(validate_whisper_model_file_name("ggml-base.en.bin").is_ok());
        assert!(validate_whisper_model_file_name("whisper-small.GGUF").is_ok());
    }

    #[test]
    fn whisper_model_file_name_rejects_paths_and_unsupported_files() {
        for invalid in [
            "../victim.bin",
            "folder/model.bin",
            r"folder\model.bin",
            "/tmp/model.bin",
            "model.txt",
            "",
        ] {
            assert!(
                validate_whisper_model_file_name(invalid).is_err(),
                "accepted unsafe file name: {invalid}"
            );
        }
    }

    #[test]
    fn whisper_url_requires_https_and_a_safe_model_basename() {
        assert_eq!(
            whisper_file_name_from_url("https://models.example/ggml-base.en.bin?download=1")
                .expect("safe model URL"),
            "ggml-base.en.bin"
        );
        assert!(whisper_file_name_from_url("http://models.example/model.bin").is_err());
        assert!(whisper_file_name_from_url("https://models.example/readme.txt").is_err());
    }

    #[test]
    fn whisper_download_state_rejects_overlap_and_scopes_cancellation() {
        let mut state = WhisperDownloadState::default();
        let mut first = state.begin(41).expect("start first download");

        assert!(state.begin(42).is_err());
        state.cancel_active();
        assert!(first.cancelled.load(Ordering::SeqCst));
        assert!(first.cancel_rx.try_recv().is_ok());

        state.finish(999);
        assert!(state.begin(42).is_err());
        state.finish(41);
        assert!(state.begin(42).is_ok());
    }

    #[test]
    fn staging_paths_are_unique_and_do_not_reuse_the_destination_name() {
        let models_dir = PathBuf::from("models");
        let (first_partial, first_backup) = whisper_download_staging_paths(&models_dir, 1);
        let (second_partial, second_backup) = whisper_download_staging_paths(&models_dir, 2);

        assert_ne!(first_partial, second_partial);
        assert_ne!(first_backup, second_backup);
        assert_eq!(
            first_partial.extension().and_then(|value| value.to_str()),
            Some("part")
        );
        assert_eq!(
            first_backup.extension().and_then(|value| value.to_str()),
            Some("backup")
        );
    }

    #[tokio::test]
    async fn promotion_replaces_a_model_only_after_the_partial_is_complete() {
        let test_dir = TestDir::new();
        let destination = test_dir.0.join("model.bin");
        let partial = test_dir.0.join("download.part");
        let backup = test_dir.0.join("download.backup");
        std::fs::write(&destination, b"previous model").expect("write previous model");
        std::fs::write(&partial, b"validated new model").expect("write staged model");

        promote_whisper_download(&partial, &destination, &backup)
            .await
            .expect("promote staged model");

        assert_eq!(
            std::fs::read(&destination).expect("read promoted model"),
            b"validated new model"
        );
        assert!(!partial.exists());
        assert!(!backup.exists());
    }

    #[tokio::test]
    async fn failed_promotion_preserves_the_existing_model() {
        let test_dir = TestDir::new();
        let destination = test_dir.0.join("model.bin");
        let missing_partial = test_dir.0.join("missing.part");
        let backup = test_dir.0.join("download.backup");
        std::fs::write(&destination, b"previous model").expect("write previous model");

        assert!(
            promote_whisper_download(&missing_partial, &destination, &backup)
                .await
                .is_err()
        );
        assert_eq!(
            std::fs::read(&destination).expect("read preserved model"),
            b"previous model"
        );
        assert!(!backup.exists());
    }

    #[tokio::test]
    async fn partial_cleanup_does_not_remove_an_existing_model() {
        let test_dir = TestDir::new();
        let destination = test_dir.0.join("model.bin");
        let partial = test_dir.0.join("download.part");
        std::fs::write(&destination, b"previous model").expect("write previous model");
        std::fs::write(&partial, b"incomplete model").expect("write partial model");

        remove_partial_download(&partial).await;

        assert!(!partial.exists());
        assert_eq!(
            std::fs::read(&destination).expect("read preserved model"),
            b"previous model"
        );
    }
}

#[tauri::command]
pub async fn transcribe_audio(
    app: AppHandle,
    model_path: String,
    audio_data: Vec<f32>,
    language: Option<String>,
) -> Result<String, AppError> {
    let resolved_path = if std::path::Path::new(&model_path).is_absolute() {
        std::path::PathBuf::from(&model_path)
    } else {
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| AppError::AppPath(e.to_string()))?;
        app_data_dir.join("whisper_models").join(&model_path)
    };

    if !resolved_path.exists() {
        return Err(AppError::ConfigIo(format!(
            "Model file not found at: {}",
            resolved_path.display()
        )));
    }

    let resolved_path_str = resolved_path.to_string_lossy().to_string();

    let actual_audio_data = if audio_data.is_empty() {
        let samples = if let Ok(samples) = RECORDED_SAMPLES.lock() {
            samples.clone()
        } else {
            return Err(AppError::ConfigIo(
                "Failed to lock recorded samples".to_string(),
            ));
        };
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or_else(|| AppError::ConfigIo("No default input device found".to_string()))?;
        let config = device.default_input_config().map_err(|e| {
            AppError::ConfigIo(format!("Failed to get default input config: {}", e))
        })?;
        resample(&samples, config.sample_rate(), 16000)
    } else {
        audio_data
    };

    let ctx_clone = resolved_path_str.clone();
    let audio_clone = actual_audio_data;
    let lang_clone = language.unwrap_or("auto".to_string());

    let transcription = tokio::task::spawn_blocking(move || -> Result<String, AppError> {
        let mut cache = WHISPER_CONTEXT_CACHE
            .lock()
            .map_err(|e| AppError::ParseError(format!("Cache lock poisoned: {}", e)))?;

        let matches = match &*cache {
            Some((path, _)) => path == &ctx_clone,
            None => false,
        };

        if !matches {
            let ctx =
                WhisperContext::new_with_params(&ctx_clone, WhisperContextParameters::default())
                    .map_err(|e| {
                        AppError::ParseError(format!("Failed to load Whisper context: {}", e))
                    })?;
            *cache = Some((ctx_clone.clone(), ctx));
        }

        let context = &cache
            .as_ref()
            .ok_or_else(|| AppError::ParseError("Whisper cache is empty".to_string()))?
            .1;

        let mut state = context
            .create_state()
            .map_err(|e| AppError::ParseError(format!("Failed to create state: {}", e)))?;

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_n_threads(4);
        params.set_translate(false);
        params.set_no_context(true);
        params.set_single_segment(false);

        if lang_clone != "auto" {
            params.set_language(Some(&lang_clone));
        } else {
            params.set_language(None);
        }

        state
            .full(params, &audio_clone)
            .map_err(|e| AppError::ParseError(format!("Failed to run Whisper model: {}", e)))?;

        let num_segments = state.full_n_segments();
        let mut text = String::new();
        for i in 0..num_segments {
            if let Some(segment) = state.get_segment(i) {
                text.push_str(&segment.to_string());
            }
        }
        Ok(text)
    })
    .await
    .map_err(|e| AppError::ParseError(format!("Task panicked: {}", e)))??;

    Ok(transcription)
}

fn encode_wav_f32(samples: &[f32], sample_rate: u32) -> Vec<u8> {
    let mut out = Vec::new();
    let data_len = samples.len() * 4;
    let file_len = 36 + data_len;
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(file_len as u32).to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&3u16.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    let byte_rate = sample_rate * 1 * 4;
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&4u16.to_le_bytes());
    out.extend_from_slice(&32u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&(data_len as u32).to_le_bytes());
    for &sample in samples {
        out.extend_from_slice(&sample.to_le_bytes());
    }
    out
}

#[derive(serde::Deserialize)]
struct CloudWhisperResponse {
    text: String,
}

#[tauri::command]
pub async fn transcribe_audio_cloud(
    _app: AppHandle,
    api_url: String,
    api_key: String,
    model: String,
    language: Option<String>,
) -> Result<String, AppError> {
    let samples = if let Ok(samples) = RECORDED_SAMPLES.lock() {
        samples.clone()
    } else {
        return Err(AppError::ConfigIo(
            "Failed to lock recorded samples".to_string(),
        ));
    };

    if samples.is_empty() {
        return Ok(String::new());
    }

    let parsed_url = url::Url::parse(&api_url)
        .map_err(|e| AppError::ConfigIo(format!("Invalid api_url: {}", e)))?;

    if let Some(host) = parsed_url.host_str() {
        let host_lower = host.to_lowercase();
        let blocked_hosts = crate::get_blocked_hosts();

        let is_blocked_host = blocked_hosts.iter().any(|blocked| {
            let blocked_lower = blocked.to_lowercase();
            if blocked.contains('*') {
                crate::search::matches_wildcard(&host_lower, &blocked_lower)
            } else {
                host_lower == blocked_lower || host_lower.ends_with(&format!(".{}", blocked_lower))
            }
        });

        let is_blocked_ip = {
            use std::net::ToSocketAddrs;
            let port = parsed_url.port_or_known_default().unwrap_or(80);
            if let Ok(addrs) = (host, port).to_socket_addrs() {
                addrs
                    .into_iter()
                    .any(|addr| crate::search::is_ip_blocked(&addr.ip(), &blocked_hosts))
            } else {
                false
            }
        };

        if is_blocked_host || is_blocked_ip {
            return Err(AppError::ConfigIo(format!(
                "Access denied: Endpoint '{}' is blocked in network settings. You can modify blocked hosts/IPs in Settings > Privacy.",
                host
            )));
        }
    }

    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| AppError::ConfigIo("No default input device found".to_string()))?;
    let config = device
        .default_input_config()
        .map_err(|e| AppError::ConfigIo(format!("Failed to get default input config: {}", e)))?;
    let sample_rate = config.sample_rate();

    let resampled = resample(&samples, sample_rate, 16000);
    let wav_bytes = encode_wav_f32(&resampled, 16000);

    let client = client_builder()
        .build()
        .map_err(|e| AppError::RequestFailed(e.to_string()))?;

    let part = reqwest::multipart::Part::bytes(wav_bytes)
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|e| AppError::ParseError(format!("Failed to create multipart part: {}", e)))?;

    let mut form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("model", model);

    if let Some(lang) = language {
        if lang != "auto" {
            form = form.text("language", lang);
        }
    }

    let res = client
        .post(&api_url)
        .header("Authorization", format!("Bearer {}", api_key))
        .multipart(form)
        .send()
        .await
        .map_err(|e| AppError::ParseError(format!("Network Error: {}", e)))?;

    let status = res.status();
    let body = res.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(AppError::ParseError(format!(
            "API Error {}: {}",
            status, body
        )));
    }

    let json: CloudWhisperResponse = serde_json::from_str(&body)
        .map_err(|e| AppError::ParseError(format!("Failed to parse JSON response: {}", e)))?;

    Ok(json.text)
}
