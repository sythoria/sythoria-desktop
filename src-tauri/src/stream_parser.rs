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
}

impl SseParser {
    pub(crate) fn new() -> Self {
        Self {
            full_content: String::new(),
            full_reasoning: String::new(),
            buffer: String::new(),
            in_reasoning: false,
        }
    }

    pub(crate) fn push_bytes(&mut self, bytes: &[u8]) {
        self.buffer.push_str(&String::from_utf8_lossy(bytes));
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
                                    self.full_reasoning.push_str(&reasoning);
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

                                    self.full_content.push_str(&normalized);
                                    emit_stream_chunk(app, stream_id, &normalized);
                                    on_chunk(&normalized);

                                    if has_close && self.in_reasoning {
                                        self.in_reasoning = false;
                                        if let Some(start) = self.full_content.find("<reasoning>") {
                                            if let Some(end) = self.full_content.find("</reasoning>") {
                                                self.full_reasoning = self.full_content
                                                    [start + "<reasoning>".len()..end]
                                                    .to_string();
                                            }
                                        }
                                    }
                                } else {
                                    if self.in_reasoning && !normalized.trim().is_empty() {
                                        self.in_reasoning = false;
                                        emit_stream_chunk(app, stream_id, "</reasoning>");
                                        self.full_content.push_str("</reasoning>");
                                        on_chunk("</reasoning>");
                                    }
                                    self.full_content.push_str(&normalized);
                                    emit_stream_chunk(app, stream_id, &normalized);
                                    on_chunk(&normalized);
                                }
                            }

                            if choice.finish_reason.is_some() {
                                if self.in_reasoning {
                                    emit_stream_chunk(app, stream_id, "</reasoning>");
                                    self.full_content.push_str("</reasoning>");
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
}
