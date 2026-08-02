use crate::AppError;
use reqwest::redirect::Policy;
use std::net::{IpAddr, SocketAddr};
use std::time::Duration;
use url::Url;

const MAX_PROVIDER_ERROR_CHARS: usize = 512;

fn redact_json_secrets(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            for (key, value) in map {
                let key = key.to_ascii_lowercase();
                if [
                    "key",
                    "token",
                    "secret",
                    "password",
                    "authorization",
                    "cookie",
                ]
                .iter()
                .any(|sensitive| key.contains(sensitive))
                {
                    *value = serde_json::Value::String("[REDACTED]".to_string());
                } else {
                    redact_json_secrets(value);
                }
            }
        }
        serde_json::Value::Array(values) => values.iter_mut().for_each(redact_json_secrets),
        _ => {}
    }
}

pub(crate) fn sanitize_provider_error(body: &str) -> String {
    let cleaned = if let Ok(mut json) = serde_json::from_str::<serde_json::Value>(body) {
        redact_json_secrets(&mut json);
        serde_json::to_string(&json)
            .unwrap_or_else(|_| "Provider returned an invalid error body".to_string())
    } else {
        let bearer = regex::Regex::new("(?i)bearer\\s+[a-z0-9._~+/-]+")
            .expect("static provider-error redaction regex");
        bearer.replace_all(body, "Bearer [REDACTED]").into_owned()
    };
    let mut chars = cleaned
        .chars()
        .filter(|character| !character.is_control() || *character == '\n');
    let preview: String = chars.by_ref().take(MAX_PROVIDER_ERROR_CHARS).collect();
    if chars.next().is_some() {
        format!("{preview}...")
    } else {
        preview
    }
}

pub struct ValidatedHttpEndpoint {
    pub url: Url,
    pub client: reqwest::Client,
}

pub struct ValidatedWebSocketEndpoint {
    pub url: Url,
    pub address: SocketAddr,
}

fn is_local_address(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => ip.is_loopback() || ip.is_private() || ip.is_link_local(),
        IpAddr::V6(ip) => ip.is_loopback() || ip.is_unique_local() || ip.is_unicast_link_local(),
    }
}

fn host_matches_blocklist(host: &str, blocked_hosts: &[String]) -> bool {
    let host = host.to_lowercase();
    blocked_hosts.iter().any(|blocked| {
        let blocked = blocked.to_lowercase();
        if blocked.contains('/') {
            false
        } else if blocked.contains('*') {
            crate::search::matches_wildcard(&host, &blocked)
        } else {
            host == blocked || host.ends_with(&format!(".{blocked}"))
        }
    })
}

async fn parse_and_resolve(
    raw_url: &str,
    allowed_schemes: &[&str],
    allow_local_network: bool,
    has_secret: bool,
) -> Result<(Url, String, Vec<SocketAddr>), AppError> {
    let parsed = Url::parse(raw_url)
        .map_err(|error| AppError::UrlValidationError(format!("Invalid endpoint URL: {error}")))?;
    if !allowed_schemes.contains(&parsed.scheme()) {
        return Err(AppError::UrlValidationError(format!(
            "Endpoint must use one of these protocols: {}",
            allowed_schemes.join(", ")
        )));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(AppError::UrlValidationError(
            "Endpoint URLs cannot contain embedded credentials".to_string(),
        ));
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| {
            AppError::UrlValidationError("Endpoint must include a hostname".to_string())
        })?
        .to_string();
    let port = parsed.port_or_known_default().ok_or_else(|| {
        AppError::UrlValidationError("Endpoint must include a valid port".to_string())
    })?;
    let addresses: Vec<SocketAddr> = tokio::net::lookup_host((host.as_str(), port))
        .await
        .map_err(|error| {
            AppError::UrlValidationError(format!("Endpoint DNS resolution failed: {error}"))
        })?
        .collect();
    if addresses.is_empty() {
        return Err(AppError::UrlValidationError(
            "Endpoint DNS resolution returned no addresses".to_string(),
        ));
    }
    if addresses
        .iter()
        .any(|address| address.ip().is_unspecified())
    {
        return Err(AppError::UrlValidationError(
            "Unspecified network addresses are not valid endpoints".to_string(),
        ));
    }

    let blocked_hosts = crate::get_blocked_hosts();
    let blocked_host = host_matches_blocklist(&host, &blocked_hosts);
    let blocked_address = addresses
        .iter()
        .any(|address| crate::search::is_ip_blocked(&address.ip(), &blocked_hosts));
    let all_local = addresses
        .iter()
        .all(|address| is_local_address(&address.ip()));
    if (blocked_host || blocked_address) && !(allow_local_network && all_local) {
        return Err(AppError::UrlValidationError(format!(
            "Access denied: Endpoint '{host}' is blocked by the network policy"
        )));
    }

    let is_plaintext = matches!(parsed.scheme(), "http" | "ws");
    if is_plaintext && !(allow_local_network && addresses.iter().all(|a| a.ip().is_loopback())) {
        let reason = if has_secret {
            "Credentials may only use plaintext transport to an explicitly trusted loopback endpoint"
        } else {
            "Plaintext transport is only allowed for an explicitly trusted loopback endpoint"
        };
        return Err(AppError::UrlValidationError(reason.to_string()));
    }

    Ok((parsed, host, addresses))
}

