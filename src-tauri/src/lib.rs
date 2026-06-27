mod anthropic;
mod appshots;
mod git;
mod mcp;
pub mod project;
mod project_tools;
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
use tauri::{Manager, Emitter};

#[derive(Debug, Serialize, Deserialize)]
struct ChatMessage {
    role: String,
    // Either a plain string or an OpenAI multipart content array
    // (e.g. text + image_url parts). `serde_json::Value` round-trips both
    // transparently when re-serialized into the upstream request body.
    #[serde(default, with = "json_or_none")]
    content: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_calls: Option<Vec<ToolCallData>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
}

/// Serializes `None` as a missing field and otherwise emits the JSON value as-is.
/// On deserialize, an absent field or explicit `null` becomes `None`; a string
/// becomes `Value::String`; any other JSON value passes through.
mod json_or_none {
    use serde::{Deserialize, Deserializer, Serializer};
    use serde_json::Value;

    pub fn serialize<S>(value: &Option<Value>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match value {
            Some(v) => serializer.serialize_some(v),
            None => serializer.serialize_none(),
        }
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Option<Value>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let opt = Option::<Value>::deserialize(deserializer)?;
        Ok(opt.filter(|v| !v.is_null()))
    }
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
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
}

#[derive(Debug, Serialize)]
struct ChatRequestTools {
    model: String,
    messages: Vec<serde_json::Value>,
    temperature: f64,
    tools: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_choice: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
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

static CANCELLED_STREAMS: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

fn mark_stream_cancelled(stream_id: String) -> Result<(), AppError> {
    let mut cancelled = CANCELLED_STREAMS.lock().unwrap_or_else(|e| e.into_inner());
    cancelled.insert(stream_id);
    Ok(())
}

fn clear_stream_cancelled(stream_id: &str) {
    let mut cancelled = CANCELLED_STREAMS.lock().unwrap_or_else(|e| e.into_inner());
    cancelled.remove(stream_id);
}

fn is_stream_cancelled(stream_id: &str) -> bool {
    let cancelled = CANCELLED_STREAMS.lock().unwrap_or_else(|e| e.into_inner());
    cancelled.contains(stream_id)
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
    #[error("Git error: {0}")]
    GitError(String),
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::ConfigIo(err.to_string())
    }
}

impl From<tauri::Error> for AppError {
    fn from(err: tauri::Error) -> Self {
        AppError::AppPath(err.to_string())
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
        dbus_secret_service_keyring_store::Store::new()
            .expect("Failed to init Linux Secret Service store"),
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

#[derive(Deserialize)]
struct ModelConfig {
    id: String,
    #[serde(rename = "apiBase")]
    api_base: String,
    #[serde(rename = "modelId")]
    model_id: String,
    provider: Option<String>,
    #[serde(rename = "allowLocalNetwork")]
    allow_local_network: Option<bool>,
}

async fn get_model_config_and_key(
    app: &tauri::AppHandle,
    config_id: &str,
) -> Result<(String, String, String, Option<String>), AppError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::AppPath(e.to_string()))?;
    let config_path = app_data_dir.join("config.json");
    if !config_path.exists() {
        return Err(AppError::ConfigIo("Configuration file not found".to_string()));
    }
    let config_content = fs::read_to_string(config_path)?;
    let configs: Vec<ModelConfig> = serde_json::from_str(&config_content)
        .map_err(|e| AppError::ConfigIo(format!("Failed to parse config: {}", e)))?;

    let config = configs.into_iter().find(|c| c.id == config_id)
        .ok_or_else(|| AppError::ConfigIo(format!("Model config not found for ID: {}", config_id)))?;

    let api_key = match get_keychain_secret("model", config_id) {
        Ok(secret) => secret,
        Err(_) => String::new(),
    };

    let parsed_url = url::Url::parse(&config.api_base)
        .map_err(|e| AppError::ConfigIo(format!("Invalid apiBase URL: {}", e)))?;

