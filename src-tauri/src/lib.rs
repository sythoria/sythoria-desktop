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
async fn load_config(app: tauri::AppHandle) -> Result<String, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let config_path = app_data_dir.join("config.json");
    if config_path.exists() {
        fs::read_to_string(config_path).map_err(|e| e.to_string())
    } else {
        Ok("".to_string())
    }
}

#[tauri::command]
async fn save_config(app: tauri::AppHandle, config: String) -> Result<(), String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    let config_path = app_data_dir.join("config.json");
    let mut file = fs::File::create(config_path).map_err(|e| e.to_string())?;
    file.write_all(config.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
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

#[tauri::command]
async fn ws_chat(
  url: String,
  api_key: Option<String>,
  model: String,
  app: tauri::AppHandle,
) -> Result<String, String> {
  let config = ws_handler::WsConfig {
    url,
    api_key,
    model,
    reconnect: true,
    max_reconnect_attempts: 5,
  };
  ws_handler::ws_chat_stream(config, app).await
}

#[tauri::command]
async fn ws_authenticate(
    username: String,
    api_key: String,
    server_url: String,
) -> Result<String, String> {
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
        .await
        .map_err(|e| format!("Auth request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".into());
        return Err(format!("Auth error {}: {}", status, text));
    }

    let token: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

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
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            chat_completion,
            chat_stream,
            ws_authenticate,
            ws_chat
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
