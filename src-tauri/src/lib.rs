mod anthropic;
mod appshots;
mod atomic_file;
pub mod commands;
mod endpoint_security;
mod git;
mod keyring;
mod mcp;
pub mod project;
mod project_tools;
mod search;
mod secret_storage;
mod secure_storage;
mod skills;
mod stream_parser;
mod ws_handler;

use futures_util::StreamExt;
use std::sync::RwLock;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct NetworkConfig {
    pub blocked_hosts: Vec<String>,
    #[serde(default)]
    pub allowed_local_endpoints: Vec<String>,
    #[serde(default)]
    pub offline_mode: bool,
}

impl Default for NetworkConfig {
    fn default() -> Self {
        Self {
            offline_mode: false,
            blocked_hosts: Vec::new(),
            allowed_local_endpoints: Vec::new(),
        }
    }
}

impl NetworkConfig {
    fn fail_closed() -> Self {
        Self {
            offline_mode: true,
            blocked_hosts: Self::default().blocked_hosts,
            allowed_local_endpoints: Vec::new(),
        }
    }
}

pub static NETWORK_CONFIG: LazyLock<RwLock<NetworkConfig>> =
    LazyLock::new(|| RwLock::new(NetworkConfig::default()));

pub fn get_offline_mode() -> bool {
    NETWORK_CONFIG
        .read()
        .map(|config| config.offline_mode)
        .unwrap_or(false)
}

pub fn ensure_online() -> Result<(), AppError> {
    if get_offline_mode() {
        return Err(AppError::RequestFailed(
            "Network access is disabled while Offline Mode is enabled".to_string(),
        ));
    }
    Ok(())
}

fn init_network_settings(app: &tauri::AppHandle) {
    let config = match commands::config::load_network_config_internal(app) {
        Ok(config) => config,
        Err(error) => {
            log::error!("Network policy could not be authenticated; failing closed: {error}");
            NetworkConfig::fail_closed()
        }
    };
    if let Ok(mut lock) = NETWORK_CONFIG.write() {
        *lock = config;
    }
}

pub fn client_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder().redirect(reqwest::redirect::Policy::none())
}

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::sync::{LazyLock, Mutex};
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

const DEFAULT_APPSHOT_SHORTCUT: &str = "Alt+Shift+S";
static APPSHOT_SHORTCUT: LazyLock<Mutex<Option<Shortcut>>> = LazyLock::new(|| Mutex::new(None));

#[derive(Default)]
struct TrayRuntimeState {
    close_to_tray: std::sync::atomic::AtomicBool,
}

#[derive(Default)]
struct LaunchRuntimeState {
    frontend_ready: std::sync::atomic::AtomicBool,
}

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
    #[serde(skip_serializing_if = "Option::is_none")]
    anthropic_content: Option<Vec<serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning_details: Option<Vec<serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning: Option<serde_json::Value>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f64>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_completion_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning_effort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
struct ChatRequestTools {
    model: String,
    messages: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f64>,
    tools: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_choice: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_completion_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stream: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning_effort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning: Option<serde_json::Value>,
}

#[derive(Default)]
struct ReasoningParams {
    reasoning_effort: Option<String>,
    reasoning: Option<serde_json::Value>,
    suppress_temperature: bool,
}

fn completion_token_params(
    provider: Option<&str>,
    limit: Option<u32>,
) -> (Option<u32>, Option<u32>) {
    let is_openai = provider.is_some_and(|value| value.eq_ignore_ascii_case("openai"));
    if is_openai {
        (None, limit)
    } else {
        (limit, None)
    }
}

