mod mcp;
mod search;
mod stream_parser;
mod ws_handler;

use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::sync::{LazyLock, Mutex};
use tauri::Manager;

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

static CANCELLED_STREAMS: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

fn mark_stream_cancelled(stream_id: String) -> Result<(), AppError> {
    let mut cancelled = CANCELLED_STREAMS
        .lock()
        .map_err(|e| AppError::StreamError(format!("Stream cancellation lock poisoned: {}", e)))?;
    cancelled.insert(stream_id);
    Ok(())
}

fn clear_stream_cancelled(stream_id: &str) {
    if let Ok(mut cancelled) = CANCELLED_STREAMS.lock() {
        cancelled.remove(stream_id);
    }
}

fn is_stream_cancelled(stream_id: &str) -> bool {
    CANCELLED_STREAMS
        .lock()
        .map(|cancelled| cancelled.contains(stream_id))
        .unwrap_or(true)
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
    #[error("MCP error: {0}")]
    McpError(String),
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

async fn get_search_api_key(app: &tauri::AppHandle, config_id: &str) -> Result<String, AppError> {
    get_secret(app, "search", config_id).await
}

const STORE_FILE: &str = "sythoria-store.json";
const KEYCHAIN_SERVICE: &str = "com.sythoria.sythoria-desktop";
const API_KEY_INDEX: &str = "sythoria-api-key-index";
const SEARCH_API_KEY_INDEX: &str = "sythoria-search-api-key-index";
const MCP_ENV_KEY_INDEX: &str = "sythoria-mcp-env-key-index";

fn keychain_account(namespace: &str, id: &str) -> String {
    format!("{}:{}", namespace, id)
}

fn load_secret_index(app: &tauri::AppHandle, index_key: &str) -> Result<Vec<String>, AppError> {
    let store = tauri_plugin_store::StoreExt::store(app, "sythoria-store.json")
        .map_err(|e| AppError::ConfigIo(format!("Failed to open store: {}", e)))?;

    let index: Option<serde_json::Value> = store.get(index_key);
    Ok(index
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|v| v.as_str().map(ToString::to_string))
        .collect())
}

fn save_secret_index(
    app: &tauri::AppHandle,
    index_key: &str,
    ids: &[String],
) -> Result<(), AppError> {
    let store = tauri_plugin_store::StoreExt::store(app, STORE_FILE)
        .map_err(|e| AppError::ConfigIo(format!("Failed to open store: {}", e)))?;

    store.set(index_key, serde_json::json!(ids));
    Ok(())
}

fn init_keyring_store() {
    #[cfg(target_os = "macos")]
    keyring_core::set_default_store(
        apple_native_keyring_store::keychain::Store::new()
            .expect("Failed to init macOS Keychain store"),
    );
    #[cfg(target_os = "ios")]
    keyring_core::set_default_store(
        apple_native_keyring_store::protected::Store::new()
            .expect("Failed to init iOS Protected Data store"),
    );
    #[cfg(target_os = "windows")]
    keyring_core::set_default_store(
        windows_native_keyring_store::Store::new()
            .expect("Failed to init Windows Credential store"),
    );
    #[cfg(target_os = "linux")]
    keyring_core::set_default_store(
        linux_keyutils_keyring_store::Store::new()
            .expect("Failed to init Linux Keyutils store"),
    );
}

fn set_keychain_secret(namespace: &str, id: &str, secret: &str) -> Result<(), AppError> {
    let entry = keyring_core::Entry::new(KEYCHAIN_SERVICE, &keychain_account(namespace, id))
        .map_err(|e| AppError::ConfigIo(format!("Failed to access keychain: {}", e)))?;
    entry
        .set_password(secret)
        .map_err(|e| AppError::ConfigIo(format!("Failed to save secret: {}", e)))
}

fn get_keychain_secret(namespace: &str, id: &str) -> Result<String, AppError> {
    let entry = keyring_core::Entry::new(KEYCHAIN_SERVICE, &keychain_account(namespace, id))
        .map_err(|e| AppError::ConfigIo(format!("Failed to access keychain: {}", e)))?;
    entry.get_password().map_err(|e| match e {
        keyring_core::Error::NoEntry => AppError::KeyNotFound(format!("No key found for '{}'", id)),
        _ => AppError::ConfigIo(format!("Failed to load secret: {}", e)),
    })
}

