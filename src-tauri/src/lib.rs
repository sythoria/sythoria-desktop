mod anthropic;
mod appshots;
mod git;
mod mcp;
pub mod project;
mod project_tools;
mod search;
mod stream_parser;
mod ws_handler;
mod skills;
pub mod commands;

use futures_util::StreamExt;
use std::sync::RwLock;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct NetworkConfig {
    pub strict_ssl: bool,
    pub blocked_hosts: Vec<String>,
}

impl Default for NetworkConfig {
    fn default() -> Self {
        Self {
            strict_ssl: true,
            blocked_hosts: vec![
                "localhost".to_string(),
                "127.0.0.1".to_string(),
                "0.0.0.0".to_string(),
                "::1".to_string(),
                "169.254.169.254".to_string(),
                "metadata.google.internal".to_string(),
                "metadata.azure.com".to_string(),
                "100.100.100.200".to_string(),
                "10.0.0.0/8".to_string(),
                "172.16.0.0/12".to_string(),
                "192.168.0.0/16".to_string(),
                "169.254.0.0/16".to_string(),
                "100.64.0.0/10".to_string(),
                "fc00::/7".to_string(),
                "fe80::/10".to_string(),
            ],
        }
    }
}

pub static NETWORK_CONFIG: LazyLock<RwLock<NetworkConfig>> = LazyLock::new(|| RwLock::new(NetworkConfig::default()));

pub fn get_strict_ssl() -> bool {
    NETWORK_CONFIG.read().map(|c| c.strict_ssl).unwrap_or(true)
}

pub fn get_blocked_hosts() -> Vec<String> {
    NETWORK_CONFIG.read().map(|c| c.blocked_hosts.clone()).unwrap_or_else(|_| NetworkConfig::default().blocked_hosts)
}

fn init_network_settings(app: &tauri::AppHandle) {
    if let Ok(config) = commands::config::load_network_config_internal(app) {
        if let Ok(mut lock) = NETWORK_CONFIG.write() {
            *lock = config;
        }
    }
}

pub fn client_builder() -> reqwest::ClientBuilder {
    let mut builder = reqwest::Client::builder();
    if !get_strict_ssl() {
        builder = builder.danger_accept_invalid_certs(true);
    }
    builder
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub latest_version: String,
    pub release_url: String,
    pub release_notes: Option<String>,
}

#[tauri::command]
async fn check_for_updates() -> Result<UpdateCheckResult, AppError> {
    let url = "https://api.github.com/repos/sythoria/sythoria-desktop/releases/latest";

    let client = client_builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| AppError::RequestFailed(e.to_string()))?;

    let user_agent = format!("Sythoria/{} (Desktop AI Assistant)", env!("CARGO_PKG_VERSION"));
    let resp = client
        .get(url)
        .header("User-Agent", &user_agent)
        .send()
        .await
        .map_err(|e| AppError::RequestFailed(e.to_string()))?;

    if !resp.status().is_success() {
        return Err(AppError::ApiError {
            status: resp.status().as_u16(),
            message: format!("GitHub API returned error: {}", resp.status()),
        });
    }

    let release_info: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::ParseError(e.to_string()))?;

    let tag_name = release_info["tag_name"]
        .as_str()
        .ok_or_else(|| AppError::ParseError("Missing tag_name in release info".to_string()))?
        .trim()
        .to_string();

    let release_url = release_info["html_url"]
        .as_str()
        .unwrap_or("")
        .to_string();

    let release_notes = release_info["body"]
        .as_str()
        .map(|s| s.to_string());

    Ok(UpdateCheckResult {
        latest_version: tag_name,
        release_url,
        release_notes,
    })
}

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
pub enum AppError {
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
    let _ = app;
    commands::config::get_keychain_secret("search", config_id)
}

