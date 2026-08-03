use crate::commands::config::get_keychain_secret;
use crate::mcp;
use crate::AppError;
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use tokio_util::sync::CancellationToken;

static ACTIVE_TOOL_CALLS: LazyLock<Mutex<HashMap<String, CancellationToken>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn register_tool_call(request_id: &str) -> Result<CancellationToken, AppError> {
    let mut active_calls = ACTIVE_TOOL_CALLS
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if active_calls.contains_key(request_id) {
        return Err(AppError::McpError(format!(
            "MCP request ID is already active: {request_id}"
        )));
    }
    let token = CancellationToken::new();
    active_calls.insert(request_id.to_string(), token.clone());
    Ok(token)
}

fn cancel_registered_tool_call(request_id: &str) -> bool {
    let active_calls = ACTIVE_TOOL_CALLS
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    active_calls
        .get(request_id)
        .map(|token| {
            token.cancel();
            true
        })
        .unwrap_or(false)
}

fn finish_tool_call(request_id: &str) {
    ACTIVE_TOOL_CALLS
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .remove(request_id);
}

struct ToolCallRegistration(String);

impl Drop for ToolCallRegistration {
    fn drop(&mut self) {
        finish_tool_call(&self.0);
    }
}

#[tauri::command]
pub async fn mcp_start_server(
    config: String,
    env_secrets: String,
    explicitly_enabled: bool,
    _app: tauri::AppHandle,
) -> Result<String, AppError> {
    crate::ensure_online()?;
    let mut server_config: mcp::McpServerConfig = serde_json::from_str(&config)
        .map_err(|e| AppError::ParseError(format!("Invalid MCP config JSON: {}", e)))?;
    let env_map: HashMap<String, String> = serde_json::from_str(&env_secrets)
        .map_err(|e| AppError::ParseError(format!("Invalid MCP env secrets JSON: {}", e)))?;

    {
        let mut manager = mcp::MCP_SERVERS.lock().unwrap_or_else(|e| e.into_inner());
        manager.set_explicitly_enabled(&server_config.id, explicitly_enabled);
    }

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
pub async fn mcp_set_server_enabled(server_id: String, enabled: bool) -> Result<(), AppError> {
    let mut manager = mcp::MCP_SERVERS.lock().unwrap_or_else(|e| e.into_inner());
    manager.set_explicitly_enabled(&server_id, enabled);
    Ok(())
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
    crate::ensure_online()?;
    let result = mcp::client::list_resources_on_server(&server_id)
        .await
        .map_err(AppError::McpError)?;
    Ok(serde_json::to_string(&result).unwrap_or_default())
}

#[tauri::command]
pub async fn mcp_list_prompts(server_id: String) -> Result<String, AppError> {
    crate::ensure_online()?;
    let result = mcp::client::list_prompts_on_server(&server_id)
        .await
        .map_err(AppError::McpError)?;
    Ok(serde_json::to_string(&result).unwrap_or_default())
}

#[tauri::command]
pub async fn mcp_call_tool(
    server_id: String,
    tool_name: String,
    arguments: String,
    request_id: Option<String>,
) -> Result<String, AppError> {
    crate::ensure_online()?;
    let args: serde_json::Value = serde_json::from_str(&arguments)
        .map_err(|e| AppError::ParseError(format!("Invalid tool arguments JSON: {}", e)))?;

    let registration = match request_id.as_deref() {
        Some(request_id) => Some((
            register_tool_call(request_id)?,
            ToolCallRegistration(request_id.to_string()),
        )),
        None => None,
    };
    let cancel_token = registration.as_ref().map(|(token, _guard)| token.clone());

    let result = tokio::time::timeout(
        std::time::Duration::from_secs(120),
        mcp::client::call_tool_on_server(&server_id, &tool_name, &args, cancel_token),
    )
    .await
    .map_err(|_| AppError::McpError("MCP tool call timed out after 120 seconds".to_string()))?
    .map_err(|e| {
        log::error!("MCP tool call failed: {}", e);
        AppError::McpError(e)
    })?;

    Ok(serde_json::to_string(&result).unwrap_or_default())
}

#[tauri::command]
pub fn mcp_cancel_tool_call(request_id: String) -> Result<bool, AppError> {
    Ok(cancel_registered_tool_call(&request_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_call_registry_cancels_only_the_requested_call() {
        let first = register_tool_call("request-first").expect("register first request");
        let second = register_tool_call("request-second").expect("register second request");

        assert!(cancel_registered_tool_call("request-first"));
        assert!(first.is_cancelled());
        assert!(!second.is_cancelled());

        finish_tool_call("request-first");
        finish_tool_call("request-second");
        assert!(!cancel_registered_tool_call("request-first"));
    }

    #[test]
    fn tool_call_registry_rejects_duplicate_request_ids() {
        let _token = register_tool_call("request-duplicate").expect("register request");
        let duplicate = register_tool_call("request-duplicate");

        assert!(duplicate.is_err());
        finish_tool_call("request-duplicate");
    }
}