fn delete_keychain_secret(namespace: &str, id: &str) -> Result<(), AppError> {
    let entry = keyring_core::Entry::new(KEYCHAIN_SERVICE, &keychain_account(namespace, id))
        .map_err(|e| AppError::ConfigIo(format!("Failed to access keychain: {}", e)))?;
    entry.delete_credential().or_else(|e| match e {
        keyring_core::Error::NoEntry => Ok(()),
        _ => Err(AppError::ConfigIo(format!(
            "Failed to delete secret: {}",
            e
        ))),
    })
}

async fn get_secret(
    _app: &tauri::AppHandle,
    namespace: &str,
    id: &str,
) -> Result<String, AppError> {
    get_keychain_secret(namespace, id)
}

async fn load_secret_map(
    app: &tauri::AppHandle,
    namespace: &str,
    index_key: &str,
) -> Result<serde_json::Value, AppError> {
    let ids = load_secret_index(app, index_key)?;
    let mut keys = serde_json::Map::new();

    for id in ids {
        match get_keychain_secret(namespace, &id) {
            Ok(secret) if !secret.is_empty() => {
                keys.insert(id, serde_json::Value::String(secret));
            }
            Ok(_) | Err(AppError::KeyNotFound(_)) => {}
            Err(err) => return Err(err),
        }
    }

    Ok(serde_json::Value::Object(keys))
}

async fn save_secret_map(
    app: &tauri::AppHandle,
    namespace: &str,
    index_key: &str,
    keys: &serde_json::Value,
) -> Result<(), AppError> {
    let existing_ids = load_secret_index(app, index_key)?;
    let key_map = keys
        .as_object()
        .ok_or_else(|| AppError::ParseError("API keys payload must be an object".to_string()))?;

    for id in existing_ids {
        if !key_map.contains_key(&id) {
            delete_keychain_secret(namespace, &id)?;
        }
    }

    let mut ids = Vec::new();
    for (id, value) in key_map {
        let secret = value.as_str().unwrap_or_default();
        if secret.is_empty() {
            delete_keychain_secret(namespace, id)?;
            continue;
        }
        set_keychain_secret(namespace, id, secret)?;
        ids.push(id.clone());
    }

    save_secret_index(app, index_key, &ids)
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
    file.write_all(config.as_bytes())
        .map_err(|e| AppError::ConfigIo(e.to_string()))?;
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
    file.write_all(config.as_bytes())
        .map_err(|e| AppError::ConfigIo(e.to_string()))?;
    Ok(())
}

#[tauri::command]
async fn load_api_keys(app: tauri::AppHandle) -> Result<serde_json::Value, AppError> {
    load_secret_map(&app, "model", API_KEY_INDEX).await
}

#[tauri::command]
async fn save_api_keys_cmd(app: tauri::AppHandle, keys: serde_json::Value) -> Result<(), AppError> {
    save_secret_map(&app, "model", API_KEY_INDEX, &keys).await
}

#[tauri::command]
async fn load_search_api_keys(app: tauri::AppHandle) -> Result<serde_json::Value, AppError> {
    load_secret_map(&app, "search", SEARCH_API_KEY_INDEX).await
}

