use crate::keyring;
use crate::secure_storage::{self, StorageDomain};
use crate::AppError;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{LazyLock, Mutex};
use zeroize::Zeroize;

pub(crate) const STORED_SECRET_PLACEHOLDER: &str = "••••••••••••";

const API_KEY_INDEX: &str = "sythoria-api-key-index";
const SEARCH_API_KEY_INDEX: &str = "sythoria-search-api-key-index";
const MCP_ENV_KEY_INDEX: &str = "sythoria-mcp-env-key-index";
const MCP_API_KEY_INDEX: &str = "sythoria-mcp-api-key-index";
const CLOUD_STT_NAMESPACE: &str = "whisper";
const CLOUD_STT_KEY_ID: &str = "cloud-stt";
const NETWORK_POLICY_NAMESPACE: &str = "storage-state";
const NETWORK_POLICY_KEY_ID: &str = "network-policy-v1";
const MAX_SECRET_MAP_ENTRIES: usize = 4096;
const MAX_SECRET_ID_BYTES: usize = 512;
const MAX_SECRET_VALUE_BYTES: usize = 1024 * 1024;

static SECRET_STORE_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));
static LEGACY_CLEANUP_ATTEMPTED: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct LegacyCredential {
    namespace: String,
    id: String,
}

impl LegacyCredential {
    fn new(namespace: &str, id: &str) -> Self {
        Self {
            namespace: namespace.to_string(),
            id: id.to_string(),
        }
    }
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeSecrets {
    #[serde(default)]
    model_api_keys: HashMap<String, String>,
    #[serde(default)]
    search_api_keys: HashMap<String, String>,
    #[serde(default)]
    mcp_api_keys: HashMap<String, String>,
    #[serde(default)]
    mcp_env: HashMap<String, HashMap<String, String>>,
    #[serde(default)]
    cloud_stt_api_key: Option<String>,
    #[serde(default)]
    network_policy_initialized: bool,
    #[serde(default)]
    legacy_cleanup_pending: Vec<LegacyCredential>,
}

impl Drop for NativeSecrets {
    fn drop(&mut self) {
        zeroize_map(&mut self.model_api_keys);
        zeroize_map(&mut self.search_api_keys);
        zeroize_map(&mut self.mcp_api_keys);
        for env in self.mcp_env.values_mut() {
            zeroize_map(env);
        }
        self.mcp_env.clear();
        if let Some(secret) = self.cloud_stt_api_key.as_mut() {
            secret.zeroize();
        }
    }
}

#[derive(Clone, Copy)]
pub(crate) enum SecretMapKind {
    Model,
    Search,
    Mcp,
}

fn map_for_kind(secrets: &NativeSecrets, kind: SecretMapKind) -> &HashMap<String, String> {
    match kind {
        SecretMapKind::Model => &secrets.model_api_keys,
        SecretMapKind::Search => &secrets.search_api_keys,
        SecretMapKind::Mcp => &secrets.mcp_api_keys,
    }
}

fn map_for_kind_mut(
    secrets: &mut NativeSecrets,
    kind: SecretMapKind,
) -> &mut HashMap<String, String> {
    match kind {
        SecretMapKind::Model => &mut secrets.model_api_keys,
        SecretMapKind::Search => &mut secrets.search_api_keys,
        SecretMapKind::Mcp => &mut secrets.mcp_api_keys,
    }
}

fn zeroize_map(map: &mut HashMap<String, String>) {
    for value in map.values_mut() {
        value.zeroize();
    }
    map.clear();
}

fn zeroize_nested_map(map: &mut HashMap<String, HashMap<String, String>>) {
    for values in map.values_mut() {
        zeroize_map(values);
    }
    map.clear();
}

fn load_legacy_index(app: &tauri::AppHandle, index_key: &str) -> Result<Vec<String>, AppError> {
    let index = secure_storage::get_preference(app, index_key)?;
    Ok(index
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|value| value.as_str().map(ToString::to_string))
        .collect())
}

fn read_legacy_secret(
    namespace: &str,
    id: &str,
    cleanup: &mut Vec<LegacyCredential>,
) -> Result<Option<String>, AppError> {
    match keyring::get_secret(namespace, id) {
        Ok(secret) => {
            cleanup.push(LegacyCredential::new(namespace, id));
            Ok((!secret.is_empty()).then_some(secret))
        }
        Err(AppError::KeyNotFound(_)) => Ok(None),
        Err(error) => Err(error),
    }
}

