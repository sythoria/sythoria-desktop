use crate::search::{SearchError, SearchResult};

pub async fn search(
    query: &str,
    config: &serde_json::Value,
) -> Result<Vec<SearchResult>, SearchError> {
    let base = config
        .get("baseUrl")
        .and_then(|v| v.as_str())
        .ok_or_else(|| SearchError::ConfigError("Missing baseUrl for custom search provider".into()))?;

    if base.trim().is_empty() {
        return Err(SearchError::ConfigError(
            "baseUrl cannot be empty for custom search provider".into(),
        ));
    }

    let num = config
        .get("maxResults")
        .and_then(|v| v.as_u64())
        .unwrap_or(5)
        .min(20) as usize;

    let url = format!(
        "{}{}q={}",
        base.trim_end_matches('/'),
        if base.contains('?') { "&" } else { "?" },
        urlencoding::encode(query)
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| {
            log::error!("Failed to build HTTP client: {}", e);
            SearchError::RequestFailed(e.to_string())
        })?;

    let mut request = client.get(&url);

    if let Some(api_key) = config.get("apiKey").and_then(|v| v.as_str()) {
        if !api_key.is_empty() {
            request = request.header("Authorization", format!("Bearer {}", api_key));
        }
    }

    let resp = request
        .header("User-Agent", "Sythoria/0.1.0")
        .send()
        .await
        .map_err(|e| {
            let sanitized = e.without_url().to_string();
            log::error!("Custom search request failed: {}", sanitized);
            SearchError::RequestFailed(sanitized)
        })?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        log::error!("Custom search API error {}: {}", status, body);
        return Err(SearchError::RequestFailed(format!(
            "Custom search API error {}: {}",
            status, body
        )));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| {
        log::error!("Failed to parse custom search response: {}", e);
        SearchError::ParseError(e.to_string())
    })?;

    let results = if let Some(arr) = json.as_array() {
        arr
    } else if let Some(arr) = json.get("results").and_then(|v| v.as_array()) {
        arr
    } else if let Some(arr) = json.get("data").and_then(|v| v.as_array()) {
        arr
    } else {
        return Ok(vec![]);
    };

    let search_results: Vec<SearchResult> = results
        .iter()
        .take(num)
        .map(|item| SearchResult {
            title: item
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            url: item
                .get("url")
                .or_else(|| item.get("link"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            snippet: item
                .get("snippet")
                .or_else(|| item.get("content"))
                .or_else(|| item.get("description"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
        })
        .filter(|r| !r.url.is_empty())
        .collect();

    Ok(search_results)
}
