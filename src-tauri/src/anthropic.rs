use crate::{AppError, ChatMessage, stream_parser, is_stream_cancelled, clear_stream_cancelled};
use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Clone)]
pub struct AnthropicMessage {
    pub role: String,
    pub content: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct AnthropicRequest {
    pub model: String,
    pub messages: Vec<AnthropicMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system: Option<String>,
    pub max_tokens: u32,
    pub temperature: f64,
    pub stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Deserialize)]
pub struct AnthropicResponse {
    pub content: Vec<AnthropicContent>,
}

#[derive(Debug, Deserialize)]
pub struct AnthropicContent {
    pub r#type: String,
    pub text: Option<String>,
    pub id: Option<String>,
    pub name: Option<String>,
    pub input: Option<serde_json::Value>,
}

pub fn convert_tools(tools_str: &str) -> Option<Vec<serde_json::Value>> {
    let openai_tools: Vec<serde_json::Value> = serde_json::from_str(tools_str).ok()?;
    let mut anthropic_tools = Vec::new();
    for t in openai_tools {
        if let Some(func) = t.get("function") {
            let anthropic_tool = serde_json::json!({
                "name": func.get("name").cloned().unwrap_or_default(),
                "description": func.get("description").cloned().unwrap_or_default(),
                "input_schema": func.get("parameters").cloned().unwrap_or_default(),
            });
            anthropic_tools.push(anthropic_tool);
        }
    }
    Some(anthropic_tools)
}

pub fn convert_messages(messages: Vec<ChatMessage>) -> (Option<String>, Vec<AnthropicMessage>) {
    let mut system_prompts = Vec::new();
    let mut anthropic_messages = Vec::new();
    
    for msg in messages {
        if msg.role == "system" {
            if let Some(val) = msg.content {
                if let Some(s) = val.as_str() {
                    system_prompts.push(s.to_string());
                }
            }
            continue;
        }
        
        let mut anthropic_content = Vec::new();
        
        if msg.role == "tool" {
            let tool_use_id = msg.tool_call_id.clone().unwrap_or_default();
            let content_str = match &msg.content {
                Some(serde_json::Value::String(s)) => s.clone(),
                Some(v) => v.to_string(),
                None => "".to_string(),
            };
            anthropic_messages.push(AnthropicMessage {
                role: "user".to_string(),
                content: serde_json::json!([{
                    "type": "tool_result",
                    "tool_use_id": tool_use_id,
                    "content": content_str
                }])
            });
            continue;
        }

        if let Some(val) = msg.content.clone() {
            if let Some(s) = val.as_str() {
                if !s.is_empty() {
                    anthropic_content.push(serde_json::json!({
                        "type": "text",
                        "text": s
                    }));
                }
            } else if let Some(arr) = val.as_array() {
                for item in arr {
                    if item.get("type").and_then(|v| v.as_str()) == Some("image_url") {
                        if let Some(img_url_obj) = item.get("image_url") {
                            if let Some(url_str) = img_url_obj.get("url").and_then(|v| v.as_str()) {
                                if let Some(data) = url_str.strip_prefix("data:") {
                                    if let Some((mime, rest)) = data.split_once(';') {
                                        if let Some(base64_data) = rest.strip_prefix("base64,") {
                                            anthropic_content.push(serde_json::json!({
                                                "type": "image",
                                                "source": {
                                                    "type": "base64",
                                                    "media_type": mime,
                                                    "data": base64_data
                                                }
                                            }));
                                        }
                                    }
                                }
                            }
                        }
                    } else if item.get("type").and_then(|v| v.as_str()) == Some("text") {
                        if let Some(text) = item.get("text") {
                            anthropic_content.push(serde_json::json!({
                                "type": "text",
                                "text": text
                            }));
                        }
                    }
                }
            }
        }

        if let Some(tool_calls) = msg.tool_calls.clone() {
            for tc in tool_calls {
                let input: serde_json::Value = serde_json::from_str(&tc.function.arguments).unwrap_or(serde_json::json!({}));
                anthropic_content.push(serde_json::json!({
                    "type": "tool_use",
                    "id": tc.id,
                    "name": tc.function.name,
                    "input": input
                }));
            }
        }
        
        let content_json = if anthropic_content.is_empty() && msg.role == "assistant" && msg.tool_calls.is_some() {
            serde_json::Value::Array(anthropic_content)
        } else if anthropic_content.len() == 1 && anthropic_content[0].get("type").and_then(|v| v.as_str()) == Some("text") {
            anthropic_content[0].get("text").cloned().unwrap_or(serde_json::Value::String("".to_string()))
        } else {
            serde_json::Value::Array(anthropic_content)
        };
        
        anthropic_messages.push(AnthropicMessage {
            role: msg.role,
            content: content_json
        });
    }
    
    // Merge consecutive messages of the same role
    let mut merged: Vec<AnthropicMessage> = Vec::new();
    for msg in anthropic_messages {
        if let Some(last) = merged.last_mut() {
            if last.role == msg.role {
                let mut last_content = match last.content.clone() {
                    serde_json::Value::String(s) => vec![serde_json::json!({"type": "text", "text": s})],
                    serde_json::Value::Array(arr) => arr,
                    _ => vec![]
                };
                let msg_content = match msg.content {
                    serde_json::Value::String(s) => vec![serde_json::json!({"type": "text", "text": s})],
                    serde_json::Value::Array(arr) => arr,
                    _ => vec![]
                };
                last_content.extend(msg_content);
                last.content = serde_json::Value::Array(last_content);
                continue;
            }
        }
        merged.push(msg);
    }
    
    let system_opt = if system_prompts.is_empty() {
        None
    } else {
        Some(system_prompts.join("\n\n"))
    };
    
    (system_opt, merged)
}

