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

pub const DEFAULT_SPOTIFY_CLIENT_ID: &str = "65b708073fc0480ea92a077233ca87bd";
pub const DEFAULT_SPOTIFY_SCOPE: &str = "user-read-private user-read-email user-read-playback-state user-modify-playback-state user-read-currently-playing user-read-recently-played user-read-playback-position user-top-read user-library-read user-library-modify user-follow-read user-follow-modify playlist-read-private playlist-read-collaborative playlist-modify-public playlist-modify-private";

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

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GoogleMcpTokenPaths {
    pub oauth_keys_path: String,
    pub token_path: String,
    pub credentials_path: String,
}

/// Saves Google OAuth tokens into structured credential files for MCP servers.
#[tauri::command]
pub async fn save_google_mcp_tokens(
    app: tauri::AppHandle,
    client_id: Option<String>,
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    scope: Option<String>,
) -> Result<GoogleMcpTokenPaths, AppError> {
    use tauri::Manager;
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::AppPath(format!("Failed to get app data directory: {e}")))?;

    let google_dir = app_dir.join("google-oauth");
    std::fs::create_dir_all(&google_dir)
        .map_err(|e| AppError::AppPath(format!("Failed to create google-oauth directory: {e}")))?;

    let cid = client_id.unwrap_or_else(|| DEFAULT_GOOGLE_CLIENT_ID.to_string());

    // 1. gcp-oauth.keys.json
    let oauth_keys = serde_json::json!({
        "installed": {
            "client_id": cid,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": ["http://127.0.0.1:54321/oauth/callback", "http://localhost"]
        }
    });
    let oauth_keys_path = google_dir.join("gcp-oauth.keys.json");
    crate::atomic_file::write_atomic(
        &oauth_keys_path,
        serde_json::to_string_pretty(&oauth_keys).unwrap_or_default().as_bytes(),
    )
    .map_err(|e| AppError::AppPath(format!("Failed to write gcp-oauth.keys.json: {e}")))?;

    // 2. tokens.json
    let expiry_date = chrono::Utc::now().timestamp_millis() + (expires_in.unwrap_or(3600) as i64 * 1000);
    let mut token_obj = serde_json::json!({
        "access_token": access_token,
        "token_type": "Bearer",
        "expiry_date": expiry_date,
        "scope": scope.clone().unwrap_or_default()
    });
    if let Some(ref rt) = refresh_token {
        token_obj["refresh_token"] = serde_json::Value::String(rt.clone());
    }
    let token_path = google_dir.join("tokens.json");
    crate::atomic_file::write_atomic(
        &token_path,
        serde_json::to_string_pretty(&token_obj).unwrap_or_default().as_bytes(),
    )
    .map_err(|e| AppError::AppPath(format!("Failed to write tokens.json: {e}")))?;

    // 3. credentials.json for Gmail / Python
    let scopes_vec: Vec<String> = scope
        .unwrap_or_default()
        .split_whitespace()
        .map(|s| s.to_string())
        .collect();
    let mut creds_obj = serde_json::json!({
        "token": access_token,
        "token_uri": "https://oauth2.googleapis.com/token",
        "client_id": cid,
        "scopes": scopes_vec
    });
    if let Some(ref rt) = refresh_token {
        creds_obj["refresh_token"] = serde_json::Value::String(rt.clone());
    }
    let credentials_path = google_dir.join("credentials.json");
    crate::atomic_file::write_atomic(
        &credentials_path,
        serde_json::to_string_pretty(&creds_obj).unwrap_or_default().as_bytes(),
    )
    .map_err(|e| AppError::AppPath(format!("Failed to write credentials.json: {e}")))?;

    // Also populate user's home paths (~/.config/google-drive-mcp, ~/.gmail-mcp, ~/.gdrive-server-credentials.json)
    if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        let home_path = std::path::PathBuf::from(home);

        let legacy_gdrive_path = home_path.join(".gdrive-server-credentials.json");
        let _ = crate::atomic_file::write_atomic(
            &legacy_gdrive_path,
            serde_json::to_string_pretty(&token_obj).unwrap_or_default().as_bytes(),
        );

        let cfg_gdrive = home_path.join(".config").join("google-drive-mcp");
        if std::fs::create_dir_all(&cfg_gdrive).is_ok() {
            let _ = crate::atomic_file::write_atomic(
                &cfg_gdrive.join("gcp-oauth.keys.json"),
                serde_json::to_string_pretty(&oauth_keys).unwrap_or_default().as_bytes(),
            );
            let _ = crate::atomic_file::write_atomic(
                &cfg_gdrive.join("tokens.json"),
                serde_json::to_string_pretty(&token_obj).unwrap_or_default().as_bytes(),
            );
        }

        let gmail_dir = home_path.join(".gmail-mcp");
        if std::fs::create_dir_all(&gmail_dir).is_ok() {
            let _ = crate::atomic_file::write_atomic(
                &gmail_dir.join("credentials.json"),
                serde_json::to_string_pretty(&creds_obj).unwrap_or_default().as_bytes(),
            );
            let _ = crate::atomic_file::write_atomic(
                &gmail_dir.join("tokens.json"),
                serde_json::to_string_pretty(&token_obj).unwrap_or_default().as_bytes(),
            );
        }
    }

    Ok(GoogleMcpTokenPaths {
        oauth_keys_path: oauth_keys_path.to_string_lossy().to_string(),
        token_path: token_path.to_string_lossy().to_string(),
        credentials_path: credentials_path.to_string_lossy().to_string(),
    })
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SpotifyTokenResponse {
    pub access_token: String,
    pub token_type: Option<String>,
    pub expires_in: Option<u64>,
    pub refresh_token: Option<String>,
    pub scope: Option<String>,
    pub error: Option<String>,
    pub error_description: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SpotifyMcpTokenPaths {
    pub token_path: String,
}

/// Exchanges authorization code + PKCE code_verifier for a Spotify access & refresh token.
#[tauri::command]
pub async fn spotify_exchange_token(
    client_id: Option<String>,
    code: String,
    code_verifier: String,
    redirect_uri: String,
) -> Result<SpotifyTokenResponse, AppError> {
    crate::ensure_online()?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::RequestFailed(format!("Failed to initialize HTTP client: {e}")))?;

    let cid = client_id.unwrap_or_else(|| DEFAULT_SPOTIFY_CLIENT_ID.to_string());

    let form_body = format!(
        "grant_type=authorization_code&client_id={}&redirect_uri={}&code={}&code_verifier={}",
        urlencoding::encode(&cid),
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(&code),
        urlencoding::encode(&code_verifier)
    );

    let response = client
        .post("https://accounts.spotify.com/api/token")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Accept", "application/json")
        .header("User-Agent", "Sythoria-Desktop")
        .body(form_body)
        .send()
        .await
        .map_err(|e| AppError::RequestFailed(format!("Failed to reach Spotify OAuth token API: {e}")))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::RequestFailed(format!(
            "Spotify token exchange failed with HTTP {status}: {body}"
        )));
    }

    let result: SpotifyTokenResponse = response
        .json()
        .await
        .map_err(|e| AppError::ParseError(format!("Failed to parse Spotify token response: {e}")))?;

    if let Some(err) = result.error {
        let desc = result.error_description.unwrap_or_default();
        return Err(AppError::RequestFailed(format!("Spotify OAuth error: {err} - {desc}")));
    }

    Ok(result)
}

