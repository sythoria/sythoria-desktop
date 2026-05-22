mod search;
mod ws_handler;

use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::Manager;
use std::fs;
use std::io::Write;

#[derive(Debug, Serialize, Deserialize)]
struct ChatMessage {
    role: String,
    content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_calls: Option<Vec<ToolCallData>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ToolCallData {
    id: String,
    r#type: String,
    function: ToolCallFunction,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ToolCallFunction {
    name: String,
    arguments: String,
}

#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f64,
    stream: bool,
}

#[derive(Debug, Serialize)]
struct ChatRequestTools {
    model: String,
    messages: Vec<serde_json::Value>,
    temperature: f64,
    tools: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_choice: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: Option<ChatChoiceMessage>,
}

#[derive(Debug, Deserialize)]
struct ChatChoiceMessage {
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Debug, Deserialize)]
struct StreamChunk {
    choices: Vec<StreamChoice>,
}

#[derive(Debug, Deserialize)]
struct StreamChoice {
    delta: StreamDelta,
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct StreamDelta {
    content: Option<String>,
}

#[derive(Debug, thiserror::Error, Serialize)]
enum AppError {
    #[error("Config I/O error: {0}")]
    ConfigIo(String),
    #[error("App path error: {0}")]
    AppPath(String),
    #[error("HTTP request failed: {0}")]
    RequestFailed(String),
    #[error("API error {status}: {message}")]
    ApiError { status: u16, message: String },
    #[error("Stream error: {0}")]
    StreamError(String),
    #[error("Response parse error: {0}")]
    ParseError(String),
    #[error("Auth error: {0}")]
    AuthError(String),
    #[error("Search error: {0}")]
    SearchError(String),
    #[error("URL validation error: {0}")]
    UrlValidationError(String),
    #[error("Key not found: {0}")]
    KeyNotFound(String),
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::ConfigIo(err.to_string())
    }
}

impl From<reqwest::Error> for AppError {
    fn from(err: reqwest::Error) -> Self {
        AppError::RequestFailed(err.to_string())
    }
}

impl From<search::SearchError> for AppError {
    fn from(err: search::SearchError) -> Self {
        match &err {
            search::SearchError::UrlValidationError(msg) => {
                AppError::UrlValidationError(msg.clone())
            }
            _ => AppError::SearchError(err.to_string()),
        }
    }
}

async fn get_search_api_key(
    app: &tauri::AppHandle,
    config_id: &str,
) -> Result<String, AppError> {
    let store = tauri_plugin_store::StoreExt::store(app, "sythoria-store.json")
        .map_err(|e| AppError::ConfigIo(format!("Failed to open store: {}", e)))?;

    let keys: Option<serde_json::Value> = store.get("sythoria-search-api-keys");
    drop(store);

    if let Some(keys_val) = keys {
        if let Some(key_str) = keys_val.get(config_id).and_then(|v| v.as_str()) {
            if !key_str.is_empty() {
                return Ok(key_str.to_string());
            }
        }
    }

    Err(AppError::KeyNotFound(format!(
        "No API key found for search config '{}'",
        config_id
    )))
}

async fn save_search_api_keys(
    app: &tauri::AppHandle,
    keys: &serde_json::Value,
) -> Result<(), AppError> {
    let store = tauri_plugin_store::StoreExt::store(app, "sythoria-store.json")
        .map_err(|e| AppError::ConfigIo(format!("Failed to open store: {}", e)))?;

    store.set("sythoria-search-api-keys", keys.clone());
    Ok(())
}

#[tauri::command]
async fn load_config(app: tauri::AppHandle) -> Result<String, AppError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::AppPath(e.to_string()))?;
    let config_path = app_data_dir.join("config.json");
    if config_path.exists() {
        fs::read_to_string(config_path).map_err(|e| AppError::ConfigIo(e.to_string()))
    } else {
        Ok("".to_string())
    }
}