fn read_legacy_map(
    app: &tauri::AppHandle,
    namespace: &str,
    index_key: &str,
    cleanup: &mut Vec<LegacyCredential>,
) -> Result<HashMap<String, String>, AppError> {
    let mut result = HashMap::new();
    for id in load_legacy_index(app, index_key)? {
        match read_legacy_secret(namespace, &id, cleanup) {
            Ok(Some(secret)) => {
                result.insert(id, secret);
            }
            Ok(None) => {}
            Err(error) => {
                zeroize_map(&mut result);
                return Err(error);
            }
        }
    }
    Ok(result)
}

fn migrate_legacy_secrets(app: &tauri::AppHandle) -> Result<NativeSecrets, AppError> {
    let mut secrets = NativeSecrets::default();
    secrets.model_api_keys = read_legacy_map(
        app,
        "model",
        API_KEY_INDEX,
        &mut secrets.legacy_cleanup_pending,
    )?;
    secrets.search_api_keys = read_legacy_map(
        app,
        "search",
        SEARCH_API_KEY_INDEX,
        &mut secrets.legacy_cleanup_pending,
    )?;
    secrets.mcp_api_keys = read_legacy_map(
        app,
        "mcp",
        MCP_API_KEY_INDEX,
        &mut secrets.legacy_cleanup_pending,
    )?;

    for server_id in load_legacy_index(app, MCP_ENV_KEY_INDEX)? {
        let server_index_key = format!("mcp-env:{server_id}");
        let env_keys = load_legacy_index(app, &server_index_key)?;
        let mut server_env = HashMap::new();
        for env_key in env_keys {
            let legacy_id = format!("{server_id}:{env_key}");
            match read_legacy_secret("mcp-env", &legacy_id, &mut secrets.legacy_cleanup_pending) {
                Ok(Some(secret)) => {
                    server_env.insert(env_key, secret);
                }
                Ok(None) => {}
                Err(error) => {
                    zeroize_map(&mut server_env);
                    return Err(error);
                }
            }
        }
        if !server_env.is_empty() {
            secrets.mcp_env.insert(server_id, server_env);
        }
    }

    secrets.cloud_stt_api_key = read_legacy_secret(
        CLOUD_STT_NAMESPACE,
        CLOUD_STT_KEY_ID,
        &mut secrets.legacy_cleanup_pending,
    )?;
    secrets.network_policy_initialized = read_legacy_secret(
        NETWORK_POLICY_NAMESPACE,
        NETWORK_POLICY_KEY_ID,
        &mut secrets.legacy_cleanup_pending,
    )?
    .is_some();
    Ok(secrets)
}

fn try_cleanup_legacy(app: &tauri::AppHandle, secrets: &mut NativeSecrets) {
    if secrets.legacy_cleanup_pending.is_empty()
        || LEGACY_CLEANUP_ATTEMPTED.swap(true, Ordering::AcqRel)
    {
        return;
    }

    let mut failures = Vec::new();
    for credential in &secrets.legacy_cleanup_pending {
        if let Err(error) = keyring::delete_secret(&credential.namespace, &credential.id) {
            log::warn!(
                "Could not remove a migrated legacy Keychain credential ({}): {error}",
                credential.namespace
            );
            failures.push(credential.clone());
        }
    }

    secrets.legacy_cleanup_pending = failures;
    if let Err(error) = secure_storage::save_json(app, StorageDomain::Secrets, secrets) {
        log::warn!("Could not persist legacy credential cleanup state: {error}");
    }
}

fn load_locked(app: &tauri::AppHandle) -> Result<NativeSecrets, AppError> {
    let mut secrets = match secure_storage::load_json(app, StorageDomain::Secrets)? {
        Some(secrets) => secrets,
        None => {
            let secrets = migrate_legacy_secrets(app)?;
            // The encrypted, authenticated replacement must reach disk before any
            // legacy Keychain credential is deleted.
            secure_storage::save_json(app, StorageDomain::Secrets, &secrets)?;
            secrets
        }
    };
    try_cleanup_legacy(app, &mut secrets);
    Ok(secrets)
}

