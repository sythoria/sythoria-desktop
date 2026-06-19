pub mod client;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

#[allow(non_snake_case)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    pub id: String,
    pub name: String,
    pub transport: String,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub baseUrl: Option<String>,
    pub apiKey: Option<String>,
    pub enabled: bool,
}

#[allow(non_snake_case)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolInfo {
    pub name: String,
    pub description: String,
    pub inputSchema: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpImageContent {
    pub mime_type: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolResult {
    pub content: String,
    #[serde(rename = "isError")]
    pub is_error: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<McpImageContent>,
}

#[derive(Debug, Clone)]
pub struct McpServerHandle {
    pub tools: Vec<McpToolInfo>,
    pub cancel_token: tokio_util::sync::CancellationToken,
    pub tool_tx: Option<tokio::sync::mpsc::Sender<McpToolRequest>>,
}

#[derive(Debug)]
pub struct McpToolRequest {
    pub tool_name: String,
    pub arguments: serde_json::Value,
    pub reply_tx: tokio::sync::oneshot::Sender<Result<McpToolResult, String>>,
}

pub struct McpServerManager {
    pub servers: HashMap<String, McpServerHandle>,
}

impl McpServerManager {
    pub fn new() -> Self {
        Self {
            servers: HashMap::new(),
        }
    }

    pub fn remove_server(&mut self, server_id: &str) {
        if let Some(handle) = self.servers.remove(server_id) {
            handle.cancel_token.cancel();
        }
    }

    pub fn get_tools(&self, server_id: &str) -> Vec<McpToolInfo> {
        self.servers
            .get(server_id)
            .map(|h| h.tools.clone())
            .unwrap_or_default()
    }
}

pub static MCP_SERVERS: LazyLock<Mutex<McpServerManager>> =
    LazyLock::new(|| Mutex::new(McpServerManager::new()));
