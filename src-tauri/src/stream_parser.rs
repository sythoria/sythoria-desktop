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
    reasoning: Option<String>,
    #[serde(default)]
    reasoning_details: Option<Vec<serde_json::Value>>,
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
    buffer: Vec<u8>,
    in_reasoning: bool,
    tool_calls: Vec<serde_json::Value>,
    tool_call_ids: Vec<Option<String>>,
    tool_call_names: Vec<Option<String>>,
    tool_call_args: Vec<String>,
    reasoning_details: Vec<serde_json::Value>,
    total_tool_argument_bytes: usize,
    terminal: SseStreamTerminal,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum SseStreamTerminal {
    Streaming,
    Complete,
    Error(String),
}

const MAX_INCOMING_CHUNK_BYTES: usize = 1_000_000;
const MAX_BUFFER_BYTES: usize = 1_000_000;
const MAX_EVENT_LINE_BYTES: usize = 256_000;
const MAX_CONTENT_BYTES: usize = 1_000_000;
const MAX_TOOL_CALLS: usize = 64;
const MAX_TOOL_ARGUMENT_BYTES: usize = 1_000_000;
const MAX_TOOL_METADATA_BYTES: usize = 4_096;

fn limit_error(resource: &str, limit: usize) -> String {
    format!("SSE {resource} exceeded the {limit}-byte resource limit")
}

fn checked_total(current: usize, additional: usize, limit: usize) -> bool {
    current
        .checked_add(additional)
        .is_some_and(|total| total <= limit)
}

impl SseParser {
    pub(crate) fn new() -> Self {
        Self {
            full_content: String::new(),
            full_reasoning: String::new(),
            buffer: Vec::new(),
            in_reasoning: false,
            tool_calls: Vec::new(),
            tool_call_ids: Vec::new(),
            tool_call_names: Vec::new(),
            tool_call_args: Vec::new(),
            reasoning_details: Vec::new(),
            total_tool_argument_bytes: 0,
            terminal: SseStreamTerminal::Streaming,
        }
    }

    pub(crate) fn push_bytes(&mut self, bytes: &[u8]) {
        if self.terminal != SseStreamTerminal::Streaming {
            return;
        }
        if bytes.len() > MAX_INCOMING_CHUNK_BYTES {
            self.fail(limit_error("incoming chunk", MAX_INCOMING_CHUNK_BYTES));
            return;
        }
        if !checked_total(self.buffer.len(), bytes.len(), MAX_BUFFER_BYTES) {
            self.fail(limit_error("buffer", MAX_BUFFER_BYTES));
            return;
        }
        self.buffer.extend_from_slice(bytes);
    }

    fn fail(&mut self, message: String) {
        if self.terminal == SseStreamTerminal::Streaming {
            self.terminal = SseStreamTerminal::Error(message);
        }
    }

    fn stored_content_bytes(&self) -> usize {
        self.full_content
            .len()
            .saturating_add(self.full_reasoning.len())
    }

    fn append_content(&mut self, content: &str) -> bool {
        if !checked_total(
            self.stored_content_bytes(),
            content.len(),
            MAX_CONTENT_BYTES,
        ) {
            self.fail(limit_error("content", MAX_CONTENT_BYTES));
            return false;
        }
        self.full_content.push_str(content);
        true
    }

    fn append_reasoning(&mut self, reasoning: &str) -> bool {
        if !checked_total(
            self.stored_content_bytes(),
            reasoning.len(),
            MAX_CONTENT_BYTES,
        ) {
            self.fail(limit_error("content", MAX_CONTENT_BYTES));
            return false;
        }
        self.full_reasoning.push_str(reasoning);
        true
    }

    fn ensure_tool_metadata(&mut self, value: &str) -> bool {
        if value.len() > MAX_TOOL_METADATA_BYTES {
            self.fail(limit_error("tool-call metadata", MAX_TOOL_METADATA_BYTES));
            return false;
        }
        true
    }

