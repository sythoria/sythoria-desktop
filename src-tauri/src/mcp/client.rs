use crate::mcp::{
    McpServerConfig, McpServerHandle, McpServerRequest, McpToolInfo, McpToolResult, MCP_SERVERS,
};
use rmcp::model::ClientInfo;
use rmcp::service::ServiceExt;
use rmcp::transport::child_process::TokioChildProcess;
use rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig;
use rmcp::ClientHandler;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::process::Command;

fn is_env_key_allowed(key: &str) -> bool {
    let key_upper = key.to_uppercase();
    if matches!(
        key_upper.as_str(),
        "PATH"
            | "HOME"
            | "USER"
            | "SHELL"
            | "LANG"
            | "LC_ALL"
            | "LOGNAME"
            | "PWD"
            | "TERM"
            | "TMPDIR"
            | "TEMP"
            | "TMP"
    ) {
        return true;
    }
    key_upper.ends_with("_API_KEY")
        || key_upper.ends_with("_TOKEN")
        || key_upper.ends_with("_SECRET")
        || key_upper.ends_with("_PASSWORD")
        || key_upper.ends_with("_URL")
        || key_upper.ends_with("_URI")
        || key_upper.ends_with("_PATH")
}

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

/// Returns the trimmed executable name from a command string.
///
/// As of the stdio UX redesign, `command` holds the program/executable only
/// (e.g. `npx`, `uvx`, `/usr/local/bin/python`) — never a full command line.
/// All arguments are supplied separately via `McpServerConfig::args`.
///
/// Returns `Err` for an empty/whitespace command so callers can produce a clear
/// "command is required" message rather than a confusing spawn failure later.
fn resolve_executable_name(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Command is required for stdio transport".to_string());
    }
    Ok(trimmed.to_string())
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutableInfo {
    pub found: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub message: String,
}

