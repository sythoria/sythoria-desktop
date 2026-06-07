use crate::mcp::{
    McpServerConfig, McpServerHandle, McpToolInfo, McpToolRequest, McpToolResult, MCP_SERVERS,
};
use rmcp::model::ClientInfo;
use rmcp::service::ServiceExt;
use rmcp::transport::child_process::TokioChildProcess;
use rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig;
use rmcp::ClientHandler;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::process::Command;

#[derive(Clone)]
struct SythoriaMcpClient {
    info: ClientInfo,
}

impl ClientHandler for SythoriaMcpClient {
    fn get_info(&self) -> ClientInfo {
        self.info.clone()
    }
}

fn convert_tool(t: &rmcp::model::Tool) -> McpToolInfo {
    let schema_obj = t.input_schema.as_ref().clone();
    McpToolInfo {
        name: t.name.to_string(),
        description: t.description.clone().unwrap_or_default().to_string(),
        inputSchema: serde_json::Value::Object(schema_obj),
    }
}

pub async fn connect_server(
    config: &McpServerConfig,
    env_secrets: HashMap<String, String>,
) -> Result<Vec<McpToolInfo>, String> {
    let cancel_token = tokio_util::sync::CancellationToken::new();
    let ct = cancel_token.clone();
    let server_id = config.id.clone();

    let client_info = ClientInfo::default();
    let client = SythoriaMcpClient { info: client_info };

    match config.transport.as_str() {
        "stdio" => {
            let command = config.command.as_deref().unwrap_or("").to_string();
            if command.is_empty() {
                return Err("Command is required for stdio transport".to_string());
            }

            let args = config.args.as_deref().unwrap_or(&[]);
            let mut cmd = Command::new(&command);
            cmd.args(args)
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::inherit());

            for (key, value) in &env_secrets {
                cmd.env(key, value);
            }

            let transport = TokioChildProcess::new(cmd)
                .map_err(|e| format!("Failed to spawn MCP server process: {}", e))?;

            let mut running = client
                .serve_with_ct(transport, ct)
                .await
                .map_err(|e| format!("MCP handshake failed: {}", e))?;

            let tools_result = running
                .peer()
                .list_tools(Default::default())
                .await
                .map_err(|e| format!("Failed to list MCP tools: {}", e))?;

            let tools: Vec<McpToolInfo> = tools_result.tools.iter().map(convert_tool).collect();

            let (tool_tx, mut tool_rx) = tokio::sync::mpsc::channel::<McpToolRequest>(64);

            let peer = running.peer().clone();
            let task_cancel = cancel_token.clone();

            tokio::spawn(async move {
                loop {
                    tokio::select! {
                        req = tool_rx.recv() => {
                            match req {
                                Some(req) => {
                                    let result = call_tool_via_peer(&peer, &req.tool_name, &req.arguments).await;
                                    let _ = req.reply_tx.send(result);
                                }
                                None => break,
                            }
                        }
                        _ = task_cancel.cancelled() => {
                            break;
                        }
                    }
                }
                let _ = running.close().await;
            });

            let handle = McpServerHandle {
                tools: tools.clone(),
                cancel_token,
                tool_tx: Some(tool_tx),
            };

            {
                let mut manager = MCP_SERVERS
                    .lock()
                    .map_err(|e| format!("Manager lock poisoned: {}", e))?;
                manager.servers.insert(server_id, handle);
            }

            Ok(tools)
        }
        "sse" | "streamable-http" => {
            let base_url = config.baseUrl.as_deref().unwrap_or("").to_string();
            if base_url.is_empty() {
                return Err("Base URL is required for HTTP transport".to_string());
            }

            let mut transport_config =
                StreamableHttpClientTransportConfig::with_uri(Arc::from(base_url.as_str()));

            if let Some(api_key) = &config.apiKey {
                if !api_key.is_empty() {
                    transport_config = transport_config.auth_header(api_key.as_str());
                }
            }

            let transport =
                rmcp::transport::StreamableHttpClientTransport::from_config(transport_config);

            let mut running = client
                .serve_with_ct(transport, ct)
                .await
                .map_err(|e| format!("MCP handshake failed: {}", e))?;

            let tools_result = running
                .peer()
                .list_tools(Default::default())
                .await
                .map_err(|e| format!("Failed to list MCP tools: {}", e))?;

            let tools: Vec<McpToolInfo> = tools_result.tools.iter().map(convert_tool).collect();

            let (tool_tx, mut tool_rx) = tokio::sync::mpsc::channel::<McpToolRequest>(64);

            let peer = running.peer().clone();
            let task_cancel = cancel_token.clone();

            tokio::spawn(async move {
                loop {
                    tokio::select! {
                        req = tool_rx.recv() => {
                            match req {
                                Some(req) => {
                                    let result = call_tool_via_peer(&peer, &req.tool_name, &req.arguments).await;
                                    let _ = req.reply_tx.send(result);
                                }
                                None => break,
                            }
                        }
                        _ = task_cancel.cancelled() => {
                            break;
                        }
                    }
                }
                let _ = running.close().await;
            });

            let handle = McpServerHandle {
                tools: tools.clone(),
                cancel_token,
                tool_tx: Some(tool_tx),
            };

            {
                let mut manager = MCP_SERVERS
                    .lock()
                    .map_err(|e| format!("Manager lock poisoned: {}", e))?;
                manager.servers.insert(server_id, handle);
            }

            Ok(tools)
        }
        _ => Err(format!("Unknown transport: {}", config.transport)),
    }
}

