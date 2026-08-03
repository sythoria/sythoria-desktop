use crate::secure_storage::{self, StorageDomain};
use crate::AppError;
use crate::NetworkConfig;
use crate::NETWORK_CONFIG;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const KEYCHAIN_SERVICE: &str = "com.sythoria.sythoria-desktop";
pub const API_KEY_INDEX: &str = "sythoria-api-key-index";
pub const SEARCH_API_KEY_INDEX: &str = "sythoria-search-api-key-index";
pub const MCP_ENV_KEY_INDEX: &str = "sythoria-mcp-env-key-index";
pub const MCP_API_KEY_INDEX: &str = "sythoria-mcp-api-key-index";
pub const STORED_SECRET_PLACEHOLDER: &str = "••••••••••••";
const CLOUD_STT_NAMESPACE: &str = "whisper";
const CLOUD_STT_KEY_ID: &str = "cloud-stt";
const NETWORK_POLICY_NAMESPACE: &str = "storage-state";
const NETWORK_POLICY_KEY_ID: &str = "network-policy-v1";

fn ensure_network_policy_marker() -> Result<(), AppError> {
    match get_keychain_secret(NETWORK_POLICY_NAMESPACE, NETWORK_POLICY_KEY_ID) {
        Ok(_) => Ok(()),
        Err(AppError::KeyNotFound(_)) => set_keychain_secret(
            NETWORK_POLICY_NAMESPACE,
            NETWORK_POLICY_KEY_ID,
            "initialized",
        ),
        Err(error) => Err(error),
    }
}

fn validate_network_config(config: &NetworkConfig) -> Result<(), AppError> {
    if config.blocked_hosts.len() > 2048 {
        return Err(AppError::ParseError(
            "Network policy contains too many blocked-host entries".to_string(),
        ));
    }
    if config.blocked_hosts.iter().any(|host| {
        host.is_empty()
            || host.len() > 512
            || host
                .chars()
                .any(|character| character.is_control() || character.is_whitespace())
    }) {
        return Err(AppError::ParseError(
            "Network policy contains an invalid blocked-host entry".to_string(),
        ));
    }
    if config.allowed_local_endpoints.len() > 128 {
        return Err(AppError::ParseError(
            "Network policy contains too many local endpoint grants".to_string(),
        ));
    }
    for endpoint in &config.allowed_local_endpoints {
        crate::endpoint_security::validate_local_grant(endpoint).map_err(AppError::ParseError)?;
    }
    Ok(())
}

// --- Keyring Utilities ---

pub fn keychain_account(namespace: &str, id: &str) -> String {
    format!("{}:{}", namespace, id)
}

