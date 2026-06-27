pub mod custom;
pub mod firecrawl;
pub mod google;
pub mod searxng;

use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;
use std::time::Duration;

use futures_util::StreamExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UrlContent {
    pub url: String,
    pub title: String,
    pub content: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
#[allow(dead_code)]
pub enum SearchErrorResponse {
    RequestFailed { message: String },
    ParseError { message: String },
    ConfigError { message: String },
    UrlValidationError { message: String },
    HttpError { status: u16, message: String },
}

#[derive(Debug, thiserror::Error)]
pub enum SearchError {
    #[error("Request failed: {0}")]
    RequestFailed(String),
    #[error("Parse error: {0}")]
    ParseError(String),
    #[error("Config error: {0}")]
    ConfigError(String),
    #[error("URL validation error: {0}")]
    UrlValidationError(String),
}

#[allow(dead_code)]
impl SearchError {
    pub fn to_response(&self) -> SearchErrorResponse {
        match self {
            SearchError::RequestFailed(msg) => SearchErrorResponse::RequestFailed {
                message: msg.clone(),
            },
            SearchError::ParseError(msg) => SearchErrorResponse::ParseError {
                message: msg.clone(),
            },
            SearchError::ConfigError(msg) => SearchErrorResponse::ConfigError {
                message: msg.clone(),
            },
            SearchError::UrlValidationError(msg) => SearchErrorResponse::UrlValidationError {
                message: msg.clone(),
            },
        }
    }

    pub fn to_response_with_status(&self, status: u16) -> SearchErrorResponse {
        match self {
            SearchError::RequestFailed(msg)
            | SearchError::ParseError(msg)
            | SearchError::ConfigError(msg)
            | SearchError::UrlValidationError(msg) => SearchErrorResponse::HttpError {
                status,
                message: msg.clone(),
            },
        }
    }
}

static BLOCKED_HOSTNAMES: LazyLock<Vec<&str>> = LazyLock::new(|| {
    vec![
        "localhost",
        "127.0.0.1",
        "0.0.0.0",
        "::1",
        "169.254.169.254",
        "metadata.google.internal",
        "metadata.azure.com",
        "100.100.100.200",
    ]
});

static SELECTOR_TITLE: LazyLock<Selector> = LazyLock::new(|| Selector::parse("title").unwrap());
static SELECTOR_BODY: LazyLock<Selector> = LazyLock::new(|| Selector::parse("body").unwrap());
const MAX_FETCH_BYTES: usize = 5_000_000;
const MAX_RETURN_BYTES: usize = 500_000;
const MAX_REDIRECTS: usize = 5;

fn validate_url(url: &str) -> Result<url::Url, SearchError> {
    let parsed = url::Url::parse(url)
        .map_err(|e| SearchError::UrlValidationError(format!("Invalid URL: {}", e)))?;

    match parsed.scheme() {
        "https" => {}
        "http" => {
            log::warn!(
                "Fetching over unencrypted HTTP: {}",
                parsed.host_str().unwrap_or("unknown")
            );
        }
        _ => {
            return Err(SearchError::UrlValidationError(format!(
                "Scheme '{}' not allowed. Only http and https are supported.",
                parsed.scheme()
            )));
        }
    }

    if let Some(host) = parsed.host_str() {
        let host_lower = host.to_lowercase();
        for blocked in BLOCKED_HOSTNAMES.iter() {
            if host_lower == *blocked || host_lower.ends_with(&format!(".{}", blocked)) {
                return Err(SearchError::UrlValidationError(format!(
                    "Hostname '{}' is not allowed for security reasons.",
                    host
                )));
            }
        }

        if let Some(ip) = parsed.host().and_then(|h| match h {
            url::Host::Ipv4(v4) => Some(std::net::IpAddr::V4(v4)),
            url::Host::Ipv6(v6) => Some(std::net::IpAddr::V6(v6)),
            _ => None,
        }) {
            if is_private_or_reserved_ip(&ip) {
                return Err(SearchError::UrlValidationError(format!(
                    "IP address '{}' is not allowed for security reasons.",
                    ip
                )));
            }
        }
    }

    Ok(parsed)
}

fn is_private_or_reserved_ip(ip: &std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => {
            let octets = v4.octets();
            octets[0] == 0
                || octets[0] == 10
                || octets[0] == 127
                || (octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31)
                || (octets[0] == 192 && octets[1] == 168)
                || (octets[0] == 169 && octets[1] == 254)
                || (octets[0] == 100 && octets[1] >= 64 && octets[1] <= 127)
                || (octets[0] == 198 && (octets[1] == 18 || octets[1] == 19))
                || (octets[0] >= 224 && octets[0] <= 239)
                || octets[0] >= 240
        }
        std::net::IpAddr::V6(v6) => {
            let segments = v6.segments();
            (segments[0] & 0xfe00) == 0xfc00
                || (segments[0] & 0xffc0) == 0xfe80
                || v6.is_loopback()
                || v6.is_multicast()
                || v6.is_unspecified()
        }
    }
}

