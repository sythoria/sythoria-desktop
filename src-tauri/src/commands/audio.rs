use std::fs;
use std::io::Write;
use std::sync::{Arc, Mutex, LazyLock};
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::io::AsyncWriteExt;
use futures_util::StreamExt;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use whisper_rs::{WhisperContext, WhisperContextParameters, FullParams, SamplingStrategy};
use tauri::{AppHandle, Manager, Emitter};

use crate::AppError;
use crate::client_builder;

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
        let val_above = if index_above < samples.len() { samples[index_above] } else { val_below };
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
        return Err(AppError::ConfigIo("Failed to lock recorded samples".to_string()));
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

static DOWNLOAD_CANCELLED: AtomicBool = AtomicBool::new(false);
static DOWNLOAD_CANCEL_TX: Mutex<Option<tokio::sync::oneshot::Sender<()>>> =
    Mutex::new(None);

#[tauri::command]
pub async fn cancel_whisper_download() -> Result<(), AppError> {
    DOWNLOAD_CANCELLED.store(true, Ordering::SeqCst);
    if let Some(tx) = DOWNLOAD_CANCEL_TX.lock().map_err(|e| AppError::ConfigIo(format!("Poisoned lock: {}", e)))?.take() {
        let _ = tx.send(());
    }
    Ok(())
}

#[tauri::command]
pub async fn download_whisper_model(
    app: AppHandle,
    model_id: String,
    url: String,
) -> Result<String, AppError> {
    DOWNLOAD_CANCELLED.store(false, Ordering::SeqCst);
    let (tx, mut rx) = tokio::sync::oneshot::channel::<()>();
    {
        let mut guard = DOWNLOAD_CANCEL_TX.lock().map_err(|e| AppError::ConfigIo(format!("Poisoned lock: {}", e)))?;
        *guard = Some(tx);
    }

    struct CancelGuard;
    impl Drop for CancelGuard {
        fn drop(&mut self) {
            if let Ok(mut guard) = DOWNLOAD_CANCEL_TX.lock() {
                *guard = None;
            }
        }
    }
    let _guard = CancelGuard;

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::AppPath(e.to_string()))?;
    let models_dir = app_data_dir.join("whisper_models");
    fs::create_dir_all(&models_dir)?;

    let file_name = url.split('/').last().unwrap_or("model.bin");
    let dest_path = models_dir.join(file_name);

    let client = client_builder()
        .build()
        .map_err(|e| AppError::RequestFailed(e.to_string()))?;
    
    let res = tokio::select! {
        _ = &mut rx => {
            let _ = tokio::fs::remove_file(&dest_path).await;
            return Err(AppError::ConfigIo("Download cancelled by user".to_string()));
        }
        res_result = client.get(&url).send() => {
            res_result.map_err(|e| AppError::RequestFailed(e.to_string()))?
        }
    };
    let total_size = res.content_length();

    let mut file = tokio::fs::File::create(&dest_path).await?;
    let mut stream = res.bytes_stream();
    let mut downloaded = 0u64;
    let mut last_emit_time = std::time::Instant::now();
    let mut last_emitted_percentage = -1.0f32;

    loop {
        tokio::select! {
            _ = &mut rx => {
                drop(file);
                let _ = tokio::fs::remove_file(&dest_path).await;
                return Err(AppError::ConfigIo("Download cancelled by user".to_string()));
            }
            chunk_result_opt = stream.next() => {
                match chunk_result_opt {
                    Some(chunk_result) => {
                        if DOWNLOAD_CANCELLED.load(Ordering::SeqCst) {
                            drop(file);
                            let _ = tokio::fs::remove_file(&dest_path).await;
                            return Err(AppError::ConfigIo("Download cancelled by user".to_string()));
                        }
                        let chunk = chunk_result.map_err(|e| AppError::RequestFailed(e.to_string()))?;
                        file.write_all(&chunk).await?;
                        downloaded += chunk.len() as u64;

                        let percentage = total_size
                            .map(|total| (downloaded as f32 / total as f32) * 100.0)
                            .unwrap_or(0.0);

                        let now = std::time::Instant::now();
                        let should_emit = if total_size.is_some() {
                            (percentage - last_emitted_percentage) >= 1.0 || now.duration_since(last_emit_time) >= std::time::Duration::from_millis(100)
                        } else {
                            now.duration_since(last_emit_time) >= std::time::Duration::from_millis(100)
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

    Ok(dest_path.to_string_lossy().to_string())
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
            return Err(AppError::ConfigIo("Failed to lock recorded samples".to_string()));
        };
        let host = cpal::default_host();
        let device = host.default_input_device().ok_or_else(|| AppError::ConfigIo("No default input device found".to_string()))?;
        let config = device.default_input_config().map_err(|e| AppError::ConfigIo(format!("Failed to get default input config: {}", e)))?;
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
            let ctx = WhisperContext::new_with_params(
                &ctx_clone,
                WhisperContextParameters::default(),
            )
            .map_err(|e| AppError::ParseError(format!("Failed to load Whisper context: {}", e)))?;
            *cache = Some((ctx_clone.clone(), ctx));
        }

        let context = &cache.as_ref().ok_or_else(|| AppError::ParseError("Whisper cache is empty".to_string()))?.1;

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
        return Err(AppError::ConfigIo("Failed to lock recorded samples".to_string()));
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
                addrs.into_iter().any(|addr| crate::search::is_ip_blocked(&addr.ip(), &blocked_hosts))
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
        return Err(AppError::ParseError(format!("API Error {}: {}", status, body)));
    }

    let json: CloudWhisperResponse = serde_json::from_str(&body)
        .map_err(|e| AppError::ParseError(format!("Failed to parse JSON response: {}", e)))?;

    Ok(json.text)
}