fn lock_store() -> Result<std::sync::MutexGuard<'static, ()>, AppError> {
    SECRET_STORE_LOCK
        .lock()
        .map_err(|_| AppError::ConfigIo("Secret store lock is poisoned".to_string()))
}

pub(crate) fn lock_for_wipe() -> Result<std::sync::MutexGuard<'static, ()>, AppError> {
    lock_store()
}

fn validate_secret_map(map: &HashMap<String, String>, label: &str) -> Result<(), AppError> {
    if map.len() > MAX_SECRET_MAP_ENTRIES {
        return Err(AppError::ParseError(format!(
            "{label} contains too many entries"
        )));
    }
    for (id, value) in map {
        if id.is_empty() || id.len() > MAX_SECRET_ID_BYTES {
            return Err(AppError::ParseError(format!(
                "{label} contains an invalid identifier"
            )));
        }
        if value.len() > MAX_SECRET_VALUE_BYTES {
            return Err(AppError::ParseError(format!(
                "{label} contains a value that exceeds the size limit"
            )));
        }
    }
    Ok(())
}

fn validate_placeholders(
    existing: &HashMap<String, String>,
    incoming: &HashMap<String, String>,
    label: &str,
) -> Result<(), AppError> {
    if incoming
        .iter()
        .any(|(id, value)| value == STORED_SECRET_PLACEHOLDER && !existing.contains_key(id))
    {
        return Err(AppError::ParseError(format!(
            "{label} contains a placeholder without an existing encrypted secret"
        )));
    }
    Ok(())
}

fn replace_map(existing: &mut HashMap<String, String>, mut incoming: HashMap<String, String>) {
    let mut previous = std::mem::take(existing);
    let mut replacement = HashMap::with_capacity(incoming.len());
    for (id, mut value) in incoming.drain() {
        if value.is_empty() {
            value.zeroize();
        } else if value == STORED_SECRET_PLACEHOLDER {
            value.zeroize();
            if let Some(secret) = previous.remove(&id) {
                replacement.insert(id, secret);
            }
        } else {
            replacement.insert(id, value);
        }
    }
    zeroize_map(&mut previous);
    *existing = replacement;
}

pub(crate) fn load_masked_map(
    app: &tauri::AppHandle,
    kind: SecretMapKind,
) -> Result<serde_json::Value, AppError> {
    let _guard = lock_store()?;
    let secrets = load_locked(app)?;
    let masked = map_for_kind(&secrets, kind)
        .keys()
        .map(|id| {
            (
                id.clone(),
                serde_json::Value::String(STORED_SECRET_PLACEHOLDER.to_string()),
            )
        })
        .collect();
    Ok(serde_json::Value::Object(masked))
}

pub(crate) fn save_map(
    app: &tauri::AppHandle,
    kind: SecretMapKind,
    mut incoming: HashMap<String, String>,
) -> Result<(), AppError> {
    if let Err(error) = validate_secret_map(&incoming, "Secret map") {
        zeroize_map(&mut incoming);
        return Err(error);
    }

    let _guard = match lock_store() {
        Ok(guard) => guard,
        Err(error) => {
            zeroize_map(&mut incoming);
            return Err(error);
        }
    };
    let mut secrets = match load_locked(app) {
        Ok(secrets) => secrets,
        Err(error) => {
            zeroize_map(&mut incoming);
            return Err(error);
        }
    };
    if let Err(error) = validate_placeholders(map_for_kind(&secrets, kind), &incoming, "Secret map")
    {
        zeroize_map(&mut incoming);
        return Err(error);
    }
    replace_map(map_for_kind_mut(&mut secrets, kind), incoming);
    secure_storage::save_json(app, StorageDomain::Secrets, &secrets)
}

pub(crate) fn get_secret(
    app: &tauri::AppHandle,
    kind: SecretMapKind,
    id: &str,
) -> Result<Option<String>, AppError> {
    let _guard = lock_store()?;
    let secrets = load_locked(app)?;
    Ok(map_for_kind(&secrets, kind).get(id).cloned())
}

