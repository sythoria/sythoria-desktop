use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::time::{sleep, Duration};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatWsMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub role: String,
    pub content: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct TypingEvent {
    pub user_id: String,
    pub is_typing: bool,
    pub chat_id: Option<String>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct WsEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    pub payload: serde_json::Value,
    pub timestamp: String,
}

#[allow(dead_code)]
impl WsEvent {
    pub fn message(msg: ChatWsMessage) -> Self {
        WsEvent {
            event_type: "message".to_string(),
            payload: serde_json::to_value(&msg).unwrap_or_default(),
            timestamp: msg.timestamp.clone(),
        }
    }

    pub fn typing(typing: TypingEvent) -> Self {
        WsEvent {
            event_type: "typing".to_string(),
            payload: serde_json::to_value(&typing).unwrap_or_default(),
            timestamp: typing.timestamp.clone(),
        }
    }

    pub fn connection_status(status: &str) -> Self {
        WsEvent {
            event_type: "connection".to_string(),
            payload: serde_json::json!({ "status": status }),
            timestamp: chrono::Utc::now().to_rfc3339(),
        }
    }

    pub fn error(message: String) -> Self {
        WsEvent {
            event_type: "error".to_string(),
            payload: serde_json::json!({ "message": message }),
            timestamp: chrono::Utc::now().to_rfc3339(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WsConfig {
    pub url: String,
    pub api_key: Option<String>,
    pub model: String,
    pub reconnect: bool,
    pub max_reconnect_attempts: u32,
}

impl Default for WsConfig {
    fn default() -> Self {
        WsConfig {
            url: String::new(),
            api_key: None,
            model: "gpt-4o".to_string(),
            reconnect: true,
            max_reconnect_attempts: 5,
        }
    }
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

#[derive(Debug, Serialize)]
#[allow(dead_code)]
struct TypingFrame {
    #[serde(rename = "type")]
    frame_type: String,
    is_typing: bool,
    chat_id: Option<String>,
}

#[allow(dead_code)]
pub struct WebSocketConnection {
    config: WsConfig,
    reconnect_count: u32,
}

#[allow(dead_code)]
impl WebSocketConnection {
    pub fn new(config: WsConfig) -> Self {
        WebSocketConnection {
            config,
            reconnect_count: 0,
        }
    }

    fn calculate_backoff(&self) -> Duration {
        let base_delay = Duration::from_secs(1);
        let max_delay = Duration::from_secs(30);

        let delay = base_delay * (2u32.pow(self.reconnect_count.min(5)));
        delay.min(max_delay)
    }

    fn should_reconnect(&self) -> bool {
        self.config.reconnect && self.reconnect_count < self.config.max_reconnect_attempts
    }
}

#[allow(dead_code)]
pub async fn ws_chat_stream(
    ws_config: WsConfig,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    use tauri::Emitter;

    let mut connection = WebSocketConnection::new(ws_config.clone());

    loop {
        match run_ws_connection(&ws_config, &app_handle).await {
            Ok(content) => return Ok(content),
            Err(e) => {
                if !connection.should_reconnect() {
                    let err_msg = format!("WebSocket connection failed after retries: {}", e);
                    let _ = app_handle.emit("ws-error", &err_msg);
                    return Err(err_msg);
                }

                connection.reconnect_count += 1;
                let backoff = connection.calculate_backoff();

                let _ = app_handle.emit(
                    "ws-reconnecting",
                    &serde_json::json!({
                        "attempt": connection.reconnect_count,
                        "max_attempts": connection.config.max_reconnect_attempts,
                        "delay_ms": backoff.as_millis()
                    }),
                );

                sleep(backoff).await;
            }
        }
    }
}

#[allow(dead_code)]
async fn run_ws_connection(
    ws_config: &WsConfig,
    app_handle: &tauri::AppHandle,
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

    let _ = app_handle.emit(
        "ws-connected",
        &serde_json::json!({
            "model": ws_config.model,
            "url": ws_config.url
        }),
    );

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
            Some(Ok(Message::Pong(_))) => {}
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

#[allow(dead_code)]
pub async fn send_typing_event(
    ws_config: &WsConfig,
    is_typing: bool,
    chat_id: Option<String>,
) -> Result<(), String> {
    if !ws_config.url.starts_with("ws") {
        return Ok(());
    }

    let (ws_stream, _) = connect_async(&ws_config.url)
        .await
        .map_err(|e| format!("WebSocket connection failed: {}", e))?;

    let (mut write, _) = ws_stream.split();

    let typing_frame = TypingFrame {
        frame_type: "typing".to_string(),
        is_typing,
        chat_id,
    };
    let typing_json = serde_json::to_string(&typing_frame)
        .map_err(|e| format!("Serialize typing error: {}", e))?;

    write
        .send(Message::Text(typing_json.into()))
        .await
        .map_err(|e| format!("Send typing failed: {}", e))?;

    Ok(())
}

use futures_util::stream::SplitSink;
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

pub type WsStream = WebSocketStream<MaybeTlsStream<TcpStream>>;
pub type WsWriter = SplitSink<WsStream, Message>;

pub struct WsSession {
    pub writer: std::sync::Arc<Mutex<Option<WsWriter>>>,
}

impl Default for WsSession {
    fn default() -> Self {
        WsSession {
            writer: std::sync::Arc::new(Mutex::new(None)),
        }
    }
}

pub async fn ws_connect(
    ws_config: WsConfig,
    app_handle: tauri::AppHandle,
    session: &WsSession,
) -> Result<(), String> {
    // 1. Close any existing connection first
    {
        let mut guard = session.writer.lock().await;
        *guard = None;
    }

    // 2. Connect
    let (ws_stream, _) = connect_async(&ws_config.url)
        .await
        .map_err(|e| format!("WebSocket connection failed: {}", e))?;

    let (mut write, mut read) = ws_stream.split();

    // 3. Auth handshake if needed
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

    // 4. Config handshake if needed
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

    use tauri::Emitter;
    let _ = app_handle.emit(
        "ws-connected",
        &serde_json::json!({
            "model": ws_config.model,
            "url": ws_config.url
        }),
    );

    // Save the writer
    {
        let mut guard = session.writer.lock().await;
        *guard = Some(write);
    }

    // Spawn the read loop
    let writer_clone = session.writer.clone();
    let app_handle_clone = app_handle.clone();
    tokio::spawn(async move {
        use tauri::Emitter;
        while let Some(msg) = read.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    let text_str = text.to_string();
                    if text_str.trim() == "[DONE]" {
                        let _ = app_handle_clone.emit("ws-closed", ());
                        break;
                    }
                    match serde_json::from_str::<ChatWsMessage>(&text_str) {
                        Ok(parsed) => {
                            if parsed.msg_type == "error" {
                                let _ = app_handle_clone.emit("ws-error", &parsed.content);
                                break;
                            }
                            let _ = app_handle_clone.emit("ws-message", &parsed);
                        }
                        Err(e) => {
                            let _ =
                                app_handle_clone.emit("ws-error", &format!("Parse error: {}", e));
                            break;
                        }
                    }
                }
                Ok(Message::Close(_)) => {
                    let _ = app_handle_clone.emit("ws-closed", ());
                    break;
                }
                Ok(Message::Ping(data)) => {
                    let mut guard = writer_clone.lock().await;
                    if let Some(ref mut writer) = *guard {
                        let _ = writer.send(Message::Pong(data)).await;
                    }
                }
                Ok(Message::Pong(_)) => {}
                Err(e) => {
                    let _ = app_handle_clone.emit("ws-error", &format!("WebSocket error: {}", e));
                    break;
                }
                _ => {}
            }
        }
        // Connection closed: clear the writer
        let mut guard = writer_clone.lock().await;
        *guard = None;
    });

    Ok(())
}

pub async fn ws_send(message: String, session: &WsSession) -> Result<(), String> {
    let mut guard = session.writer.lock().await;
    if let Some(ref mut writer) = *guard {
        writer
            .send(Message::Text(message.into()))
            .await
            .map_err(|e| format!("Send message failed: {}", e))?;
        Ok(())
    } else {
        Err("WebSocket is not connected".to_string())
    }
}

pub async fn ws_disconnect(
    session: &WsSession,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    use tauri::Emitter;
    let mut guard = session.writer.lock().await;
    if let Some(ref mut writer) = *guard {
        let _ = writer.send(Message::Close(None)).await;
    }
    *guard = None;
    let _ = app_handle.emit("ws-closed", ());
    Ok(())
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
            reconnect: true,
            max_reconnect_attempts: 5,
        };
        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("ws://localhost:8080/chat"));
        assert!(json.contains("test-key"));
        assert!(json.contains("gpt-4o"));

        let config_no_key = WsConfig {
            url: "ws://localhost:8080/chat".to_string(),
            api_key: None,
            model: "llama3.1".to_string(),
            reconnect: true,
            max_reconnect_attempts: 5,
        };
        let json = serde_json::to_string(&config_no_key).unwrap();
        assert!(json.contains("\"api_key\":null"));
    }