#[tauri::command]
async fn save_search_api_keys_cmd(
    app: tauri::AppHandle,
    keys: serde_json::Value,
) -> Result<(), AppError> {
    save_secret_map(&app, "search", SEARCH_API_KEY_INDEX, &keys).await
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
async fn cancel_chat_stream(stream_id: String) -> Result<(), AppError> {
    mark_stream_cancelled(stream_id)
}

#[tauri::command]
async fn chat_stream(
    api_url: String,
    api_key: String,
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f64,
    stream_id: String,
    app: tauri::AppHandle,
) -> Result<String, AppError> {
    clear_stream_cancelled(&stream_id);
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
        request = request.header("Authorization", format!("Bearer {}", api_key));
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
    let mut parser = stream_parser::SseParser::new();

    while let Some(chunk_result) = stream.next().await {
        if is_stream_cancelled(&stream_id) {
            clear_stream_cancelled(&stream_id);
            return Ok(parser.finalize());
        }

        let chunk = chunk_result.map_err(|e| AppError::StreamError(e.to_string()))?;
        parser.push_bytes(&chunk);
        parser.process_lines(&app, &stream_id, |_| {});
    }

    clear_stream_cancelled(&stream_id);
    Ok(parser.finalize())
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
    let mut parser = stream_parser::SseParser::new();
    let mut accumulated = String::new();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| AppError::StreamError(e.to_string()))?;
        parser.push_bytes(&chunk);
        parser.process_lines(&app, "", |chunk_text| {
            accumulated.push_str(chunk_text);
        });
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
        log::error!(
            "chat_completion_tools API error {}: [body sanitized]",
            status
        );
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

    let mut request = client
        .get(&models_url)
        .timeout(std::time::Duration::from_secs(10));
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
        if config_json
            .get("apiKey")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .is_empty()
        {
            match get_search_api_key(&app, &id).await {
                Ok(key) => {
                    config_json["apiKey"] = serde_json::Value::String(key);
                }
                Err(_) => {
                    log::warn!(
                        "No API key found in secure store for search config '{}'",
                        id
                    );
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
    let content = search::fetch_url(&url).await.map_err(|e| {
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

    let resp = client.post(&auth_url).json(&body).send().await?;

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

#[tauri::command]
async fn generate_title(
    api_url: String,
    api_key: String,
    model: String,
    user_message: String,
    system_prompt: String,
) -> Result<String, AppError> {
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()?;
    let body = ChatRequest {
        model,
        messages: vec![
            ChatMessage {
                role: "system".to_string(),
                content: Some(system_prompt),
                tool_calls: None,
                tool_call_id: None,
                name: None,
            },
            ChatMessage {
                role: "user".to_string(),
                content: Some(user_message),
                tool_calls: None,
                tool_call_id: None,
                name: None,
            },
        ],
        temperature: 0.3,
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
        log::error!("generate_title API error {}: [body sanitized]", status);
        return Err(AppError::ApiError {
            status,
            message: "Title generation failed (response body omitted for security)".to_string(),
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

    let trimmed = content.trim().to_string();
    Ok(trimmed)
}

const MCP_CONFIG_FILE: &str = "mcp_config.json";

#[tauri::command]
async fn load_mcp_config(app: tauri::AppHandle) -> Result<String, AppError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::AppPath(e.to_string()))?;
    let config_path = app_data_dir.join(MCP_CONFIG_FILE);
    if config_path.exists() {
        fs::read_to_string(config_path).map_err(|e| AppError::ConfigIo(e.to_string()))
    } else {
        Ok("".to_string())
    }
}

#[tauri::command]
async fn save_mcp_config(app: tauri::AppHandle, config: String) -> Result<(), AppError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::AppPath(e.to_string()))?;
    fs::create_dir_all(&app_data_dir).map_err(|e| AppError::ConfigIo(e.to_string()))?;
    let config_path = app_data_dir.join(MCP_CONFIG_FILE);
    let mut file = fs::File::create(config_path).map_err(|e| AppError::ConfigIo(e.to_string()))?;
    file.write_all(config.as_bytes())
        .map_err(|e| AppError::ConfigIo(e.to_string()))?;
    Ok(())
}

#[tauri::command]
async fn load_mcp_env_secrets(app: tauri::AppHandle) -> Result<serde_json::Value, AppError> {
    let index = load_secret_index(&app, MCP_ENV_KEY_INDEX)?;
    let mut result = serde_json::Map::new();

    for server_id in index {
        let server_keys = {
            let server_index_key = format!("mcp-env:{}", server_id);
            let store = tauri_plugin_store::StoreExt::store(&app, STORE_FILE)
                .map_err(|e| AppError::ConfigIo(format!("Failed to open store: {}", e)))?;
            let env_index: Option<serde_json::Value> = store.get(&server_index_key);
            env_index
                .and_then(|v| v.as_array().cloned())
                .unwrap_or_default()
                .into_iter()
                .filter_map(|v| v.as_str().map(ToString::to_string))
                .collect::<Vec<_>>()
        };

        let mut server_map = serde_json::Map::new();
        for env_key in server_keys {
            match get_keychain_secret("mcp-env", &format!("{}:{}", server_id, env_key)) {
                Ok(secret) if !secret.is_empty() => {
                    server_map.insert(env_key, serde_json::Value::String(secret));
                }
                Ok(_) | Err(AppError::KeyNotFound(_)) => {}
                Err(err) => return Err(err),
            }
        }

        if !server_map.is_empty() {
            result.insert(server_id, serde_json::Value::Object(server_map));
        }
    }

    Ok(serde_json::Value::Object(result))
}

#[tauri::command]
async fn save_mcp_env_secrets_cmd(
    app: tauri::AppHandle,
    secrets: serde_json::Value,
) -> Result<(), AppError> {
    let secrets_map = secrets
        .as_object()
        .ok_or_else(|| AppError::ParseError("MCP env secrets payload must be an object".to_string()))?;

    let existing_server_ids = load_secret_index(&app, MCP_ENV_KEY_INDEX)?;

    for server_id in &existing_server_ids {
        if !secrets_map.contains_key(server_id) {
            let server_index_key = format!("mcp-env:{}", server_id);
            let store = tauri_plugin_store::StoreExt::store(&app, STORE_FILE)
                .map_err(|e| AppError::ConfigIo(format!("Failed to open store: {}", e)))?;
            if let Some(env_index) = store.get(&server_index_key) {
                if let Some(arr) = env_index.as_array() {
                    for key in arr.iter().filter_map(|v| v.as_str()) {
                        let _ = delete_keychain_secret("mcp-env", &format!("{}:{}", server_id, key));
                    }
                }
            }
            let _ = store.delete(&server_index_key);
        }
    }

    let mut server_ids = Vec::new();
    for (server_id, server_value) in secrets_map {
        let env_map = server_value
            .as_object()
            .ok_or_else(|| AppError::ParseError("Server env must be an object".to_string()))?;

        let server_index_key = format!("mcp-env:{}", server_id);
        let mut env_keys = Vec::new();

        for (env_key, env_value) in env_map {
            let secret = env_value.as_str().unwrap_or_default();
            if secret.is_empty() {
                let _ = delete_keychain_secret("mcp-env", &format!("{}:{}", server_id, env_key));
                continue;
            }
            set_keychain_secret("mcp-env", &format!("{}:{}", server_id, env_key), secret)?;
            env_keys.push(env_key.clone());
        }

        let store = tauri_plugin_store::StoreExt::store(&app, STORE_FILE)
            .map_err(|e| AppError::ConfigIo(format!("Failed to open store: {}", e)))?;
        store.set(&server_index_key, serde_json::json!(env_keys));

        if !env_keys.is_empty() {
            server_ids.push(server_id.clone());
        }
    }

    save_secret_index(&app, MCP_ENV_KEY_INDEX, &server_ids)
}

#[tauri::command]
async fn mcp_start_server(config: String, env_secrets: String) -> Result<String, AppError> {
    let server_config: mcp::McpServerConfig = serde_json::from_str(&config)
        .map_err(|e| AppError::ParseError(format!("Invalid MCP config JSON: {}", e)))?;
    let env_map: HashMap<String, String> = serde_json::from_str(&env_secrets)
        .map_err(|e| AppError::ParseError(format!("Invalid MCP env secrets JSON: {}", e)))?;

    let tools = mcp::client::connect_server(&server_config, env_map)
        .await
        .map_err(|e| {
            log::error!("MCP server start failed: {}", e);
            AppError::McpError(e)
        })?;

    Ok(serde_json::to_string(&tools).unwrap_or_default())
}

#[tauri::command]
async fn mcp_check_command(command: String) -> Result<String, AppError> {
    let info = mcp::client::check_executable(&command).await;
    Ok(serde_json::to_string(&info).unwrap_or_default())
}

#[tauri::command]
async fn mcp_stop_server(server_id: String) -> Result<(), AppError> {
    mcp::client::disconnect_server(&server_id).map_err(|e| {
        log::error!("MCP server stop failed: {}", e);
        AppError::McpError(e)
    })
}

#[tauri::command]
async fn mcp_list_tools(server_id: String) -> Result<String, AppError> {
    let manager = crate::mcp::MCP_SERVERS
        .lock()
        .map_err(|e| AppError::McpError(format!("Manager lock poisoned: {}", e)))?;
    let tools = manager.get_tools(&server_id);
    Ok(serde_json::to_string(&tools).unwrap_or_default())
}

#[tauri::command]
async fn mcp_call_tool(
    server_id: String,
    tool_name: String,
    arguments: String,
) -> Result<String, AppError> {
    let args: serde_json::Value = serde_json::from_str(&arguments)
        .map_err(|e| AppError::ParseError(format!("Invalid tool arguments JSON: {}", e)))?;

    let result = mcp::client::call_tool_on_server(&server_id, &tool_name, &args)
        .await
        .map_err(|e| {
            log::error!("MCP tool call failed: {}", e);
            AppError::McpError(e)
        })?;

    Ok(serde_json::to_string(&result).unwrap_or_default())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_keyring_store();
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
            load_api_keys,
            save_api_keys_cmd,
            load_search_api_keys,
            save_search_api_keys_cmd,
            chat_completion,
            chat_stream,
            cancel_chat_stream,
            chat_completion_tools,
            chat_stream_tools,
            generate_title,
            check_api,
            web_search,
            fetch_url_content,
            ws_authenticate,
            ws_chat,
            load_mcp_config,
            save_mcp_config,
            load_mcp_env_secrets,
            save_mcp_env_secrets_cmd,
            mcp_start_server,
            mcp_check_command,
            mcp_stop_server,
            mcp_list_tools,
            mcp_call_tool
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
