use crate::AppError;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

pub const DEFAULT_GITHUB_CLIENT_ID: &str = "Ov23liEBjp5NydEwaPFX";
pub const DEFAULT_GITHUB_SCOPE: &str = "repo,read:user,workflow";

pub const DEFAULT_LINEAR_CLIENT_ID: &str = "4c8cf80a34931c6e5b6338c9df74f1f8";
pub const DEFAULT_LINEAR_SCOPE: &str = "read,write,issues:create";

pub const DEFAULT_GOOGLE_CLIENT_ID: &str = "566025429774-vh5b4ie4edatstbismtj0d5ku233ndlk.apps.googleusercontent.com";
pub const DEFAULT_GOOGLE_SCOPE: &str = "openid email profile https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.readonly";

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

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct OAuthCallbackResponse {
    pub code: String,
    pub state: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LinearTokenResponse {
    pub access_token: String,
    pub token_type: Option<String>,
    pub expires_in: Option<u64>,
    pub scope: Option<serde_json::Value>,
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

/// Starts a temporary local loopback HTTP listener to catch the OAuth authorization callback redirect.
#[tauri::command]
pub async fn listen_oauth_callback(
    port: u16,
    expected_state: Option<String>,
) -> Result<OAuthCallbackResponse, AppError> {
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|e| AppError::RequestFailed(format!("Failed to bind local OAuth loopback on port {port}: {e}")))?;

    // 120-second timeout for user to approve in browser
    let accept_future = async {
        let (mut stream, _) = listener.accept().await?;
        let (reader, mut writer) = stream.split();
        let mut buf_reader = BufReader::new(reader);
        let mut request_line = String::new();
        buf_reader.read_line(&mut request_line).await?;

        // Parse: GET /oauth/callback?code=abc&state=xyz HTTP/1.1
        let parts: Vec<&str> = request_line.split_whitespace().collect();
        if parts.len() < 2 {
            return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "Invalid HTTP request"));
        }

        let path = parts[1];
        let query_string = path.split_once('?').map(|(_, q)| q).unwrap_or("");
        let query_params: HashMap<String, String> = query_string
            .split('&')
            .filter_map(|pair| {
                let mut split = pair.splitn(2, '=');
                let key = split.next()?;
                let val = split.next().unwrap_or("");
                Some((key.to_string(), val.to_string()))
            })
            .collect();

        let code = query_params
            .get("code")
            .cloned()
            .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "OAuth code parameter missing in callback"))?;

        let state = query_params.get("state").cloned();

        // Send a sleek HTML confirmation response to the user's browser
        let html_body = r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sythoria - Authorization Successful</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #0d0d0e;
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 1rem;
      box-sizing: border-box;
    }
    .card {
      background: #141415;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 1.25rem;
      padding: 2.5rem 2rem;
      text-align: center;
      max-width: 420px;
      width: 100%;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
    }
    .icon-badge {
      width: 52px;
      height: 52px;
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.3);
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 1.25rem;
      color: #10b981;
      font-size: 26px;
    }
    h1 {
      font-size: 1.35rem;
      font-weight: 700;
      margin: 0 0 0.5rem;
      letter-spacing: -0.02em;
    }
    p {
      font-size: 0.875rem;
      color: #9ca3af;
      margin: 0;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon-badge">&#10003;</div>
    <h1>Authorization Successful!</h1>
    <p>Sythoria has successfully connected to your account. You can now close this browser tab and return to the application.</p>
  </div>
</body>
</html>"#;

        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            html_body.len(),
            html_body
        );

        let _ = writer.write_all(response.as_bytes()).await;
        let _ = writer.flush().await;

        Ok::<OAuthCallbackResponse, std::io::Error>(OAuthCallbackResponse { code, state })
    };

    let result = tokio::time::timeout(std::time::Duration::from_secs(120), accept_future)
        .await
        .map_err(|_| AppError::RequestFailed("OAuth authorization timed out. Please try connecting again.".to_string()))?
        .map_err(|e| AppError::RequestFailed(format!("OAuth loopback error: {e}")))?;

    if let Some(expected) = expected_state {
        if result.state.as_deref() != Some(&expected) {
            return Err(AppError::RequestFailed("OAuth state parameter mismatch (CSRF check failed)".to_string()));
        }
    }

    Ok(result)
}

/// Exchanges authorization code + PKCE code_verifier for a Linear access token.
#[tauri::command]
pub async fn linear_exchange_token(
    client_id: Option<String>,
    code: String,
    code_verifier: String,
    redirect_uri: String,
) -> Result<LinearTokenResponse, AppError> {
    crate::ensure_online()?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::RequestFailed(format!("Failed to initialize HTTP client: {e}")))?;

    let cid = client_id.unwrap_or_else(|| DEFAULT_LINEAR_CLIENT_ID.to_string());

    let form_body = format!(
        "grant_type=authorization_code&client_id={}&redirect_uri={}&code={}&code_verifier={}",
        urlencoding::encode(&cid),
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(&code),
        urlencoding::encode(&code_verifier)
    );

    let response = client
        .post("https://api.linear.app/oauth/token")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Accept", "application/json")
        .header("User-Agent", "Sythoria-Desktop")
        .body(form_body)
        .send()
        .await
        .map_err(|e| AppError::RequestFailed(format!("Failed to reach Linear OAuth token API: {e}")))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::RequestFailed(format!(
            "Linear token exchange failed with HTTP {status}: {body}"
        )));
    }

    let result: LinearTokenResponse = response
        .json()
        .await
        .map_err(|e| AppError::ParseError(format!("Failed to parse Linear token response: {e}")))?;

    if let Some(err) = result.error {
        let desc = result.error_description.unwrap_or_default();
        return Err(AppError::RequestFailed(format!("Linear OAuth error: {err} - {desc}")));
    }

    Ok(result)
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GoogleTokenResponse {
    pub access_token: String,
    pub token_type: Option<String>,
    pub expires_in: Option<u64>,
    pub refresh_token: Option<String>,
    pub scope: Option<String>,
    pub id_token: Option<String>,
    pub error: Option<String>,
    pub error_description: Option<String>,
}

/// Exchanges authorization code + PKCE code_verifier for a Google access token.
#[tauri::command]
pub async fn google_exchange_token(
    client_id: Option<String>,
    code: String,
    code_verifier: String,
    redirect_uri: String,
) -> Result<GoogleTokenResponse, AppError> {
    crate::ensure_online()?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::RequestFailed(format!("Failed to initialize HTTP client: {e}")))?;

    let cid = client_id.unwrap_or_else(|| DEFAULT_GOOGLE_CLIENT_ID.to_string());

    let form_body = format!(
        "grant_type=authorization_code&client_id={}&redirect_uri={}&code={}&code_verifier={}",
        urlencoding::encode(&cid),
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(&code),
        urlencoding::encode(&code_verifier)
    );

    let response = client
        .post("https://oauth2.googleapis.com/token")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Accept", "application/json")
        .header("User-Agent", "Sythoria-Desktop")
        .body(form_body)
        .send()
        .await
        .map_err(|e| AppError::RequestFailed(format!("Failed to reach Google OAuth token API: {e}")))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::RequestFailed(format!(
            "Google token exchange failed with HTTP {status}: {body}"
        )));
    }

    let result: GoogleTokenResponse = response
        .json()
        .await
        .map_err(|e| AppError::ParseError(format!("Failed to parse Google token response: {e}")))?;

    if let Some(err) = result.error {
        let desc = result.error_description.unwrap_or_default();
        return Err(AppError::RequestFailed(format!("Google OAuth error: {err} - {desc}")));
    }

    Ok(result)
}
