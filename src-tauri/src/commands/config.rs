use crate::get_blocked_hosts;
use crate::AppError;
use crate::NetworkConfig;
use crate::NETWORK_CONFIG;
use serde::Deserialize;
use std::fs;
use std::io::Write;
use tauri::Manager;

pub const STORE_FILE: &str = "sythoria-store.json";
pub const KEYCHAIN_SERVICE: &str = "com.sythoria.sythoria-desktop";
pub const API_KEY_INDEX: &str = "sythoria-api-key-index";
pub const SEARCH_API_KEY_INDEX: &str = "sythoria-search-api-key-index";
pub const MCP_ENV_KEY_INDEX: &str = "sythoria-mcp-env-key-index";
pub const MCP_API_KEY_INDEX: &str = "sythoria-mcp-api-key-index";

// --- Keyring Utilities ---

pub fn keychain_account(namespace: &str, id: &str) -> String {
    format!("{}:{}", namespace, id)
}

pub fn load_secret_index(app: &tauri::AppHandle, index_key: &str) -> Result<Vec<String>, AppError> {
    let store = tauri_plugin_store::StoreExt::store(app, STORE_FILE)
        .map_err(|e| AppError::ConfigIo(format!("Failed to open store: {}", e)))?;

    let index: Option<serde_json::Value> = store.get(index_key);
    Ok(index
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|v| v.as_str().map(ToString::to_string))
        .collect())
}

pub fn save_secret_index(
    app: &tauri::AppHandle,
    index_key: &str,
    ids: &[String],
) -> Result<(), AppError> {
    let store = tauri_plugin_store::StoreExt::store(app, STORE_FILE)
        .map_err(|e| AppError::ConfigIo(format!("Failed to open store: {}", e)))?;

    store.set(index_key, serde_json::json!(ids));
    Ok(())
}

pub fn set_keychain_secret(namespace: &str, id: &str, secret: &str) -> Result<(), AppError> {
    let entry = keyring_core::Entry::new(KEYCHAIN_SERVICE, &keychain_account(namespace, id))
        .map_err(|e| AppError::ConfigIo(format!("Failed to access keychain: {}", e)))?;
    entry
        .set_password(secret)
        .map_err(|e| AppError::ConfigIo(format!("Failed to save secret: {}", e)))
}

pub fn get_keychain_secret(namespace: &str, id: &str) -> Result<String, AppError> {
    let entry = keyring_core::Entry::new(KEYCHAIN_SERVICE, &keychain_account(namespace, id))
        .map_err(|e| AppError::ConfigIo(format!("Failed to access keychain: {}", e)))?;
    entry.get_password().map_err(|e| match e {
        keyring_core::Error::NoEntry => AppError::KeyNotFound(format!("No key found for '{}'", id)),
        _ => AppError::ConfigIo(format!("Failed to load secret: {}", e)),
    })
}

pub fn delete_keychain_secret(namespace: &str, id: &str) -> Result<(), AppError> {
    let entry = keyring_core::Entry::new(KEYCHAIN_SERVICE, &keychain_account(namespace, id))
        .map_err(|e| AppError::ConfigIo(format!("Failed to access keychain: {}", e)))?;
    entry.delete_credential().or_else(|e| match e {
        keyring_core::Error::NoEntry => Ok(()),
        _ => Err(AppError::ConfigIo(format!(
            "Failed to delete secret: {}",
            e
        ))),
    })
}

pub async fn load_secret_map(
    app: &tauri::AppHandle,
    namespace: &str,
    index_key: &str,
) -> Result<serde_json::Value, AppError> {
    let ids = load_secret_index(app, index_key)?;
    let mut keys = serde_json::Map::new();

    for id in ids {
        match get_keychain_secret(namespace, &id) {
            Ok(secret) if !secret.is_empty() => {
                keys.insert(id, serde_json::Value::String(secret));
            }
            Ok(_) | Err(AppError::KeyNotFound(_)) => {}
            Err(err) => return Err(err),
        }
    }

    Ok(serde_json::Value::Object(keys))
}

pub async fn save_secret_map(
    app: &tauri::AppHandle,
    namespace: &str,
    index_key: &str,
    keys: &serde_json::Value,
) -> Result<(), AppError> {
    let existing_ids = load_secret_index(app, index_key)?;
    let key_map = keys
        .as_object()
        .ok_or_else(|| AppError::ParseError("API keys payload must be an object".to_string()))?;

    for id in existing_ids {
        if !key_map.contains_key(&id) {
            delete_keychain_secret(namespace, &id)?;
        }
    }

    let mut ids = Vec::new();
    for (id, value) in key_map {
        let secret = value.as_str().unwrap_or_default();
        if secret.is_empty() {
            delete_keychain_secret(namespace, id)?;
            continue;
        }
        set_keychain_secret(namespace, id, secret)?;
        ids.push(id.clone());
    }

    save_secret_index(app, index_key, &ids)
}

