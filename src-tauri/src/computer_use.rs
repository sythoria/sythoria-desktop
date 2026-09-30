//! Fixed, bounded preflight for the bundled Open Computer Use integration.
use crate::mcp::{client, McpServerConfig};
use serde::Serialize;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

pub const PACKAGE: &str = "open-computer-use@0.3.6";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupCheck {
    label: String,
    passed: bool,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupReport {
    platform: String,
    pub ready: bool,
    checks: Vec<SetupCheck>,
}

impl SetupReport {
    fn check(&mut self, label: &str, result: Result<String, String>) -> bool {
        let passed = result.is_ok();
        self.checks.push(SetupCheck {
            label: label.into(),
            passed,
            message: result.unwrap_or_else(|message| message),
        });
        passed
    }

    pub fn failure_message(&self) -> String {
        self.checks
            .iter()
            .find(|check| !check.passed)
            .map(|check| check.message.clone())
            .unwrap_or_else(|| "Complete Computer Use setup in Plugins & Apps first.".into())
    }
}

pub fn is_catalog_config(config: &McpServerConfig) -> bool {
    config.transport == "stdio"
        && config.command.as_deref() == Some("npx")
        && config
            .args
            .as_deref()
            .is_some_and(|args| args == ["-y", PACKAGE, "mcp"])
}

pub fn prepare_tool_surface(tools: &mut [crate::mcp::McpToolInfo]) -> Result<(), String> {
    let required = [
        "list_apps",
        "get_app_state",
        "click",
        "perform_secondary_action",
        "scroll",
        "drag",
        "type_text",
        "press_key",
        "set_value",
    ];
    if required
        .iter()
        .any(|name| !tools.iter().any(|tool| tool.name == *name))
    {
        return Err(
            "Computer Use did not load its required desktop tools. Retry setup in Plugins & Apps."
                .into(),
        );
    }
    for tool in tools {
        if tool.name == "list_apps" {
            tool.description.push_str(" Begin desktop tasks by listing apps, then read the target app with get_app_state before taking actions. This controls the user's real desktop; use only apps relevant to the requested task.");
        } else if tool.name == "get_app_state" {
            tool.description.push_str(" Read fresh state before using element_index. Use indices from the latest state in this connection, prefer element-targeted actions, and read state again after significant UI changes; never guess indices. Screenshots and coordinates can be limited on Linux Wayland or protected Windows surfaces.");
        }
    }
    Ok(())
}

/// Desktop sockets are inherited only by this exact bundled integration, never
/// by arbitrary MCP commands. Keep checks and the actual server in the same session.
pub fn apply_desktop_environment(cmd: &mut Command) {
    #[cfg(target_os = "linux")]
    for key in [
        "DISPLAY",
        "WAYLAND_DISPLAY",
        "XDG_RUNTIME_DIR",
        "DBUS_SESSION_BUS_ADDRESS",
        "XAUTHORITY",
        "XDG_SESSION_TYPE",
        "XDG_CURRENT_DESKTOP",
    ] {
        if let Some(value) = std::env::var_os(key) {
            cmd.env(key, value);
        }
    }
    #[cfg(not(target_os = "linux"))]
    let _ = cmd;
}

async fn run(program: &str, args: &[&str], seconds: u64) -> Result<String, String> {
    let executable = client::check_executable(program).await;
    let path = executable
        .path
        .ok_or_else(|| format!("Install {program}, then reopen Sythoria and check again."))?;
    let args: Vec<String> = args.iter().map(|arg| (*arg).into()).collect();
    let mut cmd = client::create_shell_command(&path, &args);
    apply_desktop_environment(&mut cmd);
    cmd.kill_on_drop(true)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd
        .spawn()
        .map_err(|_| format!("Could not start {program}. Reinstall it and check again."))?;
    let stdout = child.stdout.take().ok_or("Unable to read setup output")?;
    let stderr = child.stderr.take().ok_or("Unable to read setup errors")?;
    let result = tokio::time::timeout(Duration::from_secs(seconds), async {
        let read = async |stream: Box<dyn tokio::io::AsyncRead + Unpin + Send>| {
            let mut bytes = Vec::new();
            stream.take(65_537).read_to_end(&mut bytes).await?;
            if bytes.len() > 65_536 {
                return Err(std::io::Error::other("Setup output exceeded its limit"));
            }
            Ok::<_, std::io::Error>(bytes)
        };
        let (out, err, status) =
            tokio::try_join!(read(Box::new(stdout)), read(Box::new(stderr)), child.wait())?;
        if !status.success() {
            // Diagnostics stay in native logs; the setup surface gets actionable text.
            log::warn!(
                "Computer Use setup command failed: {}",
                String::from_utf8_lossy(&err)
            );
            return Err(std::io::Error::other("Setup command failed"));
        }
        Ok(String::from_utf8_lossy(&out).trim().to_string())
    })
    .await;
    match result {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(_)) => Err(format!("{program} could not complete setup. Check your internet connection and the requirements below, then retry.")),
        Err(_) => Err("Setup timed out. Check your internet connection, finish any permission prompts, then retry.".into()),
    }
}