#[tauri::command]
async fn save_config(app: tauri::AppHandle, config: String) -> Result<(), AppError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::AppPath(e.to_string()))?;
    fs::create_dir_all(&app_data_dir).map_err(|e| AppError::ConfigIo(e.to_string()))?;
    let config_path = app_data_dir.join("config.json");
    let mut file = fs::File::create(config_path).map_err(|e| AppError::ConfigIo(e.to_string()))?;
    file.write_all(config.as_bytes()).map_err(|e| AppError::ConfigIo(e.to_string()))?;
    Ok(())
}

#[tauri::command]
async fn load_search_config(app: tauri::AppHandle) -> Result<String, AppError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::AppPath(e.to_string()))?;
    let config_path = app_data_dir.join("search_config.json");
    if config_path.exists() {
        fs::read_to_string(config_path).map_err(|e| AppError::ConfigIo(e.to_string()))
    } else {
        Ok("".to_string())
    }
}

#[tauri::command]
async fn save_search_config(app: tauri::AppHandle, config: String) -> Result<(), AppError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::AppPath(e.to_string()))?;
    fs::create_dir_all(&app_data_dir).map_err(|e| AppError::ConfigIo(e.to_string()))?;
    let config_path = app_data_dir.join("search_config.json");
    let mut file = fs::File::create(config_path).map_err(|e| AppError::ConfigIo(e.to_string()))?;
    file.write_all(config.as_bytes()).map_err(|e| AppError::ConfigIo(e.to_string()))?;
    Ok(())
}

#[tauri::command]
async fn load_search_api_keys(app: tauri::AppHandle) -> Result<serde_json::Value, AppError> {
    let store = tauri_plugin_store::StoreExt::store(&app, "sythoria-store.json")
        .map_err(|e| AppError::ConfigIo(format!("Failed to open store: {}", e)))?;

    let keys: Option<serde_json::Value> = store.get("sythoria-search-api-keys");
    drop(store);

    Ok(keys.unwrap_or(serde_json::json!({})))
}

#[tauri::command]
async fn save_search_api_keys_cmd(
    app: tauri::AppHandle,
    keys: serde_json::Value,
) -> Result<(), AppError> {
    save_search_api_keys(&app, &keys).await
}

#[tauri::command]
async fn chat_completion(
    api_url: String,
    api_key: String,
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f64,
) -> Result<String, AppError> {
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()?;
    let body = ChatRequest {
        model,
        messages,
        temperature,
        stream: false,
    };

    let mut request = client.post(&api_url).json(&body);
    request = request.header("Content-Type", "application/json");
    if !api_key.is_empty() {
        request = request.header("Authorization", format!("Bearer {}", api_key));
    }

    let resp = request.send().await?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let _body = resp.text().await.unwrap_or_default();
        log::error!("chat_completion API error {}: [body sanitized]", status);
        return Err(AppError::ApiError {
            status,
            message: "Request failed (response body omitted for security)".to_string(),
        });
    }

    let chat_resp: ChatResponse = resp
        .json()
        .await
        .map_err(|e| AppError::ParseError(e.to_string()))?;

    let content = chat_resp
        .choices
        .into_iter()
        .next()
        .and_then(|c| c.message)
        .and_then(|m| m.content)
        .unwrap_or_default();

    Ok(content)
}

#[tauri::command]
async fn chat_stream(
    api_url: String,
    api_key: String,
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f64,
    app: tauri::AppHandle,
) -> Result<String, AppError> {
    use tauri::Emitter;

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()?;
    let body = ChatRequest {
        model,
        messages,
        temperature,
        stream: true,
    };

    let mut request = client.post(&api_url).json(&body);
    request = request.header("Content-Type", "application/json");
    if !api_key.is_empty() {
        request = request.header(
            "Authorization",
            format!("Bearer {}", api_key),
        );
    }

    let resp = request.send().await?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let _body = resp.text().await.unwrap_or_default();
        log::error!("chat_stream API error {}: [body sanitized]", status);
        return Err(AppError::ApiError {
            status,
            message: "Request failed (response body omitted for security)".to_string(),
        });
    }

    let mut stream = resp.bytes_stream();
    let mut full_content = String::new();
    let mut buffer = String::new();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| AppError::StreamError(e.to_string()))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim().to_string();
            buffer = buffer[line_end + 1..].to_string();

            if line.is_empty() || line == "data: [DONE]" {
                continue;
            }

            if let Some(data) = line.strip_prefix("data: ") {
                match serde_json::from_str::<StreamChunk>(data) {
                    Ok(parsed) => {
                        for choice in parsed.choices {
                            if let Some(content) = choice.delta.content {
                                full_content.push_str(&content);
                                let _ = app.emit("chat-stream-chunk", &content);
                            }
                            if choice.finish_reason.is_some() {
                                let _ = app.emit("chat-stream-done", ());
                            }
                        }
                    }
                    Err(e) => {
                        log::warn!(
                            "SSE parse warning: skipping malformed chunk ({} bytes): {}",
                            data.len(),
                            e
                        );
                    }
                }
            }
        }
    }

    Ok(full_content)
}