/// Saves Spotify OAuth tokens into ~/.spotify-mcp/tokens.json for the spotify-mcp server.
#[tauri::command]
pub async fn save_spotify_mcp_tokens(
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
) -> Result<SpotifyMcpTokenPaths, AppError> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| AppError::AppPath("Could not determine user home directory".to_string()))?;

    let spotify_dir = std::path::PathBuf::from(home).join(".spotify-mcp");
    std::fs::create_dir_all(&spotify_dir)
        .map_err(|e| AppError::AppPath(format!("Failed to create .spotify-mcp directory: {e}")))?;

    let expires_at = chrono::Utc::now().timestamp_millis() + (expires_in.unwrap_or(3600) as i64 * 1000);
    let mut token_obj = serde_json::json!({
        "access_token": access_token,
        "expires_at": expires_at,
    });
    if let Some(ref rt) = refresh_token {
        token_obj["refresh_token"] = serde_json::Value::String(rt.clone());
    }

    let token_path = spotify_dir.join("tokens.json");
    crate::atomic_file::write_atomic(
        &token_path,
        serde_json::to_string_pretty(&token_obj).unwrap_or_default().as_bytes(),
    )
    .map_err(|e| AppError::AppPath(format!("Failed to write Spotify tokens.json: {e}")))?;

    Ok(SpotifyMcpTokenPaths {
        token_path: token_path.to_string_lossy().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_spotify_token_response_deserialization() {
        let json_data = r#"{
            "access_token": "mock_spotify_access_token",
            "token_type": "Bearer",
            "scope": "user-read-private playlist-read-private",
            "expires_in": 3600,
            "refresh_token": "mock_spotify_refresh_token"
        }"#;

        let res: Result<SpotifyTokenResponse, _> = serde_json::from_str(json_data);
        assert!(res.is_ok());
        let token = res.unwrap();
        assert_eq!(token.access_token, "mock_spotify_access_token");
        assert_eq!(token.refresh_token.as_deref(), Some("mock_spotify_refresh_token"));
        assert_eq!(token.expires_in, Some(3600));
        assert_eq!(token.token_type.as_deref(), Some("Bearer"));
    }

    #[test]
    fn test_spotify_token_error_deserialization() {
        let json_data = r#"{
            "error": "invalid_grant",
            "error_description": "Invalid authorization code"
        }"#;

        let res: Result<SpotifyTokenResponse, _> = serde_json::from_str(json_data);
        assert!(res.is_err()); // access_token is mandatory on success
    }
}