async fn validate_resolved_url(url: &url::Url) -> Result<std::net::IpAddr, SearchError> {
    let host = url
        .host_str()
        .ok_or_else(|| SearchError::UrlValidationError("URL host is required".into()))?;
    let port = url
        .port_or_known_default()
        .ok_or_else(|| SearchError::UrlValidationError("URL port is required".into()))?;

    let resolved = tokio::net::lookup_host((host, port)).await.map_err(|e| {
        SearchError::UrlValidationError(format!("Failed to resolve hostname '{}': {}", host, e))
    })?;

    let mut first_ip = None;
    for addr in resolved {
        if is_private_or_reserved_ip(&addr.ip()) {
            return Err(SearchError::UrlValidationError(format!(
                "Hostname '{}' resolves to blocked IP '{}'.",
                host,
                addr.ip()
            )));
        }
        if first_ip.is_none() {
            first_ip = Some(addr.ip());
        }
    }

    first_ip.ok_or_else(|| {
        SearchError::UrlValidationError(format!(
            "No IP addresses resolved for hostname '{}'.",
            host
        ))
    })
}

pub async fn search(
    provider: &str,
    query: &str,
    config: &serde_json::Value,
) -> Result<Vec<SearchResult>, SearchError> {
    match provider {
        "google" => google::search(query, config).await,
        "searxng" => searxng::search(query, config).await,
        "firecrawl" => firecrawl::search(query, config).await,
        "custom" => custom::search(query, config).await,
        _ => Err(SearchError::ConfigError(format!(
            "Unknown search provider: {}",
            provider
        ))),
    }
}

pub async fn fetch_url(url: &str) -> Result<UrlContent, SearchError> {
    let mut current_url = validate_url(url)?;

    for redirect_count in 0..=MAX_REDIRECTS {
        let validated_ip = validate_resolved_url(&current_url).await?;
        let host = current_url
            .host_str()
            .ok_or_else(|| SearchError::UrlValidationError("URL host is required".into()))?;
        let port = current_url
            .port_or_known_default()
            .ok_or_else(|| SearchError::UrlValidationError("URL port is required".into()))?;

        let socket_addr = std::net::SocketAddr::new(validated_ip, port);

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .resolve(host, socket_addr)
            .build()
            .map_err(|e| SearchError::RequestFailed(e.to_string()))?;

        let resp = client
            .get(current_url.clone())
            .header("User-Agent", "Sythoria/0.1.0 (Desktop AI Assistant)")
            .send()
            .await
            .map_err(|e| SearchError::RequestFailed(e.without_url().to_string()))?;

        if resp.status().is_redirection() {
            if redirect_count >= MAX_REDIRECTS {
                return Err(SearchError::UrlValidationError(format!(
                    "Too many redirects while fetching '{}'.",
                    url
                )));
            }

            let location = resp
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| {
                    SearchError::UrlValidationError("Redirect missing Location header".into())
                })?;

            let next_url = current_url.join(location).map_err(|e| {
                SearchError::UrlValidationError(format!("Invalid redirect URL: {}", e))
            })?;
            current_url = validate_url(next_url.as_str())?;
            continue;
        }

        let status = resp.status();
        if !status.is_success() {
            let status_code = status.as_u16();
            log::error!("Fetch URL HTTP {}: [response body sanitized]", status_code);
            return Ok(UrlContent {
                url: current_url.to_string(),
                title: String::new(),
                content: String::new(),
                status: "error".to_string(),
                error: Some(format!("HTTP {}", status_code)),
            });
        }

        let content_type = resp
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        let is_html = content_type.contains("text/html");

        let Some(body) = read_capped_body(resp, MAX_FETCH_BYTES).await? else {
            return Ok(UrlContent {
                url: current_url.to_string(),
                title: String::new(),
                content: "Content too large to process (exceeded 5MB limit).".to_string(),
                status: "ok".to_string(),
                error: None,
            });
        };

        if is_html {
            let title = extract_title(&body);
            let content = extract_readable_text(&body);
            return Ok(UrlContent {
                url: current_url.to_string(),
                title,
                content,
                status: "ok".to_string(),
                error: None,
            });
        } else {
            let truncated = if body.len() > MAX_RETURN_BYTES {
                truncate_str(&body, MAX_RETURN_BYTES, "500KB")
            } else {
                body
            };
            return Ok(UrlContent {
                url: current_url.to_string(),
                title: current_url.to_string(),
                content: truncated,
                status: "ok".to_string(),
                error: None,
            });
        }
    }

    Err(SearchError::UrlValidationError(format!(
        "Too many redirects while fetching '{}'.",
        url
    )))
}

