use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};


#[derive(Debug, Serialize, Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f64,
    stream: bool,
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

#[tauri::command]
async fn chat_completion(
    api_url: String,
    api_key: String,
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f64,
) -> Result<String, String> {
    let client = Client::new();
    let body = ChatRequest {
        model,
        messages,
        temperature,
        stream: false,
    };

    let auth_header = format!("Bearer {}", api_key);

    let mut request = client.post(&api_url).json(&body);
    request = request.header("Content-Type", "application/json");
    if !api_key.is_empty() {
        request = request.header("Authorization", &auth_header);
    }

    let resp = request
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".into());
        return Err(format!("API error {}: {}", status, text));
    }

    let chat_resp: ChatResponse = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

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
) -> Result<String, String> {
    use tauri::Emitter;

    let client = Client::new();
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

    let resp = request
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".into());
        return Err(format!("API error {}: {}", status, text));
    }

    let mut stream = resp.bytes_stream();
    let mut full_content = String::new();
    let mut buffer = String::new();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("Stream error: {}", e))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim().to_string();
            buffer = buffer[line_end + 1..].to_string();

            if line.is_empty() || line == "data: [DONE]" {
                continue;
            }

            if let Some(data) = line.strip_prefix("data: ") {
                if let Ok(parsed) = serde_json::from_str::<StreamChunk>(data) {
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
            }
        }
    }

    Ok(full_content)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![chat_completion, chat_stream])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