// --- Commands ---

#[tauri::command]
pub async fn load_config(app: tauri::AppHandle) -> Result<String, AppError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::AppPath(e.to_string()))?;
    let config_path = app_data_dir.join("config.json");
    if config_path.exists() {
        fs::read_to_string(config_path).map_err(|e| AppError::ConfigIo(e.to_string()))
    } else {
        Ok("".to_string())
    }
}

#[tauri::command]
pub async fn save_config(app: tauri::AppHandle, config: String) -> Result<(), AppError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::AppPath(e.to_string()))?;
    fs::create_dir_all(&app_data_dir).map_err(|e| AppError::ConfigIo(e.to_string()))?;
    let config_path = app_data_dir.join("config.json");
    let mut file = fs::File::create(config_path).map_err(|e| AppError::ConfigIo(e.to_string()))?;
    file.write_all(config.as_bytes())
        .map_err(|e| AppError::ConfigIo(e.to_string()))?;
    Ok(())
}

pub fn load_network_config_internal(app: &tauri::AppHandle) -> Result<NetworkConfig, AppError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::AppPath(e.to_string()))?;
    let config_path = app_data_dir.join("network_config.json");
    if config_path.exists() {
        let content =
            fs::read_to_string(config_path).map_err(|e| AppError::ConfigIo(e.to_string()))?;
        let config: NetworkConfig =
            serde_json::from_str(&content).map_err(|e| AppError::ParseError(e.to_string()))?;
        Ok(config)
    } else {
        Ok(NetworkConfig::default())
    }
}

#[tauri::command]
pub async fn load_network_config(app: tauri::AppHandle) -> Result<String, AppError> {
    let config = load_network_config_internal(&app)?;
    serde_json::to_string(&config).map_err(|e| AppError::ParseError(e.to_string()))
}

#[tauri::command]
pub async fn save_network_config(app: tauri::AppHandle, config: String) -> Result<(), AppError> {
    let config_struct: NetworkConfig =
        serde_json::from_str(&config).map_err(|e| AppError::ParseError(e.to_string()))?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::AppPath(e.to_string()))?;
    fs::create_dir_all(&app_data_dir).map_err(|e| AppError::ConfigIo(e.to_string()))?;
    let config_path = app_data_dir.join("network_config.json");
    let mut file = fs::File::create(config_path).map_err(|e| AppError::ConfigIo(e.to_string()))?;
    file.write_all(config.as_bytes())
        .map_err(|e| AppError::ConfigIo(e.to_string()))?;

    if let Ok(mut lock) = NETWORK_CONFIG.write() {
        *lock = config_struct;
    }
    Ok(())
}

#[tauri::command]
pub async fn load_search_config(app: tauri::AppHandle) -> Result<String, AppError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::AppPath(e.to_string()))?;
    let config_path = app_data_dir.join("search_config.json");
    if config_path.exists() {
        fs::read_to_string(config_path).map_err(|e| AppError::ConfigIo(e.to_string()))
    } else {
        Ok("".to_string())
    }
}

