use crate::atomic_file::write_atomic;
use crate::commands::config::{delete_keychain_secret, get_keychain_secret, set_keychain_secret};
use crate::AppError;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use ring::{aead, hmac, rand};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use tauri::Manager;
use zeroize::Zeroize;

const STORAGE_DIRECTORY: &str = "conversations";
const BLOBS_DIRECTORY: &str = "blobs";
const MANIFEST_FILE: &str = "manifest.enc";
const STORAGE_VERSION: u8 = 1;
const ENVELOPE_MAGIC: &[u8; 7] = b"SYTHENC";
const NONCE_LENGTH: usize = 12;
const MASTER_KEY_LENGTH: usize = 64;
const KEYCHAIN_NAMESPACE: &str = "storage";
const KEYCHAIN_KEY_ID: &str = "conversations-v1";
const MANIFEST_AAD: &[u8] = b"sythoria:conversations:manifest:v1";

static STORAGE_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConversationManifest {
    storage_version: u8,
    blobs: Vec<String>,
}

struct StorageKeys {
    encryption: [u8; 32],
    content_hash: [u8; 32],
}

impl StorageKeys {
    fn from_master(master: &[u8]) -> Result<Self, AppError> {
        if master.len() != MASTER_KEY_LENGTH {
            return Err(AppError::ConfigIo(
                "Conversation encryption key has an invalid length".to_string(),
            ));
        }

        let mut encryption = [0_u8; 32];
        encryption.copy_from_slice(&master[..32]);
        let mut content_hash = [0_u8; 32];
        content_hash.copy_from_slice(&master[32..]);
        Ok(Self {
            encryption,
            content_hash,
        })
    }
}

impl Drop for StorageKeys {
    fn drop(&mut self) {
        self.encryption.zeroize();
        self.content_hash.zeroize();
    }
}

fn storage_directory(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::AppPath(error.to_string()))?
        .join(STORAGE_DIRECTORY))
}

fn load_or_create_keys(storage_dir: &Path) -> Result<StorageKeys, AppError> {
    match get_keychain_secret(KEYCHAIN_NAMESPACE, KEYCHAIN_KEY_ID) {
        Ok(mut encoded) => {
            let decoded = BASE64.decode(&encoded);
            encoded.zeroize();
            let mut master = decoded.map_err(|_| {
                AppError::ConfigIo("Conversation encryption key is not valid base64".to_string())
            })?;
            let keys = StorageKeys::from_master(&master);
            master.zeroize();
            keys
        }
        Err(AppError::KeyNotFound(_)) => {
            if storage_dir.join(MANIFEST_FILE).exists() {
                return Err(AppError::ConfigIo(
                    "Encrypted conversations exist, but their key is missing from the OS keychain"
                        .to_string(),
                ));
            }

            let random = rand::SystemRandom::new();
            let mut master = [0_u8; MASTER_KEY_LENGTH];
            rand::SecureRandom::fill(&random, &mut master).map_err(|_| {
                AppError::ConfigIo("Failed to generate conversation encryption key".to_string())
            })?;
            let mut encoded = BASE64.encode(master);
            let save_result = set_keychain_secret(KEYCHAIN_NAMESPACE, KEYCHAIN_KEY_ID, &encoded);
            encoded.zeroize();
            if let Err(error) = save_result {
                master.zeroize();
                return Err(error);
            }
            let keys = StorageKeys::from_master(&master);
            master.zeroize();
            keys
        }
        Err(error) => Err(error),
    }
}

fn load_existing_keys(storage_dir: &Path) -> Result<Option<StorageKeys>, AppError> {
    if !storage_dir.join(MANIFEST_FILE).exists() {
        return Ok(None);
    }
    load_or_create_keys(storage_dir).map(Some)
}

