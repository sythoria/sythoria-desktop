use std::collections::HashMap;
use crate::AppError;
use crate::mcp;
use crate::commands::config::get_keychain_secret;

#[tauri::command]
pub async fn mcp_start_server(
    config: String,
    env_secrets: String,
    _app: tauri::AppHandle,
) -> Result<String, AppError> {
    let mut server_config: mcp::McpServerConfig = serde_json::from_str(&config)
        .map_err(|e| AppError::ParseError(format!("Invalid MCP config JSON: {}", e)))?;
    let env_map: HashMap<String, String> = serde_json::from_str(&env_secrets)
        .map_err(|e| AppError::ParseError(format!("Invalid MCP env secrets JSON: {}", e)))?;

    if server_config.apiKey.as_deref().unwrap_or("").is_empty() {
        if let Ok(key) = get_keychain_secret("mcp", &server_config.id) {
            if !key.is_empty() {
                server_config.apiKey = Some(key);
            }
        }
    }

    let tools = mcp::client::connect_server(&server_config, env_map)
        .await
        .map_err(|e| {
            log::error!("MCP server start failed: {}", e);
            AppError::McpError(e)
        })?;

    Ok(serde_json::to_string(&tools).unwrap_or_default())
}

#[tauri::command]
pub async fn mcp_check_command(command: String) -> Result<String, AppError> {
    let info = mcp::client::check_executable(&command).await;
    Ok(serde_json::to_string(&info).unwrap_or_default())
}

#[tauri::command]
pub async fn mcp_stop_server(server_id: String) -> Result<(), AppError> {
    mcp::client::disconnect_server(&server_id).map_err(|e| {
        log::error!("MCP server stop failed: {}", e);
        AppError::McpError(e)
    })
}

#[tauri::command]
pub async fn mcp_list_tools(server_id: String) -> Result<String, AppError> {
    let manager = crate::mcp::MCP_SERVERS
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let tools = manager.get_tools(&server_id);
    Ok(serde_json::to_string(&tools).unwrap_or_default())
}

#[tauri::command]
pub async fn mcp_list_resources(server_id: String) -> Result<String, AppError> {
    let result = mcp::client::list_resources_on_server(&server_id)
        .await
        .map_err(|e| AppError::McpError(e))?;
    Ok(serde_json::to_string(&result).unwrap_or_default())
}

#[tauri::command]
pub async fn mcp_list_prompts(server_id: String) -> Result<String, AppError> {
    let result = mcp::client::list_prompts_on_server(&server_id)
        .await
        .map_err(|e| AppError::McpError(e))?;
    Ok(serde_json::to_string(&result).unwrap_or_default())
}

#[tauri::command]
pub async fn mcp_call_tool(
    server_id: String,
    tool_name: String,
    arguments: String,
) -> Result<String, AppError> {
    let args: serde_json::Value = serde_json::from_str(&arguments)
        .map_err(|e| AppError::ParseError(format!("Invalid tool arguments JSON: {}", e)))?;

    let result = mcp::client::call_tool_on_server(&server_id, &tool_name, &args)
        .await
        .map_err(|e| {
            log::error!("MCP tool call failed: {}", e);
            AppError::McpError(e)
        })?;

    Ok(serde_json::to_string(&result).unwrap_or_default())
}