#[tauri::command]
async fn chat_stream_tools(
    api_url: String,
    api_key: String,
    model: String,
    messages: Vec<serde_json::Value>,
    tools: String,
    temperature: f64,
    app: tauri::AppHandle,
) -> Result<String, AppError> {
    use tauri::Emitter;

    let tools_parsed: Vec<serde_json::Value> = serde_json::from_str(&tools)
        .map_err(|e| AppError::ParseError(format!("Invalid tools JSON: {}", e)))?;

    let body = ChatRequestTools {
        model,
        messages,
        temperature,
        tools: tools_parsed,
        tool_choice: Some(serde_json::Value::String("auto".to_string())),
    };

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()?;

    let mut request = client.post(&api_url).json(&body);
    request = request.header("Content-Type", "application/json");
    if !api_key.is_empty() {
        request = request.header("Authorization", format!("Bearer {}", api_key));
    }

    let resp = request.send().await?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let _body = resp.text().await.unwrap_or_default();
        log::error!("chat_stream_tools API error {}: [body sanitized]", status);
        return Err(AppError::ApiError {
            status,
            message: "Request failed (response body omitted for security)".to_string(),
        });
    }

    let mut stream = resp.bytes_stream();
    let mut _full_content = String::new();
    let mut buffer = String::new();
    let mut accumulated = String::new();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| AppError::StreamError(e.to_string()))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim().to_string();
            buffer = buffer[line_end + 1..].to_string();

            if line.is_empty() || line == "data: [DONE]" {
                continue;
            }

            if let Some(data) = line.strip_prefix("data: ") {
                match serde_json::from_str::<serde_json::Value>(data) {
                    Ok(parsed) => {
                        if let Some(choices) = parsed.get("choices").and_then(|c| c.as_array()) {
                            for choice in choices {
                                if let Some(delta) = choice.get("delta") {
                                    if let Some(content) = delta.get("content").and_then(|c| c.as_str()) {
                                        accumulated.push_str(content);
                                        let _ = app.emit("chat-stream-chunk", content);
                                    }
                                }
                                if choice.get("finish_reason").and_then(|r| r.as_str()).is_some() {
                                    let _ = app.emit("chat-stream-done", ());
                                }
                            }
                        }
                    }
                    Err(e) => {
                        log::warn!(
                            "Tool SSE parse warning: skipping malformed chunk: {}",
                            e
                        );
                    }
                }
            }
        }
    }

    Ok(accumulated)
}

#[tauri::command]
async fn chat_completion_tools(
    api_url: String,
    api_key: String,
    model: String,
    messages: Vec<serde_json::Value>,
    tools: String,
    temperature: f64,
) -> Result<String, AppError> {
    let tools_parsed: Vec<serde_json::Value> = serde_json::from_str(&tools)
        .map_err(|e| AppError::ParseError(format!("Invalid tools JSON: {}", e)))?;

    let body = ChatRequestTools {
        model,
        messages,
        temperature,
        tools: tools_parsed,
        tool_choice: Some(serde_json::Value::String("auto".to_string())),
    };

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()?;

    let mut request = client.post(&api_url).json(&body);
    request = request.header("Content-Type", "application/json");
    if !api_key.is_empty() {
        request = request.header("Authorization", format!("Bearer {}", api_key));
    }

    let resp = request.send().await?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let _body = resp.text().await.unwrap_or_default();
        log::error!("chat_completion_tools API error {}: [body sanitized]", status);
        return Err(AppError::ApiError {
            status,
            message: "Request failed (response body omitted for security)".to_string(),
        });
    }

    let raw = resp.text().await?;
    Ok(raw)
}