async fn call_tool_via_peer(
    peer: &rmcp::service::Peer<rmcp::service::RoleClient>,
    tool_name: &str,
    arguments: &serde_json::Value,
) -> Result<McpToolResult, String> {
    let args_map: serde_json::Map<String, serde_json::Value> =
        arguments.as_object().cloned().unwrap_or_default();

    let params =
        rmcp::model::CallToolRequestParams::new(tool_name.to_string()).with_arguments(args_map);

    match peer.call_tool(params).await {
        Ok(result) => {
            let content_str = result
                .content
                .into_iter()
                .map(|c| match c.raw {
                    rmcp::model::RawContent::Text(text) => text.text.to_string(),
                    rmcp::model::RawContent::Image(img) => format!("[Image: {}]", img.mime_type),
                    rmcp::model::RawContent::Audio(audio) => {
                        format!("[Audio: {}]", audio.mime_type)
                    }
                    rmcp::model::RawContent::Resource(resource) => {
                        format!("[Resource: {:?}]", resource.resource)
                    }
                    _ => "[Unknown content]".to_string(),
                })
                .collect::<Vec<_>>()
                .join("\n");

            Ok(McpToolResult {
                content: content_str,
                is_error: result.is_error.unwrap_or(false),
            })
        }
        Err(e) => Ok(McpToolResult {
            content: format!("MCP tool call error: {}", e),
            is_error: true,
        }),
    }
}

pub async fn call_tool_on_server(
    server_id: &str,
    tool_name: &str,
    arguments: &serde_json::Value,
) -> Result<McpToolResult, String> {
    let tool_tx = {
        let manager = MCP_SERVERS
            .lock()
            .map_err(|e| format!("Manager lock poisoned: {}", e))?;
        manager
            .servers
            .get(server_id)
            .and_then(|h| h.tool_tx.clone())
            .ok_or_else(|| format!("MCP server '{}' not found or not connected", server_id))?
    };

    let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();

    tool_tx
        .send(McpToolRequest {
            tool_name: tool_name.to_string(),
            arguments: arguments.clone(),
            reply_tx,
        })
        .await
        .map_err(|e| format!("Failed to send tool request: {}", e))?;

    reply_rx
        .await
        .map_err(|e| format!("Tool call cancelled: {}", e))?
}

pub fn disconnect_server(server_id: &str) -> Result<(), String> {
    let mut manager = MCP_SERVERS
        .lock()
        .map_err(|e| format!("Manager lock poisoned: {}", e))?;
    manager.remove_server(server_id);
    Ok(())
}