    if let Some(host) = parsed_url.host_str() {
        let host_lower = host.to_lowercase();

        let is_loopback = host_lower == "localhost" || host_lower == "127.0.0.1" || host_lower == "::1";

        let is_private_ip = if let Some(ip) = parsed_url.host().and_then(|h| match h {
            url::Host::Ipv4(v4) => Some(std::net::IpAddr::V4(v4)),
            url::Host::Ipv6(v6) => Some(std::net::IpAddr::V6(v6)),
            _ => None,
        }) {
            match ip {
                std::net::IpAddr::V4(v4) => {
                    let octets = v4.octets();
                    octets[0] == 10
                        || (octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31)
                        || (octets[0] == 192 && octets[1] == 168)
                        || (octets[0] == 169 && octets[1] == 254)
                }
                std::net::IpAddr::V6(v6) => {
                    let segments = v6.segments();
                    (segments[0] & 0xfe00) == 0xfc00
                        || (segments[0] & 0xffc0) == 0xfe80
                        || v6.is_loopback()
                }
            }
        } else {
            false
        };

        if is_loopback || is_private_ip {
            let is_ollama = config
                .provider
                .as_deref()
                .map(|p| p.to_lowercase() == "ollama")
                .unwrap_or(false)
                || config.api_base.contains("11434");

            if is_ollama {
                if !config.allow_local_network.unwrap_or(false) {
                    return Err(AppError::ConfigIo("Access denied: Local/private network access is disabled for Ollama. Enable 'allowLocalNetwork' in model config.".to_string()));
                }
            } else {
                return Err(AppError::ConfigIo(format!(
                    "Access denied: Local/private network endpoint '{}' is not allowed.",
                    host
                )));
            }
        }
    }

    Ok((config.api_base, api_key, config.model_id, config.provider))
}

fn truncate_error(body: &str) -> String {
    if body.len() > 200 {
        format!("{}...", &body[..200])
    } else {
        body.to_string()
    }
}

#[tauri::command]
async fn cancel_chat_stream(stream_id: String) -> Result<(), AppError> {
    mark_stream_cancelled(stream_id)
}

