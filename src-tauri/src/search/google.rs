use crate::search::{SearchError, SearchResult};

pub async fn search(
    query: &str,
    config: &serde_json::Value,
) -> Result<Vec<SearchResult>, SearchError> {
    let api_key = config
        .get("apiKey")
        .and_then(|v| v.as_str())
        .ok_or_else(|| SearchError::ConfigError("Missing API key for Google Search".into()))?;

    let cx = config
        .get("cx")
        .and_then(|v| v.as_str())
        .ok_or_else(|| SearchError::ConfigError("Missing CX (Custom Search Engine ID) for Google Search".into()))?;

    let num = config
        .get("maxResults")
        .and_then(|v| v.as_u64())
        .unwrap_or(5)
        .min(10);

    let base_url = config
        .get("baseUrl")
        .and_then(|v| v.as_str())
        .unwrap_or("https://www.googleapis.com/customsearch/v1");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| {
            log::error!("Failed to build HTTP client: {}", e);
            SearchError::RequestFailed(e.to_string())
        })?;

    let url = reqwest::Url::parse_with_params(
        base_url,
        &[
            ("key", api_key),
            ("cx", cx),
            ("q", query),
            ("num", &num.to_string()),
        ],
    )
    .map_err(|e| SearchError::ConfigError(format!("Invalid base URL: {}", e)))?;

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| {
            log::error!("Google search request failed: {}", e);
            SearchError::RequestFailed(e.to_string())
        })?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let _body = resp.text().await.unwrap_or_default();
        log::error!("Google API error {}: [response body sanitized]", status);
        return Err(SearchError::RequestFailed(format!(
            "Google API error {} (response body omitted for security)",
            status
        )));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| {
            log::error!("Failed to parse Google search response: {}", e);
            SearchError::ParseError(e.to_string())
        })?;

    let items = json
        .get("items")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let results: Vec<SearchResult> = items
        .iter()
        .map(|item| SearchResult {
            title: item
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            url: item
                .get("link")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            snippet: item
                .get("snippet")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
        })
        .collect();

    Ok(results)
}
