use crate::AppError;
use serde::{Deserialize, Serialize};

pub const DEFAULT_GITHUB_CLIENT_ID: &str = "Ov23liEBjp5NydEwaPFX";
pub const DEFAULT_GITHUB_SCOPE: &str = "repo,read:user,workflow";

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitHubDeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitHubDeviceTokenResponse {
    pub access_token: Option<String>,
    pub token_type: Option<String>,
    pub scope: Option<String>,
    pub error: Option<String>,
    pub error_description: Option<String>,
}

#[tauri::command]
pub async fn github_start_device_flow(
    client_id: Option<String>,
    scope: Option<String>,
) -> Result<GitHubDeviceCodeResponse, AppError> {
    crate::ensure_online()?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::RequestFailed(format!("Failed to initialize HTTP client: {e}")))?;

    let cid = client_id.unwrap_or_else(|| DEFAULT_GITHUB_CLIENT_ID.to_string());
    let sc = scope.unwrap_or_else(|| DEFAULT_GITHUB_SCOPE.to_string());

    let payload = serde_json::json!({
        "client_id": cid,
        "scope": sc
    });

    let response = client
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .header("User-Agent", "Sythoria-Desktop")
        .json(&payload)
        .send()
        .await
        .map_err(|e| AppError::RequestFailed(format!("Failed to reach GitHub Device Code API: {e}")))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::RequestFailed(format!(
            "GitHub Device Code request failed with HTTP {status}: {body}"
        )));
    }

    let result: GitHubDeviceCodeResponse = response
        .json()
        .await
        .map_err(|e| AppError::ParseError(format!("Failed to parse GitHub Device Code response: {e}")))?;

    Ok(result)
}

#[tauri::command]
pub async fn github_poll_device_token(
    client_id: Option<String>,
    device_code: String,
) -> Result<GitHubDeviceTokenResponse, AppError> {
    crate::ensure_online()?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::RequestFailed(format!("Failed to initialize HTTP client: {e}")))?;

    let cid = client_id.unwrap_or_else(|| DEFAULT_GITHUB_CLIENT_ID.to_string());

    let payload = serde_json::json!({
        "client_id": cid,
        "device_code": device_code,
        "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
    });

    let response = client
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .header("User-Agent", "Sythoria-Desktop")
        .json(&payload)
        .send()
        .await
        .map_err(|e| AppError::RequestFailed(format!("Failed to poll GitHub Access Token API: {e}")))?;

    let result: GitHubDeviceTokenResponse = response
        .json()
        .await
        .map_err(|e| AppError::ParseError(format!("Failed to parse GitHub Access Token response: {e}")))?;

    Ok(result)
}