fn encrypt(plaintext: &[u8], aad: &[u8], key_bytes: &[u8; 32]) -> Result<Vec<u8>, AppError> {
    let unbound_key = aead::UnboundKey::new(&aead::AES_256_GCM, key_bytes).map_err(|_| {
        AppError::ConfigIo("Failed to initialize conversation encryption".to_string())
    })?;
    let key = aead::LessSafeKey::new(unbound_key);

    let random = rand::SystemRandom::new();
    let mut nonce_bytes = [0_u8; NONCE_LENGTH];
    rand::SecureRandom::fill(&random, &mut nonce_bytes).map_err(|_| {
        AppError::ConfigIo("Failed to generate conversation encryption nonce".to_string())
    })?;
    let nonce = aead::Nonce::assume_unique_for_key(nonce_bytes);

    let mut ciphertext = plaintext.to_vec();
    key.seal_in_place_append_tag(nonce, aead::Aad::from(aad), &mut ciphertext)
        .map_err(|_| AppError::ConfigIo("Failed to encrypt conversations".to_string()))?;

    let mut envelope =
        Vec::with_capacity(ENVELOPE_MAGIC.len() + 1 + NONCE_LENGTH + ciphertext.len());
    envelope.extend_from_slice(ENVELOPE_MAGIC);
    envelope.push(STORAGE_VERSION);
    envelope.extend_from_slice(&nonce_bytes);
    envelope.extend_from_slice(&ciphertext);
    Ok(envelope)
}

fn decrypt(envelope: &[u8], aad: &[u8], key_bytes: &[u8; 32]) -> Result<Vec<u8>, AppError> {
    let header_length = ENVELOPE_MAGIC.len() + 1 + NONCE_LENGTH;
    if envelope.len() < header_length + aead::AES_256_GCM.tag_len()
        || &envelope[..ENVELOPE_MAGIC.len()] != ENVELOPE_MAGIC
        || envelope[ENVELOPE_MAGIC.len()] != STORAGE_VERSION
    {
        return Err(AppError::ConfigIo(
            "Encrypted conversation file has an unsupported or corrupted header".to_string(),
        ));
    }

    let nonce_start = ENVELOPE_MAGIC.len() + 1;
    let mut nonce_bytes = [0_u8; NONCE_LENGTH];
    nonce_bytes.copy_from_slice(&envelope[nonce_start..nonce_start + NONCE_LENGTH]);

    let unbound_key = aead::UnboundKey::new(&aead::AES_256_GCM, key_bytes).map_err(|_| {
        AppError::ConfigIo("Failed to initialize conversation decryption".to_string())
    })?;
    let key = aead::LessSafeKey::new(unbound_key);
    let nonce = aead::Nonce::assume_unique_for_key(nonce_bytes);
    let mut ciphertext = envelope[header_length..].to_vec();
    let plaintext = key
        .open_in_place(nonce, aead::Aad::from(aad), &mut ciphertext)
        .map_err(|_| {
            AppError::ConfigIo(
                "Encrypted conversation data failed authentication; the file may be corrupted"
                    .to_string(),
            )
        })?;
    Ok(plaintext.to_vec())
}