    fn apply_tool_call_delta(&mut self, tc: StreamToolCallDelta) -> bool {
        let idx = tc.index.unwrap_or(0);
        if idx >= MAX_TOOL_CALLS {
            self.fail(format!(
                "SSE tool-call index {idx} exceeded the maximum index {}",
                MAX_TOOL_CALLS - 1
            ));
            return false;
        }
        while self.tool_calls.len() <= idx {
            self.tool_calls.push(serde_json::Value::Null);
            self.tool_call_ids.push(None);
            self.tool_call_names.push(None);
            self.tool_call_args.push(String::new());
        }
        if let Some(id) = tc.id {
            if !self.ensure_tool_metadata(&id) {
                return false;
            }
            self.tool_call_ids[idx] = Some(id);
        }
        if let Some(func) = tc.function {
            if let Some(name) = func.name {
                if !self.ensure_tool_metadata(&name) {
                    return false;
                }
                self.tool_call_names[idx] = Some(name);
            }
            if let Some(args) = func.arguments {
                if !checked_total(
                    self.total_tool_argument_bytes,
                    args.len(),
                    MAX_TOOL_ARGUMENT_BYTES,
                ) {
                    self.fail(limit_error(
                        "cumulative tool-call arguments",
                        MAX_TOOL_ARGUMENT_BYTES,
                    ));
                    return false;
                }
                self.tool_call_args[idx].push_str(&args);
                self.total_tool_argument_bytes += args.len();
            }
        }
        true
    }

    fn apply_tool_call_deltas(&mut self, deltas: Vec<StreamToolCallDelta>) -> bool {
        if deltas.len() > MAX_TOOL_CALLS {
            self.fail(limit_error("tool-call count", MAX_TOOL_CALLS));
            return false;
        }
        for delta in deltas {
            if !self.apply_tool_call_delta(delta) {
                return false;
            }
        }
        true
    }