fn reasoning_params(
    provider: Option<&str>,
    model: &str,
    thinking_level: Option<&str>,
) -> ReasoningParams {
    let Some(level) = thinking_level
        .map(str::to_ascii_lowercase)
        .filter(|level| matches!(level.as_str(), "off" | "low" | "medium" | "high"))
    else {
        return ReasoningParams::default();
    };

    let effort = if level == "off" {
        "none".to_string()
    } else {
        level
    };
    let provider = provider.unwrap_or_default().to_ascii_lowercase();
    let model = model.to_ascii_lowercase();

    if provider.contains("openrouter") {
        return ReasoningParams {
            reasoning: Some(serde_json::json!({ "effort": effort })),
            suppress_temperature: true,
            ..Default::default()
        };
    }

    let supports_effort = (provider.contains("openai")
        && ["o1", "o3", "o4", "gpt-5", "gpt-oss"]
            .iter()
            .any(|prefix| model.starts_with(prefix)))
        || ((provider.contains("gemini") || provider.contains("google"))
            && (model.starts_with("gemini-2.5") || model.starts_with("gemini-3")))
        || provider.contains("ollama")
        || ((provider.contains("nim") || provider.contains("nvidia")) && model.contains("gpt-oss"));

    if supports_effort {
        return ReasoningParams {
            reasoning_effort: Some(effort),
            suppress_temperature: true,
            ..Default::default()
        };
    }

    ReasoningParams::default()
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

async fn wait_for_stream_cancelled(stream_id: &str) {
    while !is_stream_cancelled(stream_id) {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
}

/// Guarantees that every streaming command releases its cancellation state and
/// emits one terminal event, including configuration, HTTP, parse, and cancel
/// failures. Parsers only emit chunks; this guard is the single completion owner.
struct StreamCompletionGuard {
    app: tauri::AppHandle,
    stream_id: String,
}

impl StreamCompletionGuard {
    fn new(app: tauri::AppHandle, stream_id: String) -> Self {
        Self { app, stream_id }
    }
}

impl Drop for StreamCompletionGuard {
    fn drop(&mut self) {
        clear_stream_cancelled(&self.stream_id);
        stream_parser::emit_stream_done(&self.app, &self.stream_id);
    }
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
    commands::config::get_search_api_key(app, config_id)?
        .ok_or_else(|| AppError::KeyNotFound(format!("No search API key found for '{config_id}'")))
}

use commands::config::get_model_config_and_key;

fn truncate_error(body: &str) -> String {
    endpoint_security::sanitize_provider_error(body)
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
    thinking_level: Option<String>,
) -> Result<String, AppError> {
    ensure_online()?;
    let (api_url, api_key, model, provider, allow_local_network) =
        get_model_config_and_key(&app, &config_id).await?;
    let endpoint = endpoint_security::validate_http_endpoint(
        &api_url,
        allow_local_network,
        !api_key.is_empty(),
        std::time::Duration::from_secs(60),
    )
    .await?;
    let api_url = endpoint.url.to_string();
    let client = endpoint.client;

    if let Some(p) = provider.as_deref() {
        if p.to_lowercase().contains("anthropic") {
            return anthropic::chat_completion_anthropic(
                anthropic::AnthropicEndpoint {
                    api_url,
                    api_key,
                    client,
                },
                model,
                messages,
                temperature,
                max_tokens,
                thinking_level,
            )
            .await;
        }
    }
    let reasoning = reasoning_params(provider.as_deref(), &model, thinking_level.as_deref());
    let (max_tokens, max_completion_tokens) =
        completion_token_params(provider.as_deref(), max_tokens);
    let body = ChatRequest {
        model,
        messages,
        temperature: (!reasoning.suppress_temperature).then_some(temperature),
        stream: false,
        max_tokens,
        max_completion_tokens,
        reasoning_effort: reasoning.reasoning_effort,
        reasoning: reasoning.reasoning,
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
    thinking_level: Option<String>,
) -> Result<String, AppError> {
    let _completion = StreamCompletionGuard::new(app.clone(), stream_id.clone());
    ensure_online()?;
    let (api_url, api_key, model, provider, allow_local_network) =
        get_model_config_and_key(&app, &config_id).await?;
    let endpoint = endpoint_security::validate_http_endpoint(
        &api_url,
        allow_local_network,
        !api_key.is_empty(),
        std::time::Duration::from_secs(120),
    )
    .await?;
    let api_url = endpoint.url.to_string();
    let client = endpoint.client;

    if let Some(p) = provider.as_deref() {
        if p.to_lowercase().contains("anthropic") {
            return anthropic::chat_stream_anthropic(
                api_url,
                api_key,
                client,
                model,
                messages,
                temperature,
                stream_id,
                max_tokens,
                thinking_level,
                app,
            )
            .await;
        }
    }
    let reasoning = reasoning_params(provider.as_deref(), &model, thinking_level.as_deref());
    let (max_tokens, max_completion_tokens) =
        completion_token_params(provider.as_deref(), max_tokens);
    let body = ChatRequest {
        model,
        messages,
        temperature: (!reasoning.suppress_temperature).then_some(temperature),
        stream: true,
        max_tokens,
        max_completion_tokens,
        reasoning_effort: reasoning.reasoning_effort,
        reasoning: reasoning.reasoning,
    };

    let mut request = client.post(&api_url).json(&body);
    request = request.header("Content-Type", "application/json");
    if !api_key.is_empty() {
        request = request.header("Authorization", format!("Bearer {}", api_key));
    }

    let mut parser = stream_parser::SseParser::new();
    let resp = tokio::select! {
        result = request.send() => result?,
        _ = wait_for_stream_cancelled(&stream_id) => return Ok(parser.finalize()),
    };

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = tokio::select! {
            result = resp.text() => result.unwrap_or_default(),
            _ = wait_for_stream_cancelled(&stream_id) => return Ok(parser.finalize()),
        };
        let err_msg = truncate_error(&body);
        log::error!("chat_stream API error {}: {}", status, err_msg);
        return Err(AppError::ApiError {
            status,
            message: format!("Request failed: {}", err_msg),
        });
    }

    let mut stream = resp.bytes_stream();

    loop {
        if is_stream_cancelled(&stream_id) {
            return Ok(parser.finalize());
        }

        let chunk_result = tokio::select! {
            chunk = stream.next() => match chunk {
                Some(result) => result,
                None => break,
            },
            _ = tokio::time::sleep(std::time::Duration::from_millis(100)) => {
                continue;
            }
        };

        let chunk = chunk_result.map_err(|e| AppError::StreamError(e.to_string()))?;
        if is_stream_cancelled(&stream_id) {
            return Ok(parser.finalize());
        }
        parser.push_bytes(&chunk);
        parser.process_lines(&app, &stream_id, |_| {});
        match parser.terminal() {
            stream_parser::SseStreamTerminal::Streaming => {}
            stream_parser::SseStreamTerminal::Complete => break,
            stream_parser::SseStreamTerminal::Error(message) => {
                return Err(AppError::StreamError(message.clone()));
            }
        }
    }

    if matches!(
        parser.terminal(),
        stream_parser::SseStreamTerminal::Streaming
    ) {
        return Err(AppError::StreamError(
            "Model stream ended before a completion event or finish reason.".to_string(),
        ));
    }
    Ok(parser.finalize())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn chat_stream_tools(
    app: tauri::AppHandle,
    config_id: String,
    messages: Vec<serde_json::Value>,
    tools: String,
    temperature: f64,
    stream_id: String,
    max_tokens: Option<u32>,
    thinking_level: Option<String>,
) -> Result<String, AppError> {
    let _completion = StreamCompletionGuard::new(app.clone(), stream_id.clone());
    ensure_online()?;
    let (api_url, api_key, model, provider, allow_local_network) =
        get_model_config_and_key(&app, &config_id).await?;
    let endpoint = endpoint_security::validate_http_endpoint(
        &api_url,
        allow_local_network,
        !api_key.is_empty(),
        std::time::Duration::from_secs(120),
    )
    .await?;
    let api_url = endpoint.url.to_string();
    let client = endpoint.client;

    if let Some(p) = provider.as_deref() {
        if p.to_lowercase().contains("anthropic") {
            let parsed_messages: Vec<ChatMessage> = messages
                .into_iter()
                .filter_map(|v| serde_json::from_value(v).ok())
                .collect();
            return anthropic::chat_stream_tools_anthropic(
                api_url,
                api_key,
                client,
                model,
                parsed_messages,
                tools,
                temperature,
                stream_id,
                max_tokens,
                thinking_level,
                app,
            )
            .await;
        }
    }
    let tools_parsed: Vec<serde_json::Value> = serde_json::from_str(&tools)
        .map_err(|e| AppError::ParseError(format!("Invalid tools JSON: {}", e)))?;

    let reasoning = reasoning_params(provider.as_deref(), &model, thinking_level.as_deref());
    let (max_tokens, max_completion_tokens) =
        completion_token_params(provider.as_deref(), max_tokens);
    let body = ChatRequestTools {
        model,
        messages,
        temperature: (!reasoning.suppress_temperature).then_some(temperature),
        tools: tools_parsed,
        tool_choice: Some(serde_json::Value::String("auto".to_string())),
        max_tokens,
        max_completion_tokens,
        stream: Some(true),
        reasoning_effort: reasoning.reasoning_effort,
        reasoning: reasoning.reasoning,
    };

    let mut request = client.post(&api_url).json(&body);
    request = request.header("Content-Type", "application/json");
    if !api_key.is_empty() {
        request = request.header("Authorization", format!("Bearer {}", api_key));
    }

    let mut parser = stream_parser::SseParser::new();
    let resp = tokio::select! {
        result = request.send() => result?,
        _ = wait_for_stream_cancelled(&stream_id) => return Ok(parser.finalize_tools()),
    };

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = tokio::select! {
            result = resp.text() => result.unwrap_or_default(),
            _ = wait_for_stream_cancelled(&stream_id) => return Ok(parser.finalize_tools()),
        };
        let err_msg = truncate_error(&body);
        log::error!("chat_stream_tools API error {}: {}", status, err_msg);
        return Err(AppError::ApiError {
            status,
            message: format!("Request failed: {}", err_msg),
        });
    }

    let mut stream = resp.bytes_stream();

    loop {
        if is_stream_cancelled(&stream_id) {
            return Ok(parser.finalize_tools());
        }

        let chunk_result = tokio::select! {
            chunk = stream.next() => match chunk {
                Some(result) => result,
                None => break,
            },
            _ = tokio::time::sleep(std::time::Duration::from_millis(100)) => {
                continue;
            }
        };

        let chunk = chunk_result.map_err(|e| AppError::StreamError(e.to_string()))?;
        if is_stream_cancelled(&stream_id) {
            return Ok(parser.finalize_tools());
        }
        parser.push_bytes(&chunk);
        parser.process_lines(&app, &stream_id, |_chunk_text| {});
        match parser.terminal() {
            stream_parser::SseStreamTerminal::Streaming => {}
            stream_parser::SseStreamTerminal::Complete => break,
            stream_parser::SseStreamTerminal::Error(message) => {
                return Err(AppError::StreamError(message.clone()));
            }
        }
    }

    if matches!(
        parser.terminal(),
        stream_parser::SseStreamTerminal::Streaming
    ) {
        return Err(AppError::StreamError(
            "Model tool stream ended before a completion event or finish reason.".to_string(),
        ));
    }
    Ok(parser.finalize_tools())
}

#[tauri::command]
async fn chat_completion_tools(
    app: tauri::AppHandle,
    config_id: String,
    messages: Vec<serde_json::Value>,
    tools: String,
    temperature: f64,
    max_tokens: Option<u32>,
    thinking_level: Option<String>,
) -> Result<String, AppError> {
    ensure_online()?;
    let (api_url, api_key, model, provider, allow_local_network) =
        get_model_config_and_key(&app, &config_id).await?;
    let endpoint = endpoint_security::validate_http_endpoint(
        &api_url,
        allow_local_network,
        !api_key.is_empty(),
        std::time::Duration::from_secs(60),
    )
    .await?;
    let api_url = endpoint.url.to_string();
    let client = endpoint.client;

    if let Some(p) = provider.as_deref() {
        if p.to_lowercase().contains("anthropic") {
            let parsed_messages: Vec<ChatMessage> = messages
                .into_iter()
                .filter_map(|v| serde_json::from_value(v).ok())
                .collect();
            return anthropic::chat_completion_tools_anthropic(
                api_url,
                api_key,
                client,
                model,
                parsed_messages,
                tools,
                temperature,
                max_tokens,
                thinking_level,
            )
            .await;
        }
    }
    let tools_parsed: Vec<serde_json::Value> = serde_json::from_str(&tools)
        .map_err(|e| AppError::ParseError(format!("Invalid tools JSON: {}", e)))?;

    let reasoning = reasoning_params(provider.as_deref(), &model, thinking_level.as_deref());
    let (max_tokens, max_completion_tokens) =
        completion_token_params(provider.as_deref(), max_tokens);
    let body = ChatRequestTools {
        model,
        messages,
        temperature: (!reasoning.suppress_temperature).then_some(temperature),
        tools: tools_parsed,
        tool_choice: Some(serde_json::Value::String("auto".to_string())),
        max_tokens,
        max_completion_tokens,
        stream: None,
        reasoning_effort: reasoning.reasoning_effort,
        reasoning: reasoning.reasoning,
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
async fn check_api(app: tauri::AppHandle, config_id: String) -> Result<bool, AppError> {
    ensure_online()?;
    let (api_url, api_key, _, provider, allow_local_network) =
        get_model_config_and_key(&app, &config_id).await?;
    let endpoint = endpoint_security::validate_http_endpoint(
        &api_url,
        allow_local_network,
        !api_key.is_empty(),
        std::time::Duration::from_secs(10),
    )
    .await?;
    let api_url = endpoint.url.to_string();
    let client = endpoint.client;

    if let Some(p) = provider.as_deref() {
        if p.to_lowercase() == "anthropic" {
            return anthropic::check_api_anthropic(api_url, api_key, client).await;
        }
    }

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
    ensure_online()?;
    let endpoint = endpoint_security::validate_http_endpoint(
        "http://127.0.0.1:11434/api/tags",
        true,
        false,
        std::time::Duration::from_secs(5),
    )
    .await?;
    let resp = endpoint.client.get(endpoint.url).send().await?;

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
    ensure_online()?;
    let mut config_json: serde_json::Value = serde_json::from_str(&config)
        .map_err(|e| AppError::ParseError(format!("Invalid search config JSON: {}", e)))?;
    if let Some(config) = config_json.as_object_mut() {
        config.remove("apiKey");
    }

    if let Some(id) = config_id {
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
    ensure_online()?;
    let mut config_json: Option<serde_json::Value> = None;
    if let Some(cfg) = config {
        let mut parsed: serde_json::Value = serde_json::from_str(&cfg)
            .map_err(|e| AppError::ParseError(format!("Invalid search config JSON: {}", e)))?;
        if let Some(config) = parsed.as_object_mut() {
            config.remove("apiKey");
        }

        if let Some(id) = config_id {
            match get_search_api_key(&app, &id).await {
                Ok(key) => {
                    parsed["apiKey"] = serde_json::Value::String(key);
                }
                Err(_) => {
                    log::warn!(
                        "No API key found in secure store for search config '{}'",
                        id
                    );
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
    )
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
    allow_local_network: Option<bool>,
    app: tauri::AppHandle,
    session: tauri::State<'_, ws_handler::WsSession>,
) -> Result<String, AppError> {
    ensure_online()?;
    let config = ws_handler::WsConfig {
        url,
        api_key,
        model,
        reconnect: true,
        max_reconnect_attempts: 5,
        allow_local_network: allow_local_network.unwrap_or(false),
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
    allow_local_network: Option<bool>,
    app: tauri::AppHandle,
    session: tauri::State<'_, ws_handler::WsSession>,
) -> Result<(), AppError> {
    ensure_online()?;
    let config = ws_handler::WsConfig {
        url,
        api_key,
        model,
        reconnect: true,
        max_reconnect_attempts: 5,
        allow_local_network: allow_local_network.unwrap_or(false),
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
    ensure_online()?;
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
    allow_local_network: Option<bool>,
) -> Result<String, AppError> {
    ensure_online()?;
    let auth_url = format!("{}/auth", server_url.trim_end_matches('/'));
    let endpoint = endpoint_security::validate_http_endpoint(
        &auth_url,
        allow_local_network.unwrap_or(false),
        true,
        std::time::Duration::from_secs(15),
    )
    .await?;

    let body = serde_json::json!({
        "username": username,
        "api_key": api_key,
    });

    let resp = endpoint
        .client
        .post(endpoint.url)
        .json(&body)
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body =
            endpoint_security::sanitize_provider_error(&resp.text().await.unwrap_or_default());
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
    app: tauri::AppHandle,
    config_id: String,
    user_message: String,
    system_prompt: String,
) -> Result<String, AppError> {
    let messages = vec![
        ChatMessage {
            role: "system".to_string(),
            content: Some(serde_json::Value::String(system_prompt)),
            tool_calls: None,
            tool_call_id: None,
            name: None,
            anthropic_content: None,
            reasoning_details: None,
            reasoning: None,
        },
        ChatMessage {
            role: "user".to_string(),
            content: Some(serde_json::Value::String(user_message)),
            tool_calls: None,
            tool_call_id: None,
            name: None,
            anthropic_content: None,
            reasoning_details: None,
            reasoning: None,
        },
    ];
    Ok(
        chat_completion(app, config_id, messages, 0.3, Some(64), None)
            .await?
            .trim()
            .to_string(),
    )
}

#[tauri::command]
async fn load_mcp_config(app: tauri::AppHandle) -> Result<String, AppError> {
    let config: Option<serde_json::Value> =
        secure_storage::load_json(&app, secure_storage::StorageDomain::Mcp)?;
    config
        .map(|value| serde_json::to_string(&value).map_err(|e| AppError::ParseError(e.to_string())))
        .transpose()
        .map(|value| value.unwrap_or_default())
}

#[tauri::command]
async fn save_mcp_config(app: tauri::AppHandle, config: String) -> Result<(), AppError> {
    let parsed = serde_json::from_str::<serde_json::Value>(&config)
        .map_err(|error| AppError::ParseError(error.to_string()))?;
    secure_storage::save_json(&app, secure_storage::StorageDomain::Mcp, &parsed)
}

fn load_close_to_tray_preference(app: &tauri::AppHandle) -> bool {
    secure_storage::get_preference(app, "sythoria-close-to-tray")
        .ok()
        .flatten()
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
}

fn should_close_to_tray(app: &tauri::AppHandle) -> bool {
    app.state::<TrayRuntimeState>()
        .close_to_tray
        .load(std::sync::atomic::Ordering::Relaxed)
}

const WINDOW_GEOMETRY_KEY: &str = "sythoria-window-geometry";

#[derive(Debug, Serialize, Deserialize)]
struct WindowGeometry {
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    maximized: bool,
}

fn load_window_geometry(app: &tauri::AppHandle) -> Option<WindowGeometry> {
    match secure_storage::get_preference(app, WINDOW_GEOMETRY_KEY) {
        Ok(Some(value)) => {
            if let Ok(config_dir) = app.path().app_config_dir() {
                let legacy_path = config_dir.join(".window-state.json");
                if legacy_path.exists() {
                    let _ = fs::remove_file(legacy_path);
                }
            }
            serde_json::from_value(value).ok()
        }
        Ok(None) => {
            let legacy_path = app.path().app_config_dir().ok()?.join(".window-state.json");
            let content = fs::read(&legacy_path).ok()?;
            let root: serde_json::Value = serde_json::from_slice(&content).ok()?;
            let main = root.get("main")?;
            let geometry = WindowGeometry {
                width: main.get("width")?.as_u64()?.try_into().ok()?,
                height: main.get("height")?.as_u64()?.try_into().ok()?,
                x: main
                    .get("prev_x")
                    .or_else(|| main.get("x"))?
                    .as_i64()?
                    .try_into()
                    .ok()?,
                y: main
                    .get("prev_y")
                    .or_else(|| main.get("y"))?
                    .as_i64()?
                    .try_into()
                    .ok()?,
                maximized: main
                    .get("maximized")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false),
            };
            if secure_storage::set_preference(
                app,
                WINDOW_GEOMETRY_KEY,
                serde_json::to_value(&geometry).ok()?,
            )
            .is_ok()
            {
                let _ = fs::remove_file(legacy_path);
            }
            Some(geometry)
        }
        Err(error) => {
            log::error!("Failed to load encrypted window geometry: {error}");
            None
        }
    }
}

fn restore_window_geometry(window: &tauri::WebviewWindow) -> bool {
    let Some(geometry) = load_window_geometry(window.app_handle()) else {
        return false;
    };
    if !(640..=10_000).contains(&geometry.width) || !(480..=10_000).contains(&geometry.height) {
        return false;
    }
    let _ = window.set_size(tauri::PhysicalSize::new(geometry.width, geometry.height));
    let _ = window.set_position(tauri::PhysicalPosition::new(geometry.x, geometry.y));
    if geometry.maximized {
        let _ = window.maximize();
    }
    true
}

fn save_window_geometry(window: &tauri::WebviewWindow) {
    let mut geometry = match (
        window.outer_size(),
        window.outer_position(),
        window.is_maximized(),
    ) {
        (Ok(size), Ok(position), Ok(maximized)) => WindowGeometry {
            width: size.width,
            height: size.height,
            x: position.x,
            y: position.y,
            maximized,
        },
        _ => return,
    };
    if geometry.maximized {
        if let Some(previous) = load_window_geometry(window.app_handle()) {
            geometry.width = previous.width;
            geometry.height = previous.height;
            geometry.x = previous.x;
            geometry.y = previous.y;
        }
    }
    if let Ok(value) = serde_json::to_value(geometry) {
        if let Err(error) =
            secure_storage::set_preference(window.app_handle(), WINDOW_GEOMETRY_KEY, value)
        {
            log::error!("Failed to save encrypted window geometry: {error}");
        }
    }
}

static TRAY_VISIBLE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);

fn tray_should_show(close_to_tray: bool, is_visible: bool, is_minimized: bool) -> bool {
    close_to_tray && (!is_visible || is_minimized)
}

fn update_tray_visibility(app: &tauri::AppHandle) {
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    if let Some(tray) = app.tray_by_id("main") {
        let should_show = if let Some(window) = app.get_webview_window("main") {
            tray_should_show(
                should_close_to_tray(app),
                window.is_visible().unwrap_or(true),
                window.is_minimized().unwrap_or(false),
            )
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
fn set_close_to_tray_runtime(app: tauri::AppHandle, enabled: bool) {
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        app.state::<TrayRuntimeState>()
            .close_to_tray
            .store(enabled, std::sync::atomic::Ordering::Relaxed);
        update_tray_visibility(&app);
    }
}

fn native_shortcut(combo: &str) -> String {
    combo
        .split('+')
        .map(|part| {
            if part.trim().eq_ignore_ascii_case("ctrl") {
                "CommandOrControl"
            } else {
                part.trim()
            }
        })
        .collect::<Vec<_>>()
        .join("+")
}

#[tauri::command]
fn register_appshot_shortcut(app: tauri::AppHandle, shortcut: String) -> Result<(), AppError> {
    let normalized = native_shortcut(&shortcut);
    let next: Shortcut = normalized
        .parse()
        .map_err(|error| AppError::ConfigIo(format!("Invalid Appshot shortcut: {error}")))?;
    let previous = APPSHOT_SHORTCUT
        .lock()
        .map_err(|_| AppError::ConfigIo("Appshot shortcut state is unavailable".into()))?
        .to_owned();

    if previous.as_ref().map(Shortcut::id) == Some(next.id()) {
        return Ok(());
    }

    app.global_shortcut().register(next).map_err(|error| {
        AppError::ConfigIo(format!("Could not register Appshot shortcut: {error}"))
    })?;

    if let Some(previous) = previous {
        if let Err(error) = app.global_shortcut().unregister(previous) {
            let _ = app.global_shortcut().unregister(next);
            return Err(AppError::ConfigIo(format!(
                "Could not replace the Appshot shortcut: {error}"
            )));
        }
    }

    *APPSHOT_SHORTCUT
        .lock()
        .map_err(|_| AppError::ConfigIo("Appshot shortcut state is unavailable".into()))? =
        Some(next);
    Ok(())
}

#[tauri::command]
fn reveal_main_window(app: tauri::AppHandle) -> Result<(), AppError> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| AppError::AppPath("Main window not found".into()))?;
    window.show()?;
    window.unminimize()?;
    window.set_focus()?;
    update_tray_visibility(&app);
    Ok(())
}

#[tauri::command]
fn frontend_ready(app: tauri::AppHandle) -> Result<(), AppError> {
    app.state::<LaunchRuntimeState>()
        .frontend_ready
        .store(true, std::sync::atomic::Ordering::Release);
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| AppError::AppPath("Main window not found".into()))?;
    window.show()?;
    window.set_focus()?;
    update_tray_visibility(&app);
    Ok(())
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
    tokens: std::sync::Mutex<std::collections::HashMap<String, FileTokenEntry>>,
}

#[derive(Clone)]
struct FileTokenEntry {
    path: std::path::PathBuf,
    delete_after_read: bool,
}

impl FileTokenRegistry {
    pub fn new() -> Self {
        Self {
            tokens: std::sync::Mutex::new(std::collections::HashMap::new()),
        }
    }

    pub fn register(&self, path: std::path::PathBuf) -> String {
        self.register_with_policy(path, false)
    }

    pub fn register_ephemeral(&self, path: std::path::PathBuf) -> String {
        self.register_with_policy(path, true)
    }

    fn register_with_policy(&self, path: std::path::PathBuf, delete_after_read: bool) -> String {
        let token = uuid::Uuid::new_v4().to_string();
        if let Ok(mut lock) = self.tokens.lock() {
            lock.insert(
                token.clone(),
                FileTokenEntry {
                    path,
                    delete_after_read,
                },
            );
        }
        token
    }

    pub fn consume(&self, token: &str) -> Option<std::path::PathBuf> {
        self.consume_entry(token).map(|entry| entry.path)
    }

    fn consume_entry(&self, token: &str) -> Option<FileTokenEntry> {
        if let Ok(mut lock) = self.tokens.lock() {
            lock.remove(token)
        } else {
            None
        }
    }

    pub fn registered_paths(&self) -> std::collections::HashSet<std::path::PathBuf> {
        self.tokens
            .lock()
            .map(|lock| lock.values().map(|entry| entry.path.clone()).collect())
            .unwrap_or_default()
    }
}

impl Default for FileTokenRegistry {
    fn default() -> Self {
        Self::new()
    }
}

struct EphemeralFileCleanup(Option<std::path::PathBuf>);

impl Drop for EphemeralFileCleanup {
    fn drop(&mut self) {
        if let Some(path) = self.0.take() {
            let _ = std::fs::remove_file(path);
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
            return Err(AppError::ConfigIo(
                "File size exceeds the 10 MB limit".to_string(),
            ));
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
    let entry = state
        .consume_entry(&token)
        .ok_or_else(|| AppError::ConfigIo("Invalid or expired file token".to_string()))?;
    let path_buf = entry.path;
    let _ephemeral_cleanup =
        EphemeralFileCleanup(entry.delete_after_read.then(|| path_buf.clone()));

    if !path_buf.is_file() {
        return Err(AppError::ConfigIo(format!(
            "Path is not a file: {}",
            path_buf.display()
        )));
    }

    let metadata = fs::metadata(&path_buf)?;
    let size = metadata.len();
    if size > 10 * 1024 * 1024 {
        return Err(AppError::ConfigIo(
            "File size exceeds the 10 MB limit".to_string(),
        ));
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
fn release_file_token(state: tauri::State<'_, FileTokenRegistry>, token: String) -> bool {
    state.consume(&token).is_some()
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
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

    let about = PredefinedMenuItem::about(app, None, None)?;
    let check_updates = MenuItem::with_id(
        app,
        "check_updates",
        "Check for Updates...",
        true,
        None::<&str>,
    )?;
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

    let new_chat = MenuItem::with_id(
        app,
        "new_conversation",
        "New Conversation",
        true,
        Some("CmdOrCtrl+Shift+O"),
    )?;
    let create_project =
        MenuItem::with_id(app, "create_project", "Create Project", true, None::<&str>)?;
    let cmd_palette = MenuItem::with_id(
        app,
        "command_palette",
        "Command Palette",
        true,
        Some("CmdOrCtrl+Shift+P"),
    )?;

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
        &[&zoom_in, &zoom_out, &zoom_reset],
    )?;

    let minimize = PredefinedMenuItem::minimize(app, None)?;
    let maximize = MenuItem::with_id(app, "maximize", "Maximize", true, None::<&str>)?;
    let close = PredefinedMenuItem::close_window(app, None)?;

    let window_menu = Submenu::with_id_and_items(
        app,
        "window",
        "Window",
        true,
        &[&minimize, &maximize, &close],
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
    keyring::init_store();
    let project_registry = project::ProjectRegistry::new();
    let file_token_registry = FileTokenRegistry::new();
    let app = tauri::Builder::default()
        .manage(project_registry)
        .manage(file_token_registry)
        .manage(ws_handler::WsSession::default())
        .manage(TrayRuntimeState::default())
        .manage(LaunchRuntimeState::default())
        .on_menu_event(|app, event| match event.id().as_ref() {
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
        })
        .setup(|app| {
            if let Ok(log_dir) = app.path().app_log_dir() {
                if log_dir.exists() {
                    if let Err(error) = fs::remove_dir_all(&log_dir) {
                        eprintln!("Failed to remove legacy plaintext logs: {error}");
                    }
                }
            }
            init_network_settings(app.app_handle());
            app.state::<TrayRuntimeState>()
                .close_to_tray
                .store(
                    load_close_to_tray_preference(app.app_handle()),
                    std::sync::atomic::Ordering::Relaxed,
                );
            let registry = app.state::<project::ProjectRegistry>();
            if let Err(error) = registry.load_from_disk(app.app_handle()) {
                log::error!("Failed to load projects from disk: {error}");
            }
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{Code, Modifiers};
                let shortcut = Shortcut::new(Some(Modifiers::CONTROL), Code::Space);
                let _ = app.global_shortcut().register(shortcut);
                if let Ok(appshot_shortcut) = DEFAULT_APPSHOT_SHORTCUT.parse::<Shortcut>() {
                    if app.global_shortcut().register(appshot_shortcut).is_ok() {
                        if let Ok(mut registered) = APPSHOT_SHORTCUT.lock() {
                            *registered = Some(appshot_shortcut);
                        }
                    }
                }
            }

            let _window = app.get_webview_window("main").ok_or_else(|| {
                Box::new(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "Main window not found",
                )) as Box<dyn std::error::Error>
            })?;
            if !restore_window_geometry(&_window) {
                let _ = _window.center();
            }

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
            if let Err(mica_error) = window_vibrancy::apply_mica(&_window, None) {
                log::warn!(
                    "Mica is unavailable; falling back to the legacy Windows blur effect: {mica_error}"
                );
                if let Err(blur_error) =
                    window_vibrancy::apply_blur(&_window, Some((18, 18, 18, 125)))
                {
                    log::warn!("Could not apply a Windows backdrop effect: {blur_error}");
                }
            }

            let launch_app = app.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(4)).await;
                let launch_state = launch_app.state::<LaunchRuntimeState>();
                if !launch_state
                    .frontend_ready
                    .swap(true, std::sync::atomic::Ordering::AcqRel)
                {
                    log::warn!("Frontend readiness timed out; revealing the main window");
                    if let Some(window) = launch_app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                        update_tray_visibility(&launch_app);
                    }
                }
            });

            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            {
                let quit_i = tauri::menu::MenuItemBuilder::with_id("quit", "Quit").build(app)?;
                let show_i =
                    tauri::menu::MenuItemBuilder::with_id("show", "Show Sythoria").build(app)?;
                let menu = tauri::menu::MenuBuilder::new(app)
                    .items(&[&show_i, &quit_i])
                    .build()?;

                let _tray = tauri::tray::TrayIconBuilder::with_id("main")
                    .icon(
                        app.default_window_icon()
                            .ok_or_else(|| {
                                Box::new(std::io::Error::new(
                                    std::io::ErrorKind::NotFound,
                                    "Window icon not found",
                                )) as Box<dyn std::error::Error>
                            })?
                            .clone(),
                    )
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
                            if let Some(main_window) = app.get_webview_window("main") {
                                save_window_geometry(&main_window);
                            }
                            if should_close_to_tray(app) {
                                api.prevent_close();
                                let _ = window.hide();
                                update_tray_visibility(app);
                            } else {
                                app.exit(0);
                            }
                        }
                    }
                    tauri::WindowEvent::Focused(_) | tauri::WindowEvent::Resized(_) => {
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
                        let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
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
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
                        } else if APPSHOT_SHORTCUT
                            .lock()
                            .ok()
                            .and_then(|registered| *registered)
                            .map(|registered| registered.id() == shortcut.id())
                            .unwrap_or(false)
                        {
                            if let Some(main_win) = app.get_webview_window("main") {
                                let _ = main_win.emit("sythoria://appshot-requested", ());
                            }
                        }
                    }
                })
                .build(),
        )
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Warn)
                .targets([tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Stdout,
                )])
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            commands::config::load_config,
            commands::config::save_config,
            commands::config::load_encrypted_preferences,
            commands::config::mutate_encrypted_preferences,
            commands::config::load_network_config,
            commands::config::save_network_config,
            commands::config::load_search_config,
            commands::config::save_search_config,
            commands::config::load_api_keys,
            commands::config::save_api_keys_cmd,
            commands::config::has_cloud_stt_api_key,
            commands::config::save_cloud_stt_api_key,
            commands::config::load_search_api_keys,
            commands::config::save_search_api_keys_cmd,
            commands::conversations::load_encrypted_conversations,
            commands::conversations::save_encrypted_conversations,
            commands::conversations::clear_encrypted_conversations,
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
            commands::config::load_mcp_env_secrets,
            commands::config::save_mcp_env_secrets_cmd,
            commands::config::load_mcp_api_keys,
            commands::config::save_mcp_api_keys_cmd,
            commands::mcp::mcp_start_server,
            commands::mcp::mcp_check_command,
            commands::mcp::mcp_stop_server,
            commands::mcp::mcp_set_server_enabled,
            commands::mcp::mcp_list_tools,
            commands::mcp::mcp_list_resources,
            commands::mcp::mcp_list_prompts,
            commands::mcp::mcp_request_tool_approval,
            commands::mcp::mcp_call_tool,
            commands::mcp::mcp_cancel_tool_call,
            commands::config::wipe_config_files,
            set_autostart_enabled,
            is_autostart_enabled,
            set_close_to_tray_runtime,
            frontend_ready,
            register_appshot_shortcut,
            reveal_main_window,
            select_file_and_get_token,
            read_file_from_token,
            release_file_token,
            select_save_file_and_get_token,
            write_exported_file_by_token,
            commands::audio::start_recording,
            commands::audio::stop_recording,
            commands::audio::get_recorded_samples,
            commands::audio::download_whisper_model,
            commands::audio::cancel_whisper_download,
            commands::audio::import_custom_whisper_model,
            commands::audio::check_downloaded_whisper_models,
            commands::audio::delete_whisper_model,
            commands::audio::transcribe_audio_cloud,
            commands::audio::transcribe_audio,
            project::load_projects,
            project::save_projects,
            project::set_active_project,
            project::project_run_begin,
            project::project_browse_begin,
            project::project_run_end,
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
            appshots::clear_appshots,
            appshots::wipe_appshot_data,
            appshots::run_appshots_clean,
            appshots::select_appshot_folder,
            appshots::has_screen_capture_permission,
            appshots::request_screen_capture_permission,
            appshots::open_screen_capture_settings,
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

#[cfg(test)]
mod tests {
    use super::{
        completion_token_params, tray_should_show, truncate_error, EphemeralFileCleanup,
        FileTokenRegistry, NetworkConfig,
    };

    #[test]
    fn openai_uses_max_completion_tokens_while_compatible_providers_keep_max_tokens() {
        assert_eq!(
            completion_token_params(Some("OpenAI"), Some(2048)),
            (None, Some(2048))
        );
        assert_eq!(
            completion_token_params(Some("OpenRouter"), Some(2048)),
            (Some(2048), None)
        );
    }

    #[test]
    fn legacy_network_config_ignores_obsolete_tls_override() {
        let config: NetworkConfig =
            serde_json::from_str(r#"{"strict_ssl":false,"blocked_hosts":["localhost"]}"#).unwrap();

        assert!(!config.offline_mode);
        assert!(config.allowed_local_endpoints.is_empty());
    }

    #[test]
    fn unauthenticated_network_policy_fails_closed() {
        let config = NetworkConfig::fail_closed();

        assert!(config.offline_mode);
        assert!(config.blocked_hosts.is_empty());
        assert!(config.allowed_local_endpoints.is_empty());
    }

    #[test]
    fn error_preview_truncates_on_a_character_boundary() {
        let body = format!("{}🦀suffix", "a".repeat(511));
        let preview = truncate_error(&body);

        assert!(preview.starts_with(&"a".repeat(511)));
        assert!(preview.contains('🦀'));
        assert!(preview.ends_with("..."));
    }

    #[test]
    fn short_error_preview_is_unchanged() {
        assert_eq!(truncate_error("provider error"), "provider error");
    }

    #[test]
    fn tray_visibility_only_depends_on_cached_setting_and_window_state() {
        assert!(!tray_should_show(false, false, true));
        assert!(!tray_should_show(true, true, false));
        assert!(tray_should_show(true, false, false));
        assert!(tray_should_show(true, true, true));
    }

    #[test]
    fn ephemeral_file_tokens_remove_the_file_after_read_cleanup() {
        let path =
            std::env::temp_dir().join(format!("sythoria-token-test-{}", uuid::Uuid::new_v4()));
        std::fs::write(&path, b"temporary capture").unwrap();
        let registry = FileTokenRegistry::new();
        let token = registry.register_ephemeral(path.clone());
        let entry = registry.consume_entry(&token).unwrap();

        assert!(entry.delete_after_read);
        drop(EphemeralFileCleanup(Some(entry.path)));
        assert!(!path.exists());
    }
}