pub fn load_secret_index(app: &tauri::AppHandle, index_key: &str) -> Result<Vec<String>, AppError> {
    let index = secure_storage::get_preference(app, index_key)?;
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
    secure_storage::set_preference(app, index_key, serde_json::json!(ids))
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

pub fn get_cloud_stt_api_key() -> Result<String, AppError> {
    get_keychain_secret(CLOUD_STT_NAMESPACE, CLOUD_STT_KEY_ID)
}

#[tauri::command]
pub fn has_cloud_stt_api_key() -> Result<bool, AppError> {
    match get_cloud_stt_api_key() {
        Ok(secret) => Ok(!secret.is_empty()),
        Err(AppError::KeyNotFound(_)) => Ok(false),
        Err(err) => Err(err),
    }
}

#[tauri::command]
pub fn save_cloud_stt_api_key(api_key: String) -> Result<(), AppError> {
    if api_key.trim().is_empty() {
        delete_keychain_secret(CLOUD_STT_NAMESPACE, CLOUD_STT_KEY_ID)
    } else {
        set_keychain_secret(CLOUD_STT_NAMESPACE, CLOUD_STT_KEY_ID, &api_key)
    }
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
                keys.insert(
                    id,
                    serde_json::Value::String(STORED_SECRET_PLACEHOLDER.to_string()),
                );
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
    for (id, value) in key_map {
        if !value.is_string() {
            return Err(AppError::ParseError(format!(
                "Secret value for '{id}' must be a string"
            )));
        }
    }

    let mut ids = Vec::new();
    for (id, value) in key_map {
        let secret = value.as_str().expect("secret map was validated");
        if secret.is_empty() {
            continue;
        }
        if secret == STORED_SECRET_PLACEHOLDER && existing_ids.contains(id) {
            ids.push(id.clone());
            continue;
        }
        set_keychain_secret(namespace, id, secret)?;
        ids.push(id.clone());
    }

    // Only remove old values after all replacement writes have succeeded.
    for id in existing_ids {
        if !ids.contains(&id) {
            delete_keychain_secret(namespace, &id)?;
        }
    }

    save_secret_index(app, index_key, &ids)
}

// --- Commands ---

#[tauri::command(async)]
pub fn load_encrypted_preferences(
    app: tauri::AppHandle,
) -> Result<serde_json::Map<String, serde_json::Value>, AppError> {
    secure_storage::load_preferences(&app)
}

#[tauri::command(async)]
pub fn mutate_encrypted_preferences(
    app: tauri::AppHandle,
    sets: serde_json::Map<String, serde_json::Value>,
    deletes: Vec<String>,
    clear: bool,
) -> Result<serde_json::Map<String, serde_json::Value>, AppError> {
    secure_storage::mutate_preferences(&app, sets, &deletes, clear)
}

#[tauri::command]
pub async fn load_config(app: tauri::AppHandle) -> Result<String, AppError> {
    let config: Option<serde_json::Value> = secure_storage::load_json(&app, StorageDomain::Models)?;
    config
        .map(|value| serde_json::to_string(&value).map_err(|e| AppError::ParseError(e.to_string())))
        .transpose()
        .map(|value| value.unwrap_or_default())
}

#[tauri::command]
pub async fn save_config(app: tauri::AppHandle, config: String) -> Result<(), AppError> {
    let parsed: serde_json::Value =
        serde_json::from_str(&config).map_err(|e| AppError::ParseError(e.to_string()))?;
    if !parsed.is_array() {
        return Err(AppError::ParseError(
            "Model configuration must be an array".to_string(),
        ));
    }
    secure_storage::save_json(&app, StorageDomain::Models, &parsed)
}

pub fn load_network_config_internal(app: &tauri::AppHandle) -> Result<NetworkConfig, AppError> {
    match secure_storage::load_json(app, StorageDomain::Network)? {
        Some(config) => {
            validate_network_config(&config)?;
            ensure_network_policy_marker()?;
            Ok(config)
        }
        None => match get_keychain_secret(NETWORK_POLICY_NAMESPACE, NETWORK_POLICY_KEY_ID) {
            Ok(_) => Err(AppError::ConfigIo(
                "The authenticated network policy is missing".to_string(),
            )),
            Err(AppError::KeyNotFound(_)) => Ok(NetworkConfig::default()),
            Err(error) => Err(error),
        },
    }
}

#[tauri::command]
pub async fn load_network_config(app: tauri::AppHandle) -> Result<String, AppError> {
    if !secure_storage::domain_file_exists(&app, StorageDomain::Network)?
        && matches!(
            get_keychain_secret(NETWORK_POLICY_NAMESPACE, NETWORK_POLICY_KEY_ID),
            Err(AppError::KeyNotFound(_))
        )
    {
        return Ok(String::new());
    }
    let config = load_network_config_internal(&app)?;
    serde_json::to_string(&config).map_err(|e| AppError::ParseError(e.to_string()))
}

#[tauri::command]
pub async fn save_network_config(app: tauri::AppHandle, config: String) -> Result<(), AppError> {
    let config_struct: NetworkConfig =
        serde_json::from_str(&config).map_err(|e| AppError::ParseError(e.to_string()))?;
    validate_network_config(&config_struct)?;
    secure_storage::save_json(&app, StorageDomain::Network, &config_struct)?;
    ensure_network_policy_marker()?;

    if let Ok(mut lock) = NETWORK_CONFIG.write() {
        *lock = config_struct;
    }
    Ok(())
}

#[tauri::command]
pub async fn load_search_config(app: tauri::AppHandle) -> Result<String, AppError> {
    let config: Option<serde_json::Value> = secure_storage::load_json(&app, StorageDomain::Search)?;
    config
        .map(|value| serde_json::to_string(&value).map_err(|e| AppError::ParseError(e.to_string())))
        .transpose()
        .map(|value| value.unwrap_or_default())
}

#[tauri::command]
pub async fn save_search_config(app: tauri::AppHandle, config: String) -> Result<(), AppError> {
    let parsed = serde_json::from_str::<serde_json::Value>(&config)
        .map_err(|e| AppError::ParseError(e.to_string()))?;
    secure_storage::save_json(&app, StorageDomain::Search, &parsed)
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
        let server_index_key = format!("mcp-env:{}", server_id);
        let server_keys = secure_storage::get_preference(&app, &server_index_key)?
            .and_then(|v| v.as_array().cloned())
            .unwrap_or_default()
            .into_iter()
            .filter_map(|v| v.as_str().map(ToString::to_string))
            .collect::<Vec<_>>();

        let mut server_map = serde_json::Map::new();
        for env_key in server_keys {
            match get_keychain_secret("mcp-env", &format!("{}:{}", server_id, env_key)) {
                Ok(secret) if !secret.is_empty() => {
                    server_map.insert(
                        env_key,
                        serde_json::Value::String(STORED_SECRET_PLACEHOLDER.to_string()),
                    );
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
    for (server_id, server_value) in secrets_map {
        let env_map = server_value.as_object().ok_or_else(|| {
            AppError::ParseError(format!(
                "MCP environment secrets for server '{server_id}' must be an object"
            ))
        })?;
        for (env_key, env_value) in env_map {
            if !env_value.is_string() {
                return Err(AppError::ParseError(format!(
                    "MCP environment secret '{env_key}' for server '{server_id}' must be a string"
                )));
            }
        }
    }

    let existing_server_ids = load_secret_index(&app, MCP_ENV_KEY_INDEX)?;

    for server_id in &existing_server_ids {
        if !secrets_map.contains_key(server_id) {
            let server_index_key = format!("mcp-env:{}", server_id);
            if let Some(env_index) = secure_storage::get_preference(&app, &server_index_key)? {
                if let Some(arr) = env_index.as_array() {
                    for key in arr.iter().filter_map(|v| v.as_str()) {
                        delete_keychain_secret("mcp-env", &format!("{}:{}", server_id, key))?;
                    }
                }
            }
            secure_storage::mutate_preferences(
                &app,
                serde_json::Map::new(),
                &[server_index_key],
                false,
            )?;
        }
    }

    let mut server_ids = Vec::new();
    for (server_id, server_value) in secrets_map {
        let env_map = server_value
            .as_object()
            .expect("MCP environment map was validated");

        let server_index_key = format!("mcp-env:{}", server_id);
        let existing_env_keys = secure_storage::get_preference(&app, &server_index_key)?
            .and_then(|value| value.as_array().cloned())
            .unwrap_or_default()
            .into_iter()
            .filter_map(|value| value.as_str().map(ToString::to_string))
            .collect::<Vec<_>>();
        let mut env_keys = Vec::new();

        for (env_key, env_value) in env_map {
            let secret = env_value
                .as_str()
                .expect("MCP environment secret was validated");
            if secret.is_empty() {
                delete_keychain_secret("mcp-env", &format!("{}:{}", server_id, env_key))?;
                continue;
            }
            if secret == STORED_SECRET_PLACEHOLDER && existing_env_keys.contains(env_key) {
                env_keys.push(env_key.clone());
                continue;
            }
            set_keychain_secret("mcp-env", &format!("{}:{}", server_id, env_key), secret)?;
            env_keys.push(env_key.clone());
        }

        for old_key in existing_env_keys {
            if !env_keys.contains(&old_key) {
                delete_keychain_secret("mcp-env", &format!("{}:{}", server_id, old_key))?;
            }
        }
        secure_storage::set_preference(&app, &server_index_key, serde_json::json!(env_keys))?;

        if !env_keys.is_empty() {
            server_ids.push(server_id.clone());
        }
    }

    save_secret_index(&app, MCP_ENV_KEY_INDEX, &server_ids)
}

pub fn load_mcp_env_secrets_for_server(
    app: &tauri::AppHandle,
    server_id: &str,
) -> Result<HashMap<String, String>, AppError> {
    let server_index_key = format!("mcp-env:{server_id}");
    let env_keys = secure_storage::get_preference(app, &server_index_key)?
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|value| value.as_str().map(ToString::to_string));
    let mut secrets = HashMap::new();

    for env_key in env_keys {
        match get_keychain_secret("mcp-env", &format!("{server_id}:{env_key}")) {
            Ok(secret) if !secret.is_empty() => {
                secrets.insert(env_key, secret);
            }
            Ok(_) | Err(AppError::KeyNotFound(_)) => {}
            Err(error) => return Err(error),
        }
    }

    Ok(secrets)
}

#[tauri::command]
pub async fn wipe_config_files(app: tauri::AppHandle) -> Result<(), AppError> {
    let mut failures = Vec::new();

    // Secret indices must remain available until every referenced keychain
    // credential has been deleted.
    for (namespace, index_key) in [
        ("model", API_KEY_INDEX),
        ("search", SEARCH_API_KEY_INDEX),
        ("mcp", MCP_API_KEY_INDEX),
    ] {
        match load_secret_index(&app, index_key) {
            Ok(ids) => {
                for id in ids {
                    if let Err(error) = delete_keychain_secret(namespace, &id) {
                        failures.push(error.to_string());
                    }
                }
            }
            Err(error) => failures.push(error.to_string()),
        }
    }

    match load_secret_index(&app, MCP_ENV_KEY_INDEX) {
        Ok(server_ids) => {
            for server_id in server_ids {
                let server_index_key = format!("mcp-env:{server_id}");
                match secure_storage::get_preference(&app, &server_index_key) {
                    Ok(Some(env_index)) => {
                        if let Some(keys) = env_index.as_array() {
                            for key in keys.iter().filter_map(|value| value.as_str()) {
                                if let Err(error) =
                                    delete_keychain_secret("mcp-env", &format!("{server_id}:{key}"))
                                {
                                    failures.push(error.to_string());
                                }
                            }
                        }
                    }
                    Ok(None) => {}
                    Err(error) => failures.push(error.to_string()),
                }
            }
        }
        Err(error) => failures.push(error.to_string()),
    }

    if let Err(error) = delete_keychain_secret(CLOUD_STT_NAMESPACE, CLOUD_STT_KEY_ID) {
        failures.push(error.to_string());
    }
    if let Err(error) = crate::commands::conversations::wipe_encrypted_conversations(&app) {
        failures.push(error.to_string());
    }

    if !failures.is_empty() {
        return Err(AppError::ConfigIo(format!(
            "Credential wipe was incomplete; secret indices were preserved for retry: {}",
            failures.join("; ")
        )));
    }

    if let Err(error) = secure_storage::remove_all_settings_files(&app) {
        failures.push(error.to_string());
    }
    if let Err(error) = delete_keychain_secret(NETWORK_POLICY_NAMESPACE, NETWORK_POLICY_KEY_ID) {
        failures.push(error.to_string());
    }

    if failures.is_empty() {
        Ok(())
    } else {
        Err(AppError::ConfigIo(format!(
            "Data wipe was incomplete: {}",
            failures.join("; ")
        )))
    }
}

#[derive(Deserialize, Serialize)]
pub struct ModelConfig {
    pub id: String,
    #[serde(rename = "apiBase")]
    pub api_base: String,
    #[serde(rename = "modelId")]
    pub model_id: String,
    pub provider: Option<String>,
    #[serde(rename = "allowLocalNetwork", default)]
    pub allow_local_network: bool,
}

pub async fn get_model_config_and_key(
    app: &tauri::AppHandle,
    config_id: &str,
) -> Result<(String, String, String, Option<String>, bool), AppError> {
    let configs: Vec<ModelConfig> = secure_storage::load_json(app, StorageDomain::Models)?
        .ok_or_else(|| AppError::ConfigIo("Model configuration not found".to_string()))?;

    let config = configs
        .into_iter()
        .find(|c| c.id == config_id)
        .ok_or_else(|| {
            AppError::ConfigIo(format!("Model config not found for ID: {}", config_id))
        })?;

    let api_key = get_keychain_secret("model", config_id).unwrap_or_default();

    Ok((
        config.api_base,
        api_key,
        config.model_id,
        config.provider,
        config.allow_local_network,
    ))
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