pub async fn chat_completion_anthropic(
    api_url: String,
    api_key: String,
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f64,
) -> Result<String, AppError> {
    let client = Client::builder().timeout(std::time::Duration::from_secs(60)).build()?;
    let (system, anthropic_messages) = convert_messages(messages);
    
    let body = AnthropicRequest {
        model,
        messages: anthropic_messages,
        system,
        max_tokens: 4096,
        temperature,
        stream: false,
        tools: None,
    };

    let mut request = client.post(&api_url).json(&body);
    request = request.header("Content-Type", "application/json")
        .header("anthropic-version", "2023-06-01")
        .header("x-api-key", api_key);

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

    let anthropic_resp: AnthropicResponse = resp.json().await.map_err(|e| AppError::ParseError(e.to_string()))?;
    
    let mut full_text = String::new();
    for c in anthropic_resp.content {
        if c.r#type == "text" {
            if let Some(t) = c.text {
                full_text.push_str(&t);
            }
        }
    }

    Ok(full_text)
}

pub async fn chat_completion_tools_anthropic(
    api_url: String,
    api_key: String,
    model: String,
    messages: Vec<ChatMessage>,
    tools_str: String,
    temperature: f64,
) -> Result<String, AppError> {
    let client = Client::builder().timeout(std::time::Duration::from_secs(120)).build()?;
    let (system, anthropic_messages) = convert_messages(messages);
    let tools = convert_tools(&tools_str);

    let body = AnthropicRequest {
        model,
        messages: anthropic_messages,
        system,
        max_tokens: 4096,
        temperature,
        stream: false,
        tools,
    };

    let mut request = client.post(&api_url).json(&body);
    request = request.header("Content-Type", "application/json")
        .header("anthropic-version", "2023-06-01")
        .header("x-api-key", api_key);

    let resp = request.send().await?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body_str = resp.text().await.unwrap_or_default();
        log::error!("chat_completion_tools API error {}: {}", status, body_str);
        return Err(AppError::ApiError {
            status,
            message: format!("Request failed: {}", body_str),
        });
    }

    let anthropic_resp: AnthropicResponse = resp.json().await.map_err(|e| AppError::ParseError(e.to_string()))?;
    
    let mut full_text = String::new();
    let mut tool_calls = Vec::new();
    
    for c in anthropic_resp.content {
        if c.r#type == "text" {
            if let Some(t) = c.text {
                full_text.push_str(&t);
            }
        } else if c.r#type == "tool_use" {
            if let (Some(id), Some(name), Some(input)) = (c.id, c.name, c.input) {
                tool_calls.push(serde_json::json!({
                    "id": id,
                    "type": "function",
                    "function": {
                        "name": name,
                        "arguments": input.to_string()
                    }
                }));
            }
        }
    }

    let openai_response = serde_json::json!({
        "choices": [{
            "message": {
                "content": if full_text.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(full_text) },
                "tool_calls": if tool_calls.is_empty() { serde_json::Value::Null } else { serde_json::Value::Array(tool_calls) }
            }
        }]
    });

    Ok(openai_response.to_string())
}

