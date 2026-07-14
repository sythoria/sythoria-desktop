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
  Project,
  McpServerConfig,
} from "../types";
import { generateId } from "../utils/generateId";
import { logError, logInfo } from "../utils/logger";
import { parseApiError } from "../utils/parseApiError";
import { useSkillStore } from "../store/useSkillStore";
import { useUIStore } from "../store/useUIStore";
import { useChatStore } from "../store/useChatStore";
import { useModelStore } from "../store/useModelStore";
import { useMcpStore } from "../store/useMcpStore";
import { useProjectStore } from "../store/useProjectStore";
import { buildUserApiContent } from "../utils/attachments";

export interface ToolLoopSlice {
  conversations: Conversation[];
  isStreaming: boolean;
  generationState: GenerationState;
  generationLabel: string;
  generationByConversation: Record<string, { state: GenerationState; label: string }>;
}

function setConversationGeneration(
  state: ToolLoopSlice,
  convId: string,
  generationState: GenerationState,
  generationLabel: string,
): Record<string, { state: GenerationState; label: string }> {
  if (generationState === "idle") {
    const rest = { ...state.generationByConversation };
    delete rest[convId];
    return rest;
  }
  return {
    ...state.generationByConversation,
    [convId]: { state: generationState, label: generationLabel },
  };
}

function computeLineDiff(oldContent: string, newContent: string): { added: number; deleted: number } {
  const oldLines = oldContent ? oldContent.split(/\r?\n/) : [];
  const newLines = newContent ? newContent.split(/\r?\n/) : [];

  let start = 0;
  let endOld = oldLines.length - 1;
  let endNew = newLines.length - 1;

  // Trim common prefix
  while (start <= endOld && start <= endNew && oldLines[start] === newLines[start]) {
    start++;
  }

  // Trim common suffix
  while (endOld >= start && endNew >= start && oldLines[endOld] === newLines[endNew]) {
    endOld--;
    endNew--;
  }

  const N = endOld - start + 1;
  const M = endNew - start + 1;

  if (N <= 0) return { added: M > 0 ? M : 0, deleted: 0 };
  if (M <= 0) return { added: 0, deleted: N > 0 ? N : 0 };

  // Fallback for massive diffs to avoid freezing the thread
  if (N * M > 1000000) {
    return { added: M, deleted: N };
  }

  const dp = new Int32Array(M + 1);
  for (let i = 1; i <= N; i++) {
    let prev = 0;
    const oldLine = oldLines[start + i - 1];
    for (let j = 1; j <= M; j++) {
      const temp = dp[j];
      if (oldLine === newLines[start + j - 1]) {
        dp[j] = prev + 1;
      } else {
        dp[j] = Math.max(dp[j], dp[j - 1]);
      }
      prev = temp;
    }
  }

  const lcs = dp[M];
  return {
    added: M - lcs,
    deleted: N - lcs,
  };
}

function isFileWriteTool(
  name: string,
  args: Record<string, string> | undefined,
): { isWrite: boolean; pathKey?: string } {
  const lowerName = name.toLowerCase();
  const isWriteName =
    lowerName.includes("write") ||
    lowerName.includes("edit") ||
    lowerName.includes("replace") ||
    lowerName.includes("create") ||
    lowerName.includes("save") ||
    lowerName.includes("update") ||
    lowerName.includes("patch");

  if (!isWriteName) return { isWrite: false };

  const pathKeys = ["path", "filepath", "file_path", "filePath", "relative_path", "filename", "file"];
  for (const key of pathKeys) {
    if (args && typeof args[key] === "string") {
      return { isWrite: true, pathKey: key };
    }
  }

  return { isWrite: false };
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
        properties: {
          url: { type: "string", description: "The URL to fetch and read" },
          format: {
            type: "string",
            description: "Optional format to fetch. 'markdown' (default), 'raw_html', or 'text'.",
          },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "invoke_subagent",
      description:
        "Spawns one or more real subagents to perform background tasks. You possess the genuine capability to run independent background processes on the user's machine using this tool. You MUST use this tool when asked to delegate tasks, run subagents, or execute parallel research. NEVER say you cannot physically spawn processes, and NEVER simulate subagent responses.",
      parameters: {
        type: "object",
        properties: {
          subagents: {
            type: "array",
            items: {
              type: "object",
              properties: {
                role: { type: "string", description: "The role of the subagent." },
                prompt: { type: "string", description: "The initial prompt/instructions." },
              },
              required: ["role", "prompt"],
            },
          },
        },
        required: ["subagents"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_message",
      description: "Sends a message to an active subagent.",
      parameters: {
        type: "object",
        properties: {
          conversationId: { type: "string", description: "The subagent's conversation ID." },
          message: { type: "string", description: "The message text to send." },
        },
        required: ["conversationId", "message"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_skill",
      description: "Reads the content of a specific skill by its ID.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The ID of the skill to read." },
        },
        required: ["id"],
      },
    },
  },
];

