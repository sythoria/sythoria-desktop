use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::time::{sleep, Duration};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatWsMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub role: String,
    pub content: String,
    pub timestamp: String,
}

#[derive(Debug, Serialize)]
pub struct WsConfig {
    pub url: String,
    pub api_key: Option<String>,
    pub model: String,
}

#[derive(Debug, Serialize)]
struct AuthFrame {
    #[serde(rename = "type")]
    frame_type: String,
    key: String,
}

#[derive(Debug, Serialize)]
struct ConfigFrame {
    #[serde(rename = "type")]
    frame_type: String,
    model: String,
}

pub async fn ws_chat_stream(
    ws_config: WsConfig,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    use tauri::Emitter;

    let (ws_stream, _) = connect_async(&ws_config.url)
        .await
        .map_err(|e| format!("WebSocket connection failed: {}", e))?;

    let (mut write, mut read) = ws_stream.split();

    if let Some(ref key) = ws_config.api_key {
        let auth_frame = AuthFrame {
            frame_type: "auth".to_string(),
            key: key.clone(),
        };
        let auth_json =
            serde_json::to_string(&auth_frame).map_err(|e| format!("Serialize error: {}", e))?;
        write
            .send(Message::Text(auth_json.into()))
            .await
            .map_err(|e| format!("Send auth failed: {}", e))?;
    }

    let config_frame = ConfigFrame {
        frame_type: "config".to_string(),
        model: ws_config.model.clone(),
    };
    let config_json =
        serde_json::to_string(&config_frame).map_err(|e| format!("Serialize error: {}", e))?;
    write
        .send(Message::Text(config_json.into()))
        .await
        .map_err(|e| format!("Send config failed: {}", e))?;

    let mut full_content = String::new();

    loop {
        let timeout_future = sleep(Duration::from_secs(30));
        let msg_option = tokio::select! {
            msg = read.next() => msg,
            _ = timeout_future => {
                let err_msg = "WebSocket connection timed out".to_string();
                let _ = app_handle.emit("ws-error", &err_msg);
                return Err(err_msg);
            }
        };

        match msg_option {
            Some(Ok(Message::Text(text))) => {
                let text_str = text.to_string();
                if text_str.trim() == "[DONE]" {
                    let _ = app_handle.emit("ws-closed", ());
                    break;
                }
                match serde_json::from_str::<ChatWsMessage>(&text_str) {
                    Ok(parsed) => {
                        if parsed.msg_type == "error" {
                            let _ = app_handle.emit("ws-error", &parsed.content);
                            return Err(parsed.content);
                        }
                        full_content.push_str(&parsed.content);
                        let _ = app_handle.emit("ws-message", &parsed);
                    }
                    Err(e) => {
                        let err_msg = format!("Parse error: {}", e);
                        let _ = app_handle.emit("ws-error", &err_msg);
                        return Err(err_msg);
                    }
                }
            }
            Some(Ok(Message::Close(_))) => {
                let _ = app_handle.emit("ws-closed", ());
                break;
            }
            Some(Ok(Message::Ping(data))) => {
                if let Err(e) = write.send(Message::Pong(data)).await {
                    let err_msg = format!("Pong failed: {}", e);
                    let _ = app_handle.emit("ws-error", &err_msg);
                    return Err(err_msg);
                }
            }
            Some(Err(e)) => {
                let err_msg = format!("WebSocket error: {}", e);
                let _ = app_handle.emit("ws-error", &err_msg);
                return Err(err_msg);
            }
            None => {
                let _ = app_handle.emit("ws-closed", ());
                break;
            }
            _ => {}
        }
    }

    Ok(full_content)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chat_ws_message_serialization() {
        let msg = ChatWsMessage {
            msg_type: "assistant".to_string(),
            role: "assistant".to_string(),
            content: "Hello, world!".to_string(),
            timestamp: "2024-01-01T00:00:00Z".to_string(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("Hello, world!"));
        assert!(json.contains("assistant"));

        let deserialized: ChatWsMessage = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.content, "Hello, world!");
        assert_eq!(deserialized.msg_type, "assistant");
        assert_eq!(deserialized.role, "assistant");
    }

    #[test]
    fn test_chat_ws_message_deserialize_full() {
        let json = r#"{"type":"user","role":"user","content":"What is Rust?","timestamp":"2024-06-15T10:30:00Z"}"#;
        let msg: ChatWsMessage = serde_json::from_str(json).unwrap();
        assert_eq!(msg.msg_type, "user");
        assert_eq!(msg.role, "user");
        assert_eq!(msg.content, "What is Rust?");
        assert_eq!(msg.timestamp, "2024-06-15T10:30:00Z");
    }

    #[test]
    fn test_ws_config_serialization() {
        let config = WsConfig {
            url: "ws://localhost:8080/chat".to_string(),
            api_key: Some("test-key".to_string()),
            model: "gpt-4o".to_string(),
        };
        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("ws://localhost:8080/chat"));
        assert!(json.contains("test-key"));
        assert!(json.contains("gpt-4o"));

        let config_no_key = WsConfig {
            url: "ws://localhost:8080/chat".to_string(),
            api_key: None,
            model: "llama3.1".to_string(),
        };
        let json = serde_json::to_string(&config_no_key).unwrap();
        assert!(json.contains("\"api_key\":null"));
    }
}