#[tauri::command]
pub async fn save_search_config(app: tauri::AppHandle, config: String) -> Result<(), AppError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::AppPath(e.to_string()))?;
    fs::create_dir_all(&app_data_dir).map_err(|e| AppError::ConfigIo(e.to_string()))?;
    let config_path = app_data_dir.join("search_config.json");
    let mut file = fs::File::create(config_path).map_err(|e| AppError::ConfigIo(e.to_string()))?;
    file.write_all(config.as_bytes())
        .map_err(|e| AppError::ConfigIo(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn load_api_keys(app: tauri::AppHandle) -> Result<serde_json::Value, AppError> {
    load_secret_map(&app, "model", API_KEY_INDEX).await
}

#[tauri::command]
pub async fn save_api_keys_cmd(
    app: tauri::AppHandle,
    keys: serde_json::Value,
) -> Result<(), AppError> {
    save_secret_map(&app, "model", API_KEY_INDEX, &keys).await
}

#[tauri::command]
pub async fn load_search_api_keys(app: tauri::AppHandle) -> Result<serde_json::Value, AppError> {
    load_secret_map(&app, "search", SEARCH_API_KEY_INDEX).await
}

#[tauri::command]
pub async fn save_search_api_keys_cmd(
    app: tauri::AppHandle,
    keys: serde_json::Value,
) -> Result<(), AppError> {
    save_secret_map(&app, "search", SEARCH_API_KEY_INDEX, &keys).await
}

#[tauri::command]
pub async fn load_mcp_api_keys(app: tauri::AppHandle) -> Result<serde_json::Value, AppError> {
    load_secret_map(&app, "mcp", MCP_API_KEY_INDEX).await
}

#[tauri::command]
pub async fn save_mcp_api_keys_cmd(
    app: tauri::AppHandle,
    keys: serde_json::Value,
) -> Result<(), AppError> {
    save_secret_map(&app, "mcp", MCP_API_KEY_INDEX, &keys).await
}

#[tauri::command]
pub async fn load_mcp_env_secrets(app: tauri::AppHandle) -> Result<serde_json::Value, AppError> {
    let index = load_secret_index(&app, MCP_ENV_KEY_INDEX)?;
    let mut result = serde_json::Map::new();

    for server_id in index {
        let server_keys = {
            let server_index_key = format!("mcp-env:{}", server_id);
            let store = tauri_plugin_store::StoreExt::store(&app, STORE_FILE)
                .map_err(|e| AppError::ConfigIo(format!("Failed to open store: {}", e)))?;
            let env_index: Option<serde_json::Value> = store.get(&server_index_key);
            env_index
                .and_then(|v| v.as_array().cloned())
                .unwrap_or_default()
                .into_iter()
                .filter_map(|v| v.as_str().map(ToString::to_string))
                .collect::<Vec<_>>()
        };

        let mut server_map = serde_json::Map::new();
        for env_key in server_keys {
            match get_keychain_secret("mcp-env", &format!("{}:{}", server_id, env_key)) {
                Ok(secret) if !secret.is_empty() => {
                    server_map.insert(env_key, serde_json::Value::String(secret));
                }
                Ok(_) | Err(AppError::KeyNotFound(_)) => {}
                Err(err) => return Err(err),
            }
        }

        if !server_map.is_empty() {
            result.insert(server_id, serde_json::Value::Object(server_map));
        }
    }

    Ok(serde_json::Value::Object(result))
}

#[tauri::command]
pub async fn save_mcp_env_secrets_cmd(
    app: tauri::AppHandle,
    secrets: serde_json::Value,
) -> Result<(), AppError> {
    let secrets_map = secrets.as_object().ok_or_else(|| {
        AppError::ParseError("MCP env secrets payload must be an object".to_string())
    })?;

    let existing_server_ids = load_secret_index(&app, MCP_ENV_KEY_INDEX)?;

    for server_id in &existing_server_ids {
        if !secrets_map.contains_key(server_id) {
            let server_index_key = format!("mcp-env:{}", server_id);
            let store = tauri_plugin_store::StoreExt::store(&app, STORE_FILE)
                .map_err(|e| AppError::ConfigIo(format!("Failed to open store: {}", e)))?;
            if let Some(env_index) = store.get(&server_index_key) {
                if let Some(arr) = env_index.as_array() {
                    for key in arr.iter().filter_map(|v| v.as_str()) {
                        let _ =
                            delete_keychain_secret("mcp-env", &format!("{}:{}", server_id, key));
                    }
                }
            }
            let _ = store.delete(&server_index_key);
        }
    }

    let mut server_ids = Vec::new();
    for (server_id, server_value) in secrets_map {
        let env_map = server_value
            .as_object()
            .ok_or_else(|| AppError::ParseError("Server env must be an object".to_string()))?;

        let server_index_key = format!("mcp-env:{}", server_id);
        let mut env_keys = Vec::new();

        for (env_key, env_value) in env_map {
            let secret = env_value.as_str().unwrap_or_default();
            if secret.is_empty() {
                let _ = delete_keychain_secret("mcp-env", &format!("{}:{}", server_id, env_key));
                continue;
            }
            set_keychain_secret("mcp-env", &format!("{}:{}", server_id, env_key), secret)?;
            env_keys.push(env_key.clone());
        }

        let store = tauri_plugin_store::StoreExt::store(&app, STORE_FILE)
            .map_err(|e| AppError::ConfigIo(format!("Failed to open store: {}", e)))?;
        store.set(&server_index_key, serde_json::json!(env_keys));

        if !env_keys.is_empty() {
            server_ids.push(server_id.clone());
        }
    }

    save_secret_index(&app, MCP_ENV_KEY_INDEX, &server_ids)
}

#[tauri::command]
pub async fn wipe_config_files(app: tauri::AppHandle) -> Result<(), AppError> {
    // 1. Delete model keys from OS Keychain
    if let Ok(ids) = load_secret_index(&app, API_KEY_INDEX) {
        for id in ids {
            let _ = delete_keychain_secret("model", &id);
        }
    }

    // 2. Delete search keys from OS Keychain
    if let Ok(ids) = load_secret_index(&app, SEARCH_API_KEY_INDEX) {
        for id in ids {
            let _ = delete_keychain_secret("search", &id);
        }
    }

    // 3. Delete MCP API keys from OS Keychain
    if let Ok(ids) = load_secret_index(&app, MCP_API_KEY_INDEX) {
        for id in ids {
            let _ = delete_keychain_secret("mcp", &id);
        }
    }

    // 4. Delete MCP env secrets from OS Keychain
    if let Ok(server_ids) = load_secret_index(&app, MCP_ENV_KEY_INDEX) {
        if let Ok(store) = tauri_plugin_store::StoreExt::store(&app, STORE_FILE) {
            for server_id in server_ids {
                let server_index_key = format!("mcp-env:{}", server_id);
                if let Some(env_index) = store.get(&server_index_key) {
                    if let Some(arr) = env_index.as_array() {
                        for key in arr.iter().filter_map(|v| v.as_str()) {
                            let _ = delete_keychain_secret(
                                "mcp-env",
                                &format!("{}:{}", server_id, key),
                            );
                        }
                    }
                }
            }
        }
    }

    // 5. Delete the configuration and store files
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::AppPath(e.to_string()))?;

    let files = vec![
        "config.json",
        "search_config.json",
        "mcp_config.json",
        "sythoria-store.json",
    ];
    for file_name in files {
        let path = app_data_dir.join(file_name);
        if path.exists() {
            let _ = fs::remove_file(path);
        }
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct ModelConfig {
    pub id: String,
    #[serde(rename = "apiBase")]
    pub api_base: String,
    #[serde(rename = "modelId")]
    pub model_id: String,
    pub provider: Option<String>,
}

pub async fn get_model_config_and_key(
    app: &tauri::AppHandle,
    config_id: &str,
) -> Result<(String, String, String, Option<String>), AppError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::AppPath(e.to_string()))?;
    let config_path = app_data_dir.join("config.json");
    if !config_path.exists() {
        return Err(AppError::ConfigIo(
            "Configuration file not found".to_string(),
        ));
    }
    let config_content = fs::read_to_string(config_path)?;
    let configs: Vec<ModelConfig> = serde_json::from_str(&config_content)
        .map_err(|e| AppError::ConfigIo(format!("Failed to parse config: {}", e)))?;

    let config = configs
        .into_iter()
        .find(|c| c.id == config_id)
        .ok_or_else(|| {
            AppError::ConfigIo(format!("Model config not found for ID: {}", config_id))
        })?;

    let api_key = match get_keychain_secret("model", config_id) {
        Ok(secret) => secret,
        Err(_) => String::new(),
    };

    let parsed_url = url::Url::parse(&config.api_base)
        .map_err(|e| AppError::ConfigIo(format!("Invalid apiBase URL: {}", e)))?;

    if let Some(host) = parsed_url.host_str() {
        let host_lower = host.to_lowercase();
        let blocked_hosts = get_blocked_hosts();

        let is_blocked_host = blocked_hosts.iter().any(|blocked| {
            let blocked_lower = blocked.to_lowercase();
            if blocked.contains('*') {
                crate::search::matches_wildcard(&host_lower, &blocked_lower)
            } else {
                host_lower == blocked_lower || host_lower.ends_with(&format!(".{}", blocked_lower))
            }
        });

        let is_blocked_ip = {
            use std::net::ToSocketAddrs;
            let port = parsed_url.port_or_known_default().unwrap_or(80);
            if let Ok(addrs) = (host, port).to_socket_addrs() {
                addrs
                    .into_iter()
                    .any(|addr| crate::search::is_ip_blocked(&addr.ip(), &blocked_hosts))
            } else {
                false
            }
        };

        if is_blocked_host || is_blocked_ip {
            return Err(AppError::ConfigIo(format!(
                "Access denied: Endpoint '{}' is blocked in network settings. You can modify blocked hosts/IPs in Settings > Privacy.",
                host
            )));
        }
    }

    Ok((config.api_base, api_key, config.model_id, config.provider))
}

pub fn init_keyring_store() {
    #[cfg(target_os = "macos")]
    keyring_core::set_default_store(
        apple_native_keyring_store::keychain::Store::new()
            .expect("Failed to init macOS Keychain store"),
    );
    #[cfg(target_os = "ios")]
    keyring_core::set_default_store(
        apple_native_keyring_store::protected::Store::new()
            .expect("Failed to init iOS Protected Data store"),
    );
    #[cfg(target_os = "windows")]
    keyring_core::set_default_store(
        windows_native_keyring_store::Store::new()
            .expect("Failed to init Windows Credential store"),
    );
    #[cfg(target_os = "linux")]
    keyring_core::set_default_store(
        dbus_secret_service_keyring_store::Store::new()
            .expect("Failed to init Linux Secret Service store"),
    );
}