#[tauri::command]
async fn check_api(api_url: String, api_key: String) -> Result<bool, AppError> {
    let client = Client::new();

    let base_url = api_url
        .trim_end_matches('/')
        .trim_end_matches("/chat/completions")
        .trim_end_matches("/completions")
        .trim_end_matches("/messages");

    let models_url = format!("{}/models", base_url);

    let mut request = client.get(&models_url).timeout(std::time::Duration::from_secs(10));
    if !api_key.is_empty() {
        request = request.header("Authorization", format!("Bearer {}", api_key));
    }

    let resp = request.send().await?;

    Ok(resp.status().is_success())
}

#[tauri::command]
async fn web_search(
    provider: String,
    query: String,
    config: String,
    config_id: Option<String>,
    app: tauri::AppHandle,
) -> Result<String, AppError> {
    let mut config_json: serde_json::Value = serde_json::from_str(&config)
        .map_err(|e| AppError::ParseError(format!("Invalid search config JSON: {}", e)))?;

    if let Some(id) = config_id {
        if config_json.get("apiKey").and_then(|v| v.as_str()).unwrap_or("").is_empty() {
            match get_search_api_key(&app, &id).await {
                Ok(key) => {
                    config_json["apiKey"] = serde_json::Value::String(key);
                }
                Err(_) => {
                    log::warn!("No API key found in secure store for search config '{}'", id);
                }
            }
        }
    }

    let results = search::search(&provider, &query, &config_json)
        .await
        .map_err(|e| {
            log::error!("Search failed for provider '{}': {}", provider, e);
            AppError::from(e)
        })?;

    Ok(serde_json::to_string(&results).unwrap_or_default())
}

#[tauri::command]
async fn fetch_url_content(url: String) -> Result<String, AppError> {
    let content = search::fetch_url(&url)
        .await
        .map_err(|e| {
            log::error!("Fetch URL failed for '{}': {}", url, e);
            AppError::from(e)
        })?;

    Ok(serde_json::to_string(&content).unwrap_or_default())
}

#[tauri::command]
async fn ws_chat(
    url: String,
    api_key: Option<String>,
    model: String,
    app: tauri::AppHandle,
) -> Result<String, AppError> {
    let config = ws_handler::WsConfig {
        url,
        api_key,
        model,
        reconnect: true,
        max_reconnect_attempts: 5,
    };
    ws_handler::ws_chat_stream(config, app)
        .await
        .map_err(AppError::AuthError)
}

#[tauri::command]
async fn ws_authenticate(
    username: String,
    api_key: String,
    server_url: String,
) -> Result<String, AppError> {
    let client = Client::new();
    let auth_url = format!("{}/auth", server_url.trim_end_matches('/'));

    let body = serde_json::json!({
        "username": username,
        "api_key": api_key,
    });

    let resp = client
        .post(&auth_url)
        .json(&body)
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let _body = resp.text().await.unwrap_or_default();
        log::error!("ws_authenticate API error {}: [body sanitized]", status);
        return Err(AppError::ApiError {
            status,
            message: "Authentication failed (response body omitted for security)".to_string(),
        });
    }

    let token: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::ParseError(e.to_string()))?;

    Ok(token["token"]
        .as_str()
        .unwrap_or("authenticated")
        .to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Warn)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            load_search_config,
            save_search_config,
            load_search_api_keys,
            save_search_api_keys_cmd,
            chat_completion,
            chat_stream,
            chat_completion_tools,
            chat_stream_tools,
            check_api,
            web_search,
            fetch_url_content,
            ws_authenticate,
            ws_chat
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