fn version_at_least(version: &str, minimum: u32) -> bool {
    version
        .trim()
        .trim_start_matches('v')
        .split('.')
        .next()
        .and_then(|major| major.parse::<u32>().ok())
        .is_some_and(|major| major >= minimum)
}

fn native_runtime_ready(output: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(output)
        .ok()
        .is_some_and(|value| {
            value
                .pointer("/runtime/node/available")
                .and_then(|v| v.as_bool())
                == Some(true)
                && value
                    .pointer("/runtime/native/supported")
                    .and_then(|v| v.as_bool())
                    == Some(true)
                && value
                    .pointer("/capabilities/nativeMcp/available")
                    .and_then(|v| v.as_bool())
                    == Some(true)
        })
}

fn mac_permissions_ready(output: &str) -> bool {
    output
        .lines()
        .any(|line| line.trim() == "Permissions: accessibility=granted, screenRecording=granted")
}

pub async fn check_setup(prepare: bool) -> SetupReport {
    let mut report = SetupReport {
        platform: std::env::consts::OS.into(),
        ready: false,
        checks: Vec::new(),
    };
    let supported = matches!(std::env::consts::OS, "macos" | "linux" | "windows")
        && matches!(std::env::consts::ARCH, "x86_64" | "aarch64");
    if !report.check(
        "Supported computer",
        if supported {
            Ok("Supported operating system and architecture.".into())
        } else {
            Err(
                "Computer Use supports macOS, Windows, and Linux on Intel/AMD 64-bit or ARM64."
                    .into(),
            )
        },
    ) {
        return report;
    }
    #[cfg(target_os = "macos")]
    {
        let result = run("sw_vers", &["-productVersion"], 5).await.and_then(|version| {
            if version_at_least(&version, 14) { Ok(format!("macOS {version}")) }
            else { Err("Update to macOS 14 or later before installing Computer Use. Permission changes cannot fix an unsupported macOS version.".into()) }
        });
        if !report.check("macOS version", result) {
            return report;
        }
    }
    let node = client::check_executable("node").await;
    let node_ready = node.found
        && node
            .version
            .as_deref()
            .is_some_and(|v| version_at_least(v, 18));
    let node_result = if node_ready {
        Ok(format!("Node.js {}", node.version.unwrap_or_default()))
    } else {
        Err(
            "Install Node.js 18 or later (LTS recommended), then reopen Sythoria and check again."
                .into(),
        )
    };
    if !report.check("Node.js 18+", node_result) {
        return report;
    }
    let npx = client::check_executable("npx").await;
    if !report.check(
        "npm launcher",
        if npx.found {
            Ok("npm / npx is available.".into())
        } else {
            Err("Install Node.js with npm included, then reopen Sythoria.".into())
        },
    ) {
        return report;
    }
    #[cfg(target_os = "linux")]
    {
        let desktop = std::env::var_os("XDG_RUNTIME_DIR").is_some()
            && std::env::var_os("DBUS_SESSION_BUS_ADDRESS").is_some()
            && (std::env::var_os("DISPLAY").is_some()
                || std::env::var_os("WAYLAND_DISPLAY").is_some());
        if !report.check("Desktop session", if desktop { Ok("Signed-in graphical desktop session is available.".into()) } else { Err("Open Sythoria from your signed-in desktop, with D-Bus and XDG_RUNTIME_DIR available. Headless and SSH sessions are unsupported by this setup.".into()) }) { return report; }
        let result = run("python3", &["-c", "import gi; gi.require_version('Atspi', '2.0'); gi.require_version('Gdk', '3.0'); from gi.repository import Atspi, Gdk; assert Atspi.get_desktop(0) is not None; print('Python accessibility and screenshot libraries are available.')"], 15).await
            .map_err(|_| "Install Python 3, PyGObject, AT-SPI2, and GTK 3 introspection. On Ubuntu/Debian: sudo apt install python3-gi gir1.2-atspi-2.0 gir1.2-gtk-3.0 at-spi2-core. Enable desktop accessibility and check again.".into());
        if !report.check("Linux accessibility", result) {
            return report;
        }
    }
    #[cfg(target_os = "windows")]
    {
        let result = run("powershell.exe", &["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; Add-Type -AssemblyName UIAutomationClient; Add-Type -AssemblyName UIAutomationTypes; Add-Type -AssemblyName System.Drawing; if (-not [Environment]::UserInteractive -or [System.Diagnostics.Process]::GetCurrentProcess().SessionId -eq 0 -or $null -eq [System.Windows.Automation.AutomationElement]::RootElement) { exit 1 }; Write-Output 'Windows desktop automation is available.'"], 15).await
            .map_err(|_| "Use a signed-in Windows desktop with Windows PowerShell and UI Automation available. Service sessions cannot control your desktop.".into());
        if !report.check("Windows desktop automation", result) {
            return report;
        }
    }
    if !prepare {
        return report;
    }
    let runtime = run("npx", &["-y", PACKAGE, "capabilities", "--json"], 120).await.and_then(|output| {
        if native_runtime_ready(&output) { Ok("Open Computer Use 0.3.6 is installed and its native runtime is available.".into()) }
        else { Err("The Computer Use package is incomplete or unsupported. Clear the npm cache for this package and retry setup.".into()) }
    });
    if !report.check("Computer Use runtime", runtime) {
        return report;
    }
    #[cfg(target_os = "macos")]
    {
        let permissions = run("npx", &["-y", PACKAGE, "doctor"], 45).await.and_then(|output| {
            if mac_permissions_ready(&output) { Ok("Accessibility and Screen Recording are enabled for Open Computer Use.".into()) }
            else { Err("Allow Open Computer Use in System Settings → Privacy & Security → Accessibility and Screen Recording. Finish its setup window, then check again. If macOS requests it, quit and reopen Open Computer Use.".into()) }
        });
        if !report.check("macOS permissions", permissions) {
            return report;
        }
    }
    report.ready = true;
    report
}