function buildToolDefinitions(mcpTools: McpTool[] = [], includeSearch = true) {
  const tools = TOOL_DEFINITIONS.filter((t) => {
    if (!includeSearch && (t.function.name === "search_query" || t.function.name === "fetch_url")) {
      return false;
    }
    return true;
  });
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

function buildProjectToolDefinitions(project: Project | null) {
  if (!project) return [];
  const tools: ToolDefinition[] = [];

  tools.push({
    type: "function",
    function: {
      name: "project_read",
      description:
        "Retrieves the raw textual contents of a targeted file within the project. Handles data formatting and clear text extraction automatically.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "The absolute or relative path string identifying the file to read.",
          },
          offset: {
            type: "number",
            description: "Optional. The 1-indexed line index number from which to begin reading.",
          },
          limit: {
            type: "number",
            description:
              "Optional. The maximum number of continuous lines to retrieve. If unspecified, defaults to 2000 lines.",
          },
        },
        required: ["file_path"],
      },
    },
  });
  tools.push({
    type: "function",
    function: {
      name: "project_grep",
      description:
        "Scans file text contents globally across the repository workspace for matching strings and code definitions utilizing an optimized background regex engine.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "The exact regex or text string pattern to match across the codebase.",
          },
          output_mode: {
            type: "string",
            description:
              "Optional. Determines the layout style of the tool result. Allowed values: 'files_with_matches', 'content', 'count'. Defaults to 'files_with_matches'.",
          },
          multiline: {
            type: "boolean",
            description:
              "Optional. When configured to true, allows the regex engine to span across newline breaks. Defaults to false.",
          },
        },
        required: ["pattern"],
      },
    },
  });
  tools.push({
    type: "function",
    function: {
      name: "project_glob",
      description:
        "Discovers and arrays file paths across the active workspace using recursive directory pattern-matching filters.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description:
              "A standard unix-style glob pattern string supporting deep recursive matching paths (e.g., 'src/**/*.ts', 'package.json', '**/tests/*.py').",
          },
        },
        required: ["pattern"],
      },
    },
  });
  tools.push({
    type: "function",
    function: {
      name: "project_git_status",
      description: "Get the current git status of the project.",
      parameters: { type: "object", properties: {} },
    },
  });
  tools.push({
    type: "function",
    function: {
      name: "project_list_dir",
      description: "Lists the files and directories inside a specific directory path within the project.",
      parameters: {
        type: "object",
        properties: {
          dir_path: {
            type: "string",
            description: "The relative or absolute path of the directory to list.",
          },
        },
        required: ["dir_path"],
      },
    },
  });
  tools.push({
    type: "function",
    function: {
      name: "project_git_diff",
      description: "Get the git diff of the project (unstaged and staged changes).",
      parameters: { type: "object", properties: {} },
    },
  });

  // Write permissions
  if (project.permissions === "write" || project.permissions === "full") {
    tools.push({
      type: "function",
      function: {
        name: "project_write",
        description:
          "Write content to a file within the project, overwriting it entirely. Creates directories if needed.",
        parameters: {
          type: "object",
          properties: {
            file_path: { type: "string", description: "Relative or absolute path to the file" },
            content: { type: "string", description: "The content to write" },
          },
          required: ["file_path", "content"],
        },
      },
    });
    tools.push({
      type: "function",
      function: {
        name: "project_edit",
        description:
          "Performs modifications on an existing target file via precise exact-string block matching. This tool will automatically fail if the target string block inside old_string is structurally ambiguous, uniquely missing, or doesn't match line-for-line.",
        parameters: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "The absolute or relative path string pointing to the target file.",
            },
            old_string: {
              type: "string",
              description:
                "The exact multi-line text block sequence currently present in the file that needs to be targeted and removed.",
            },
            new_string: {
              type: "string",
              description: "The precise structural code block sequence that will replace the old_string block.",
            },
            replace_all: {
              type: "boolean",
              description:
                "Optional. When set to true, scans the file and replaces all identical matches of old_string. Defaults to false.",
            },
          },
          required: ["file_path", "old_string", "new_string"],
        },
      },
    });
    tools.push({
      type: "function",
      function: {
        name: "project_git_commit",
        description: "Stage and commit changes in the project.",
        parameters: {
          type: "object",
          properties: {
            message: { type: "string", description: "The commit message" },
            files: {
              type: "array",
              items: { type: "string" },
              description: "Optional list of files to commit. If empty, all changes are committed.",
            },
          },
          required: ["message"],
        },
      },
    });
  }

  // Full Shell permissions
  if (project.permissions === "full") {
    tools.push({
      type: "function",
      function: {
        name: "project_bash",
        description:
          "Executes terminal/shell commands natively inside a persistent, stateful shell session in the user's workspace environment.",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string", description: "The complete raw shell command string sequence to be executed." },
            timeout: {
              type: "number",
              description:
                "Optional. Maximum duration allowed for the command to execute before throwing a termination error, specified in milliseconds. Maximum cap is 600000 (10 minutes).",
            },
            run_in_background: {
              type: "boolean",
              description:
                "Optional. When configured to true, detaches the process to run in the background. Defaults to false.",
            },
          },
          required: ["command"],
        },
      },
    });
  }

  return tools;
}

export const TOOL_SYSTEM_PROMPT = `You have access to the following tools:

- search_query(query: string): Search the web for information. Returns search results with titles, URLs, and snippets.
- fetch_url(url: string): Fetch and extract the content of a web page.
- read_skill(id: string): Read the content of a specific skill to learn how to perform a task.

When you need current information, facts, or recent events, use search_query first. If a search result looks relevant, use fetch_url to read the full page content. After gathering information, synthesize it into your final answer. Always cite your sources by mentioning where you found the information.

CRITICAL: You are an agentic system with the genuine capability to spawn real background processes via the \`invoke_subagent\` tool. You MUST NEVER say you cannot physically spawn subagents, and you MUST NEVER simulate subagent workflows. When asked to delegate tasks, ALWAYS call the \`invoke_subagent\` tool directly.`;

