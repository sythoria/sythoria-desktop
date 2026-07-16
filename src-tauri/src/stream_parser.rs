use serde::Deserialize;
use tauri::Emitter;

#[derive(Debug, Deserialize)]
struct StreamChunk {
    choices: Vec<StreamChoice>,
}

#[derive(Debug, Deserialize)]
struct StreamChoice {
    delta: StreamDelta,
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct StreamDelta {
    content: Option<String>,
    #[serde(default)]
    reasoning_content: Option<String>,
    #[serde(default)]
    tool_calls: Option<Vec<StreamToolCallDelta>>,
}

#[derive(Debug, Deserialize)]
struct StreamToolCallDelta {
    #[serde(default)]
    index: Option<usize>,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    function: Option<StreamToolCallFunction>,
}

#[derive(Debug, Deserialize)]
struct StreamToolCallFunction {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    arguments: Option<String>,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StreamChunkPayload<'a> {
    stream_id: &'a str,
    content: &'a str,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StreamDonePayload<'a> {
    stream_id: &'a str,
}

pub(crate) fn emit_stream_chunk(app: &tauri::AppHandle, stream_id: &str, content: &str) {
    let _ = app.emit(
        "chat-stream-chunk",
        StreamChunkPayload { stream_id, content },
    );
}

pub(crate) fn emit_stream_done(app: &tauri::AppHandle, stream_id: &str) {
    let _ = app.emit("chat-stream-done", StreamDonePayload { stream_id });
}

pub(crate) struct SseParser {
    full_content: String,
    full_reasoning: String,
    buffer: String,
    in_reasoning: bool,
    tool_calls: Vec<serde_json::Value>,
    tool_call_ids: Vec<Option<String>>,
    tool_call_names: Vec<Option<String>>,
    tool_call_args: Vec<String>,
}

const MAX_CONTENT_CHARS: usize = 1_000_000;
const MAX_BUFFER_CHARS: usize = 1_000_000;

impl SseParser {
    pub(crate) fn new() -> Self {
        Self {
            full_content: String::new(),
            full_reasoning: String::new(),
            buffer: String::new(),
            in_reasoning: false,
            tool_calls: Vec::new(),
            tool_call_ids: Vec::new(),
            tool_call_names: Vec::new(),
            tool_call_args: Vec::new(),
        }
    }

    pub(crate) fn push_bytes(&mut self, bytes: &[u8]) {
        let incoming = String::from_utf8_lossy(bytes);
        if self.buffer.len() + incoming.len() <= MAX_BUFFER_CHARS {
            self.buffer.push_str(&incoming);
        } else {
            log::warn!(
                "SSE buffer exceeded {} char limit ({}), dropping stale data",
                MAX_BUFFER_CHARS,
                self.buffer.len() + incoming.len()
            );
            if let Some(last_nl) = incoming.rfind('\n') {
                self.buffer = incoming[last_nl + 1..].to_string();
            } else {
                self.buffer.clear();
                self.buffer.push_str(&incoming);
            }
        }
    }

