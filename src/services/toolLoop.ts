import { invoke } from "@tauri-apps/api/core";
import type {
  Conversation,
  Message,
  ModelConfig,
  SearchApiConfig,
  SearchResult,
  UrlContent,
  GenerationState,
  McpTool,
  McpToolResult,
} from "../types";
import { generateId } from "../utils/generateId";
import { logError, logInfo, logWarn } from "../utils/logger";
import { MAX_TOOL_STEPS } from "../config/constants";
import { parseApiError } from "../utils/parseApiError";
import { useUIStore } from "../store/useUIStore";
import { useChatStore } from "../store/useChatStore";
import { useModelStore } from "../store/useModelStore";
import { buildUserApiContent } from "../utils/attachments";

export interface ToolLoopSlice {
  conversations: Conversation[];
  isStreaming: boolean;
  generationState: GenerationState;
  generationLabel: string;
}

interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_query",
      description:
        "Search the web for information. Returns search results with titles, URLs, and snippets. Use this when you need current or factual information.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "The search query string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_url",
      description:
        "Fetch and extract the readable content of a web page. Use this when you want to read the full content of a URL found in search results.",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "The URL to fetch and read" } },
        required: ["url"],
      },
    },
  },
];

export function buildToolDefinitions(mcpTools: McpTool[] = [], includeSearch = true) {
  const tools = includeSearch ? [...TOOL_DEFINITIONS] : [];
  for (const mcpTool of mcpTools) {
    const inputSchema = (mcpTool.inputSchema ?? { properties: {} }) as Record<string, unknown>;
    tools.push({
      type: "function",
      function: {
        name: mcpTool.namespacedName,
        description: `[MCP: ${mcpTool.serverName}] ${mcpTool.description}`,
        parameters: {
          ...inputSchema,
          type: "object",
          properties: (inputSchema.properties as Record<string, unknown>) ?? {},
        },
      },
    });
  }
  return tools;
}

export const TOOL_SYSTEM_PROMPT = `You have access to the following tools:

- search_query(query: string): Search the web for information. Returns search results with titles, URLs, and snippets.
- fetch_url(url: string): Fetch and extract the content of a web page.

When you need current information, facts, or recent events, use search_query first. If a search result looks relevant, use fetch_url to read the full page content. After gathering information, synthesize it into your final answer. Always cite your sources by mentioning where you found the information.`;

export function buildToolSystemPrompt(mcpTools: McpTool[] = []) {
  let prompt = TOOL_SYSTEM_PROMPT;
  if (mcpTools.length > 0) {
    const mcpDescriptions = mcpTools
      .map((t) => `- ${t.namespacedName}: [MCP: ${t.serverName}] ${t.description}`)
      .join("\n");
    prompt += `\n\nYou also have access to these MCP tools:\n${mcpDescriptions}`;
  }
  return prompt;
}

type KnownToolName = "search_query" | "fetch_url";
const KNOWN_TOOLS: Set<string> = new Set(["search_query", "fetch_url"]);

function toKnownToolName(name: string): KnownToolName | "unknown" {
  return KNOWN_TOOLS.has(name) ? (name as KnownToolName) : "unknown";
}

interface ToolCallData {
  id: string;
  function: { name: string; arguments: string };
}

interface ToolCallResponse {
  choices?: { message: { content: string | null; tool_calls?: ToolCallData[] } }[];
}

function updateConversationMessages(
  conversations: Conversation[],
  convId: string,
  updater: (msgs: Message[]) => Message[],
  extra?: Partial<Conversation>,
): Conversation[] {
  return conversations.map((c) => {
    if (c.id !== convId) return c;
    return { ...c, messages: updater(c.messages), timestamp: new Date(), ...extra };
  });
}