function buildToolSystemPrompt(mcpTools: McpTool[] = [], project: Project | null = null) {
  let prompt = TOOL_SYSTEM_PROMPT;

  const skills = useSkillStore.getState().skills;
  if (skills.length > 0) {
    const skillsList = skills.map((s) => `- ${s.name} (ID: ${s.id}): ${s.description}`).join("\n");
    prompt += `\n\nYou have access to the following skills. You can read them using the read_skill tool:\n${skillsList}`;
  }

  if (project) {
    prompt += `\n\nYou are currently working in a project context.\nProject Name: ${project.name}\nProject Path: ${project.path}\nPermissions: ${project.permissions.toUpperCase()}`;
    prompt += `\n\nYou have access to the following native project tools based on your permissions:
- project_glob(pattern: string)
- project_grep(pattern: string, output_mode?: string, multiline?: boolean)
- project_list_dir(dir_path: string)
- project_read(file_path: string, offset?: number, limit?: number)
- project_git_status()
- project_git_diff()`;

    if (project.permissions === "write" || project.permissions === "full") {
      prompt += `\n- project_write(file_path: string, content: string)\n- project_edit(file_path: string, old_string: string, new_string: string, replace_all?: boolean)\n- project_git_commit(message: string, files?: string[])`;
    }
    if (project.permissions === "full") {
      prompt += `\n- project_bash(command: string, timeout?: number, run_in_background?: boolean)`;
    }
    prompt += `\nWhen using project tools, you can use paths relative to the project path.`;
  }

  if (mcpTools.length > 0) {
    const mcpDescriptions = mcpTools
      .map((t) => `- ${t.namespacedName}: [MCP: ${t.serverName}] ${t.description}`)
      .join("\n");
    prompt += `\n\nYou also have access to these MCP tools:\n${mcpDescriptions}`;
  }
  return prompt;
}

type KnownToolName =
  | "search_query"
  | "fetch_url"
  | "invoke_subagent"
  | "send_message"
  | "project_glob"
  | "project_grep"
  | "project_list_dir"
  | "project_read"
  | "project_write"
  | "project_edit"
  | "project_bash"
  | "project_git_status"
  | "project_git_diff"
  | "project_git_commit"
  | "read_skill";