    pub(crate) fn process_lines<F>(&mut self, app: &tauri::AppHandle, stream_id: &str, mut on_chunk: F)
    where
        F: FnMut(&str),
    {
        while let Some(line_end) = self.buffer.find('\n') {
            let line = self.buffer[..line_end].trim().to_string();
            self.buffer = self.buffer[line_end + 1..].to_string();

            if line.is_empty() || line == "data: [DONE]" {
                continue;
            }

            if let Some(data) = line.strip_prefix("data: ") {
                match serde_json::from_str::<StreamChunk>(data) {
                    Ok(parsed) => {
                        for choice in parsed.choices {
            if let Some(reasoning) = choice.delta.reasoning_content {
                if !reasoning.is_empty() {
                    if self.full_content.len() < MAX_CONTENT_CHARS {
                        self.full_reasoning.push_str(&reasoning);
                    }
                    if !self.in_reasoning {
                        self.in_reasoning = true;
                        emit_stream_chunk(app, stream_id, "<reasoning>");
                        on_chunk("<reasoning>");
                    }
                    emit_stream_chunk(app, stream_id, &reasoning);
                    on_chunk(&reasoning);
                }
            }

            if let Some(content) = choice.delta.content {
                let normalized = content
                    .replace("<thinking>", "<reasoning>")
                    .replace("</thinking>", "</reasoning>")
                    .replace("<thought>", "<reasoning>")
                    .replace("</thought>", "</reasoning>");

                if normalized.contains("<reasoning>")
                    || normalized.contains("</reasoning>")
                {
                    let has_open = normalized.contains("<reasoning>");
                    let has_close = normalized.contains("</reasoning>");

                    if has_open && !self.in_reasoning {
                        self.in_reasoning = true;
                    }

                    if self.full_content.len() < MAX_CONTENT_CHARS {
                        self.full_content.push_str(&normalized);
                    }
                    emit_stream_chunk(app, stream_id, &normalized);
                    on_chunk(&normalized);

                    if has_close && self.in_reasoning {
                        self.in_reasoning = false;
                        if self.full_content.len() < MAX_CONTENT_CHARS {
                            if let Some(start) = self.full_content.find("<reasoning>") {
                                if let Some(end) = self.full_content.find("</reasoning>") {
                                    self.full_reasoning = self.full_content
                                        [start + "<reasoning>".len()..end]
                                        .to_string();
                                }
                            }
                        }
                    }
                } else {
                    if self.in_reasoning && !normalized.trim().is_empty() {
                        self.in_reasoning = false;
                        emit_stream_chunk(app, stream_id, "</reasoning>");
                        if self.full_content.len() < MAX_CONTENT_CHARS {
                            self.full_content.push_str("</reasoning>");
                        }
                        on_chunk("</reasoning>");
                    }
                    if self.full_content.len() < MAX_CONTENT_CHARS {
                        self.full_content.push_str(&normalized);
                    }
                    emit_stream_chunk(app, stream_id, &normalized);
                    on_chunk(&normalized);
                }
            }

            if let Some(tool_call_deltas) = choice.delta.tool_calls {
                for tc in tool_call_deltas {
                    let idx = tc.index.unwrap_or(0);
                    while self.tool_calls.len() <= idx {
                        self.tool_calls.push(serde_json::Value::Null);
                        self.tool_call_ids.push(None);
                        self.tool_call_names.push(None);
                        self.tool_call_args.push(String::new());
                    }
                    if let Some(id) = tc.id {
                        self.tool_call_ids[idx] = Some(id.clone());
                    }
                    if let Some(func) = tc.function {
                        if let Some(name) = func.name {
                            self.tool_call_names[idx] = Some(name.clone());
                        }
                        if let Some(args) = func.arguments {
                            self.tool_call_args[idx].push_str(&args);
                        }
                    }
                }
            }

            if choice.finish_reason.is_some() {
                if self.in_reasoning {
                    emit_stream_chunk(app, stream_id, "</reasoning>");
                    if self.full_content.len() < MAX_CONTENT_CHARS {
                        self.full_content.push_str("</reasoning>");
                    }
                    on_chunk("</reasoning>");
                    self.in_reasoning = false;
                }
                emit_stream_done(app, stream_id);
            }
                        }
                    }
                    Err(e) => {
                        log::warn!(
                            "SSE parse warning: skipping malformed chunk ({} bytes): {}",
                            data.len(),
                            e
                        );
                    }
                }
            }
        }
    }

    pub(crate) fn finalize(&mut self) -> String {
        if !self.full_reasoning.is_empty()
            && !self.full_content.contains("<reasoning>")
        {
            self.full_content = format!(
                "<reasoning>{}</reasoning>{}",
                self.full_reasoning, self.full_content
            );
        }
        self.full_content.clone()
    }