function setAssistantError(conversations: Conversation[], convId: string, err: unknown): Conversation[] {
  const parsed = parseApiError(err);
  return updateConversationMessages(conversations, convId, (msgs) => {
    const updated = [...msgs];
    const last = updated[updated.length - 1];
    if (last && last.role === "assistant") {
      updated[updated.length - 1] = { ...last, content: `**Error:** ${parsed.message}`, isStreaming: false };
    } else {
      updated.push({
        id: generateId(),
        role: "assistant",
        content: `**Error:** ${parsed.message}`,
        timestamp: new Date(),
        isStreaming: false,
      });
    }
    return updated;
  });
}

export async function sendWithToolLoop(
  convId: string,
  modelConfig: ModelConfig,
  temperature: number,
  apiKeys: Record<string, string>,
  searchConfig: SearchApiConfig | undefined,
  searchApiKey: string,
  mcpTools: McpTool[],
  mcpCallTool:
    | ((serverId: string, toolName: string, args: Record<string, string>) => Promise<McpToolResult>)
    | undefined,
  set: (fn: (state: ToolLoopSlice) => Partial<ToolLoopSlice>) => void,
  get: () => ToolLoopSlice,
  performSearch: (query: string, config: SearchApiConfig, apiKey: string) => Promise<SearchResult[]>,
  fetchUrlContent: (url: string) => Promise<UrlContent>,
) {
  set(() => ({
    isStreaming: true,
    generationState: "thinking" as GenerationState,
    generationLabel: "Thinking",
  }));
  useUIStore.getState().setLoading("sendMessage", true);
  useUIStore.getState().setLoading("toolExecution", false);

  const collectedSources: { title: string; url: string }[] = [];

  try {
    const apiUrl = modelConfig.apiBase;
    const apiKey = apiKeys[modelConfig.id] ?? modelConfig.apiKey ?? "";

    const conv = get().conversations.find((c) => c.id === convId);
    const baseMessages =
      conv?.messages
        .filter((m) => (m.role === "user" || m.role === "assistant") && !m.isStreaming)
        .map((m) => ({
          role: m.role,
          content: m.role === "user" ? buildUserApiContent(m.content, m.attachments) : m.content,
        })) ?? [];

    const useSearch = !!searchConfig;
    const useMcp = mcpTools.length > 0 && !!mcpCallTool;
    const allTools = buildToolDefinitions(useMcp ? mcpTools : [], useSearch);

    const userSystemPrompt = useModelStore.getState().systemPrompt || "";
    const toolSystemPrompt = buildToolSystemPrompt(useMcp ? mcpTools : []);
    const combinedSystemPrompt = userSystemPrompt.trim()
      ? `${userSystemPrompt}\n\n${toolSystemPrompt}`
      : toolSystemPrompt;

    const apiMessages: {
      role: string;
      content: string | null | unknown[];
      tool_calls?: unknown[];
      tool_call_id?: string;
      name?: string;
    }[] = [{ role: "system", content: combinedSystemPrompt }, ...baseMessages];

    for (let step = 0; step < MAX_TOOL_STEPS; step++) {
      if (!get().isStreaming) {
        logInfo("chat", "Tool loop aborted: stream was stopped by user before step start");
        await useChatStore.getState().persistConversations();
        return;
      }

      useUIStore.getState().setLoading("toolExecution", true);
      logInfo("chat", `Tool loop step ${step + 1}/${MAX_TOOL_STEPS}`, {
        details: `Model: ${modelConfig.modelId}, Messages so far: ${apiMessages.length}`,
      });
      if (step > 0) {
        set(() => ({
          generationState: "thinking" as GenerationState,
          generationLabel: "Thinking (continued)",
        }));
      }

      const raw = await invoke<string>("chat_completion_tools", {
        apiUrl,
        apiKey,
        model: modelConfig.modelId,
        messages: apiMessages,
        tools: JSON.stringify(allTools),
        temperature,
      });

      if (!get().isStreaming) {
        logInfo("chat", "Tool loop aborted: stream was stopped by user during API call");
        await useChatStore.getState().persistConversations();
        return;
      }

      const response: ToolCallResponse = JSON.parse(raw);
      const choice = response.choices?.[0];
      if (!choice) break;

      const msg = choice.message;

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        apiMessages.push({ role: "assistant", content: msg.content, tool_calls: msg.tool_calls });

        for (const toolCall of msg.tool_calls) {
          const rawName = toolCall.function.name;
          const fnName = toKnownToolName(rawName);
          let fnArgs: Record<string, string>;
          try {
            fnArgs = JSON.parse(toolCall.function.arguments || "{}");
          } catch {
            fnArgs = {};
          }

          let resultContent = "";

          if (fnName === "unknown" && rawName.includes("__") && useMcp) {
            if (!get().isStreaming) {
              logInfo("chat", "Tool loop aborted: stream was stopped by user before MCP tool call");
              await useChatStore.getState().persistConversations();
              return;
            }
            const mcpTool = mcpTools.find((t) => t.namespacedName === rawName);
            if (mcpTool && mcpCallTool) {
              logInfo("mcp", `Tool loop calling MCP tool: ${mcpTool.name}`, {
                details: `Server: ${mcpTool.serverName}, Step ${step + 1}`,
              });
              const toolCallMsgId = generateId();
              const toolCallMsg: Message = {
                id: toolCallMsgId,
                role: "tool",
                content: `Running: ${mcpTool.name} via ${mcpTool.serverName}`,
                timestamp: new Date(),
                toolCall: {
                  id: toolCall.id,
                  name: rawName,
                  arguments: fnArgs,
                },
              };

              set((state) => ({
                conversations: updateConversationMessages(state.conversations, convId, (msgs) => [
                  ...msgs,
                  toolCallMsg,
                ]),
                generationState: "mcp_executing" as GenerationState,
                generationLabel: `Running: ${mcpTool.name} via ${mcpTool.serverName}`,
              }));

              const result = await mcpCallTool(mcpTool.serverId, mcpTool.name, fnArgs);
              if (!get().isStreaming) {
                logInfo("chat", "Tool loop aborted: stream was stopped by user during MCP tool call");
                await useChatStore.getState().persistConversations();
                return;
              }
              resultContent = result.content;

              const displayContent = result.isError
                ? `Error: ${result.content.slice(0, 2000)}`
                : result.content.slice(0, 2000);

              set((state) => ({
                conversations: updateConversationMessages(state.conversations, convId, (msgs) =>
                  msgs.map((m) =>
                    m.id === toolCallMsgId
                      ? {
                          ...m,
                          content: displayContent,
                          toolResult: {
                            id: toolCall.id,
                            name: rawName,
                            content: resultContent,
                          },
                        }
                      : m,
                  ),
                ),
                ...(result.isError
                  ? {
                      generationState: "error" as GenerationState,
                      generationLabel: `MCP tool failed: ${mcpTool.name}`,
                    }
                  : {}),
              }));

              if (result.images && result.images.length > 0) {
                apiMessages.push({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  name: rawName,
                  content: resultContent || "(tool returned images)",
                });

                const imageContentParts: unknown[] = [
                  {
                    type: "text",
                    text: `[Images from MCP tool "${mcpTool.name}" — analyze these images:]`,
                  },
                ];
                for (const img of result.images) {
                  imageContentParts.push({
                    type: "image_url",
                    image_url: { url: `data:${img.mimeType};base64,${img.data}` },
                  });
                }
                apiMessages.push({
                  role: "user",
                  content: imageContentParts,
                });
              } else {
                apiMessages.push({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  name: rawName,
                  content: resultContent,
                });
              }
              continue;
            } else {
              const unknownMsg: Message = {
                id: generateId(),
                role: "tool",
                content: `Unknown tool: ${rawName}`,
                timestamp: new Date(),
                toolCall: {
                  id: toolCall.id,
                  name: "fetch_url",
                  arguments: { url: `unknown:${rawName}` },
                },
                toolResult: {
                  id: toolCall.id,
                  name: rawName,
                  content: JSON.stringify({ error: `Unknown tool: ${rawName}` }),
                },
              };
              logWarn("chat", `Unknown tool called in tool loop: ${rawName}`, {
                details: `Available: ${allTools.map((t) => t.function.name).join(", ")}`,
                action: "The model requested a tool that is not available. This may indicate a model hallucination.",
              });
              set((state) => ({
                conversations: updateConversationMessages(state.conversations, convId, (msgs) => [...msgs, unknownMsg]),
                generationState: "error" as GenerationState,
                generationLabel: `Unknown tool: ${rawName}`,
              }));
              apiMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                name: rawName,
                content: JSON.stringify({ error: `Unknown tool: ${rawName}` }),
              });
              continue;
            }
          } else if (fnName === "unknown") {
            const unknownMsg: Message = {
              id: generateId(),
              role: "tool",
              content: `Unknown tool: ${rawName}`,
              timestamp: new Date(),
              toolCall: {
                id: toolCall.id,
                name: "fetch_url",
                arguments: { url: `unknown:${rawName}` },
              },
              toolResult: {
                id: toolCall.id,
                name: rawName,
                content: JSON.stringify({ error: `Unknown tool: ${rawName}` }),
              },
            };
            set((state) => ({
              conversations: updateConversationMessages(state.conversations, convId, (msgs) => [...msgs, unknownMsg]),
              generationState: "error" as GenerationState,
              generationLabel: `Unknown tool: ${rawName}`,
            }));
            apiMessages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              name: rawName,
              content: JSON.stringify({ error: `Unknown tool: ${rawName}` }),
            });
            continue;
          }

          const toolCallMsgId = generateId();
          const toolCallMsg: Message = {
            id: toolCallMsgId,
            role: "tool",
            content: fnName === "search_query" ? `Searching: ${fnArgs.query}` : `Fetching: ${fnArgs.url}`,
            timestamp: new Date(),
            toolCall: {
              id: toolCall.id,
              name: fnName,
              arguments: fnArgs,
            },
          };

          set((state) => ({
            conversations: updateConversationMessages(state.conversations, convId, (msgs) => [...msgs, toolCallMsg]),
            generationState:
              fnName === "search_query" ? ("searching" as GenerationState) : ("fetching" as GenerationState),
            generationLabel: fnName === "search_query" ? `Searching: ${fnArgs.query}` : `Fetching: ${fnArgs.url}`,
          }));

          if (fnName === "search_query" && useSearch && searchConfig) {
            if (!get().isStreaming) {
              logInfo("chat", "Tool loop aborted: stream was stopped by user before search execution");
              await useChatStore.getState().persistConversations();
              return;
            }
            logInfo("search", `Tool loop search: "${fnArgs.query}"`, {
              details: `Provider: ${searchConfig.provider}, Step ${step + 1}`,
            });
            const results = await performSearch(fnArgs.query!, searchConfig, searchApiKey);
            if (!get().isStreaming) {
              logInfo("chat", "Tool loop aborted: stream was stopped by user during search execution");
              await useChatStore.getState().persistConversations();
              return;
            }
            resultContent = JSON.stringify(results);
            results.forEach((r) => collectedSources.push({ title: r.title, url: r.url }));

            const displayContent = results.map((r) => `[${r.title}](${r.url}): ${r.snippet}`).join("\n");

            set((state) => ({
              conversations: updateConversationMessages(state.conversations, convId, (msgs) =>
                msgs.map((m) =>
                  m.id === toolCallMsgId
                    ? {
                        ...m,
                        content: displayContent,
                        toolResult: {
                          id: toolCall.id,
                          name: "search_query",
                          content: resultContent,
                        },
                      }
                    : m,
                ),
              ),
            }));
          } else if (fnName === "fetch_url" && useSearch) {
            if (!get().isStreaming) {
              logInfo("chat", "Tool loop aborted: stream was stopped by user before fetch execution");
              await useChatStore.getState().persistConversations();
              return;
            }
            logInfo("search", `Tool loop fetch URL: ${fnArgs.url}`, {
              details: `Step ${step + 1}`,
            });
            const urlContent = await fetchUrlContent(fnArgs.url!);
            if (!get().isStreaming) {
              logInfo("chat", "Tool loop aborted: stream was stopped by user during fetch execution");
              await useChatStore.getState().persistConversations();
              return;
            }
            resultContent = JSON.stringify(urlContent);
            if (urlContent.status === "ok") {
              collectedSources.push({ title: urlContent.title || fnArgs.url!, url: fnArgs.url! });
            }

            const displayContent =
              urlContent.status === "ok"
                ? urlContent.content.slice(0, 2000)
                : `Error fetching URL: ${urlContent.error || "Unknown error"}`;

            const fetchFailed = urlContent.status !== "ok";

            set((state) => ({
              conversations: updateConversationMessages(state.conversations, convId, (msgs) =>
                msgs.map((m) =>
                  m.id === toolCallMsgId
                    ? {
                        ...m,
                        content: displayContent,
                        toolResult: {
                          id: toolCall.id,
                          name: "fetch_url",
                          content: resultContent,
                        },
                      }
                    : m,
                ),
              ),
              ...(fetchFailed
                ? {
                    generationState: "error" as GenerationState,
                    generationLabel: `Fetch failed: ${fnArgs.url} — ${urlContent.error || "Unknown error"}`,
                  }
                : {}),
            }));
          } else if ((fnName === "search_query" && !useSearch) || (fnName === "fetch_url" && !useSearch)) {
            resultContent = JSON.stringify({ error: `${fnName} is not available — web search is not configured` });
            set((state) => ({
              conversations: updateConversationMessages(state.conversations, convId, (msgs) =>
                msgs.map((m) =>
                  m.id === toolCallMsgId
                    ? {
                        ...m,
                        content: `${fnName} is not available`,
                        toolResult: {
                          id: toolCall.id,
                          name: fnName,
                          content: resultContent,
                        },
                      }
                    : m,
                ),
              ),
            }));
          }

          apiMessages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            name: fnName,
            content: resultContent,
          });
        }
      } else {
        const assistantContent = msg.content || "";

        const assistantMsg: Message = {
          id: generateId(),
          role: "assistant",
          content: assistantContent,
          timestamp: new Date(),
          isStreaming: false,
          sources: collectedSources.length > 0 ? collectedSources : undefined,
        };

        set((state) => ({
          conversations: updateConversationMessages(state.conversations, convId, (msgs) => [...msgs, assistantMsg]),
          isStreaming: false,
          generationState: "idle" as GenerationState,
          generationLabel: "",
        }));
        useUIStore.getState().setLoading("sendMessage", false);
        useUIStore.getState().setLoading("toolExecution", false);

        await useChatStore.getState().persistConversations();
        return;
      }
    }

    const maxStepsMsg: Message = {
      id: generateId(),
      role: "assistant",
      content:
        "I reached the maximum number of tool calls. Let me provide the best answer I can with the information gathered so far.",
      timestamp: new Date(),
      sources: collectedSources.length > 0 ? collectedSources : undefined,
    };

    set((state) => ({
      conversations: updateConversationMessages(state.conversations, convId, (msgs) => [...msgs, maxStepsMsg]),
      isStreaming: false,
      generationState: "idle" as GenerationState,
      generationLabel: "",
    }));
    useUIStore.getState().setLoading("sendMessage", false);
    useUIStore.getState().setLoading("toolExecution", false);

    await useChatStore.getState().persistConversations();
  } catch (err) {
    const parsed = parseApiError(err);
    set((state) => ({
      conversations: setAssistantError(state.conversations, convId, err),
      isStreaming: false,
      generationState: "error" as GenerationState,
      generationLabel: `Generation failed: ${parsed.message}`,
    }));
    useUIStore.getState().setLoading("sendMessage", false);
    useUIStore.getState().setLoading("toolExecution", false);
    useUIStore.getState().addToast(parsed.message, "error");
    logError("chat", "Tool loop failed", {
      error: err,
      action: parsed.action,
      details: `Model: ${modelConfig?.name}, Category: ${parsed.category}, Retryable: ${parsed.retryable}${parsed.rawDetail ? `\nRaw: ${parsed.rawDetail}` : ""}`,
    });
  }
}