use commands::config::get_model_config_and_key;

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
    let client = client_builder()
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
    let client = client_builder()
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

    let client = client_builder()
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

    let client = client_builder()
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
    let client = client_builder().build()?;

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
    let client = client_builder().build()?;
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
async fn fetch_url_content(
    url: String,
    provider: Option<String>,
    config: Option<String>,
    config_id: Option<String>,
    format: Option<String>,
    app: tauri::AppHandle,
) -> Result<String, AppError> {
    let mut config_json: Option<serde_json::Value> = None;
    if let Some(cfg) = config {
        let mut parsed: serde_json::Value = serde_json::from_str(&cfg)
            .map_err(|e| AppError::ParseError(format!("Invalid search config JSON: {}", e)))?;
        
        if let Some(id) = config_id {
            if parsed
                .get("apiKey")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .is_empty()
            {
                match get_search_api_key(&app, &id).await {
                    Ok(key) => {
                        parsed["apiKey"] = serde_json::Value::String(key);
                    }
                    Err(_) => {
                        log::warn!("No API key found in secure store for search config '{}'", id);
                    }
                }
            }
        }
        config_json = Some(parsed);
    }

    let content = search::fetch(
        &url,
        provider.as_deref(),
        config_json.as_ref(),
        format.as_deref(),
    ).await.map_err(|e| {
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
    let client = client_builder().build()?;
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
    let client = client_builder()
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

fn should_close_to_tray(app: &tauri::AppHandle) -> bool {
    if let Ok(store) = tauri_plugin_store::StoreExt::store(app, commands::config::STORE_FILE) {
        if let Some(val) = store.get("sythoria-close-to-tray") {
            return val.as_bool().unwrap_or(false);
        }
    }
    false
}

static TRAY_VISIBLE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);

fn update_tray_visibility(app: &tauri::AppHandle) {
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    if let Some(tray) = app.tray_by_id("main") {
        let should_show = if should_close_to_tray(app) {
            if let Some(window) = app.get_webview_window("main") {
                let is_visible = window.is_visible().unwrap_or(true);
                let is_minimized = window.is_minimized().unwrap_or(false);
                !is_visible || is_minimized
            } else {
                false
            }
        } else {
            false
        };
        
        if TRAY_VISIBLE.load(std::sync::atomic::Ordering::Relaxed) != should_show {
            let _ = tray.set_visible(should_show);
            TRAY_VISIBLE.store(should_show, std::sync::atomic::Ordering::Relaxed);
        }
    }
}

#[tauri::command]
fn update_tray_icon(app: tauri::AppHandle) {
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    update_tray_visibility(&app);
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

#[cfg(target_os = "macos")]
fn create_macos_menu(app: &tauri::App<tauri::Wry>) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, Submenu, MenuItem, PredefinedMenuItem};

    let about = PredefinedMenuItem::about(app, None, None)?;
    let check_updates = MenuItem::with_id(app, "check_updates", "Check for Updates...", true, None::<&str>)?;
    let services = PredefinedMenuItem::services(app, None)?;
    let hide = PredefinedMenuItem::hide(app, None)?;
    let hide_others = PredefinedMenuItem::hide_others(app, None)?;
    let show_all = PredefinedMenuItem::show_all(app, None)?;
    let quit = PredefinedMenuItem::quit(app, None)?;

    let sythoria_menu = Submenu::with_id_and_items(
        app,
        "sythoria",
        "Sythoria",
        true,
        &[
            &about,
            &PredefinedMenuItem::separator(app)?,
            &check_updates,
            &PredefinedMenuItem::separator(app)?,
            &services,
            &PredefinedMenuItem::separator(app)?,
            &hide,
            &hide_others,
            &show_all,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let new_chat = MenuItem::with_id(app, "new_conversation", "New Conversation", true, Some("CmdOrCtrl+Shift+O"))?;
    let create_project = MenuItem::with_id(app, "create_project", "Create Project", true, None::<&str>)?;
    let cmd_palette = MenuItem::with_id(app, "command_palette", "Command Palette", true, Some("CmdOrCtrl+Shift+P"))?;
    
    let file_menu = Submenu::with_id_and_items(
        app,
        "file",
        "File",
        true,
        &[
            &new_chat,
            &create_project,
            &PredefinedMenuItem::separator(app)?,
            &cmd_palette,
        ],
    )?;

    let edit_menu = Submenu::with_id_and_items(
        app,
        "edit",
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let zoom_in = MenuItem::with_id(app, "zoom_in", "Zoom In", true, Some("CmdOrCtrl+="))?;
    let zoom_out = MenuItem::with_id(app, "zoom_out", "Zoom Out", true, Some("CmdOrCtrl+-"))?;
    let zoom_reset = MenuItem::with_id(app, "zoom_reset", "Reset Zoom", true, Some("CmdOrCtrl+0"))?;

    let view_menu = Submenu::with_id_and_items(
        app,
        "view",
        "View",
        true,
        &[
            &zoom_in,
            &zoom_out,
            &zoom_reset,
        ],
    )?;

    let minimize = PredefinedMenuItem::minimize(app, None)?;
    let maximize = MenuItem::with_id(app, "maximize", "Maximize", true, None::<&str>)?;
    let close = PredefinedMenuItem::close_window(app, None)?;

    let window_menu = Submenu::with_id_and_items(
        app,
        "window",
        "Window",
        true,
        &[
            &minimize,
            &maximize,
            &close,
        ],
    )?;

    Menu::with_items(
        app,
        &[
            &sythoria_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
        ],
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    commands::config::init_keyring_store();
    let project_registry = project::ProjectRegistry::new();
    let file_token_registry = FileTokenRegistry::new();
    let app = tauri::Builder::default()
        .manage(project_registry)
        .manage(file_token_registry)
        .manage(ws_handler::WsSession::default())
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "check_updates" => {
                    let _ = app.emit("menu-check-updates", ());
                }
                "new_conversation" => {
                    let _ = app.emit("menu-new-conversation", ());
                }
                "create_project" => {
                    let _ = app.emit("menu-create-project", ());
                }
                "command_palette" => {
                    let _ = app.emit("menu-command-palette", ());
                }
                "zoom_in" => {
                    let _ = app.emit("menu-zoom-in", ());
                }
                "zoom_out" => {
                    let _ = app.emit("menu-zoom-out", ());
                }
                "zoom_reset" => {
                    let _ = app.emit("menu-zoom-reset", ());
                }
                "maximize" => {
                    if let Some(window) = app.get_webview_window("main") {
                        if let Ok(maximized) = window.is_maximized() {
                            if maximized {
                                let _ = window.unmaximize();
                            } else {
                                let _ = window.maximize();
                            }
                        }
                    }
                }
                _ => {}
            }
        })
        .setup(|app| {
            init_network_settings(app.app_handle());
            let registry = app.state::<project::ProjectRegistry>();
            let _ = registry.load_from_disk(app.app_handle());
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
                let shortcut = Shortcut::new(Some(Modifiers::CONTROL), Code::Space);
                let _ = app.global_shortcut().register(shortcut);
            }

            let _window = app.get_webview_window("main").ok_or_else(|| Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "Main window not found")) as Box<dyn std::error::Error>)?;
            let _ = _window.center();

            #[cfg(not(target_os = "macos"))]
            let _ = _window.set_decorations(false);

            #[cfg(target_os = "macos")]
            {
                let _ = window_vibrancy::apply_vibrancy(
                    &_window,
                    window_vibrancy::NSVisualEffectMaterial::UnderWindowBackground,
                    None,
                    Some(16.0),
                );
                if let Ok(menu) = create_macos_menu(app) {
                    let _ = app.set_menu(menu);
                }
            }

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

                let _tray = tauri::tray::TrayIconBuilder::with_id("main")
                    .icon(app.default_window_icon().ok_or_else(|| Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "Window icon not found")) as Box<dyn std::error::Error>)?.clone())
                    .menu(&menu)
                    .on_menu_event(|app, event| match event.id().as_ref() {
                        "quit" => {
                            app.exit(0);
                        }
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                                let _ = window.unminimize();
                                update_tray_visibility(app);
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
                                    let _ = window.unminimize();
                                    update_tray_visibility(app);
                                }
                            }
                        }
                    })
                    .build(app)?;

                update_tray_visibility(app.app_handle());
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            {
                let app = window.app_handle();
                match event {
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        if window.label() == "main" {
                            if should_close_to_tray(app) {
                                api.prevent_close();
                                let _ = window.hide();
                                update_tray_visibility(app);
                            } else {
                                app.exit(0);
                            }
                        }
                    }
                    tauri::WindowEvent::Focused(_)
                    | tauri::WindowEvent::Resized(_)
                    | tauri::WindowEvent::Moved(_) => {
                        update_tray_visibility(app);
                    }
                    _ => {}
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
                        if shortcut.matches(Modifiers::CONTROL, Code::Space) {
                            if let Some(main_win) = app.get_webview_window("main") {
                                let _ = main_win.show();
                                let _ = main_win.set_focus();
                                let _ = main_win.emit("sythoria://spotlight-shown", ());
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
            commands::config::load_config,
            commands::config::save_config,
            commands::config::load_network_config,
            commands::config::save_network_config,
            commands::config::load_search_config,
            commands::config::save_search_config,
            commands::config::load_api_keys,
            commands::config::save_api_keys_cmd,
            commands::config::load_search_api_keys,
            commands::config::save_search_api_keys_cmd,
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
            check_for_updates,
            ws_authenticate,
            ws_chat,
            ws_connect,
            ws_send,
            ws_disconnect,
            load_mcp_config,
            save_mcp_config,
            commands::config::load_mcp_env_secrets,
            commands::config::save_mcp_env_secrets_cmd,
            commands::config::load_mcp_api_keys,
            commands::config::save_mcp_api_keys_cmd,
            commands::mcp::mcp_start_server,
            commands::mcp::mcp_check_command,
            commands::mcp::mcp_stop_server,
            commands::mcp::mcp_list_tools,
            commands::mcp::mcp_list_resources,
            commands::mcp::mcp_list_prompts,
            commands::mcp::mcp_call_tool,
            commands::config::wipe_config_files,
            set_autostart_enabled,
            is_autostart_enabled,
            update_tray_icon,
            select_file_and_get_token,
            read_file_from_token,
            select_save_file_and_get_token,
            write_exported_file_by_token,
            commands::audio::start_recording,
            commands::audio::stop_recording,
            commands::audio::get_recorded_samples,
            commands::audio::download_whisper_model,
            commands::audio::cancel_whisper_download,
            commands::audio::check_downloaded_whisper_models,
            commands::audio::delete_whisper_model,
            commands::audio::transcribe_audio_cloud,
            commands::audio::transcribe_audio,
            project::load_projects,
            project::save_projects,
            project::set_active_project,
            project::set_project_path_override,
            git::git_detect_repo,
            git::git_get_status,
            git::git_create_commit,
            git::git_undo_last_commit,
            git::git_checkout_branch,
            git::git_diff_changes,
            git::git_worktree_create,
            git::git_worktree_apply,
            git::git_worktree_discard,
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
            appshots::request_screen_capture_permission,
            skills::list_skills,
            skills::read_skill,
            skills::create_skill,
            skills::update_skill,
            skills::delete_skill
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, _event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = _event {
            if let Some(window) = _app_handle.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
                let _ = window.unminimize();
                update_tray_visibility(_app_handle);
            }
        }
    });
}