    pub(crate) fn process_lines<F>(
        &mut self,
        app: &tauri::AppHandle,
        stream_id: &str,
        mut on_chunk: F,
    ) where
        F: FnMut(&str),
    {
        while self.terminal == SseStreamTerminal::Streaming {
            let Some(line_end) = self.buffer.iter().position(|byte| *byte == b'\n') else {
                break;
            };
            if self.buffer[..line_end].len() > MAX_EVENT_LINE_BYTES {
                self.fail(limit_error("event line", MAX_EVENT_LINE_BYTES));
                break;
            }
            let Ok(line) = std::str::from_utf8(&self.buffer[..line_end]) else {
                self.fail("SSE event line was not valid UTF-8".to_string());
                break;
            };
            let line = line.trim().to_string();
            self.buffer.drain(..=line_end);

            if line.is_empty() {
                continue;
            }

            if line == "data: [DONE]" {
                self.terminal = SseStreamTerminal::Complete;
                break;
            }

            if let Some(data) = line.strip_prefix("data: ") {
                match serde_json::from_str::<StreamChunk>(data) {
                    Ok(parsed) => {
                        for choice in parsed.choices {
                            if let Some(details) = choice.delta.reasoning_details {
                                self.reasoning_details.extend(details);
                            }
                            if let Some(reasoning) =
                                choice.delta.reasoning_content.or(choice.delta.reasoning)
                            {
                                if !reasoning.is_empty() {
                                    if !self.append_reasoning(&reasoning) {
                                        break;
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

                                    if !self.append_content(&normalized) {
                                        break;
                                    }
                                    if has_open && !self.in_reasoning {
                                        self.in_reasoning = true;
                                    }

                                    emit_stream_chunk(app, stream_id, &normalized);
                                    on_chunk(&normalized);

                                    if has_close && self.in_reasoning {
                                        self.in_reasoning = false;
                                    }
                                } else {
                                    if self.in_reasoning && !normalized.trim().is_empty() {
                                        if !self.append_content("</reasoning>") {
                                            break;
                                        }
                                        self.in_reasoning = false;
                                        emit_stream_chunk(app, stream_id, "</reasoning>");
                                        on_chunk("</reasoning>");
                                    }
                                    if !self.append_content(&normalized) {
                                        break;
                                    }
                                    emit_stream_chunk(app, stream_id, &normalized);
                                    on_chunk(&normalized);
                                }
                            }

                            if let Some(tool_call_deltas) = choice.delta.tool_calls {
                                if !self.apply_tool_call_deltas(tool_call_deltas) {
                                    break;
                                }
                            }

                            if self.terminal != SseStreamTerminal::Streaming {
                                break;
                            }

                            if choice.finish_reason.is_some() {
                                if self.in_reasoning {
                                    if !self.append_content("</reasoning>") {
                                        break;
                                    }
                                    emit_stream_chunk(app, stream_id, "</reasoning>");
                                    on_chunk("</reasoning>");
                                    self.in_reasoning = false;
                                }
                                self.terminal = SseStreamTerminal::Complete;
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

    #[cfg(test)]
    pub(crate) fn is_complete(&self) -> bool {
        self.terminal != SseStreamTerminal::Streaming
    }

    pub(crate) fn terminal(&self) -> &SseStreamTerminal {
        &self.terminal
    }

    pub(crate) fn finalize(&mut self) -> String {
        if !self.full_reasoning.is_empty() && !self.full_content.contains("<reasoning>") {
            let reasoning = std::mem::take(&mut self.full_reasoning);
            let content = std::mem::take(&mut self.full_content);
            self.full_content = format!("<reasoning>{}</reasoning>{}", reasoning, content);
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
        if !self.reasoning_details.is_empty() {
            msg["reasoning_details"] = serde_json::Value::Array(self.reasoning_details.clone());
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
        assert_eq!(parser.terminal(), &SseStreamTerminal::Streaming);
    }

    #[test]
    fn oversized_incoming_chunk_is_a_sticky_terminal_error() {
        let mut parser = SseParser::new();
        parser.push_bytes(&vec![b'x'; MAX_INCOMING_CHUNK_BYTES + 1]);
        let terminal = parser.terminal().clone();

        assert!(matches!(terminal, SseStreamTerminal::Error(_)));
        assert!(parser.is_complete());
        assert!(parser.buffer.is_empty());

        parser.push_bytes(b"data: [DONE]\n");
        assert_eq!(parser.terminal(), &terminal);
        assert!(parser.buffer.is_empty());
    }

    #[test]
    fn cumulative_buffer_limit_rejects_before_append() {
        let mut parser = SseParser::new();
        parser.push_bytes(&vec![b'x'; MAX_BUFFER_BYTES]);
        assert_eq!(parser.buffer.len(), MAX_BUFFER_BYTES);

        parser.push_bytes(b"\n");

        assert!(matches!(parser.terminal(), SseStreamTerminal::Error(_)));
        assert_eq!(parser.buffer.len(), MAX_BUFFER_BYTES);
    }

    #[test]
    fn cumulative_content_limit_rejects_before_append() {
        let mut parser = SseParser::new();
        parser.full_content = "x".repeat(MAX_CONTENT_BYTES);

        assert!(!parser.append_content("y"));
        assert_eq!(parser.full_content.len(), MAX_CONTENT_BYTES);
        assert!(matches!(parser.terminal(), SseStreamTerminal::Error(_)));
    }

    #[test]
    fn tool_call_index_is_bounded_before_vector_growth() {
        let mut parser = SseParser::new();
        let delta = StreamToolCallDelta {
            index: Some(MAX_TOOL_CALLS),
            id: None,
            function: None,
        };

        assert!(!parser.apply_tool_call_delta(delta));
        assert!(parser.tool_call_args.is_empty());
        assert!(matches!(parser.terminal(), SseStreamTerminal::Error(_)));
    }

    #[test]
    fn tool_call_count_is_bounded_before_vector_growth() {
        let mut parser = SseParser::new();
        let deltas = (0..=MAX_TOOL_CALLS)
            .map(|index| StreamToolCallDelta {
                index: Some(index),
                id: None,
                function: None,
            })
            .collect();

        assert!(!parser.apply_tool_call_deltas(deltas));
        assert!(parser.tool_call_args.is_empty());
        assert!(matches!(parser.terminal(), SseStreamTerminal::Error(_)));
    }

    #[test]
    fn cumulative_tool_arguments_reject_before_append() {
        let mut parser = SseParser::new();
        parser.total_tool_argument_bytes = MAX_TOOL_ARGUMENT_BYTES - 1;
        let delta = StreamToolCallDelta {
            index: Some(0),
            id: None,
            function: Some(StreamToolCallFunction {
                name: None,
                arguments: Some("ab".to_string()),
            }),
        };

        assert!(!parser.apply_tool_call_delta(delta));
        assert_eq!(
            parser.total_tool_argument_bytes,
            MAX_TOOL_ARGUMENT_BYTES - 1
        );
        assert!(parser.tool_call_args[0].is_empty());
        assert!(matches!(parser.terminal(), SseStreamTerminal::Error(_)));
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
        assert_eq!(
            result,
            "<reasoning>I need to think</reasoning>The answer is 42"
        );
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
        assert_eq!(
            tc.function.as_ref().unwrap().name.as_deref(),
            Some("get_weather")
        );
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
    buffer: Vec<u8>,
    tool_calls: Vec<serde_json::Value>,
    current_tool_id: Option<String>,
    current_tool_name: Option<String>,
    current_tool_input: String,
    total_tool_argument_bytes: usize,
    in_thinking: bool,
    terminal: AnthropicStreamTerminal,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum AnthropicStreamTerminal {
    Streaming,
    Complete,
    Error(String),
}

impl AnthropicSseParser {
    pub(crate) fn new() -> Self {
        Self {
            full_content: String::new(),
            buffer: Vec::new(),
            tool_calls: Vec::new(),
            current_tool_id: None,
            current_tool_name: None,
            current_tool_input: String::new(),
            total_tool_argument_bytes: 0,
            in_thinking: false,
            terminal: AnthropicStreamTerminal::Streaming,
        }
    }

    pub(crate) fn push_bytes(&mut self, bytes: &[u8]) {
        if self.terminal != AnthropicStreamTerminal::Streaming {
            return;
        }
        if bytes.len() > MAX_INCOMING_CHUNK_BYTES {
            self.fail(limit_error("incoming chunk", MAX_INCOMING_CHUNK_BYTES));
            return;
        }
        if !checked_total(self.buffer.len(), bytes.len(), MAX_BUFFER_BYTES) {
            self.fail(limit_error("buffer", MAX_BUFFER_BYTES));
            return;
        }
        self.buffer.extend_from_slice(bytes);
    }

    fn fail(&mut self, message: String) {
        if self.terminal == AnthropicStreamTerminal::Streaming {
            self.terminal = AnthropicStreamTerminal::Error(message);
        }
    }

    fn ensure_tool_metadata(&mut self, value: &str) -> bool {
        if value.len() > MAX_TOOL_METADATA_BYTES {
            self.fail(limit_error("tool-call metadata", MAX_TOOL_METADATA_BYTES));
            return false;
        }
        true
    }

    pub(crate) fn process_lines<F>(&mut self, mut on_chunk: F)
    where
        F: FnMut(&str),
    {
        while self.terminal == AnthropicStreamTerminal::Streaming {
            let Some(line_end) = self.buffer.iter().position(|byte| *byte == b'\n') else {
                break;
            };
            if self.buffer[..line_end].len() > MAX_EVENT_LINE_BYTES {
                self.fail(limit_error("event line", MAX_EVENT_LINE_BYTES));
                break;
            }
            let Ok(line) = std::str::from_utf8(&self.buffer[..line_end]) else {
                self.fail("SSE event line was not valid UTF-8".to_string());
                break;
            };
            let line = line.trim().to_string();
            self.buffer.drain(..=line_end);

            if line.is_empty() {
                continue;
            }

            if line.starts_with("event: ") {
                // Handle events if needed
                continue;
            }

            if let Some(data) = line.strip_prefix("data: ") {
                if data == "[DONE]" {
                    self.terminal = AnthropicStreamTerminal::Complete;
                    break;
                }

                match serde_json::from_str::<serde_json::Value>(data) {
                    Ok(parsed) => {
                        if let Some(type_str) = parsed.get("type").and_then(|v| v.as_str()) {
                            match type_str {
                                "content_block_start" => {
                                    if let Some(cb) = parsed.get("content_block") {
                                        let block_type = cb.get("type").and_then(|v| v.as_str());
                                        if block_type == Some("tool_use") {
                                            if self.tool_calls.len() >= MAX_TOOL_CALLS {
                                                self.fail(limit_error(
                                                    "tool-call count",
                                                    MAX_TOOL_CALLS,
                                                ));
                                                break;
                                            }
                                            let id = cb.get("id").and_then(|v| v.as_str());
                                            let name = cb.get("name").and_then(|v| v.as_str());
                                            if id.is_some_and(|value| {
                                                !self.ensure_tool_metadata(value)
                                            }) || name.is_some_and(|value| {
                                                !self.ensure_tool_metadata(value)
                                            }) {
                                                break;
                                            }
                                            self.current_tool_id = id.map(str::to_string);
                                            self.current_tool_name = name.map(str::to_string);
                                            self.current_tool_input.clear();
                                        } else if block_type == Some("thinking") {
                                            self.in_thinking = true;
                                            self.full_content.push_str("<reasoning>");
                                            on_chunk("<reasoning>");
                                        }
                                    }
                                }
                                "content_block_delta" => {
                                    if let Some(delta) = parsed.get("delta") {
                                        if delta.get("type").and_then(|v| v.as_str())
                                            == Some("text_delta")
                                        {
                                            if let Some(text) =
                                                delta.get("text").and_then(|v| v.as_str())
                                            {
                                                if !checked_total(
                                                    self.full_content.len(),
                                                    text.len(),
                                                    MAX_CONTENT_BYTES,
                                                ) {
                                                    self.fail(limit_error(
                                                        "content",
                                                        MAX_CONTENT_BYTES,
                                                    ));
                                                    break;
                                                }
                                                self.full_content.push_str(text);
                                                on_chunk(text);
                                            }
                                        } else if delta.get("type").and_then(|v| v.as_str())
                                            == Some("thinking_delta")
                                        {
                                            if let Some(thinking) =
                                                delta.get("thinking").and_then(|v| v.as_str())
                                            {
                                                if !checked_total(
                                                    self.full_content.len(),
                                                    thinking.len(),
                                                    MAX_CONTENT_BYTES,
                                                ) {
                                                    self.fail(limit_error(
                                                        "content",
                                                        MAX_CONTENT_BYTES,
                                                    ));
                                                    break;
                                                }
                                                self.full_content.push_str(thinking);
                                                on_chunk(thinking);
                                            }
                                        } else if delta.get("type").and_then(|v| v.as_str())
                                            == Some("input_json_delta")
                                        {
                                            if let Some(partial_json) =
                                                delta.get("partial_json").and_then(|v| v.as_str())
                                            {
                                                if !checked_total(
                                                    self.total_tool_argument_bytes,
                                                    partial_json.len(),
                                                    MAX_TOOL_ARGUMENT_BYTES,
                                                ) {
                                                    self.fail(limit_error(
                                                        "cumulative tool-call arguments",
                                                        MAX_TOOL_ARGUMENT_BYTES,
                                                    ));
                                                    break;
                                                }
                                                self.current_tool_input.push_str(partial_json);
                                                self.total_tool_argument_bytes +=
                                                    partial_json.len();
                                            }
                                        }
                                    }
                                }
                                "content_block_stop" => {
                                    if self.in_thinking {
                                        self.full_content.push_str("</reasoning>");
                                        on_chunk("</reasoning>");
                                        self.in_thinking = false;
                                    }
                                    if let (Some(id), Some(name)) =
                                        (&self.current_tool_id, &self.current_tool_name)
                                    {
                                        if self.tool_calls.len() >= MAX_TOOL_CALLS {
                                            self.fail(limit_error(
                                                "tool-call count",
                                                MAX_TOOL_CALLS,
                                            ));
                                            break;
                                        }
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
                                "message_stop" => {
                                    self.terminal = AnthropicStreamTerminal::Complete;
                                }
                                "error" => {
                                    let message = parsed
                                        .pointer("/error/message")
                                        .and_then(|value| value.as_str())
                                        .unwrap_or("Anthropic stream returned an error")
                                        .to_string();
                                    self.terminal = AnthropicStreamTerminal::Error(message);
                                }
                                _ => {}
                            }
                        }
                    }
                    Err(error) => {
                        log::warn!(
                            "Anthropic SSE parse warning: skipping malformed event ({} bytes): {}",
                            data.len(),
                            error
                        );
                    }
                }
            }
        }
    }

    pub(crate) fn terminal(&self) -> &AnthropicStreamTerminal {
        &self.terminal
    }

    pub(crate) fn finalize(mut self) -> String {
        if self.in_thinking {
            self.full_content.push_str("</reasoning>");
        }
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

#[cfg(test)]
mod anthropic_tests {
    use super::*;

    #[test]
    fn content_delta_and_message_stop_complete_the_stream() {
        let mut parser = AnthropicSseParser::new();
        let mut chunks = Vec::new();
        parser.push_bytes(
            concat!(
                "event: content_block_delta\n",
                "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hello\"}}\n\n",
                "event: message_stop\n",
                "data: {\"type\":\"message_stop\"}\n\n",
                "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\" ignored\"}}\n\n"
            )
            .as_bytes(),
        );

        parser.process_lines(|chunk| chunks.push(chunk.to_string()));
        parser.process_lines(|chunk| chunks.push(chunk.to_string()));

        assert_eq!(chunks, vec!["Hello"]);
        assert_eq!(parser.terminal(), &AnthropicStreamTerminal::Complete);
        assert_eq!(parser.finalize(), "Hello");
    }

    #[test]
    fn utf8_code_point_split_across_chunks_remains_valid() {
        let mut parser = AnthropicSseParser::new();
        let event = "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"café\"}}\n";
        let split_at = event.find('é').unwrap() + 1;

        parser.push_bytes(&event.as_bytes()[..split_at]);
        parser.process_lines(|_| panic!("an incomplete line must not emit"));
        parser.push_bytes(&event.as_bytes()[split_at..]);

        let mut chunks = Vec::new();
        parser.process_lines(|chunk| chunks.push(chunk.to_string()));

        assert_eq!(chunks, vec!["café"]);
        assert_eq!(parser.terminal(), &AnthropicStreamTerminal::Streaming);
    }

    #[test]
    fn tool_stream_finalizes_on_message_stop() {
        let mut parser = AnthropicSseParser::new();
        parser.push_bytes(
            concat!(
                "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_1\",\"name\":\"get_weather\",\"input\":{}}}\n\n",
                "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"city\\\":\\\"Toronto\\\"}\"}}\n\n",
                "data: {\"type\":\"content_block_stop\",\"index\":0}\n\n",
                "data: {\"type\":\"message_stop\"}\n\n"
            )
            .as_bytes(),
        );

        parser.process_lines(|_| {});

        assert_eq!(parser.terminal(), &AnthropicStreamTerminal::Complete);
        let response: serde_json::Value = serde_json::from_str(&parser.finalize_tools()).unwrap();
        let tool_call = &response["choices"][0]["message"]["tool_calls"][0];
        assert_eq!(tool_call["id"], "toolu_1");
        assert_eq!(tool_call["function"]["name"], "get_weather");
        assert_eq!(tool_call["function"]["arguments"], "{\"city\":\"Toronto\"}");
    }

    #[test]
    fn anthropic_error_is_terminal() {
        let mut parser = AnthropicSseParser::new();
        parser.push_bytes(
            b"data: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}\n\n",
        );

        parser.process_lines(|_| {});

        assert_eq!(
            parser.terminal(),
            &AnthropicStreamTerminal::Error("Overloaded".to_string())
        );
    }

    #[test]
    fn anthropic_oversized_incoming_chunk_is_terminal() {
        let mut parser = AnthropicSseParser::new();
        parser.push_bytes(&vec![b'x'; MAX_INCOMING_CHUNK_BYTES + 1]);
        let terminal = parser.terminal().clone();

        assert!(matches!(terminal, AnthropicStreamTerminal::Error(_)));
        assert!(parser.buffer.is_empty());

        parser.push_bytes(b"data: [DONE]\n");
        assert_eq!(parser.terminal(), &terminal);
        assert!(parser.buffer.is_empty());
    }

    #[test]
    fn anthropic_event_line_is_bounded_before_parsing() {
        let mut parser = AnthropicSseParser::new();
        let mut event = vec![b'x'; MAX_EVENT_LINE_BYTES + 1];
        event.push(b'\n');
        parser.push_bytes(&event);

        parser.process_lines(|_| panic!("oversized event must not emit content"));

        assert!(matches!(
            parser.terminal(),
            AnthropicStreamTerminal::Error(_)
        ));
    }

    #[test]
    fn anthropic_content_limit_rejects_before_append_or_emit() {
        let mut parser = AnthropicSseParser::new();
        parser.full_content = "x".repeat(MAX_CONTENT_BYTES);
        parser.push_bytes(
            b"data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"y\"}}\n",
        );

        parser.process_lines(|_| panic!("over-limit content must not be emitted"));

        assert_eq!(parser.full_content.len(), MAX_CONTENT_BYTES);
        assert!(matches!(
            parser.terminal(),
            AnthropicStreamTerminal::Error(_)
        ));
    }

    #[test]
    fn anthropic_input_json_limit_rejects_before_append() {
        let mut parser = AnthropicSseParser::new();
        parser.total_tool_argument_bytes = MAX_TOOL_ARGUMENT_BYTES - 1;
        parser.push_bytes(
            b"data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"ab\"}}\n",
        );

        parser.process_lines(|_| {});

        assert!(parser.current_tool_input.is_empty());
        assert_eq!(
            parser.total_tool_argument_bytes,
            MAX_TOOL_ARGUMENT_BYTES - 1
        );
        assert!(matches!(
            parser.terminal(),
            AnthropicStreamTerminal::Error(_)
        ));
    }

    #[test]
    fn anthropic_tool_call_count_rejects_before_starting_another() {
        let mut parser = AnthropicSseParser::new();
        parser.tool_calls = vec![serde_json::Value::Null; MAX_TOOL_CALLS];
        parser.push_bytes(
            b"data: {\"type\":\"content_block_start\",\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_65\",\"name\":\"blocked\"}}\n",
        );

        parser.process_lines(|_| {});

        assert!(parser.current_tool_id.is_none());
        assert_eq!(parser.tool_calls.len(), MAX_TOOL_CALLS);
        assert!(matches!(
            parser.terminal(),
            AnthropicStreamTerminal::Error(_)
        ));
    }
}