fn content_id(plaintext: &[u8], key_bytes: &[u8; 32]) -> String {
    let key = hmac::Key::new(hmac::HMAC_SHA256, key_bytes);
    hmac::sign(&key, plaintext)
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn blob_aad(blob_id: &str) -> Vec<u8> {
    format!("sythoria:conversations:blob:v1:{blob_id}").into_bytes()
}

fn valid_blob_id(blob_id: &str) -> bool {
    blob_id.len() == 64 && blob_id.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn save_snapshot(
    storage_dir: &Path,
    conversations: &[serde_json::Value],
    keys: &StorageKeys,
) -> Result<(), AppError> {
    let blobs_dir = storage_dir.join(BLOBS_DIRECTORY);
    fs::create_dir_all(&blobs_dir)?;

    let mut blob_ids = Vec::with_capacity(conversations.len());
    for conversation in conversations {
        let plaintext = serde_json::to_vec(conversation).map_err(|error| {
            AppError::ParseError(format!("Failed to serialize conversation: {error}"))
        })?;
        let blob_id = content_id(&plaintext, &keys.content_hash);
        let blob_path = blobs_dir.join(format!("{blob_id}.enc"));
        if !blob_path.exists() {
            let encrypted = encrypt(&plaintext, &blob_aad(&blob_id), &keys.encryption)?;
            write_atomic(&blob_path, &encrypted)?;
        }
        blob_ids.push(blob_id);
    }

    let manifest = ConversationManifest {
        storage_version: STORAGE_VERSION,
        blobs: blob_ids,
    };
    let manifest_plaintext = serde_json::to_vec(&manifest).map_err(|error| {
        AppError::ParseError(format!(
            "Failed to serialize conversation manifest: {error}"
        ))
    })?;
    let encrypted_manifest = encrypt(&manifest_plaintext, MANIFEST_AAD, &keys.encryption)?;
    write_atomic(&storage_dir.join(MANIFEST_FILE), &encrypted_manifest)?;

    let referenced: HashSet<String> = manifest.blobs.into_iter().collect();
    if let Ok(entries) = fs::read_dir(&blobs_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let blob_id = path
                .file_stem()
                .and_then(|name| name.to_str())
                .unwrap_or_default();
            if path.extension().and_then(|extension| extension.to_str()) == Some("enc")
                && !referenced.contains(blob_id)
            {
                if let Err(error) = fs::remove_file(&path) {
                    log::warn!(
                        "Failed to remove unreferenced encrypted conversation blob: {error}"
                    );
                }
            }
        }
    }

    Ok(())
}

fn load_snapshot(
    storage_dir: &Path,
    keys: &StorageKeys,
) -> Result<Vec<serde_json::Value>, AppError> {
    let encrypted_manifest = fs::read(storage_dir.join(MANIFEST_FILE))?;
    let manifest_plaintext = decrypt(&encrypted_manifest, MANIFEST_AAD, &keys.encryption)?;
    let manifest: ConversationManifest =
        serde_json::from_slice(&manifest_plaintext).map_err(|error| {
            AppError::ParseError(format!("Failed to parse conversation manifest: {error}"))
        })?;
    if manifest.storage_version != STORAGE_VERSION {
        return Err(AppError::ConfigIo(format!(
            "Unsupported conversation storage version {}",
            manifest.storage_version
        )));
    }

    let mut conversations = Vec::with_capacity(manifest.blobs.len());
    for blob_id in manifest.blobs {
        if !valid_blob_id(&blob_id) {
            return Err(AppError::ConfigIo(
                "Conversation manifest contains an invalid blob identifier".to_string(),
            ));
        }
        let encrypted_blob = fs::read(
            storage_dir
                .join(BLOBS_DIRECTORY)
                .join(format!("{blob_id}.enc")),
        )?;
        let plaintext = decrypt(&encrypted_blob, &blob_aad(&blob_id), &keys.encryption)?;
        let conversation = serde_json::from_slice(&plaintext).map_err(|error| {
            AppError::ParseError(format!("Failed to parse encrypted conversation: {error}"))
        })?;
        conversations.push(conversation);
    }
    Ok(conversations)
}

#[tauri::command(async)]
pub fn load_encrypted_conversations(
    app: tauri::AppHandle,
) -> Result<Option<Vec<serde_json::Value>>, AppError> {
    let _guard = STORAGE_LOCK
        .lock()
        .map_err(|_| AppError::ConfigIo("Conversation storage lock is poisoned".to_string()))?;
    let storage_dir = storage_directory(&app)?;
    let Some(keys) = load_existing_keys(&storage_dir)? else {
        return Ok(None);
    };
    load_snapshot(&storage_dir, &keys).map(Some)
}

#[tauri::command(async)]
pub fn save_encrypted_conversations(
    app: tauri::AppHandle,
    conversations: Vec<serde_json::Value>,
) -> Result<(), AppError> {
    let _guard = STORAGE_LOCK
        .lock()
        .map_err(|_| AppError::ConfigIo("Conversation storage lock is poisoned".to_string()))?;
    let storage_dir = storage_directory(&app)?;
    let keys = load_or_create_keys(&storage_dir)?;
    save_snapshot(&storage_dir, &conversations, &keys)
}

#[tauri::command(async)]
pub fn clear_encrypted_conversations(app: tauri::AppHandle) -> Result<(), AppError> {
    let _guard = STORAGE_LOCK
        .lock()
        .map_err(|_| AppError::ConfigIo("Conversation storage lock is poisoned".to_string()))?;
    let storage_dir = storage_directory(&app)?;
    if storage_dir.exists() {
        fs::remove_dir_all(&storage_dir)?;
    }
    delete_keychain_secret(KEYCHAIN_NAMESPACE, KEYCHAIN_KEY_ID)
}

pub fn wipe_encrypted_conversations(app: &tauri::AppHandle) -> Result<(), AppError> {
    let _guard = STORAGE_LOCK
        .lock()
        .map_err(|_| AppError::ConfigIo("Conversation storage lock is poisoned".to_string()))?;
    let storage_dir = storage_directory(app)?;
    if storage_dir.exists() {
        fs::remove_dir_all(&storage_dir)?;
    }
    delete_keychain_secret(KEYCHAIN_NAMESPACE, KEYCHAIN_KEY_ID)
}

#[cfg(test)]
mod tests {
    use super::{load_snapshot, save_snapshot, StorageKeys, BLOBS_DIRECTORY, MANIFEST_FILE};
    use serde_json::json;
    use std::fs;

    fn fixture_directory() -> std::path::PathBuf {
        let path =
            std::env::temp_dir().join(format!("sythoria-conversations-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).expect("create fixture directory");
        path
    }

    fn fixture_keys() -> StorageKeys {
        StorageKeys {
            encryption: [7_u8; 32],
            content_hash: [11_u8; 32],
        }
    }

    #[test]
    fn encrypted_snapshot_round_trips_without_plaintext_on_disk() {
        let directory = fixture_directory();
        let conversations = vec![
            json!({"id": "one", "messages": [{"content": "highly sensitive prompt"}]}),
            json!({"id": "two", "messages": []}),
        ];
        let keys = fixture_keys();

        save_snapshot(&directory, &conversations, &keys).expect("save encrypted snapshot");
        assert_eq!(
            load_snapshot(&directory, &keys).expect("load encrypted snapshot"),
            conversations
        );

        let manifest = fs::read(directory.join(MANIFEST_FILE)).expect("read encrypted manifest");
        assert!(!String::from_utf8_lossy(&manifest).contains("highly sensitive prompt"));
        for entry in fs::read_dir(directory.join(BLOBS_DIRECTORY)).expect("read blobs") {
            let bytes = fs::read(entry.expect("read blob entry").path()).expect("read blob");
            assert!(!String::from_utf8_lossy(&bytes).contains("highly sensitive prompt"));
        }

        fs::remove_dir_all(directory).expect("remove fixture directory");
    }

    #[test]
    fn unchanged_conversations_reuse_content_addressed_blobs() {
        let directory = fixture_directory();
        let conversations = vec![json!({"id": "one", "messages": [{"content": "hello"}]})];
        let keys = fixture_keys();

        save_snapshot(&directory, &conversations, &keys).expect("save initial snapshot");
        save_snapshot(&directory, &conversations, &keys).expect("save unchanged snapshot");

        assert_eq!(
            fs::read_dir(directory.join(BLOBS_DIRECTORY))
                .expect("read blobs")
                .filter_map(Result::ok)
                .count(),
            1
        );

        fs::remove_dir_all(directory).expect("remove fixture directory");
    }

    #[test]
    fn rejects_tampered_conversation_data() {
        let directory = fixture_directory();
        let conversations = vec![json!({"id": "one", "messages": [{"content": "hello"}]})];
        let keys = fixture_keys();

        save_snapshot(&directory, &conversations, &keys).expect("save initial snapshot");
        let blob_path = fs::read_dir(directory.join(BLOBS_DIRECTORY))
            .expect("read blobs")
            .next()
            .expect("blob exists")
            .expect("read blob entry")
            .path();
        let mut bytes = fs::read(&blob_path).expect("read blob");
        let last = bytes.last_mut().expect("blob is nonempty");
        *last ^= 0x01;
        fs::write(&blob_path, bytes).expect("tamper with blob");

        assert!(load_snapshot(&directory, &keys).is_err());

        fs::remove_dir_all(directory).expect("remove fixture directory");
    }
}