#[tauri::command]
async fn chat_completion(
    app: tauri::AppHandle,
    config_id: String,
    messages: Vec<ChatMessage>,
    temperature: f64,
    max_tokens: Option<u32>,
) -> Result<String, AppError> {
    let (api_url, api_key, model, provider) = get_model_config_and_key(&app, &config_id).await?;

    if let Some(p) = provider.as_deref() {
        if p.to_lowercase() == "anthropic" {
            return anthropic::chat_completion_anthropic(
                api_url,
                api_key,
                model,
                messages,
                temperature,
                max_tokens,
            )
            .await;
        }
    }
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()?;
    let body = ChatRequest {
        model,
        messages,
        temperature,
        stream: false,
        max_tokens,
    };

    let mut request = client.post(&api_url).json(&body);
    request = request.header("Content-Type", "application/json");
    if !api_key.is_empty() {
        request = request.header("Authorization", format!("Bearer {}", api_key));
    }

    let resp = request.send().await?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        let err_msg = truncate_error(&body);
        log::error!("chat_completion API error {}: {}", status, err_msg);
        return Err(AppError::ApiError {
            status,
            message: format!("Request failed: {}", err_msg),
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
    app: tauri::AppHandle,
    config_id: String,
    messages: Vec<ChatMessage>,
    temperature: f64,
    stream_id: String,
    max_tokens: Option<u32>,
) -> Result<String, AppError> {
    let (api_url, api_key, model, provider) = get_model_config_and_key(&app, &config_id).await?;

    if let Some(p) = provider.as_deref() {
        if p.to_lowercase() == "anthropic" {
            return anthropic::chat_stream_anthropic(
                api_url,
                api_key,
                model,
                messages,
                temperature,
                stream_id,
                max_tokens,
                app,
            )
            .await;
        }
    }
    clear_stream_cancelled(&stream_id);
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()?;
    let body = ChatRequest {
        model,
        messages,
        temperature,
        stream: true,
        max_tokens,
    };

    let mut request = client.post(&api_url).json(&body);
    request = request.header("Content-Type", "application/json");
    if !api_key.is_empty() {
        request = request.header("Authorization", format!("Bearer {}", api_key));
    }

    let resp = request.send().await?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        let err_msg = truncate_error(&body);
        log::error!("chat_stream API error {}: {}", status, err_msg);
        return Err(AppError::ApiError {
            status,
            message: format!("Request failed: {}", err_msg),
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
    app: tauri::AppHandle,
    config_id: String,
    messages: Vec<serde_json::Value>,
    tools: String,
    temperature: f64,
    stream_id: String,
    max_tokens: Option<u32>,
) -> Result<String, AppError> {
    let (api_url, api_key, model, provider) = get_model_config_and_key(&app, &config_id).await?;

    if let Some(p) = provider.as_deref() {
        if p.to_lowercase() == "anthropic" {
            let parsed_messages: Vec<ChatMessage> = messages
                .into_iter()
                .filter_map(|v| serde_json::from_value(v).ok())
                .collect();
            return anthropic::chat_stream_tools_anthropic(
                api_url,
                api_key,
                model,
                parsed_messages,
                tools,
                temperature,
                stream_id,
                max_tokens,
                app,
            )
            .await;
        }
    }
    clear_stream_cancelled(&stream_id);
    let tools_parsed: Vec<serde_json::Value> = serde_json::from_str(&tools)
        .map_err(|e| AppError::ParseError(format!("Invalid tools JSON: {}", e)))?;

    let body = ChatRequestTools {
        model,
        messages,
        temperature,
        tools: tools_parsed,
        tool_choice: Some(serde_json::Value::String("auto".to_string())),
        max_tokens,
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
        let body = resp.text().await.unwrap_or_default();
        let err_msg = truncate_error(&body);
        log::error!("chat_stream_tools API error {}: {}", status, err_msg);
        return Err(AppError::ApiError {
            status,
            message: format!("Request failed: {}", err_msg),
        });
    }

    let mut stream = resp.bytes_stream();
    let mut parser = stream_parser::SseParser::new();
    let mut accumulated = String::new();

    while let Some(chunk_result) = stream.next().await {
        if is_stream_cancelled(&stream_id) {
            clear_stream_cancelled(&stream_id);
            return Ok(accumulated);
        }

        let chunk = chunk_result.map_err(|e| AppError::StreamError(e.to_string()))?;
        parser.push_bytes(&chunk);
        parser.process_lines(&app, &stream_id, |chunk_text| {
            accumulated.push_str(chunk_text);
        });
    }

    clear_stream_cancelled(&stream_id);
    Ok(accumulated)
}

#[tauri::command]
async fn chat_completion_tools(
    app: tauri::AppHandle,
    config_id: String,
    messages: Vec<serde_json::Value>,
    tools: String,
    temperature: f64,
    max_tokens: Option<u32>,
) -> Result<String, AppError> {
    let (api_url, api_key, model, provider) = get_model_config_and_key(&app, &config_id).await?;

    if let Some(p) = provider.as_deref() {
        if p.to_lowercase() == "anthropic" {
            let parsed_messages: Vec<ChatMessage> = messages
                .into_iter()
                .filter_map(|v| serde_json::from_value(v).ok())
                .collect();
            return anthropic::chat_completion_tools_anthropic(
                api_url,
                api_key,
                model,
                parsed_messages,
                tools,
                temperature,
                max_tokens,
            )
            .await;
        }
    }
    let tools_parsed: Vec<serde_json::Value> = serde_json::from_str(&tools)
        .map_err(|e| AppError::ParseError(format!("Invalid tools JSON: {}", e)))?;

    let body = ChatRequestTools {
        model,
        messages,
        temperature,
        tools: tools_parsed,
        tool_choice: Some(serde_json::Value::String("auto".to_string())),
        max_tokens,
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
        let body = resp.text().await.unwrap_or_default();
        let err_msg = truncate_error(&body);
        log::error!("chat_completion_tools API error {}: {}", status, err_msg);
        return Err(AppError::ApiError {
            status,
            message: format!("Request failed: {}", err_msg),
        });
    }

    let raw = resp.text().await?;
    Ok(raw)
}

#[tauri::command]
async fn check_api(
    app: tauri::AppHandle,
    config_id: String,
) -> Result<bool, AppError> {
    let (api_url, api_key, _, provider) = get_model_config_and_key(&app, &config_id).await?;

    if let Some(p) = provider.as_deref() {
        if p.to_lowercase() == "anthropic" {
            return anthropic::check_api_anthropic(api_url, api_key).await;
        }
    }
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

#[derive(Debug, Serialize, Deserialize)]
struct OllamaResponse {
    models: Vec<OllamaModel>,
}

#[derive(Debug, Serialize, Deserialize)]
struct OllamaModel {
    name: String,
    model: Option<String>,
}

#[tauri::command]
async fn check_ollama() -> Result<Vec<String>, AppError> {
    let client = Client::new();
    let resp = client
        .get("http://127.0.0.1:11434/api/tags")
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await?;

    if resp.status().is_success() {
        let ollama_res: OllamaResponse = resp.json().await?;
        let models = ollama_res.models.into_iter().map(|m| m.name).collect();
        Ok(models)
    } else {
        Err(AppError::RequestFailed(format!(
            "Ollama server returned status: {}",
            resp.status()
        )))
    }
}

#[tauri::command]
async fn mcp_list_resources(server_id: String) -> Result<String, AppError> {
    let result = mcp::client::list_resources_on_server(&server_id)
        .await
        .map_err(|e| AppError::McpError(e))?;
    Ok(serde_json::to_string(&result).unwrap_or_default())
}

#[tauri::command]
async fn mcp_list_prompts(server_id: String) -> Result<String, AppError> {
    let result = mcp::client::list_prompts_on_server(&server_id)
        .await
        .map_err(|e| AppError::McpError(e))?;
    Ok(serde_json::to_string(&result).unwrap_or_default())
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
    session: tauri::State<'_, ws_handler::WsSession>,
) -> Result<String, AppError> {
    let config = ws_handler::WsConfig {
        url,
        api_key,
        model,
        reconnect: true,
        max_reconnect_attempts: 5,
    };
    ws_handler::ws_connect(config, app, &session)
        .await
        .map_err(AppError::AuthError)?;
    Ok("Connected".to_string())
}

#[tauri::command]
async fn ws_connect(
    url: String,
    api_key: Option<String>,
    model: String,
    app: tauri::AppHandle,
    session: tauri::State<'_, ws_handler::WsSession>,
) -> Result<(), AppError> {
    let config = ws_handler::WsConfig {
        url,
        api_key,
        model,
        reconnect: true,
        max_reconnect_attempts: 5,
    };
    ws_handler::ws_connect(config, app, &session)
        .await
        .map_err(AppError::AuthError)
}

#[tauri::command]
async fn ws_send(
    message: String,
    session: tauri::State<'_, ws_handler::WsSession>,
) -> Result<(), AppError> {
    ws_handler::ws_send(message, &session)
        .await
        .map_err(AppError::AuthError)
}

#[tauri::command]
async fn ws_disconnect(
    app: tauri::AppHandle,
    session: tauri::State<'_, ws_handler::WsSession>,
) -> Result<(), AppError> {
    ws_handler::ws_disconnect(&session, app)
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
        let body = resp.text().await.unwrap_or_default();
        log::error!("ws_authenticate API error {}: {}", status, body);
        return Err(AppError::ApiError {
            status,
            message: format!("Authentication failed: {}", body),
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
                content: Some(serde_json::Value::String(system_prompt)),
                tool_calls: None,
                tool_call_id: None,
                name: None,
            },
            ChatMessage {
                role: "user".to_string(),
                content: Some(serde_json::Value::String(user_message)),
                tool_calls: None,
                tool_call_id: None,
                name: None,
            },
        ],
        temperature: 0.3,
        stream: false,
        max_tokens: None,
    };

    let mut request = client.post(&api_url).json(&body);
    request = request.header("Content-Type", "application/json");
    if !api_key.is_empty() {
        request = request.header("Authorization", format!("Bearer {}", api_key));
    }

    let resp = request.send().await?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        log::error!("generate_title API error {}: {}", status, body);
        return Err(AppError::ApiError {
            status,
            message: format!("Title generation failed: {}", body),
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
    let secrets_map = secrets.as_object().ok_or_else(|| {
        AppError::ParseError("MCP env secrets payload must be an object".to_string())
    })?;

    let existing_server_ids = load_secret_index(&app, MCP_ENV_KEY_INDEX)?;

    for server_id in &existing_server_ids {
        if !secrets_map.contains_key(server_id) {
            let server_index_key = format!("mcp-env:{}", server_id);
            let store = tauri_plugin_store::StoreExt::store(&app, STORE_FILE)
                .map_err(|e| AppError::ConfigIo(format!("Failed to open store: {}", e)))?;
            if let Some(env_index) = store.get(&server_index_key) {
                if let Some(arr) = env_index.as_array() {
                    for key in arr.iter().filter_map(|v| v.as_str()) {
                        let _ =
                            delete_keychain_secret("mcp-env", &format!("{}:{}", server_id, key));
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
        .unwrap_or_else(|e| e.into_inner());
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

#[tauri::command]
async fn wipe_config_files(app: tauri::AppHandle) -> Result<(), AppError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::AppPath(e.to_string()))?;

    let files = vec![
        "config.json",
        "search_config.json",
        "mcp_config.json",
        "sythoria-store.json",
    ];
    for file_name in files {
        let path = app_data_dir.join(file_name);
        if path.exists() {
            let _ = fs::remove_file(path);
        }
    }
    Ok(())
}

fn should_close_to_tray(app: &tauri::AppHandle) -> bool {
    if let Ok(store) = tauri_plugin_store::StoreExt::store(app, STORE_FILE) {
        if let Some(val) = store.get("sythoria-close-to-tray") {
            return val.as_bool().unwrap_or(false);
        }
    }
    false
}

#[tauri::command]
async fn set_autostart_enabled(app: tauri::AppHandle, enabled: bool) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        use smappservice_rs::{AppService, ServiceType};
        let service = AppService::new(ServiceType::MainApp);
        if enabled {
            service
                .register()
                .map_err(|e| AppError::ConfigIo(e.to_string()))?;
        } else {
            service
                .unregister()
                .map_err(|e| AppError::ConfigIo(e.to_string()))?;
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        use tauri_plugin_autostart::ManagerExt;
        let manager = app.autolaunch();
        if enabled {
            manager
                .enable()
                .map_err(|e| AppError::ConfigIo(e.to_string()))?;
        } else {
            manager
                .disable()
                .map_err(|e| AppError::ConfigIo(e.to_string()))?;
        }
        Ok(())
    }
}

#[tauri::command]
async fn is_autostart_enabled(app: tauri::AppHandle) -> Result<bool, AppError> {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        use smappservice_rs::{AppService, ServiceStatus, ServiceType};
        let service = AppService::new(ServiceType::MainApp);
        Ok(service.status() == ServiceStatus::Enabled)
    }
    #[cfg(not(target_os = "macos"))]
    {
        use tauri_plugin_autostart::ManagerExt;
        let manager = app.autolaunch();
        manager
            .is_enabled()
            .map_err(|e| AppError::ConfigIo(e.to_string()))
    }
}

pub struct FileTokenRegistry {
    pub tokens: std::sync::Mutex<std::collections::HashMap<String, std::path::PathBuf>>,
}

impl FileTokenRegistry {
    pub fn new() -> Self {
        Self {
            tokens: std::sync::Mutex::new(std::collections::HashMap::new()),
        }
    }

    pub fn register(&self, path: std::path::PathBuf) -> String {
        let token = uuid::Uuid::new_v4().to_string();
        if let Ok(mut lock) = self.tokens.lock() {
            lock.insert(token.clone(), path);
        }
        token
    }

    pub fn consume(&self, token: &str) -> Option<std::path::PathBuf> {
        if let Ok(mut lock) = self.tokens.lock() {
            lock.remove(token)
        } else {
            None
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FilePayload {
    name: String,
    size: u64,
    mime_type: String,
    data_url: Option<String>,
    text_content: Option<String>,
}

#[tauri::command]
async fn select_file_and_get_token(
    app: tauri::AppHandle,
    state: tauri::State<'_, FileTokenRegistry>,
    title: Option<String>,
) -> Result<Option<(String, String, u64)>, AppError> {
    use tauri_plugin_dialog::DialogExt;
    let file_path = app
        .dialog()
        .file()
        .set_title(title.as_deref().unwrap_or("Select File"))
        .blocking_pick_file();

    if let Some(path) = file_path {
        let path_buf = match path {
            tauri_plugin_dialog::FilePath::Path(p) => p,
            tauri_plugin_dialog::FilePath::Url(u) => {
                if let Ok(p) = u.to_file_path() {
                    p
                } else {
                    return Err(AppError::ConfigIo("Invalid file path URL".to_string()));
                }
            }
        };
        let name = path_buf
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();

        let metadata = std::fs::metadata(&path_buf)?;
        let size = metadata.len();

        if size > 10 * 1024 * 1024 {
            return Err(AppError::ConfigIo("File size exceeds the 10 MB limit".to_string()));
        }

        let token = state.register(path_buf);
        Ok(Some((token, name, size)))
    } else {
        Ok(None)
    }
}

#[tauri::command]
async fn read_file_from_token(
    state: tauri::State<'_, FileTokenRegistry>,
    token: String,
) -> Result<FilePayload, AppError> {
    let path_buf = state
        .consume(&token)
        .ok_or_else(|| AppError::ConfigIo("Invalid or expired file token".to_string()))?;

    if !path_buf.is_file() {
        return Err(AppError::ConfigIo(format!(
            "Path is not a file: {}",
            path_buf.display()
        )));
    }

    let metadata = fs::metadata(&path_buf)?;
    let size = metadata.len();
    if size > 10 * 1024 * 1024 {
        return Err(AppError::ConfigIo(format!(
            "File size exceeds the 10 MB limit"
        )));
    }

    let name = path_buf
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    let ext = path_buf
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default();

    let is_image = ext == "png" || ext == "jpg" || ext == "jpeg" || ext == "gif" || ext == "webp";

    if is_image {
        let bytes = fs::read(&path_buf)?;
        use base64::Engine;
        let b64 = base64::prelude::BASE64_STANDARD.encode(&bytes);
        let mime_type = match ext.as_str() {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            _ => "image/png",
        };
        Ok(FilePayload {
            name,
            size,
            mime_type: mime_type.to_string(),
            data_url: Some(format!("data:{};base64,{}", mime_type, b64)),
            text_content: None,
        })
    } else {
        let text_content = fs::read_to_string(&path_buf)
            .map_err(|e| AppError::ConfigIo(format!("Failed to read file as text: {}", e)))?;

        let mime_type = match ext.as_str() {
            "txt" => "text/plain",
            "html" => "text/html",
            "css" => "text/css",
            "js" => "application/javascript",
            "ts" => "application/typescript",
            "json" => "application/json",
            "md" | "markdown" => "text/markdown",
            _ => "text/plain",
        };

        Ok(FilePayload {
            name,
            size,
            mime_type: mime_type.to_string(),
            data_url: None,
            text_content: Some(text_content),
        })
    }
}

#[tauri::command]
async fn select_save_file_and_get_token(
    app: tauri::AppHandle,
    state: tauri::State<'_, FileTokenRegistry>,
    title: Option<String>,
    default_name: Option<String>,
) -> Result<Option<(String, String)>, AppError> {
    use tauri_plugin_dialog::DialogExt;
    let mut builder = app
        .dialog()
        .file()
        .set_title(title.as_deref().unwrap_or("Save File"));
    if let Some(ref name) = default_name {
        builder = builder.set_file_name(name);
    }

    let file_path = builder.blocking_save_file();
    if let Some(path) = file_path {
        let path_buf = match path {
            tauri_plugin_dialog::FilePath::Path(p) => p,
            tauri_plugin_dialog::FilePath::Url(u) => {
                if let Ok(p) = u.to_file_path() {
                    p
                } else {
                    return Err(AppError::ConfigIo("Invalid file path URL".to_string()));
                }
            }
        };
        let path_str = path_buf.to_string_lossy().to_string();
        let token = state.register(path_buf);
        Ok(Some((token, path_str)))
    } else {
        Ok(None)
    }
}

#[tauri::command]
async fn write_exported_file_by_token(
    state: tauri::State<'_, FileTokenRegistry>,
    token: String,
    content: String,
) -> Result<(), AppError> {
    let path_buf = state
        .consume(&token)
        .ok_or_else(|| AppError::ConfigIo("Invalid or expired file token".to_string()))?;

    fs::write(path_buf, content)?;
    Ok(())
}



#[cfg_attr(mobile, tauri::mobile_entry_point)]

pub fn run() {
    init_keyring_store();
    let project_registry = project::ProjectRegistry::new();
    let file_token_registry = FileTokenRegistry::new();
    tauri::Builder::default()
        .manage(project_registry)
        .manage(file_token_registry)
        .manage(ws_handler::WsSession::default())
        .setup(|app| {
            let registry = app.state::<project::ProjectRegistry>();
            let _ = registry.load_from_disk(app.app_handle());
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
                let shortcut = Shortcut::new(Some(Modifiers::ALT), Code::Space);
                let _ = app.global_shortcut().register(shortcut);
            }

            let _window = app.get_webview_window("main").unwrap();

            #[cfg(target_os = "macos")]
            let _ = window_vibrancy::apply_vibrancy(
                &_window,
                window_vibrancy::NSVisualEffectMaterial::UnderWindowBackground,
                None,
                Some(16.0),
            );

            #[cfg(target_os = "windows")]
            let _ = window_vibrancy::apply_blur(&_window, Some((18, 18, 18, 125)));

            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            {
                let quit_i = tauri::menu::MenuItemBuilder::with_id("quit", "Quit").build(app)?;
                let show_i =
                    tauri::menu::MenuItemBuilder::with_id("show", "Show Sythoria").build(app)?;
                let menu = tauri::menu::MenuBuilder::new(app)
                    .items(&[&show_i, &quit_i])
                    .build()?;

                let _tray = tauri::tray::TrayIconBuilder::new()
                    .icon(app.default_window_icon().unwrap().clone())
                    .menu(&menu)
                    .on_menu_event(|app, event| match event.id().as_ref() {
                        "quit" => {
                            app.exit(0);
                        }
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let tauri::tray::TrayIconEvent::Click {
                            button,
                            button_state,
                            ..
                        } = event
                        {
                            if button == tauri::tray::MouseButton::Left
                                && button_state == tauri::tray::MouseButtonState::Up
                            {
                                let app = tray.app_handle();
                                if let Some(window) = app.get_webview_window("main") {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                    })
                    .build(app)?;
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    let app = window.app_handle();
                    if should_close_to_tray(app) {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                let app = window.app_handle();
                let state = app.state::<FileTokenRegistry>();

                let mut payload = Vec::new();
                for path in paths {
                    if path.is_file() {
                        let name = path
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("unknown")
                            .to_string();
                        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                        let token = state.register(path.clone());
                        payload.push(serde_json::json!({
                            "token": token,
                            "name": name,
                            "size": size,
                        }));
                    }
                }

                let _ = window.emit("sythoria://drag-drop-tokens", payload);
            }
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::AppleScript,
            None,
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};
                    if event.state() == ShortcutState::Pressed {
                        if shortcut.matches(Modifiers::ALT, Code::Space) {
                            if let Some(spotlight_win) = app.get_webview_window("spotlight") {
                                match spotlight_win.is_visible() {
                                    Ok(true) => {
                                        let _ = spotlight_win.hide();
                                    }
                                    Ok(false) => {
                                        let _ = spotlight_win.show();
                                        let _ = spotlight_win.set_focus();
                                    }
                                    _ => {}
                                }
                            }
                        }
                    }
                })
                .build(),
        )
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
            check_ollama,
            web_search,
            fetch_url_content,
            ws_authenticate,
            ws_chat,
            ws_connect,
            ws_send,
            ws_disconnect,
            load_mcp_config,
            save_mcp_config,
            load_mcp_env_secrets,
            save_mcp_env_secrets_cmd,
            mcp_start_server,
            mcp_check_command,
            mcp_stop_server,
            mcp_list_tools,
            mcp_list_resources,
            mcp_list_prompts,
            mcp_call_tool,
            wipe_config_files,
            set_autostart_enabled,
            is_autostart_enabled,
            select_file_and_get_token,
            read_file_from_token,
            select_save_file_and_get_token,
            write_exported_file_by_token,
            project::load_projects,
            project::save_projects,
            project::set_active_project,
            git::git_detect_repo,
            git::git_get_status,
            git::git_create_commit,
            git::git_undo_last_commit,
            git::git_checkout_branch,
            git::git_diff_changes,
            project_tools::project_read,
            project_tools::project_write,
            project_tools::project_edit,
            project_tools::project_multi_replace_file_content,
            project_tools::project_list_dir,
            project_tools::project_bash,
            project_tools::project_grep,
            project_tools::project_glob,
            project_tools::create_project_dir,
            appshots::capture_screen,
            appshots::list_appshots,
            appshots::delete_appshot,
            appshots::run_appshots_clean,
            appshots::select_appshot_folder,
            appshots::has_screen_capture_permission,
            appshots::request_screen_capture_permission
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