    #[test]
    fn test_typing_event_serialization() {
        let typing = TypingEvent {
            user_id: "user123".to_string(),
            is_typing: true,
            chat_id: Some("chat456".to_string()),
            timestamp: "2024-01-01T00:00:00Z".to_string(),
        };
        let json = serde_json::to_string(&typing).unwrap();
        assert!(json.contains("user123"));
        assert!(json.contains("chat456"));
        assert!(json.contains("true"));

        let deserialized: TypingEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.user_id, "user123");
        assert!(deserialized.is_typing);
        assert_eq!(deserialized.chat_id, Some("chat456".to_string()));
    }

    #[test]
    fn test_ws_event_creation() {
        let msg = ChatWsMessage {
            msg_type: "assistant".to_string(),
            role: "assistant".to_string(),
            content: "Test".to_string(),
            timestamp: "2024-01-01T00:00:00Z".to_string(),
        };
        let event = WsEvent::message(msg);
        assert_eq!(event.event_type, "message");
        assert_eq!(event.timestamp, "2024-01-01T00:00:00Z");

        let typing = TypingEvent {
            user_id: "user1".to_string(),
            is_typing: true,
            chat_id: None,
            timestamp: "2024-01-01T00:00:00Z".to_string(),
        };
        let event = WsEvent::typing(typing);
        assert_eq!(event.event_type, "typing");

        let event = WsEvent::connection_status("connected");
        assert_eq!(event.event_type, "connection");

        let event = WsEvent::error("Test error".to_string());
        assert_eq!(event.event_type, "error");
    }

    #[test]
    fn test_backoff_calculation() {
        let config = WsConfig::default();
        let mut connection = WebSocketConnection::new(config);

        connection.reconnect_count = 0;
        assert_eq!(connection.calculate_backoff(), Duration::from_secs(1));

        connection.reconnect_count = 1;
        assert_eq!(connection.calculate_backoff(), Duration::from_secs(2));

        connection.reconnect_count = 2;
        assert_eq!(connection.calculate_backoff(), Duration::from_secs(4));

        connection.reconnect_count = 10;
        assert_eq!(connection.calculate_backoff(), Duration::from_secs(30));
    }

    #[test]
    fn test_should_reconnect() {
        let config = WsConfig {
            reconnect: true,
            max_reconnect_attempts: 3,
            ..WsConfig::default()
        };
        let mut connection = WebSocketConnection::new(config);

        connection.reconnect_count = 0;
        assert!(connection.should_reconnect());

        connection.reconnect_count = 2;
        assert!(connection.should_reconnect());

        connection.reconnect_count = 3;
        assert!(!connection.should_reconnect());

        let config_no_reconnect = WsConfig {
            reconnect: false,
            max_reconnect_attempts: 10,
            ..WsConfig::default()
        };
        let mut connection = WebSocketConnection::new(config_no_reconnect);
        connection.reconnect_count = 0;
        assert!(!connection.should_reconnect());
    }
}