pub(crate) fn load_masked_mcp_env(app: &tauri::AppHandle) -> Result<serde_json::Value, AppError> {
    let _guard = lock_store()?;
    let secrets = load_locked(app)?;
    let result = secrets
        .mcp_env
        .iter()
        .map(|(server_id, env)| {
            let masked = env
                .keys()
                .map(|key| {
                    (
                        key.clone(),
                        serde_json::Value::String(STORED_SECRET_PLACEHOLDER.to_string()),
                    )
                })
                .collect();
            (server_id.clone(), serde_json::Value::Object(masked))
        })
        .collect();
    Ok(serde_json::Value::Object(result))
}

pub(crate) fn save_mcp_env(
    app: &tauri::AppHandle,
    mut incoming: HashMap<String, HashMap<String, String>>,
) -> Result<(), AppError> {
    if incoming.len() > MAX_SECRET_MAP_ENTRIES {
        zeroize_nested_map(&mut incoming);
        return Err(AppError::ParseError(
            "MCP environment contains too many servers".to_string(),
        ));
    }
    for (server_id, env) in &incoming {
        if server_id.is_empty() || server_id.len() > MAX_SECRET_ID_BYTES {
            zeroize_nested_map(&mut incoming);
            return Err(AppError::ParseError(
                "MCP environment contains an invalid server identifier".to_string(),
            ));
        }
        if let Err(error) = validate_secret_map(env, "MCP environment") {
            zeroize_nested_map(&mut incoming);
            return Err(error);
        }
    }

    let _guard = match lock_store() {
        Ok(guard) => guard,
        Err(error) => {
            zeroize_nested_map(&mut incoming);
            return Err(error);
        }
    };
    let mut secrets = match load_locked(app) {
        Ok(secrets) => secrets,
        Err(error) => {
            zeroize_nested_map(&mut incoming);
            return Err(error);
        }
    };
    for (server_id, env) in &incoming {
        let existing = secrets.mcp_env.get(server_id);
        if env.iter().any(|(key, value)| {
            value == STORED_SECRET_PLACEHOLDER
                && !existing.is_some_and(|values| values.contains_key(key))
        }) {
            zeroize_nested_map(&mut incoming);
            return Err(AppError::ParseError(
                "MCP environment contains a placeholder without an existing encrypted secret"
                    .to_string(),
            ));
        }
    }

    let mut previous = std::mem::take(&mut secrets.mcp_env);
    let mut replacement = HashMap::with_capacity(incoming.len());
    for (server_id, env) in incoming {
        let mut existing = previous.remove(&server_id).unwrap_or_default();
        replace_map(&mut existing, env);
        if !existing.is_empty() {
            replacement.insert(server_id, existing);
        }
    }
    for env in previous.values_mut() {
        zeroize_map(env);
    }
    secrets.mcp_env = replacement;
    secure_storage::save_json(app, StorageDomain::Secrets, &secrets)
}

pub(crate) fn mcp_env_for_server(
    app: &tauri::AppHandle,
    server_id: &str,
) -> Result<HashMap<String, String>, AppError> {
    let _guard = lock_store()?;
    let secrets = load_locked(app)?;
    Ok(secrets.mcp_env.get(server_id).cloned().unwrap_or_default())
}

pub(crate) fn has_cloud_stt_api_key(app: &tauri::AppHandle) -> Result<bool, AppError> {
    let _guard = lock_store()?;
    let secrets = load_locked(app)?;
    Ok(secrets
        .cloud_stt_api_key
        .as_ref()
        .is_some_and(|secret| !secret.is_empty()))
}

pub(crate) fn cloud_stt_api_key(app: &tauri::AppHandle) -> Result<Option<String>, AppError> {
    let _guard = lock_store()?;
    let secrets = load_locked(app)?;
    Ok(secrets.cloud_stt_api_key.clone())
}