async fn find_executable(name: &str) -> String {
    if which::which(name).is_ok() {
        return name.to_string();
    }

    let common_paths = [
        "/usr/local/bin",
        "/opt/homebrew/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ];

    for dir in &common_paths {
        let path = std::path::Path::new(dir).join(name);
        if path.exists() {
            return path.to_string_lossy().to_string();
        }
    }

    if let Ok(home) = std::env::var("HOME") {
        let npm_paths = [
            format!("{}/.npm-global/bin", home),
            format!("{}/.local/bin", home),
            format!("{}/n/bin", home),
        ];
        for dir in &npm_paths {
            let path = std::path::Path::new(dir).join(name);
            if path.exists() {
                return path.to_string_lossy().to_string();
            }
        }

        if let Ok(nvm_dir) = std::env::var("NVM_DIR") {
            let nvm_bin = std::path::Path::new(&nvm_dir).join("versions").join("node");
            if let Ok(entries) = std::fs::read_dir(&nvm_bin) {
                let mut versions: Vec<_> = entries
                    .filter_map(|e| e.ok())
                    .filter(|e| e.path().is_dir())
                    .collect();
                versions.sort_by(|a, b| {
                    let a_name = a.file_name().to_string_lossy().to_string();
                    let b_name = b.file_name().to_string_lossy().to_string();
                    b_name.cmp(&a_name)
                });
                for version_dir in versions {
                    let bin_path = version_dir.path().join("bin").join(name);
                    if bin_path.exists() {
                        return bin_path.to_string_lossy().to_string();
                    }
                }
            }
        }
    }

    name.to_string()
}

fn create_shell_command(program: &str, args: &[String]) -> Command {
    let mut cmd = Command::new(program);
    cmd.args(args);

    let current_path = std::env::var_os("PATH").unwrap_or_default();
    let paths = std::env::split_paths(&current_path);
    let mut new_paths: Vec<std::path::PathBuf> = paths.collect();

    let program_path = std::path::Path::new(program);
    if program_path.is_absolute() {
        if let Some(parent) = program_path.parent() {
            let parent_buf = parent.to_path_buf();
            if !new_paths.contains(&parent_buf) {
                new_paths.insert(0, parent_buf);
            }
        }
    }

    let common_dirs = [
        "/usr/local/bin",
        "/opt/homebrew/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ];

    for dir in &common_dirs {
        let path_buf = std::path::PathBuf::from(dir);
        if path_buf.exists() && !new_paths.contains(&path_buf) {
            new_paths.push(path_buf);
        }
    }

    if let Ok(home) = std::env::var("HOME") {
        let npm_dirs = [
            format!("{}/.npm-global/bin", home),
            format!("{}/.local/bin", home),
            format!("{}/n/bin", home),
        ];
        for dir in &npm_dirs {
            let path_buf = std::path::PathBuf::from(dir);
            if path_buf.exists() && !new_paths.contains(&path_buf) {
                new_paths.push(path_buf);
            }
        }

        let nvm_dir_val = std::env::var("NVM_DIR")
            .ok()
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| std::path::PathBuf::from(&home).join(".nvm"));
        let nvm_bin = nvm_dir_val.join("versions").join("node");
        if let Ok(entries) = std::fs::read_dir(&nvm_bin) {
            let mut versions: Vec<_> = entries
                .filter_map(|e| e.ok())
                .filter(|e| e.path().is_dir())
                .collect();
            versions.sort_by(|a, b| {
                let a_name = a.file_name().to_string_lossy().to_string();
                let b_name = b.file_name().to_string_lossy().to_string();
                b_name.cmp(&a_name)
            });
            for version_dir in versions {
                let bin_path = version_dir.path().join("bin");
                if bin_path.exists() && !new_paths.contains(&bin_path) {
                    new_paths.push(bin_path);
                }
            }
        }
    }

    if let Ok(joined) = std::env::join_paths(new_paths) {
        cmd.env("PATH", joined);
    }

    cmd
}

async fn resolve_executable_via_shell(program: &str) -> Option<String> {
    if std::path::Path::new(program).is_absolute() && std::path::Path::new(program).exists() {
        return Some(program.to_string());
    }
    which::which(program)
        .ok()
        .map(|path| path.to_string_lossy().into_owned())
}

/// Probes whether the given program is resolvable to an executable.
///
/// Returns an [`ExecutableInfo`] describing whether it was found, the resolved
/// path, and a best-effort `--version` string. Used by the settings UI to show
/// a green/red status *before* the user clicks Connect.
pub async fn check_executable(program: &str) -> ExecutableInfo {
    let program = program.trim();
    if program.is_empty() {
        return ExecutableInfo {
            found: false,
            path: None,
            version: None,
            message: "Enter a command to check".to_string(),
        };
    }

    let resolved_opt = resolve_executable_via_shell(program).await;
    let (found, resolved) = match resolved_opt {
        Some(path) => (true, path),
        None => {
            let fb = find_executable(program).await;
            let exists = std::path::Path::new(&fb).exists() || which::which(&fb).is_ok();
            if exists {
                (true, fb)
            } else {
                (false, program.to_string())
            }
        }
    };

    if !found {
        return ExecutableInfo {
            found: false,
            path: None,
            version: None,
            message: format!(
                "\"{}\" was not found on PATH or in common install locations. \
                 Check the spelling, install the runtime it belongs to, \
                 or enter the full path (e.g. /usr/local/bin/{}).",
                program, program
            ),
        };
    }

    let version = probe_version(&resolved).await;

    let message = match &version {
        Some(v) => format!(
            "{} found{} — {}",
            program,
            at_path_note(&resolved, program),
            v
        ),
        None => format!("{} found{}", program, at_path_note(&resolved, program)),
    };

    ExecutableInfo {
        found: true,
        path: Some(resolved),
        version,
        message,
    }
}

fn at_path_note(resolved: &str, program: &str) -> String {
    if resolved == program {
        String::new()
    } else {
        format!(" at {}", resolved)
    }
}

/// Runs `<program> --version` with a short timeout and returns the first line
/// of output trimmed. Returns `None` on any failure — it's only a hint.
async fn probe_version(resolved: &str) -> Option<String> {
    let mut cmd = create_shell_command(resolved, &["--version".to_string()]);
    let output = tokio::time::timeout(std::time::Duration::from_secs(4), cmd.output())
        .await
        .ok()?
        .ok()?;

    let text = if !output.stdout.is_empty() {
        String::from_utf8_lossy(&output.stdout).to_string()
    } else {
        String::from_utf8_lossy(&output.stderr).to_string()
    };

    text.lines()
        .next()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
}

/// Produces a user-friendly error string when spawning the MCP process fails.
/// Distinguishes "not found" (PATH/install issue) from permission errors so the
/// frontend can surface an actionable install hint.
fn friendly_spawn_error(program: &str, resolved: &str, err: &std::io::Error) -> String {
    match err.kind() {
        std::io::ErrorKind::NotFound => format!(
            "Could not start \"{}\": the executable was not found \
             (resolved to \"{}\"). Install the runtime it belongs to \
             (e.g. Node.js for npx, uv for uvx, Python for python) \
             or set the full path in the Command field.",
            program, resolved
        ),
        std::io::ErrorKind::PermissionDenied => format!(
            "Could not start \"{}\" at \"{}\": permission denied. \
             Check that the file is executable (chmod +x) or pick a different path.",
            program, resolved
        ),
        _ => format!("Could not start \"{}\" ({}): {}", program, resolved, err),
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
            let command_raw = config.command.as_deref().unwrap_or("").to_string();
            let program = resolve_executable_name(&command_raw)?;

            let extra_args = config.args.as_deref().unwrap_or(&[]);
            let resolved_args: Vec<String> = extra_args.iter().cloned().collect();

            let resolved_program = match resolve_executable_via_shell(&program).await {
                Some(path) => path,
                None => find_executable(&program).await,
            };

            let mut cmd = create_shell_command(&resolved_program, &resolved_args);
            cmd.stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::inherit());

            for (key, value) in &env_secrets {
                if is_env_key_allowed(key) {
                    cmd.env(key, value);
                } else {
                    log::warn!("Filtered out disallowed environment variable: {}", key);
                }
            }

            // Build the child process, translating NotFound/permission into a
            // friendly, actionable error before it becomes an opaque OS message.
            let transport = TokioChildProcess::new(cmd).map_err(|e| {
                // TokioChildProcess wraps the underlying io::Error in its own Display.
                // Pull the raw kind by attempting a downcast-style inspection via string.
                let raw_err = std::io::Error::other(e.to_string());
                let kind = io_error_kind_from_display(&e.to_string());
                let synthetic = match kind {
                    Some(k) => std::io::Error::new(k, e.to_string()),
                    None => raw_err,
                };
                friendly_spawn_error(&program, &resolved_program, &synthetic)
            })?;

            let mut running = client
                .serve_with_ct(transport, ct)
                .await
                .map_err(|e| format!("MCP handshake failed for '{}': {}", resolved_program, e))?;

            let tools_result = running
                .peer()
                .list_tools(Default::default())
                .await
                .map_err(|e| format!("Failed to list MCP tools: {}", e))?;

            let tools: Vec<McpToolInfo> = tools_result.tools.iter().map(convert_tool).collect();

            let (request_tx, mut request_rx) = tokio::sync::mpsc::channel::<McpServerRequest>(64);

            let peer = running.peer().clone();
            let task_cancel = cancel_token.clone();
            let server_id_clone = server_id.clone();

            tokio::spawn(async move {
                let mut timeout_sleep =
                    Box::pin(tokio::time::sleep(tokio::time::Duration::from_secs(300)));
                loop {
                    tokio::select! {
                        req = request_rx.recv() => {
                            match req {
                                Some(req) => {
                                    match req {
                                        McpServerRequest::CallTool { tool_name, arguments, reply_tx } => {
                                            timeout_sleep = Box::pin(tokio::time::sleep(tokio::time::Duration::from_secs(300)));
                                            let result = call_tool_via_peer(&peer, &tool_name, &arguments).await;
                                            let _ = reply_tx.send(result);
                                        }
                                        McpServerRequest::ListResources { reply_tx } => {
                                            timeout_sleep = Box::pin(tokio::time::sleep(tokio::time::Duration::from_secs(300)));
                                            let res = peer.list_resources(Default::default()).await;
                                            let mapped = res
                                                .map(|r| serde_json::to_value(r).unwrap_or(serde_json::Value::Null))
                                                .map_err(|e| e.to_string());
                                            let _ = reply_tx.send(mapped);
                                        }
                                        McpServerRequest::ListPrompts { reply_tx } => {
                                            timeout_sleep = Box::pin(tokio::time::sleep(tokio::time::Duration::from_secs(300)));
                                            let res = peer.list_prompts(Default::default()).await;
                                            let mapped = res
                                                .map(|r| serde_json::to_value(r).unwrap_or(serde_json::Value::Null))
                                                .map_err(|e| e.to_string());
                                            let _ = reply_tx.send(mapped);
                                        }
                                    }
                                }
                                None => break,
                            }
                        }
                        _ = &mut timeout_sleep => {
                            log::info!("MCP server '{}' idle timeout: terminating child process", server_id_clone);
                            if let Ok(mut manager) = MCP_SERVERS.lock() {
                                if let Some(handle) = manager.servers.get_mut(&server_id_clone) {
                                    handle.request_tx = None;
                                }
                            }
                            break;
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
                request_tx: Some(request_tx),
                config: config.clone(),
                env_secrets: env_secrets.clone(),
            };

            {
                let mut manager = MCP_SERVERS.lock().unwrap_or_else(|e| e.into_inner());
                manager.servers.insert(server_id, handle);
            }

            Ok(tools)
        }
        "sse" | "streamable-http" => {
            let base_url = config.baseUrl.as_deref().unwrap_or("").to_string();
            if base_url.is_empty() {
                return Err("Base URL is required for HTTP transport".to_string());
            }

            // Validate URL and restrict local networks unless allowLocalNetwork is true
            let parsed_url = url::Url::parse(&base_url)
                .map_err(|e| format!("Invalid base URL: {}", e))?;

            if let Some(host) = parsed_url.host_str() {
                let host_lower = host.to_lowercase();
                let is_loopback = host_lower == "localhost" || host_lower == "127.0.0.1" || host_lower == "::1";

                let is_private_ip = if let Some(ip) = parsed_url.host().and_then(|h| match h {
                    url::Host::Ipv4(v4) => Some(std::net::IpAddr::V4(v4)),
                    url::Host::Ipv6(v6) => Some(std::net::IpAddr::V6(v6)),
                    _ => None,
                }) {
                    match ip {
                        std::net::IpAddr::V4(v4) => {
                            let octets = v4.octets();
                            octets[0] == 10
                                || (octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31)
                                || (octets[0] == 192 && octets[1] == 168)
                                || (octets[0] == 169 && octets[1] == 254)
                        }
                        std::net::IpAddr::V6(v6) => {
                            let segments = v6.segments();
                            (segments[0] & 0xfe00) == 0xfc00
                                || (segments[0] & 0xffc0) == 0xfe80
                                || v6.is_loopback()
                        }
                    }
                } else {
                    false
                };

                if is_loopback || is_private_ip {
                    let allowed = config.allowLocalNetwork.unwrap_or(false);
                    if !allowed {
                        return Err(format!(
                            "Access denied: Local/private network access is disabled for MCP server '{}'.",
                            config.name
                        ));
                    }
                }
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

            let (request_tx, mut request_rx) = tokio::sync::mpsc::channel::<McpServerRequest>(64);

            let peer = running.peer().clone();
            let task_cancel = cancel_token.clone();

            tokio::spawn(async move {
                loop {
                    tokio::select! {
                        req = request_rx.recv() => {
                            match req {
                                Some(req) => {
                                    match req {
                                        McpServerRequest::CallTool { tool_name, arguments, reply_tx } => {
                                            let result = call_tool_via_peer(&peer, &tool_name, &arguments).await;
                                            let _ = reply_tx.send(result);
                                        }
                                        McpServerRequest::ListResources { reply_tx } => {
                                            let res = peer.list_resources(Default::default()).await;
                                            let mapped = res
                                                .map(|r| serde_json::to_value(r).unwrap_or(serde_json::Value::Null))
                                                .map_err(|e| e.to_string());
                                            let _ = reply_tx.send(mapped);
                                        }
                                        McpServerRequest::ListPrompts { reply_tx } => {
                                            let res = peer.list_prompts(Default::default()).await;
                                            let mapped = res
                                                .map(|r| serde_json::to_value(r).unwrap_or(serde_json::Value::Null))
                                                .map_err(|e| e.to_string());
                                            let _ = reply_tx.send(mapped);
                                        }
                                    }
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
                request_tx: Some(request_tx),
                config: config.clone(),
                env_secrets: env_secrets.clone(),
            };

            {
                let mut manager = MCP_SERVERS.lock().unwrap_or_else(|e| e.into_inner());
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
            let mut text_parts: Vec<String> = Vec::new();
            let mut images: Vec<crate::mcp::McpImageContent> = Vec::new();

            for c in result.content {
                match c {
                    rmcp::model::ContentBlock::Text(text_content) => {
                        text_parts.push(text_content.text.to_string());
                    }
                    rmcp::model::ContentBlock::Image(img_content) => {
                        images.push(crate::mcp::McpImageContent {
                            mime_type: img_content.mime_type.clone(),
                            data: img_content.data.clone(),
                        });
                    }
                    rmcp::model::ContentBlock::Audio(audio_content) => {
                        text_parts.push(format!("[Audio: {}]", audio_content.mime_type));
                    }
                    rmcp::model::ContentBlock::Resource(resource_content) => {
                        text_parts.push(format!("[Resource: {:?}]", resource_content.resource));
                    }
                    _ => {
                        text_parts.push("[Unknown content]".to_string());
                    }
                }
            }

            Ok(McpToolResult {
                content: text_parts.join("\n"),
                is_error: result.is_error.unwrap_or(false),
                images,
            })
        }
        Err(e) => Ok(McpToolResult {
            content: format!("MCP tool call error: {}", e),
            is_error: true,
            images: vec![],
        }),
    }
}

pub async fn call_tool_on_server(
    server_id: &str,
    tool_name: &str,
    arguments: &serde_json::Value,
) -> Result<McpToolResult, String> {
    let mut needs_respawn = false;
    let mut saved_config = None;
    let mut saved_env_secrets = None;

    {
        let manager = MCP_SERVERS.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(h) = manager.servers.get(server_id) {
            if h.request_tx.is_none() {
                needs_respawn = true;
                saved_config = Some(h.config.clone());
                saved_env_secrets = Some(h.env_secrets.clone());
            }
        }
    }

    if needs_respawn {
        if let (Some(config), Some(env_secrets)) = (saved_config, saved_env_secrets) {
            log::info!("Transparently re-spawning idle MCP server '{}'", server_id);
            connect_server(&config, env_secrets).await?;
        }
    }

    let request_tx = {
        let manager = MCP_SERVERS.lock().unwrap_or_else(|e| e.into_inner());
        manager
            .servers
            .get(server_id)
            .and_then(|h| h.request_tx.clone())
            .ok_or_else(|| format!("MCP server '{}' not found or not connected", server_id))?
    };

    let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();

    request_tx
        .send(McpServerRequest::CallTool {
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
    let mut manager = MCP_SERVERS.lock().unwrap_or_else(|e| e.into_inner());
    manager.remove_server(server_id);
    Ok(())
}

/// Best-effort classification of a `TokioChildProcess` error string into an
/// `io::ErrorKind`, so [`friendly_spawn_error`] can pick the right message.
/// Tokio surfaces the OS error verbatim in the Display, so we sniff keywords.
fn io_error_kind_from_display(msg: &str) -> Option<std::io::ErrorKind> {
    let lower = msg.to_ascii_lowercase();
    if lower.contains("no such file or directory")
        || lower.contains("not found")
        || lower.contains("cannot find")
        || lower.contains("program not found")
    {
        Some(std::io::ErrorKind::NotFound)
    } else if lower.contains("permission denied") || lower.contains("not executable") {
        Some(std::io::ErrorKind::PermissionDenied)
    } else {
        None
    }
}

pub async fn list_resources_on_server(server_id: &str) -> Result<serde_json::Value, String> {
    let mut needs_respawn = false;
    let mut saved_config = None;
    let mut saved_env_secrets = None;

    {
        let manager = MCP_SERVERS.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(h) = manager.servers.get(server_id) {
            if h.request_tx.is_none() {
                needs_respawn = true;
                saved_config = Some(h.config.clone());
                saved_env_secrets = Some(h.env_secrets.clone());
            }
        }
    }

    if needs_respawn {
        if let (Some(config), Some(env_secrets)) = (saved_config, saved_env_secrets) {
            log::info!("Transparently re-spawning idle MCP server '{}'", server_id);
            connect_server(&config, env_secrets).await?;
        }
    }

    let request_tx = {
        let manager = MCP_SERVERS.lock().unwrap_or_else(|e| e.into_inner());
        manager
            .servers
            .get(server_id)
            .and_then(|h| h.request_tx.clone())
            .ok_or_else(|| format!("MCP server '{}' not found or not connected", server_id))?
    };

    let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();

    request_tx
        .send(McpServerRequest::ListResources { reply_tx })
        .await
        .map_err(|e| format!("Failed to send list resources request: {}", e))?;

    reply_rx
        .await
        .map_err(|e| format!("Request cancelled: {}", e))?
}

pub async fn list_prompts_on_server(server_id: &str) -> Result<serde_json::Value, String> {
    let mut needs_respawn = false;
    let mut saved_config = None;
    let mut saved_env_secrets = None;

    {
        let manager = MCP_SERVERS.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(h) = manager.servers.get(server_id) {
            if h.request_tx.is_none() {
                needs_respawn = true;
                saved_config = Some(h.config.clone());
                saved_env_secrets = Some(h.env_secrets.clone());
            }
        }
    }

    if needs_respawn {
        if let (Some(config), Some(env_secrets)) = (saved_config, saved_env_secrets) {
            log::info!("Transparently re-spawning idle MCP server '{}'", server_id);
            connect_server(&config, env_secrets).await?;
        }
    }

    let request_tx = {
        let manager = MCP_SERVERS.lock().unwrap_or_else(|e| e.into_inner());
        manager
            .servers
            .get(server_id)
            .and_then(|h| h.request_tx.clone())
            .ok_or_else(|| format!("MCP server '{}' not found or not connected", server_id))?
    };

    let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();

    request_tx
        .send(McpServerRequest::ListPrompts { reply_tx })
        .await
        .map_err(|e| format!("Failed to send list prompts request: {}", e))?;

    reply_rx
        .await
        .map_err(|e| format!("Request cancelled: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_executable_name_trims_whitespace() {
        assert_eq!(resolve_executable_name("  npx  ").unwrap(), "npx");
        assert_eq!(resolve_executable_name("npx").unwrap(), "npx");
        assert_eq!(
            resolve_executable_name("/usr/local/bin/node").unwrap(),
            "/usr/local/bin/node"
        );
    }

    #[test]
    fn resolve_executable_name_rejects_empty() {
        assert!(resolve_executable_name("").is_err());
        assert!(resolve_executable_name("   ").is_err());
        assert!(resolve_executable_name("\t\n").is_err());
    }

    #[test]
    fn resolve_executable_name_keeps_full_command_unchanged() {
        // Legacy behaviour split a full command line; the new contract is
        // program-only, so a value that happens to contain spaces is kept as-is
        // (the frontend migration guarantees single-token input).
        assert_eq!(
            resolve_executable_name("some/path with space").unwrap(),
            "some/path with space"
        );
    }

    #[test]
    fn io_error_kind_classifies_messages() {
        assert_eq!(
            io_error_kind_from_display("No such file or directory (os error 2)"),
            Some(std::io::ErrorKind::NotFound)
        );
        assert_eq!(
            io_error_kind_from_display("Permission denied (os error 13)"),
            Some(std::io::ErrorKind::PermissionDenied)
        );
        assert_eq!(io_error_kind_from_display("something else"), None);
    }

    #[test]
    fn friendly_spawn_error_not_found_mentions_install() {
        let msg = friendly_spawn_error(
            "npx",
            "/usr/bin/npx",
            &std::io::Error::new(std::io::ErrorKind::NotFound, "missing"),
        );
        assert!(msg.contains("not found"));
        assert!(msg.contains("Install"));
    }

    #[test]
    fn test_create_shell_command() {
        let cmd = create_shell_command("echo", &["hello".to_string(), "world".to_string()]);

        assert_eq!(cmd.as_std().get_program().to_string_lossy(), "echo");
        let args: Vec<_> = cmd
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        assert_eq!(args, vec!["hello", "world"]);
    }

    #[tokio::test]
    async fn test_resolve_executable_via_shell() {
        let git_path = resolve_executable_via_shell("git").await;
        assert!(git_path.is_some());
        let path = git_path.unwrap();
        assert!(path.contains("git") || std::path::Path::new(&path).exists());

        let fake = resolve_executable_via_shell("non_existent_command_12345").await;
        assert!(fake.is_none());
    }
}