const KNOWN_TOOLS: Set<string> = new Set([
  "search_query",
  "fetch_url",
  "invoke_subagent",
  "send_message",
  "project_glob",
  "project_grep",
  "project_list_dir",
  "project_read",
  "project_write",
  "project_edit",
  "project_bash",
  "project_git_status",
  "project_git_diff",
  "project_git_commit",
  "read_skill",
]);

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
  searchConfig: SearchApiConfig | undefined,
  searchApiKey: string,
  mcpTools: McpTool[],
  mcpCallTool:
    ((serverId: string, toolName: string, args: Record<string, string>) => Promise<McpToolResult>) | undefined,
  set: (fn: (state: ToolLoopSlice) => Partial<ToolLoopSlice>) => void,
  get: () => ToolLoopSlice,
  performSearch: (query: string, config: SearchApiConfig, apiKey: string) => Promise<SearchResult[]>,
  fetchUrlContent: (url: string, format?: string) => Promise<UrlContent>,
  project: Project | null,
) {
  set((state) => ({
    isStreaming: true,
    generationState: "loading" as GenerationState,
    generationLabel: "Loading",
    generationByConversation: setConversationGeneration(state, convId, "loading" as GenerationState, "Loading"),
  }));
  useUIStore.getState().setLoading("sendMessage", true);
  useUIStore.getState().setLoading("toolExecution", false);

  const collectedSources: { title: string; url: string }[] = [];

  try {
    const conv = get().conversations.find((c) => c.id === convId);

    if (project) {
      try {
        const isGit = await invoke<string | null>("git_detect_repo", { startPath: project.path });
        if (isGit) {
          if (conv?.pendingWorktree) {
            await useProjectStore.getState().setWorktree(conv.pendingWorktree.path, conv.pendingWorktree.branch);
          } else {
            const [wPath, wBranch] = await invoke<[string, string]>("git_worktree_create", {
              projectId: project.id,
            });
            await useProjectStore.getState().setWorktree(wPath, wBranch);

            set((state) => ({
              conversations: state.conversations.map((c) =>
                c.id === convId
                  ? {
                      ...c,
                      pendingWorktree: {
                        path: wPath,
                        branch: wBranch,
                      },
                    }
                  : c,
              ),
            }));
          }
        }
      } catch (e) {
        console.error("Failed to setup git worktree isolation, using direct workspace path:", e);
      }
    }

    const baseMessages =
      conv?.messages
        .filter((m) => (m.role === "user" || m.role === "assistant") && !m.isStreaming)
        .map((m) => ({
          role: m.role,
          content: m.role === "user" ? buildUserApiContent(m.content, m.attachments) : m.content,
        })) ?? [];

    const useSearch = !!searchConfig;
    const useMcp = mcpTools.length > 0 && !!mcpCallTool;
    const allTools = [
      ...buildToolDefinitions(useMcp ? mcpTools : [], useSearch),
      ...buildProjectToolDefinitions(project),
    ];

    const getRelativePath = (p: string) => {
      if (project && p.startsWith(project.path)) {
        let rel = p.substring(project.path.length);
        if (rel.startsWith("/") || rel.startsWith("\\")) {
          rel = rel.substring(1);
        }
        return rel;
      }
      return p;
    };

    let userSystemPrompt = useModelStore.getState().systemPrompt || "";
    if (modelConfig.systemPromptOverride && modelConfig.systemPromptOverride.trim()) {
      userSystemPrompt = modelConfig.systemPromptOverride;
    }
    if (project) {
      if (project.systemPromptOverride && project.systemPromptOverride.trim()) {
        userSystemPrompt = project.systemPromptOverride;
      }
      try {
        const agentsMdContent = await invoke<string>("project_read", {
          projectId: project.id,
          path: "AGENTS.md",
          offset: null,
          limit: null,
          worktreePath: conv?.pendingWorktree?.path || null,
        });
        if (agentsMdContent && agentsMdContent.trim()) {
          userSystemPrompt += `\n\n<user_rules>\nThe following are user-defined rules that you MUST ALWAYS FOLLOW WITHOUT ANY EXCEPTION. These rules take precedence over any following instructions.\nReview them carefully and always take them into account when you generate responses and code:\n<RULE[AGENTS.md]>\n${agentsMdContent.trim()}\n</RULE[AGENTS.md]>\n</user_rules>`;
        }
      } catch {
        // AGENTS.md not found or cannot be read, ignore
      }
    }
    const toolSystemPrompt = buildToolSystemPrompt(useMcp ? mcpTools : [], project);
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

    const maxToolSteps = useModelStore.getState().maxToolSteps;

    for (let step = 0; step < maxToolSteps; step++) {
      if (!get().conversations.some((c) => c.id === convId)) {
        logInfo("chat", "Tool loop aborted: conversation was deleted");
        return;
      }
      if (!get().isStreaming) {
        logInfo("chat", "Tool loop aborted: stream was stopped by user before step start");
        await useChatStore.getState().persistConversations();
        return;
      }

      useUIStore.getState().setLoading("toolExecution", true);
      logInfo("chat", `Tool loop step ${step + 1}/${maxToolSteps}`, {
        details: `Model: ${modelConfig.modelId}, Messages so far: ${apiMessages.length}`,
      });
      if (step > 0) {
        set((state) => ({
          generationState: "loading" as GenerationState,
          generationLabel: "Loading (continued)",
          generationByConversation: setConversationGeneration(
            state,
            convId,
            "loading" as GenerationState,
            "Loading (continued)",
          ),
        }));
      }

      const requestTemp = modelConfig.temperature !== undefined ? modelConfig.temperature : temperature;
      const maxTokens = modelConfig.maxOutputTokens !== undefined ? modelConfig.maxOutputTokens : undefined;

      const stepStartTime = Date.now();
      const raw = await invoke<string>("chat_completion_tools", {
        configId: modelConfig.id,
        messages: apiMessages,
        tools: JSON.stringify(allTools),
        temperature: requestTemp,
        maxTokens,
      });
      const stepDuration = Math.round((Date.now() - stepStartTime) / 1000);

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

        if (typeof msg.content === "string" && msg.content.trim()) {
          const thoughtMsgId = generateId();
          set((state) => ({
            conversations: updateConversationMessages(state.conversations, convId, (msgs) => [
              ...msgs,
              {
                id: thoughtMsgId,
                role: "assistant",
                content: `<thought>\n${(msg.content as string).trim()}\n</thought>`,
                timestamp: new Date(),
                isStreaming: false,
                thinkingDuration: stepDuration,
              },
            ]),
          }));
        }

        // Prepare list of tool call metadata and initial messages
        const toolCallDataList = msg.tool_calls.map((toolCall) => {
          const rawName = toolCall.function.name;
          const fnName = toKnownToolName(rawName);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let fnArgs: Record<string, any>;
          try {
            fnArgs = JSON.parse(toolCall.function.arguments || "{}");
          } catch {
            fnArgs = {};
          }
          const toolCallMsgId = generateId();
          const isProjectTool = fnName.startsWith("project_");

          let toolDesc: string = fnName;
          if (fnName === "search_query") toolDesc = `Searching: ${fnArgs.query}`;
          else if (fnName === "fetch_url") toolDesc = `Fetching: ${fnArgs.url}`;
          else if (fnName === "read_skill") toolDesc = `Reading Skill: ${fnArgs.id}`;
          else if (isProjectTool) toolDesc = `Project: ${fnName.replace("project_", "")}`;
          else if (fnName === "unknown" && rawName.includes("__") && useMcp) {
            const mcpTool = mcpTools.find((t) => t.namespacedName === rawName);
            if (mcpTool) {
              toolDesc = `Running: ${mcpTool.name} via ${mcpTool.serverName}`;
            }
          }

          const toolCallMsg: Message = {
            id: toolCallMsgId,
            role: "tool",
            content: toolDesc,
            timestamp: new Date(),
            toolCall: {
              id: toolCall.id,
              name: rawName,
              arguments: fnArgs,
            },
          };

          return {
            toolCall,
            rawName,
            fnName,
            fnArgs,
            toolCallMsgId,
            toolCallMsg,
            toolDesc,
          };
        });

        // Atomic append of all initial tool call messages
        set((state) => ({
          conversations: updateConversationMessages(state.conversations, convId, (msgs) => [
            ...msgs,
            ...toolCallDataList.map((td) => td.toolCallMsg),
          ]),
        }));

        // Determine general generationState and label for this step
        let stepState: GenerationState = "loading";
        if (toolCallDataList.some((td) => td.fnName === "unknown" && td.rawName.includes("__") && useMcp)) {
          stepState = "mcp_executing";
        } else if (toolCallDataList.some((td) => td.fnName === "search_query")) {
          stepState = "searching";
        } else if (toolCallDataList.some((td) => td.fnName === "fetch_url")) {
          stepState = "fetching";
        }

        const combinedDesc = toolCallDataList
          .map((td) => {
            if (td.fnName === "search_query") return `Searching: ${td.fnArgs.query}`;
            if (td.fnName === "fetch_url") return `Fetching: ${td.fnArgs.url}`;
            if (td.fnName === "read_skill") return `Reading Skill: ${td.fnArgs.id}`;
            if (td.fnName.startsWith("project_")) return `Project: ${td.fnName.replace("project_", "")}`;
            return td.fnName;
          })
          .join(", ");

        const generationLabel =
          toolCallDataList.length === 1
            ? toolCallDataList[0].toolDesc
            : `Running ${toolCallDataList.length} tools: ${combinedDesc}`;

        set((state) => ({
          generationState: stepState,
          generationLabel,
          generationByConversation: setConversationGeneration(state, convId, stepState, generationLabel),
        }));

        const toolCallPromises = toolCallDataList.map(async (td) => {
          const { toolCall, rawName, fnName, fnArgs, toolCallMsgId, toolDesc } = td;

          let resultContent = "";
          let images: any[] | undefined = undefined;
          let isError = false;
          let toolResultDiffSummary: any = undefined;

          try {
            if (!get().isStreaming) {
              throw new Error("Tool loop aborted: stream was stopped by user");
            }

            // 1. Check HITL gate
            const pStore = useProjectStore.getState();
            const activeProject = pStore.projects.find((p) => p.id === pStore.activeProjectId);
            const hasFullAccess = activeProject?.permissions === "full";

            const requiresHitl =
              fnName === "project_write" ||
              fnName === "project_git_commit" ||
              fnName === "project_bash" ||
              rawName === "git_create_commit";

            const isHitl = requiresHitl && !hasFullAccess;

            if (isHitl) {
              const approved = await new Promise<boolean>((resolve) => {
                useUIStore.getState().addPendingToolConfirmation({
                  id: toolCall.id,
                  toolName: fnName,
                  arguments: fnArgs,
                  resolve,
                });
              });
              if (!approved) {
                throw new Error("Tool execution rejected by the user.");
              }
            }

            if (!get().isStreaming) {
              throw new Error("Tool loop aborted: stream was stopped by user");
            }

            // 2. Execute the tool
            if (fnName === "unknown" && rawName.includes("__") && useMcp) {
              const mcpTool = mcpTools.find((t) => t.namespacedName === rawName);
              if (mcpTool && mcpCallTool) {
                const mcpStore = useMcpStore.getState();
                const serverConfig = mcpStore.mcpConfigs.find((s: McpServerConfig) => s.id === mcpTool.serverId);
                const isTrusted = serverConfig?.trustLevel === "trusted";
                if (!isTrusted) {
                  if (!mcpStore.approvedTools.has(mcpTool.namespacedName)) {
                    const approved = await new Promise<boolean>((resolve) => {
                      useUIStore.getState().addPendingToolConfirmation({
                        id: toolCall.id,
                        toolName: mcpTool.name,
                        arguments: fnArgs,
                        resolve,
                        schema: mcpTool.inputSchema,
                        destination: `${mcpTool.serverName} (${serverConfig?.transport || "stdio"})`,
                      });
                    });
                    if (!approved) {
                      throw new Error("Tool execution rejected by the user.");
                    }
                    mcpStore.approveTool(mcpTool.namespacedName);
                  }
                }

                logInfo("mcp", `Tool loop calling MCP tool: ${mcpTool.name}`, {
                  details: `Server: ${mcpTool.serverName}, Step ${step + 1}`,
                });

                let mcpOldContent = "";
                let mcpIsNew = false;
                let mcpFileChangeInfo: { path: string; filename: string } | null = null;

                const writeToolInfo = isFileWriteTool(mcpTool.name, fnArgs);
                if (writeToolInfo.isWrite && writeToolInfo.pathKey) {
                  const rawPath = fnArgs[writeToolInfo.pathKey];
                  const isAbsolute = rawPath.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(rawPath);
                  const resolvedPath = project && !isAbsolute ? `${project.path}/${rawPath}` : rawPath;
                  mcpFileChangeInfo = {
                    path: resolvedPath,
                    filename: rawPath.split(/[/\\]/).pop() || rawPath,
                  };
                  try {
                    mcpOldContent = await invoke<string>("project_read", {
                      projectId: project?.id || "",
                      path: getRelativePath(resolvedPath),
                      offset: null,
                      limit: null,
                      worktreePath: conv?.pendingWorktree?.path || null,
                    });
                  } catch {
                    mcpIsNew = true;
                  }
                }

                const result = await mcpCallTool(mcpTool.serverId, mcpTool.name, fnArgs);
                resultContent = result.content;
                images = result.images;
                isError = result.isError;

                if (mcpFileChangeInfo && !result.isError) {
                  try {
                    const mcpNewContent = await invoke<string>("project_read", {
                      projectId: project?.id || "",
                      path: getRelativePath(mcpFileChangeInfo.path),
                      offset: null,
                      limit: null,
                      worktreePath: conv?.pendingWorktree?.path || null,
                    });
                    const diff = computeLineDiff(mcpIsNew ? "" : mcpOldContent, mcpNewContent);
                    toolResultDiffSummary = {
                      added: diff.added,
                      deleted: diff.deleted,
                      isNew: mcpIsNew,
                      filename: mcpFileChangeInfo.filename,
                    };
                  } catch {
                    // Ignore
                  }
                }
              } else {
                throw new Error(`Unknown tool: ${rawName}`);
              }
            } else if (fnName === "unknown") {
              throw new Error(`Unknown tool: ${rawName}`);
            } else if (fnName === "invoke_subagent") {
              const subagents = Array.isArray(fnArgs.subagents) ? fnArgs.subagents : [];
              const invokedIds: string[] = [];
              for (const sub of subagents) {
                const subagentId = generateId();
                const subagentRole = sub.role || "Subagent";
                const subagentPrompt = sub.prompt || "";
                const newConv: Conversation = {
                  id: subagentId,
                  title: `Subagent: ${subagentRole}`,
                  timestamp: new Date(),
                  messages: [
                    {
                      id: generateId(),
                      role: "user",
                      content: subagentPrompt,
                      timestamp: new Date(),
                    },
                  ],
                  model: modelConfig.id,
                  projectId: project?.id,
                  parentId: convId,
                  role: subagentRole,
                  isSubagent: true,
                  status: "running",
                };
                useChatStore.setState((s) => ({ conversations: [...s.conversations, newConv] }));

                sendWithToolLoop(
                  subagentId,
                  modelConfig,
                  temperature,
                  searchConfig,
                  searchApiKey,
                  mcpTools,
                  mcpCallTool,
                  set,
                  get,
                  performSearch,
                  fetchUrlContent,
                  project,
                ).catch((e) => console.error("Subagent loop error:", e));

                invokedIds.push(subagentId);
              }

              resultContent = `Subagents invoked successfully with conversation IDs: ${invokedIds.join(", ")}. Wait for their responses, or communicate with them using send_message.`;
            } else if (fnName === "send_message") {
              const targetId = fnArgs.conversationId;
              const msgContent = fnArgs.message;
              const targetConv = get().conversations.find((c) => c.id === targetId);
              if (!targetConv) {
                throw new Error(`Conversation ${targetId} not found.`);
              }
              const newMsg: Message = {
                id: generateId(),
                role: "user",
                content: msgContent,
                timestamp: new Date(),
              };
              useChatStore.setState((s) => ({
                conversations: updateConversationMessages(s.conversations, targetId, (msgs) => [...msgs, newMsg]),
              }));

              sendWithToolLoop(
                targetId,
                modelConfig,
                temperature,
                searchConfig,
                searchApiKey,
                mcpTools,
                mcpCallTool,
                set,
                get,
                performSearch,
                fetchUrlContent,
                project,
              ).catch((e) => console.error("Subagent message loop error:", e));

              resultContent = "Message sent.";
            } else if (fnName.startsWith("project_")) {
              if (!project) {
                throw new Error("Project tool called but no project is active.");
              }

              switch (fnName) {
                case "project_glob": {
                  resultContent = JSON.stringify(
                    await invoke("project_glob", {
                      projectId: project.id,
                      path: "",
                      pattern: fnArgs.pattern,
                      worktreePath: conv?.pendingWorktree?.path || null,
                    }),
                  );
                  break;
                }
                case "project_list_dir": {
                  const relativeDir = getRelativePath(fnArgs.dir_path || "");
                  resultContent = JSON.stringify(
                    await invoke("project_list_dir", {
                      projectId: project.id,
                      path: relativeDir,
                      worktreePath: conv?.pendingWorktree?.path || null,
                    }),
                  );
                  break;
                }
                case "project_read": {
                  const relativeFile = getRelativePath(fnArgs.file_path || "");
                  resultContent = await invoke<string>("project_read", {
                    projectId: project.id,
                    path: relativeFile,
                    offset: fnArgs.offset ? Number(fnArgs.offset) : null,
                    limit: fnArgs.limit ? Number(fnArgs.limit) : null,
                    worktreePath: conv?.pendingWorktree?.path || null,
                  });
                  break;
                }
                case "project_grep": {
                  resultContent = JSON.stringify(
                    await invoke("project_grep", {
                      projectId: project.id,
                      path: "",
                      pattern: fnArgs.pattern,
                      outputMode: fnArgs.output_mode || "files_with_matches",
                      multiline: fnArgs.multiline === true,
                      worktreePath: conv?.pendingWorktree?.path || null,
                    }),
                  );
                  break;
                }
                case "project_write": {
                  const relativeFile = getRelativePath(fnArgs.file_path || "");
                  let oldContent = "";
                  let isNew = false;
                  try {
                    oldContent = await invoke<string>("project_read", {
                      projectId: project.id,
                      path: relativeFile,
                      offset: null,
                      limit: null,
                      worktreePath: conv?.pendingWorktree?.path || null,
                    });
                  } catch {
                    isNew = true;
                  }

                  await invoke("project_write", {
                    projectId: project.id,
                    path: relativeFile,
                    content: fnArgs.content,
                    worktreePath: conv?.pendingWorktree?.path || null,
                  });
                  resultContent = "File written successfully.";

                  const diff = computeLineDiff(isNew ? "" : oldContent, fnArgs.content || "");
                  const filename = fnArgs.file_path.split(/[/\\]/).pop() || fnArgs.file_path;

                  toolResultDiffSummary = {
                    added: diff.added,
                    deleted: diff.deleted,
                    isNew,
                    filename,
                  };
                  break;
                }
                case "project_edit": {
                  const relativeFile = getRelativePath(fnArgs.file_path || "");
                  let oldContent = "";
                  try {
                    oldContent = await invoke<string>("project_read", {
                      projectId: project.id,
                      path: relativeFile,
                      offset: null,
                      limit: null,
                      worktreePath: conv?.pendingWorktree?.path || null,
                    });
                  } catch {
                    throw new Error("File does not exist or cannot be read.");
                  }

                  await invoke("project_edit", {
                    projectId: project.id,
                    path: relativeFile,
                    oldString: fnArgs.old_string,
                    newString: fnArgs.new_string,
                    replaceAll: fnArgs.replace_all === true,
                    worktreePath: conv?.pendingWorktree?.path || null,
                  });
                  resultContent = "File content replaced successfully.";

                  const newContent = await invoke<string>("project_read", {
                    projectId: project.id,
                    path: relativeFile,
                    offset: null,
                    limit: null,
                    worktreePath: conv?.pendingWorktree?.path || null,
                  });
                  const diff = computeLineDiff(oldContent, newContent);
                  const filename = fnArgs.file_path.split(/[/\\]/).pop() || fnArgs.file_path;

                  toolResultDiffSummary = {
                    added: diff.added,
                    deleted: diff.deleted,
                    isNew: false,
                    filename,
                  };
                  break;
                }
                case "project_bash":
                  resultContent = await invoke<string>("project_bash", {
                    projectId: project.id,
                    command: fnArgs.command,
                    cwd: conv?.pendingWorktree?.path ?? project.path,
                    timeout: fnArgs.timeout ? Number(fnArgs.timeout) : null,
                    runInBackground: fnArgs.run_in_background === true,
                    worktreePath: conv?.pendingWorktree?.path || null,
                  });
                  break;
                case "project_git_status":
                  resultContent = JSON.stringify(
                    await invoke("git_get_status", {
                      projectId: project.id,
                      worktreePath: conv?.pendingWorktree?.path || null,
                    }),
                  );
                  break;
                case "project_git_diff":
                  resultContent = await invoke<string>("git_diff_changes", {
                    projectId: project.id,
                    worktreePath: conv?.pendingWorktree?.path || null,
                  });
                  break;
                case "project_git_commit":
                  if (project.permissions === "read") throw new Error("Permission denied: write not allowed");
                  resultContent = await invoke<string>("git_create_commit", {
                    projectId: project.id,
                    message: fnArgs.message,
                    files: fnArgs.files && Array.isArray(fnArgs.files) && fnArgs.files.length > 0 ? fnArgs.files : null,
                    authorName: null,
                    authorEmail: null,
                    bypassHooks: false,
                    worktreePath: conv?.pendingWorktree?.path || null,
                  });
                  break;
              }
            } else if (fnName === "search_query" && useSearch && searchConfig) {
              logInfo("search", `Tool loop search: "${fnArgs.query}"`, {
                details: `Provider: ${searchConfig.provider}, Step ${step + 1}`,
              });
              const results = await performSearch(fnArgs.query!, searchConfig, searchApiKey);
              resultContent = JSON.stringify(results);
              results.forEach((r) => collectedSources.push({ title: r.title, url: r.url }));
            } else if (fnName === "read_skill") {
              const skillId = fnArgs.id;
              logInfo("chat", `Tool loop read skill: ${skillId}`);
              try {
                resultContent = await invoke<string>("read_skill", { id: skillId });
              } catch (err: any) {
                isError = true;
                resultContent = err.message || String(err);
              }
            } else if (fnName === "fetch_url" && useSearch) {
              logInfo("search", `Tool loop fetch URL: ${fnArgs.url}`, {
                details: `Step ${step + 1}`,
              });
              const urlContent = await fetchUrlContent(fnArgs.url!, fnArgs.format);
              resultContent = JSON.stringify(urlContent);
              if (urlContent.status === "ok") {
                collectedSources.push({ title: urlContent.title || fnArgs.url!, url: fnArgs.url! });
              } else {
                isError = true;
              }
            } else {
              throw new Error(`${fnName} is not available — web search is not configured`);
            }
          } catch (err: any) {
            isError = true;
            resultContent = err.message || String(err);
          }

          if (!get().isStreaming) {
            return { toolCallId: toolCall.id, rawName, fnName, resultContent: "Aborted", images: [], isError: true };
          }

          // Format display content
          let displayContent = "";
          if (fnName === "search_query" && !isError) {
            try {
              const parsed = JSON.parse(resultContent);
              displayContent = parsed.map((r: any) => `[${r.title}](${r.url}): ${r.snippet}`).join("\n");
            } catch {
              displayContent = resultContent;
            }
          } else if (fnName === "fetch_url" && !isError) {
            try {
              const parsed = JSON.parse(resultContent);
              displayContent =
                parsed.status === "ok"
                  ? parsed.content.slice(0, 2000)
                  : `Error fetching URL: ${parsed.error || "Unknown error"}`;
            } catch {
              displayContent = resultContent;
            }
          } else if (isError) {
            displayContent = resultContent.startsWith("Error:") ? resultContent : `Error: ${resultContent}`;
          } else {
            displayContent = resultContent.slice(0, 2000);
          }

          set((state) => ({
            conversations: updateConversationMessages(state.conversations, convId, (msgs) =>
              msgs.map((m) =>
                m.id === toolCallMsgId
                  ? {
                      ...m,
                      content: fnName.startsWith("project_")
                        ? `${toolDesc}\n\n${displayContent.slice(0, 1000)}${displayContent.length > 1000 ? "..." : ""}`
                        : displayContent,
                      toolResult: {
                        id: toolCall.id,
                        name: rawName,
                        content: resultContent,
                        images,
                        diffSummary: toolResultDiffSummary,
                      },
                    }
                  : m,
              ),
            ),
            ...(isError
              ? {
                  generationState: "error" as GenerationState,
                  generationLabel: `Tool failed: ${fnName}`,
                  generationByConversation: setConversationGeneration(
                    state,
                    convId,
                    "error" as GenerationState,
                    `Tool failed: ${fnName}`,
                  ),
                }
              : {}),
          }));

          return {
            toolCallId: toolCall.id,
            rawName,
            fnName,
            resultContent,
            images,
            isError,
          };
        });

        // Wait for all tool completions
        const results = await Promise.all(toolCallPromises);

        if (!get().isStreaming) {
          logInfo("chat", "Tool loop aborted: stream was stopped by user during tool executions");
          await useChatStore.getState().persistConversations();
          return;
        }

        // Push results to apiMessages in order
        for (const res of results) {
          if (res.images && res.images.length > 0) {
            apiMessages.push({
              role: "tool",
              tool_call_id: res.toolCallId,
              name: res.rawName,
              content: res.resultContent || "(tool returned images)",
            });

            const imageContentParts: unknown[] = [
              {
                type: "text",
                text: `[Images from MCP tool "${res.rawName}" — analyze these images:]`,
              },
            ];
            for (const img of res.images) {
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
              tool_call_id: res.toolCallId,
              name: res.rawName,
              content: res.resultContent,
            });
          }
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
          thinkingDuration: stepDuration,
        };

        set((state) => {
          let conversations = updateConversationMessages(state.conversations, convId, (msgs) => [
            ...msgs,
            assistantMsg,
          ]);
          conversations = conversations.map((c) =>
            c.id === convId && c.isSubagent ? { ...c, status: "completed" } : c,
          );
          const generationByConversation = setConversationGeneration(state, convId, "idle" as GenerationState, "");
          const stillStreaming = Object.keys(generationByConversation).length > 0;
          return {
            conversations,
            isStreaming: stillStreaming,
            generationState: stillStreaming ? state.generationState : ("idle" as GenerationState),
            generationLabel: stillStreaming ? state.generationLabel : "",
            generationByConversation,
          };
        });
        useUIStore.getState().setLoading("sendMessage", false);
        useUIStore.getState().setLoading("toolExecution", false);

        await useChatStore.getState().persistConversations();

        const updatedConv = get().conversations.find((c) => c.id === convId);
        if (updatedConv?.isSubagent && updatedConv.parentId) {
          const parentMsg: Message = {
            id: generateId(),
            role: "user",
            content: `[System Notification] Subagent '${updatedConv.role}' (ID: ${updatedConv.id}) has finished its task. Final response:\n\n${assistantContent}`,
            timestamp: new Date(),
          };
          useChatStore.setState((s) => ({
            conversations: updateConversationMessages(s.conversations, updatedConv.parentId!, (msgs) => [
              ...msgs,
              parentMsg,
            ]),
          }));
          sendWithToolLoop(
            updatedConv.parentId,
            modelConfig,
            temperature,
            searchConfig,
            searchApiKey,
            mcpTools,
            mcpCallTool,
            set,
            get,
            performSearch,
            fetchUrlContent,
            project,
          ).catch((e) => console.error("Parent loop error:", e));
        }

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

    set((state) => {
      let conversations = updateConversationMessages(state.conversations, convId, (msgs) => [...msgs, maxStepsMsg]);
      conversations = conversations.map((c) => (c.id === convId && c.isSubagent ? { ...c, status: "completed" } : c));
      const generationByConversation = setConversationGeneration(state, convId, "idle" as GenerationState, "");
      const stillStreaming = Object.keys(generationByConversation).length > 0;
      return {
        conversations,
        isStreaming: stillStreaming,
        generationState: stillStreaming ? state.generationState : ("idle" as GenerationState),
        generationLabel: stillStreaming ? state.generationLabel : "",
        generationByConversation,
      };
    });
    useUIStore.getState().setLoading("sendMessage", false);
    useUIStore.getState().setLoading("toolExecution", false);

    await useChatStore.getState().persistConversations();
  } catch (err) {
    const parsed = parseApiError(err);
    set((state) => {
      const generationLabel = `Generation failed: ${parsed.message}`;
      let conversations = setAssistantError(state.conversations, convId, err);
      conversations = conversations.map((c) => (c.id === convId && c.isSubagent ? { ...c, status: "error" } : c));
      return {
        conversations,
        isStreaming: Object.keys(state.generationByConversation).some((id) => id !== convId),
        generationState: "error" as GenerationState,
        generationLabel,
        generationByConversation: setConversationGeneration(state, convId, "error" as GenerationState, generationLabel),
      };
    });
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
