export const WEB_SEARCH_MENTION = "[Web Search]";

export function hasWebSearchMention(content: string): boolean {
  return content.includes(WEB_SEARCH_MENTION);
}
