export function parseReasoning(content: string, role: string) {
  const hasOpenReasoning =
    role === "assistant" &&
    (content.includes("<reasoning>") || content.includes("<thinking>") || content.includes("<thought>"));

  let reasoningContent = "";
  let displayContent = content;

  if (hasOpenReasoning) {
    const reasoningMatch =
      content.match(/<reasoning>([\s\S]*?)<\/reasoning>/) ||
      content.match(/<thinking>([\s\S]*?)<\/thinking>/) ||
      content.match(/<thought>([\s\S]*?)<\/thought>/);

    if (reasoningMatch) {
      reasoningContent = reasoningMatch[1].trim();
      displayContent = content
        .replace(/<(?:reasoning|thinking|thought)>[\s\S]*?<\/(?:reasoning|thinking|thought)>/, "")
        .trim();
    } else {
      const openMatch =
        content.match(/<reasoning>([\s\S]*)/) ||
        content.match(/<thinking>([\s\S]*)/) ||
        content.match(/<thought>([\s\S]*)/);
      if (openMatch) {
        reasoningContent = openMatch[1].trim();
        displayContent = content.replace(/<(?:reasoning|thinking|thought)>[\s\S]*/, "").trim();
      }
    }
  }

  return { reasoningContent, displayContent, hasOpenReasoning };
}