#[tauri::command]
pub async fn computer_use_check_setup(prepare: bool) -> Result<SetupReport, crate::AppError> {
    if prepare {
        crate::ensure_online()?;
    }
    Ok(check_setup(prepare).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_unknown_versions_and_incomplete_diagnostics() {
        assert!(version_at_least("v18.0.0", 18));
        assert!(version_at_least("14.7.1", 14));
        assert!(!version_at_least("v17.9.1", 18));
        assert!(!version_at_least("unknown", 18));
        assert!(!native_runtime_ready("{}"));
        assert!(!native_runtime_ready("npm warning"));
        assert!(native_runtime_ready(
            r#"{"runtime":{"node":{"available":true},"native":{"supported":true}},"capabilities":{"nativeMcp":{"available":true}}}"#
        ));
        assert!(!native_runtime_ready(
            r#"{"runtime":{"node":{"available":true},"native":{"supported":false}},"capabilities":{"nativeMcp":{"available":true}}}"#
        ));
    }
    #[test]
    fn desktop_environment_is_limited_to_the_exact_pinned_launcher() {
        let mut config = McpServerConfig {
            id: "desktop".into(),
            name: "Computer Use".into(),
            transport: "stdio".into(),
            command: Some("npx".into()),
            args: Some(vec!["-y".into(), PACKAGE.into(), "mcp".into()]),
            baseUrl: None,
            apiKey: None,
            enabled: true,
            trustLevel: None,
        };
        assert!(is_catalog_config(&config));
        config.args.as_mut().unwrap()[1] = "open-computer-use@latest".into();
        assert!(!is_catalog_config(&config));
        config.args.as_mut().unwrap()[1] = PACKAGE.into();
        config.args.as_mut().unwrap().push("--unknown".into());
        assert!(!is_catalog_config(&config));
    }

    #[test]
    fn incomplete_tool_surface_cannot_be_connected() {
        let mut tools: Vec<crate::mcp::McpToolInfo> = [
            "list_apps",
            "get_app_state",
            "click",
            "perform_secondary_action",
            "scroll",
            "drag",
            "type_text",
            "press_key",
            "set_value",
        ]
        .into_iter()
        .map(|name| crate::mcp::McpToolInfo {
            name: name.into(),
            description: "Desktop tool".into(),
            inputSchema: serde_json::json!({}),
            readOnlyHint: None,
        })
        .collect();
        assert!(prepare_tool_surface(&mut tools).is_ok());
        tools.pop();
        assert!(prepare_tool_surface(&mut tools).is_err());
    }

    #[test]
    fn doctor_success_does_not_imply_permissions_granted() {
        assert!(mac_permissions_ready(
            "Permissions: accessibility=granted, screenRecording=granted\n"
        ));
        assert!(!mac_permissions_ready(
            "Permissions: accessibility=granted, screenRecording=missing"
        ));
        assert!(!mac_permissions_ready(""));
    }
}