async fn read_capped_body(
    resp: reqwest::Response,
    max_bytes: usize,
) -> Result<Option<String>, SearchError> {
    let mut stream = resp.bytes_stream();
    let mut bytes = Vec::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| SearchError::RequestFailed(e.without_url().to_string()))?;
        if bytes.len().saturating_add(chunk.len()) > max_bytes {
            return Ok(None);
        }
        bytes.extend_from_slice(&chunk);
    }

    Ok(Some(String::from_utf8_lossy(&bytes).to_string()))
}

fn truncate_str(s: &str, max_bytes: usize, label: &str) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }
    let boundary = s
        .char_indices()
        .take_while(|(i, _)| *i < max_bytes)
        .last()
        .map(|(i, c)| i + c.len_utf8())
        .unwrap_or(0);
    let safe_end = s.floor_char_boundary(boundary);
    format!("{}\n\n[Content truncated at {}]", &s[..safe_end], label)
}

fn extract_title(html: &str) -> String {
    let document = Html::parse_document(html);
    document
        .select(&SELECTOR_TITLE)
        .next()
        .map(|el| el.text().collect::<Vec<_>>().join("").trim().to_string())
        .unwrap_or_default()
}

fn extract_readable_text(html: &str) -> String {
    let document = Html::parse_document(html);

    let body_text = if let Some(body) = document.select(&SELECTOR_BODY).next() {
        let mut text_parts: Vec<String> = Vec::new();
        let mut blocked_depth: u32 = 0;

        for edge in body.traverse() {
            match edge {
                ego_tree::iter::Edge::Open(node_ref) => {
                    if let Some(element) = node_ref.value().as_element() {
                        let tag = element.name();
                        if matches!(tag, "script" | "style" | "nav" | "header" | "footer") {
                            blocked_depth += 1;
                        }
                    }
                    if blocked_depth > 0 {
                        continue;
                    }
                    if let Some(text) = node_ref.value().as_text() {
                        let trimmed = text.text.trim();
                        if !trimmed.is_empty() {
                            text_parts.push(trimmed.to_string());
                        }
                    }
                }
                ego_tree::iter::Edge::Close(node_ref) => {
                    if let Some(element) = node_ref.value().as_element() {
                        let tag = element.name();
                        if matches!(tag, "script" | "style" | "nav" | "header" | "footer") {
                            blocked_depth = blocked_depth.saturating_sub(1);
                        }
                    }
                }
            }
        }

        text_parts.join("\n")
    } else {
        let mut clean_text = String::new();
        for node_ref in document.tree.nodes() {
            if let Some(text) = node_ref.value().as_text() {
                let trimmed = text.text.trim();
                if !trimmed.is_empty() {
                    clean_text.push_str(trimmed);
                    clean_text.push('\n');
                }
            }
        }
        clean_text
    };

    let decoded = html_escape::decode_html_entities(&body_text).to_string();

    let lines: Vec<&str> = decoded
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect();

    let mut result = String::with_capacity(lines.iter().map(|l| l.len() + 1).sum());
    let mut empty_count = 0u8;
    for line in lines.iter() {
        if line.is_empty() {
            empty_count += 1;
            if empty_count <= 2 {
                result.push('\n');
            }
        } else {
            empty_count = 0;
            result.push_str(line);
            result.push('\n');
        }
    }

    let final_text = result.trim().to_string();
    if final_text.len() > 500_000 {
        truncate_str(&final_text, 500_000, "500KB")
    } else {
        final_text
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_url_https() {
        assert!(validate_url("https://example.com").is_ok());
    }

    #[test]
    fn test_validate_url_ftp_rejected() {
        assert!(validate_url("ftp://example.com").is_err());
    }

    #[test]
    fn test_validate_url_file_rejected() {
        assert!(validate_url("file:///etc/passwd").is_err());
    }

    #[test]
    fn test_validate_url_localhost_rejected() {
        assert!(validate_url("http://localhost:8080").is_err());
    }

    #[test]
    fn test_validate_url_127_rejected() {
        assert!(validate_url("http://127.0.0.1:11434").is_err());
    }

    #[test]
    fn test_validate_url_metadata_aws_rejected() {
        assert!(validate_url("http://169.254.169.254/latest/meta-data/").is_err());
    }

    #[test]
    fn test_validate_url_metadata_gcp_rejected() {
        assert!(validate_url("http://metadata.google.internal/computeMetadata/v1/").is_err());
    }

    #[test]
    fn test_validate_url_invalid() {
        assert!(validate_url("not-a-url").is_err());
    }

    #[test]
    fn test_extract_title() {
        let html = r#"<html><head><title>My Page Title</title></head><body>Hello</body></html>"#;
        assert_eq!(extract_title(html), "My Page Title");
    }

    #[test]
    fn test_extract_title_empty() {
        let html = r#"<html><head></head><body>No title</body></html>"#;
        assert_eq!(extract_title(html), "");
    }

    #[test]
    fn test_extract_readable_text_strips_scripts() {
        let html = r#"<html><body><script>alert('xss')</script><p>Hello World</p></body></html>"#;
        let text = extract_readable_text(html);
        assert!(!text.contains("alert"));
        assert!(text.contains("Hello World"));
    }

    #[test]
    fn test_extract_readable_text_strips_styles() {
        let html = r#"<html><body><style>.foo{color:red}</style><p>Content</p></body></html>"#;
        let text = extract_readable_text(html);
        assert!(!text.contains("color:red"));
        assert!(text.contains("Content"));
    }

    #[test]
    fn test_extract_readable_text_nested_blocked() {
        let html = r#"<html><body><nav><div><script>alert('xss')</script></div></nav><p>Visible</p></body></html>"#;
        let text = extract_readable_text(html);
        assert!(!text.contains("alert"));
        assert!(!text.contains("div"));
        assert!(text.contains("Visible"));
    }

    #[test]
    fn test_validate_url_private_10_rejected() {
        assert!(validate_url("http://10.0.0.1/secret").is_err());
    }

    #[test]
    fn test_validate_url_private_172_rejected() {
        assert!(validate_url("http://172.16.0.1/secret").is_err());
        assert!(validate_url("http://172.31.255.255/secret").is_err());
    }

    #[test]
    fn test_validate_url_private_192_168_rejected() {
        assert!(validate_url("http://192.168.1.1/secret").is_err());
    }

    #[test]
    fn test_validate_url_link_local_rejected() {
        assert!(validate_url("http://169.254.1.1/secret").is_err());
    }

    #[test]
    fn test_validate_url_cgnat_rejected() {
        assert!(validate_url("http://100.64.0.1/secret").is_err());
        assert!(validate_url("http://100.127.255.254/secret").is_err());
    }

    #[test]
    fn test_validate_url_ipv6_unique_local_rejected() {
        assert!(validate_url("http://[fd00::1]/secret").is_err());
    }

    #[test]
    fn test_validate_url_public_ip_ok() {
        assert!(validate_url("http://93.184.216.34/").is_ok());
    }

    #[test]
    fn test_truncate_str_multibyte() {
        let s = "a".repeat(3) + "¥" + &"b".repeat(10);
        let truncated = truncate_str(&s, 5, "5B");
        assert!(truncated.starts_with("aaa"));
        assert!(truncated.contains("[Content truncated at 5B]"));
    }
}