    pub(crate) fn finalize_tools(&mut self) -> String {
        let content = self.finalize();

        let tool_calls: Vec<serde_json::Value> = self
            .tool_call_ids
            .iter()
            .zip(self.tool_call_names.iter())
            .zip(self.tool_call_args.iter())
            .filter_map(|((id, name), args)| {
                let name = name.as_deref()?;
                Some(serde_json::json!({
                    "id": id.as_deref().unwrap_or(""),
                    "type": "function",
                    "function": {
                        "name": name,
                        "arguments": args.clone()
                    }
                }))
            })
            .collect();

        let has_tool_calls = !tool_calls.is_empty();
        let content_value = if content.is_empty() {
            serde_json::Value::Null
        } else {
            serde_json::Value::String(content)
        };

        let mut msg = serde_json::json!({
            "content": content_value,
        });
        if has_tool_calls {
            msg["tool_calls"] = serde_json::Value::Array(tool_calls);
        }

        serde_json::json!({
            "choices": [{
                "message": msg
            }]
        })
        .to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_parser_is_empty() {
        let parser = SseParser::new();
        assert!(parser.full_content.is_empty());
        assert!(parser.full_reasoning.is_empty());
        assert!(parser.buffer.is_empty());
        assert!(!parser.in_reasoning);
    }

    #[test]
    fn test_finalize_without_reasoning() {
        let mut parser = SseParser::new();
        parser.full_content = "Hello world".to_string();
        assert_eq!(parser.finalize(), "Hello world");
    }

    #[test]
    fn test_finalize_with_reasoning_prepend() {
        let mut parser = SseParser::new();
        parser.full_reasoning = "I need to think".to_string();
        parser.full_content = "The answer is 42".to_string();
        let result = parser.finalize();
        assert_eq!(result, "<reasoning>I need to think</reasoning>The answer is 42");
    }

    #[test]
    fn test_finalize_with_existing_reasoning_tag() {
        let mut parser = SseParser::new();
        parser.full_reasoning = "thinking".to_string();
        parser.full_content = "<reasoning>already tagged</reasoning>content".to_string();
        let result = parser.finalize();
        assert_eq!(result, "<reasoning>already tagged</reasoning>content");
    }

    #[test]
    fn test_tool_call_delta_missing_index() {
        let json = r#"{"choices":[{"delta":{"tool_calls":[{"id":"call_1","function":{"name":"get_weather","arguments":"{\"loc"}}]},"finish_reason":null}]}"#;
        let chunk: StreamChunk = serde_json::from_str(json).unwrap();
        let tc = &chunk.choices[0].delta.tool_calls.as_ref().unwrap()[0];
        assert_eq!(tc.index, None);
        assert_eq!(tc.id.as_deref(), Some("call_1"));
        assert_eq!(tc.function.as_ref().unwrap().name.as_deref(), Some("get_weather"));
    }

    #[test]
    fn test_tool_call_delta_with_index() {
        let json = r#"{"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_2","function":{"name":"search","arguments":"{\"q\":\"t"}}]},"finish_reason":null}]}"#;
        let chunk: StreamChunk = serde_json::from_str(json).unwrap();
        let tc = &chunk.choices[0].delta.tool_calls.as_ref().unwrap()[0];
        assert_eq!(tc.index, Some(1));
    }

    #[test]
    fn test_tool_call_delta_null_index() {
        let json = r#"{"choices":[{"delta":{"tool_calls":[{"index":null,"id":"call_3","function":{"name":"calc","arguments":"42"}}]},"finish_reason":null}]}"#;
        let chunk: StreamChunk = serde_json::from_str(json).unwrap();
        let tc = &chunk.choices[0].delta.tool_calls.as_ref().unwrap()[0];
        assert_eq!(tc.index, None);
    }

    #[test]
    fn test_tool_call_missing_index_parses_and_fills_zero() {
        let data = r#"{"choices":[{"index":0,"delta":{"tool_calls":[{"id":"call_1","function":{"name":"get_weather","arguments":"{\"location\":\"NYC\"}"}}]},"finish_reason":"tool_calls"}]}"#;
        let chunk: StreamChunk = serde_json::from_str(data).unwrap();
        let choices = &chunk.choices;
        assert_eq!(choices.len(), 1);
        let deltas = choices[0].delta.tool_calls.as_ref().unwrap();
        assert_eq!(deltas.len(), 1);
        assert_eq!(deltas[0].index, None);
        assert_eq!(deltas[0].id.as_deref(), Some("call_1"));
        let func = deltas[0].function.as_ref().unwrap();
        assert_eq!(func.name.as_deref(), Some("get_weather"));
        assert_eq!(func.arguments.as_deref(), Some("{\"location\":\"NYC\"}"));
    }
}

pub(crate) struct AnthropicSseParser {
    full_content: String,
    buffer: String,
    tool_calls: Vec<serde_json::Value>,
    current_tool_id: Option<String>,
    current_tool_name: Option<String>,
    current_tool_input: String,
}

impl AnthropicSseParser {
    pub(crate) fn new() -> Self {
        Self {
            full_content: String::new(),
            buffer: String::new(),
            tool_calls: Vec::new(),
            current_tool_id: None,
            current_tool_name: None,
            current_tool_input: String::new(),
        }
    }

