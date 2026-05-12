use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
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

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct SessionManager {
    sessions: Arc<RwLock<HashMap<String, SessionInfo>>>,
    event_tx: broadcast::Sender<WsEvent>,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
struct SessionInfo {
    user_id: String,
    created_at: String,
    last_activity: String,
    message_count: usize,
}

#[allow(dead_code)]
impl SessionManager {
    pub fn new() -> Self {
        let (event_tx, _) = broadcast::channel::<WsEvent>(1000);
        SessionManager {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            event_tx,
        }
    }

    pub async fn create_session(&self, user_id: String) -> String {
        let session_id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        
        let mut sessions = self.sessions.write().await;
        sessions.insert(
            session_id.clone(),
            SessionInfo {
                user_id,
                created_at: now.clone(),
                last_activity: now,
                message_count: 0,
            },
        );
        
        session_id
    }

    pub async fn update_activity(&self, session_id: &str) {
        if let Some(session) = self.sessions.write().await.get_mut(session_id) {
            session.last_activity = chrono::Utc::now().to_rfc3339();
            session.message_count += 1;
        }
    }

    pub async fn remove_session(&self, session_id: &str) {
        self.sessions.write().await.remove(session_id);
    }

    pub fn event_receiver(&self) -> broadcast::Receiver<WsEvent> {
        self.event_tx.clone().subscribe()
    }

    pub async fn broadcast_event(&self, event: WsEvent) {
        let _ = self.event_tx.send(event);
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

pub struct WebSocketConnection {
    config: WsConfig,
    #[allow(dead_code)]
    session_manager: Arc<SessionManager>,
    reconnect_count: u32,
}

impl WebSocketConnection {
    pub fn new(config: WsConfig, session_manager: Arc<SessionManager>) -> Self {
        WebSocketConnection {
            config,
            session_manager,
            reconnect_count: 0,
        }
    }

    fn calculate_backoff(&self) -> Duration {
        let base_delay = Duration::from_secs(1);
        let max_delay = Duration::from_secs(30);
        
        let delay = base_delay * (2u32.pow(self.reconnect_count.min(5) as u32));
        delay.min(max_delay)
    }

    fn should_reconnect(&self) -> bool {
        self.config.reconnect && self.reconnect_count < self.config.max_reconnect_attempts
    }
}

pub async fn ws_chat_stream(
    ws_config: WsConfig,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    use tauri::Emitter;

    let session_manager = Arc::new(SessionManager::new());
    let mut connection = WebSocketConnection::new(ws_config.clone(), session_manager.clone());

    loop {
        match run_ws_connection(&ws_config, &app_handle, session_manager.clone()).await {
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

async fn run_ws_connection(
    ws_config: &WsConfig,
    app_handle: &tauri::AppHandle,
    _session_manager: Arc<SessionManager>,
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

    let _ = app_handle.emit("ws-connected", &serde_json::json!({
        "model": ws_config.model,
        "url": ws_config.url
    }));

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
        assert_eq!(deserialized.is_typing, true);
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
        let session_manager = Arc::new(SessionManager::new());
        let mut connection = WebSocketConnection::new(config, session_manager);

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
        let session_manager = Arc::new(SessionManager::new());
        let mut connection = WebSocketConnection::new(config, session_manager);

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
        let session_manager = Arc::new(SessionManager::new());
        let mut connection =
            WebSocketConnection::new(config_no_reconnect, session_manager);
        connection.reconnect_count = 0;
        assert!(!connection.should_reconnect());
    }

    #[tokio::test]
    async fn test_session_manager() {
        let manager = SessionManager::new();
        
        let session_id = manager.create_session("user1".to_string()).await;
        assert!(!session_id.is_empty());

        manager.update_activity(&session_id).await;
        
        let sessions = manager.sessions.read().await;
        assert!(sessions.contains_key(&session_id));
        drop(sessions);

        manager.remove_session(&session_id).await;
        let sessions = manager.sessions.read().await;
        assert!(!sessions.contains_key(&session_id));
    }
}