pub(crate) fn save_cloud_stt_api_key(
    app: &tauri::AppHandle,
    mut api_key: String,
) -> Result<(), AppError> {
    if api_key.len() > MAX_SECRET_VALUE_BYTES {
        api_key.zeroize();
        return Err(AppError::ParseError(
            "Cloud speech-to-text API key exceeds the size limit".to_string(),
        ));
    }
    let _guard = match lock_store() {
        Ok(guard) => guard,
        Err(error) => {
            api_key.zeroize();
            return Err(error);
        }
    };
    let mut secrets = match load_locked(app) {
        Ok(secrets) => secrets,
        Err(error) => {
            api_key.zeroize();
            return Err(error);
        }
    };
    if let Some(existing) = secrets.cloud_stt_api_key.as_mut() {
        existing.zeroize();
    }
    if api_key.trim().is_empty() {
        api_key.zeroize();
        secrets.cloud_stt_api_key = None;
    } else {
        secrets.cloud_stt_api_key = Some(api_key);
    }
    secure_storage::save_json(app, StorageDomain::Secrets, &secrets)
}

pub(crate) fn network_policy_initialized(app: &tauri::AppHandle) -> Result<bool, AppError> {
    let _guard = lock_store()?;
    let secrets = load_locked(app)?;
    Ok(secrets.network_policy_initialized)
}

pub(crate) fn mark_network_policy_initialized(app: &tauri::AppHandle) -> Result<(), AppError> {
    let _guard = lock_store()?;
    let mut secrets = load_locked(app)?;
    if !secrets.network_policy_initialized {
        secrets.network_policy_initialized = true;
        secure_storage::save_json(app, StorageDomain::Secrets, &secrets)?;
    }
    Ok(())
}

pub(crate) fn delete_legacy_credentials(app: &tauri::AppHandle) -> Vec<String> {
    let mut credentials = HashSet::new();
    let mut failures = Vec::new();
    for (namespace, index_key) in [
        ("model", API_KEY_INDEX),
        ("search", SEARCH_API_KEY_INDEX),
        ("mcp", MCP_API_KEY_INDEX),
    ] {
        match load_legacy_index(app, index_key) {
            Ok(ids) => credentials.extend(
                ids.into_iter()
                    .map(|id| LegacyCredential::new(namespace, &id)),
            ),
            Err(error) => failures.push(error.to_string()),
        }
    }
    match load_legacy_index(app, MCP_ENV_KEY_INDEX) {
        Ok(server_ids) => {
            for server_id in server_ids {
                match load_legacy_index(app, &format!("mcp-env:{server_id}")) {
                    Ok(keys) => credentials.extend(keys.into_iter().map(|key| {
                        LegacyCredential::new("mcp-env", &format!("{server_id}:{key}"))
                    })),
                    Err(error) => failures.push(error.to_string()),
                }
            }
        }
        Err(error) => failures.push(error.to_string()),
    }
    credentials.insert(LegacyCredential::new(CLOUD_STT_NAMESPACE, CLOUD_STT_KEY_ID));
    credentials.insert(LegacyCredential::new(
        NETWORK_POLICY_NAMESPACE,
        NETWORK_POLICY_KEY_ID,
    ));
    match secure_storage::load_json::<NativeSecrets>(app, StorageDomain::Secrets) {
        Ok(Some(secrets)) => credentials.extend(secrets.legacy_cleanup_pending.iter().cloned()),
        Ok(None) => {}
        Err(error) => failures.push(error.to_string()),
    }

    failures.extend(credentials.into_iter().filter_map(|credential| {
        keyring::delete_secret(&credential.namespace, &credential.id)
            .err()
            .map(|error| error.to_string())
    }));
    failures
}

#[cfg(test)]
mod tests {
    use super::{replace_map, validate_placeholders, STORED_SECRET_PLACEHOLDER};
    use std::collections::HashMap;

    #[test]
    fn placeholder_preserves_existing_secret_without_storing_mask() {
        let mut existing = HashMap::from([("provider".to_string(), "real-secret".to_string())]);
        let incoming = HashMap::from([(
            "provider".to_string(),
            STORED_SECRET_PLACEHOLDER.to_string(),
        )]);

        validate_placeholders(&existing, &incoming, "test").expect("valid placeholder");
        replace_map(&mut existing, incoming);

        assert_eq!(
            existing.get("provider").map(String::as_str),
            Some("real-secret")
        );
    }

    #[test]
    fn placeholder_without_existing_secret_is_rejected() {
        let existing = HashMap::new();
        let incoming = HashMap::from([(
            "provider".to_string(),
            STORED_SECRET_PLACEHOLDER.to_string(),
        )]);

        assert!(validate_placeholders(&existing, &incoming, "test").is_err());
    }
}