pub async fn chat_stream_anthropic(
    api_url: String,
    api_key: String,
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f64,
    stream_id: String,
    app: tauri::AppHandle,
) -> Result<String, AppError> {
    clear_stream_cancelled(&stream_id);
    let client = Client::builder().timeout(std::time::Duration::from_secs(120)).build()?;
    let (system, anthropic_messages) = convert_messages(messages);

    let body = AnthropicRequest {
        model,
        messages: anthropic_messages,
        system,
        max_tokens: 4096,
        temperature,
        stream: true,
        tools: None,
    };

    let mut request = client.post(&api_url).json(&body);
    request = request.header("Content-Type", "application/json")
        .header("anthropic-version", "2023-06-01")
        .header("x-api-key", api_key);

    let resp = request.send().await?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body_str = resp.text().await.unwrap_or_default();
        log::error!("chat_stream API error {}: {}", status, body_str);
        return Err(AppError::ApiError {
            status,
            message: format!("Request failed: {}", body_str),
        });
    }

    let mut stream = resp.bytes_stream();
    let mut parser = stream_parser::AnthropicSseParser::new();

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

pub async fn chat_stream_tools_anthropic(
    api_url: String,
    api_key: String,
    model: String,
    messages: Vec<ChatMessage>,
    tools_str: String,
    temperature: f64,
    stream_id: String,
    app: tauri::AppHandle,
) -> Result<String, AppError> {
    clear_stream_cancelled(&stream_id);
    let client = Client::builder().timeout(std::time::Duration::from_secs(120)).build()?;
    let (system, anthropic_messages) = convert_messages(messages);
    let tools = convert_tools(&tools_str);

    let body = AnthropicRequest {
        model,
        messages: anthropic_messages,
        system,
        max_tokens: 4096,
        temperature,
        stream: true,
        tools,
    };

    let mut request = client.post(&api_url).json(&body);
    request = request.header("Content-Type", "application/json")
        .header("anthropic-version", "2023-06-01")
        .header("x-api-key", api_key);

    let resp = request.send().await?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body_str = resp.text().await.unwrap_or_default();
        log::error!("chat_stream_tools API error {}: {}", status, body_str);
        return Err(AppError::ApiError {
            status,
            message: format!("Request failed: {}", body_str),
        });
    }

    let mut stream = resp.bytes_stream();
    let mut parser = stream_parser::AnthropicSseParser::new();

    while let Some(chunk_result) = stream.next().await {
        if is_stream_cancelled(&stream_id) {
            clear_stream_cancelled(&stream_id);
            return Ok(parser.finalize_tools());
        }

        let chunk = chunk_result.map_err(|e| AppError::StreamError(e.to_string()))?;
        parser.push_bytes(&chunk);
        parser.process_lines(&app, &stream_id, |_| {});
    }

    clear_stream_cancelled(&stream_id);
    Ok(parser.finalize_tools())
}

pub async fn check_api_anthropic(api_url: String, api_key: String) -> Result<bool, AppError> {
    let client = Client::builder().timeout(std::time::Duration::from_secs(10)).build()?;
    let body = AnthropicRequest {
        model: "claude-3-haiku-20240307".to_string(),
        messages: vec![AnthropicMessage { role: "user".to_string(), content: serde_json::Value::String("hello".to_string()) }],
        system: None,
        max_tokens: 1,
        temperature: 0.0,
        stream: false,
        tools: None,
    };

    let mut request = client.post(&api_url).json(&body);
    request = request.header("Content-Type", "application/json")
        .header("anthropic-version", "2023-06-01")
        .header("x-api-key", api_key);

    let resp = request.send().await?;
    Ok(resp.status().is_success())
}