    pub(crate) fn push_bytes(&mut self, bytes: &[u8]) {
        let incoming = String::from_utf8_lossy(bytes);
        self.buffer.push_str(&incoming);
    }

    pub(crate) fn process_lines<F>(&mut self, app: &tauri::AppHandle, stream_id: &str, mut _on_chunk: F)
    where
        F: FnMut(&str),
    {
        while let Some(line_end) = self.buffer.find('\n') {
            let line = self.buffer[..line_end].trim().to_string();
            self.buffer = self.buffer[line_end + 1..].to_string();

            if line.is_empty() {
                continue;
            }

            if line.starts_with("event: ") {
                // Handle events if needed
                continue;
            }

            if let Some(data) = line.strip_prefix("data: ") {
                if data == "[DONE]" {
                    continue;
                }
                
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                    if let Some(type_str) = parsed.get("type").and_then(|v| v.as_str()) {
                        match type_str {
                            "content_block_start" => {
                                if let Some(cb) = parsed.get("content_block") {
                                    if cb.get("type").and_then(|v| v.as_str()) == Some("tool_use") {
                                        self.current_tool_id = cb.get("id").and_then(|v| v.as_str()).map(|s| s.to_string());
                                        self.current_tool_name = cb.get("name").and_then(|v| v.as_str()).map(|s| s.to_string());
                                        self.current_tool_input.clear();
                                    }
                                }
                            }
                            "content_block_delta" => {
                                if let Some(delta) = parsed.get("delta") {
                                    if delta.get("type").and_then(|v| v.as_str()) == Some("text_delta") {
                                        if let Some(text) = delta.get("text").and_then(|v| v.as_str()) {
                                            self.full_content.push_str(text);
                                            emit_stream_chunk(app, stream_id, text);
                                        }
                                    } else if delta.get("type").and_then(|v| v.as_str()) == Some("input_json_delta") {
                                        if let Some(partial_json) = delta.get("partial_json").and_then(|v| v.as_str()) {
                                            self.current_tool_input.push_str(partial_json);
                                        }
                                    }
                                }
                            }
                            "content_block_stop" => {
                                if let (Some(id), Some(name)) = (&self.current_tool_id, &self.current_tool_name) {
                                    self.tool_calls.push(serde_json::json!({
                                        "id": id,
                                        "type": "function",
                                        "function": {
                                            "name": name,
                                            "arguments": self.current_tool_input.clone()
                                        }
                                    }));
                                    self.current_tool_id = None;
                                    self.current_tool_name = None;
                                    self.current_tool_input.clear();
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
        }
    }

    pub(crate) fn finalize(self) -> String {
        self.full_content
    }

    pub(crate) fn finalize_tools(self) -> String {
        let openai_response = serde_json::json!({
            "choices": [{
                "message": {
                    "content": if self.full_content.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(self.full_content) },
                    "tool_calls": if self.tool_calls.is_empty() { serde_json::Value::Null } else { serde_json::Value::Array(self.tool_calls) }
                }
            }]
        });
        openai_response.to_string()
    }
}