pub async fn validate_http_endpoint(
    raw_url: &str,
    allow_local_network: bool,
    has_secret: bool,
    timeout: Duration,
) -> Result<ValidatedHttpEndpoint, AppError> {
    let (url, host, addresses) =
        parse_and_resolve(raw_url, &["http", "https"], allow_local_network, has_secret).await?;
    let client = crate::client_builder()
        .redirect(Policy::none())
        .resolve_to_addrs(&host, &addresses)
        .timeout(timeout)
        .build()
        .map_err(AppError::from)?;
    Ok(ValidatedHttpEndpoint { url, client })
}

pub async fn validate_websocket_endpoint(
    raw_url: &str,
    allow_local_network: bool,
    has_secret: bool,
) -> Result<ValidatedWebSocketEndpoint, AppError> {
    let (url, _host, addresses) =
        parse_and_resolve(raw_url, &["ws", "wss"], allow_local_network, has_secret).await?;
    Ok(ValidatedWebSocketEndpoint {
        url,
        address: addresses[0],
    })
}

#[cfg(test)]
mod tests {
    use super::{sanitize_provider_error, validate_http_endpoint, validate_websocket_endpoint};
    use std::time::Duration;

    #[tokio::test]
    async fn local_http_requires_explicit_trust() {
        assert!(validate_http_endpoint(
            "http://127.0.0.1:11434/v1/chat/completions",
            false,
            false,
            Duration::from_secs(1),
        )
        .await
        .is_err());
        assert!(validate_http_endpoint(
            "http://127.0.0.1:11434/v1/chat/completions",
            true,
            false,
            Duration::from_secs(1),
        )
        .await
        .is_ok());
    }

    #[tokio::test]
    async fn plaintext_remote_and_embedded_credentials_are_rejected() {
        assert!(validate_http_endpoint(
            "http://93.184.216.34/api",
            true,
            false,
            Duration::from_secs(1),
        )
        .await
        .is_err());
        assert!(validate_http_endpoint(
            "https://user:password@93.184.216.34/api",
            false,
            true,
            Duration::from_secs(1),
        )
        .await
        .is_err());
    }

    #[tokio::test]
    async fn local_websocket_requires_explicit_trust() {
        assert!(
            validate_websocket_endpoint("ws://127.0.0.1:8000", false, false)
                .await
                .is_err()
        );
        assert!(
            validate_websocket_endpoint("ws://127.0.0.1:8000", true, false)
                .await
                .is_ok()
        );
    }

    #[test]
    fn provider_errors_are_bounded_and_secret_fields_are_redacted() {
        let sanitized = sanitize_provider_error(
            r#"{"error":"failed","apiKey":"secret-value","nested":{"access_token":"token-value"}}"#,
        );
        assert!(sanitized.contains("[REDACTED]"));
        assert!(!sanitized.contains("secret-value"));
        assert!(!sanitized.contains("token-value"));

        let bearer = sanitize_provider_error(&format!("Bearer secret-token {}", "x".repeat(600)));
        assert!(bearer.contains("Bearer [REDACTED]"));
        assert!(!bearer.contains("secret-token"));
        assert!(bearer.ends_with("..."));
    }
}
