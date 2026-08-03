import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useProjectStore } from "../store/useProjectStore";
import {
  TOOL_DEFINITIONS,
  TOOL_SYSTEM_PROMPT,
  assertUsableFinishReason,
  parseToolArguments,
  requiresMcpConfirmation,
  sendWithToolLoop,
  type ToolLoopSlice,
} from "./toolLoop";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockToasts: any[] = [];
const mockAddToast = vi.fn((msg, variant) => {
  mockToasts.push({ msg, variant });
});
const mockAddTask = vi.fn();
const mockCompleteTask = vi.fn();
let mockMaxToolSteps = 25;
let mockStreamContent = "Simulated content chunk";
let mockStreamReasoning = "";
let mockStreamDone: (() => void) | null = null;

vi.mock("../store/useUIStore", () => ({
  useUIStore: {
    getState: () => ({
      setLoading: vi.fn(),
      addToast: mockAddToast,
      addTask: mockAddTask,
      completeTask: mockCompleteTask,
    }),
  },
}));

vi.mock("../store/useModelStore", () => ({
  useModelStore: {
    getState: () => ({
      systemPrompt: "",
      maxToolSteps: mockMaxToolSteps,
      ensureStreamListeners: vi.fn().mockImplementation((_convId, onChunk, onDone) => {
        mockStreamDone = onDone;
        // Trigger onChunk and onDone asynchronously to simulate completion
        setTimeout(() => {
          if (mockStreamContent) {
            if (mockStreamReasoning) {
              onChunk({ kind: "reasoning", content: mockStreamReasoning });
            }
            onChunk({ kind: "content", content: mockStreamContent });
          }
          onDone();
        }, 10);
        return Promise.resolve(vi.fn());
      }),
      setActiveStreamId: vi.fn(),
    }),
  },
}));

const mockConversations: any[] = [];
const mockActiveStreamContent: Record<string, string> = {};
const mockActiveStreamReasoning: Record<string, string> = {};
const mockResumeConversation = vi.fn().mockResolvedValue(undefined);
const mockSetState = vi.fn((fn: any) => {
  const next =
    typeof fn === "function"
      ? fn({
          conversations: mockConversations,
          activeStreamContent: mockActiveStreamContent,
          activeStreamReasoning: mockActiveStreamReasoning,
          activeStreamThinkingStart: {},
          activeStreamThinkingEnd: {},
        })
      : fn;
  if (next.conversations) {
    mockConversations.length = 0;
    mockConversations.push(...next.conversations);
  }
  if (next.activeStreamContent) {
    Object.assign(mockActiveStreamContent, next.activeStreamContent);
  }
  if (next.activeStreamReasoning) {
    Object.assign(mockActiveStreamReasoning, next.activeStreamReasoning);
  }
});

vi.mock("../store/useChatStore", () => ({
  useChatStore: {
    getState: () => ({
      persistConversations: vi.fn(),
      conversations: mockConversations,
      activeStreamContent: mockActiveStreamContent,
      activeStreamReasoning: mockActiveStreamReasoning,
      resumeConversation: mockResumeConversation,
    }),
    setState: (fn: any) => mockSetState(fn),
  },
}));

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  invokeMock.mockReset();
  mockMaxToolSteps = 25;
  mockStreamContent = "Simulated content chunk";
  mockStreamReasoning = "";
  mockStreamDone = null;
  mockConversations.length = 0;
  for (const key of Object.keys(mockActiveStreamContent)) {
    delete mockActiveStreamContent[key];
  }
  for (const key of Object.keys(mockActiveStreamReasoning)) {
    delete mockActiveStreamReasoning[key];
  }
  mockAddTask.mockClear();
  mockCompleteTask.mockClear();
  useProjectStore.setState({
    projects: [],
    activeProjectId: null,
    isProjectsEnabled: false,
    activeWorktreePath: null,
    activeWorktreeBranch: null,
  });
});

describe("TOOL_DEFINITIONS", () => {
  it("defines exactly 6 tools", () => {
    expect(TOOL_DEFINITIONS).toHaveLength(6);
  });

  it("includes search_query tool", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.function.name);
    expect(names).toContain("search_query");
  });

  it("includes fetch_url tool", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.function.name);
    expect(names).toContain("fetch_url");
  });

  it("includes subagent and skill tools", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.function.name);
    expect(names).toContain("invoke_subagent");
    expect(names).toContain("send_message");
    expect(names).toContain("read_skill");
  });

  it("all tools have required parameters", () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.function.parameters.required).toBeDefined();
      expect(tool.function.parameters.required!.length).toBeGreaterThan(0);
    }
  });
});

describe("tool response validation", () => {
  it("rejects tool calls from a truncated response", () => {
    expect(() => assertUsableFinishReason("length", true)).toThrow("were not executed");
    expect(() => assertUsableFinishReason(undefined, true)).toThrow("without a tool-call finish reason");
  });

  it("rejects malformed or schema-invalid arguments before execution", () => {
    const tool = TOOL_DEFINITIONS.find((definition) => definition.function.name === "search_query")!;
    expect(() =>
      parseToolArguments({ id: "call-1", function: { name: "search_query", arguments: '{"query":' } }, [tool]),
    ).toThrow("invalid JSON");
    expect(() =>
      parseToolArguments(
        { id: "call-2", function: { name: "search_query", arguments: JSON.stringify({ query: 123 }) } },
        [tool],
      ),
    ).toThrow("schema validation");
  });
});

describe("MCP confirmation policy", () => {
  it("requires confirmation unless the server is explicitly trusted", () => {
    expect(requiresMcpConfirmation(undefined)).toBe(true);
    expect(requiresMcpConfirmation({})).toBe(true);
    expect(requiresMcpConfirmation({ trustLevel: "untrusted" })).toBe(true);
    expect(requiresMcpConfirmation({ trustLevel: "trusted" })).toBe(false);
  });
});

describe("TOOL_SYSTEM_PROMPT", () => {
  it("mentions both tools", () => {
    expect(TOOL_SYSTEM_PROMPT).toContain("search_query");
    expect(TOOL_SYSTEM_PROMPT).toContain("fetch_url");
  });

  it("mentions citing sources", () => {
    expect(TOOL_SYSTEM_PROMPT.toLowerCase()).toContain("cite");
  });
});

describe("sendWithToolLoop", () => {
  it("runs project tools for the default read-only project without creating a Git worktree", async () => {
    mockMaxToolSteps = 2;
    mockStreamContent = "";
    const project = {
      id: "project-1",
      name: "Default project",
      path: "/workspace/project",
      permissions: "read" as const,
    };
    useProjectStore.setState({
      projects: [project],
      activeProjectId: project.id,
      isProjectsEnabled: true,
    });

    let modelCall = 0;
    invokeMock.mockImplementation(async (command, args) => {
      const invokeArgs = args as Record<string, unknown> | undefined;
      if (command === "project_run_begin") return undefined;
      if (command === "project_read") {
        return invokeArgs?.path === "AGENTS.md" ? "" : "read-only content";
      }
      if (command === "chat_stream_tools") {
        modelCall += 1;
        if (modelCall === 1) {
          return JSON.stringify({
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  content: "I’ll inspect the project.",
                  tool_calls: [
                    {
                      id: "read-call",
                      function: {
                        name: "project_read",
                        arguments: JSON.stringify({ file_path: "README.md" }),
                      },
                    },
                  ],
                },
              },
            ],
          });
        }
        setTimeout(() => mockStreamDone?.(), 0);
        return JSON.stringify({
          choices: [{ finish_reason: "stop", message: { content: "Read complete." } }],
        });
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    mockConversations.push({
      id: "conv-read",
      title: "Read project",
      timestamp: new Date(),
      model: "model-1",
      projectId: project.id,
      messages: [{ id: "msg-read", role: "user", content: "Read the README", timestamp: new Date() }],
    });
    let state: ToolLoopSlice = {
      conversations: mockConversations,
      isStreaming: true,
      generationState: "loading",
      generationLabel: "",
      generationByConversation: { "conv-read": { state: "loading", label: "Loading" } },
    };
    const set = (fn: (state: ToolLoopSlice) => Partial<ToolLoopSlice>) => {
      const next = fn(state);
      state = { ...state, ...next };
      if (next.conversations) {
        const conversations = [...next.conversations];
        mockConversations.length = 0;
        mockConversations.push(...conversations);
        state.conversations = mockConversations;
      }
    };

    await sendWithToolLoop(
      "conv-read",
      {
        id: "model-1",
        name: "Model",
        apiBase: "https://example.com/v1/chat/completions",
        apiKey: "",
        modelId: "test-model",
      },
      0.7,
      undefined,
      "",
      [],
      undefined,
      set,
      () => state,
      vi.fn(),
      vi.fn(),
      project,
    );

    expect(invokeMock).toHaveBeenCalledWith("project_run_begin", {
      projectId: project.id,
      worktreePath: null,
      branchName: null,
    });
    expect(invokeMock).not.toHaveBeenCalledWith("git_worktree_create", expect.anything());
    expect(invokeMock).toHaveBeenCalledWith("project_read", {
      projectId: project.id,
      path: "README.md",
      offset: null,
      limit: null,
      worktreePath: null,
    });
  });

  it("keeps assistant narration visible when the same response requests a tool call", async () => {
    mockMaxToolSteps = 1;
    mockStreamReasoning = "I should use the search tool.";
    mockStreamContent = "I’ll search for the latest information first.";
    invokeMock.mockResolvedValueOnce(
      JSON.stringify({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: "I’ll search for the latest information first.",
              reasoning: "I should use the search tool.",
              tool_calls: [
                {
                  id: "call-1",
                  function: {
                    name: "search_query",
                    arguments: JSON.stringify({ query: "latest information" }),
                  },
                },
              ],
            },
          },
        ],
      }),
    );

    mockConversations.push({
      id: "conv-1",
      title: "Test",
      timestamp: new Date(),
      model: "model-1",
      messages: [{ id: "msg-1", role: "user", content: "Look this up", timestamp: new Date() }],
    });

    let state: ToolLoopSlice = {
      conversations: mockConversations,
      isStreaming: true,
      generationState: "loading",
      generationLabel: "",
      generationByConversation: {
        "conv-1": { state: "loading", label: "Loading" },
      },
    };

    const set = (fn: (state: ToolLoopSlice) => Partial<ToolLoopSlice>) => {
      const next = fn(state);
      state = { ...state, ...next };
      if (next.conversations) {
        const conversations = [...next.conversations];
        mockConversations.length = 0;
        mockConversations.push(...conversations);
        state.conversations = mockConversations;
      }
    };

    await sendWithToolLoop(
      "conv-1",
      {
        id: "model-1",
        name: "Model",
        apiBase: "https://example.com/v1/chat/completions",
        apiKey: "",
        modelId: "test-model",
      },
      0.7,
      {
        id: "search-1",
        name: "Search",
        provider: "google",
        baseUrl: "https://www.googleapis.com/customsearch/v1",
        maxResults: 5,
        enabled: true,
      },
      "",
      [],
      undefined,
      set,
      () => state,
      vi.fn().mockResolvedValue([]),
      vi.fn(),
      null,
    );

    const messages = state.conversations[0].messages;
    const narrationIndex = messages.findIndex(
      (message) => message.role === "assistant" && message.content.includes("I’ll search"),
    );
    const toolCallIndex = messages.findIndex((message) => message.toolCall?.id === "call-1");
    const narration = messages[narrationIndex];

    expect(narration).toMatchObject({
      isStreaming: false,
    });
    expect(narration?.content).toBe("I’ll search for the latest information first.");
    expect(narration?.reasoningContent).toBe("I should use the search tool.");
    expect(narrationIndex).toBeGreaterThan(-1);
    expect(toolCallIndex).toBeGreaterThan(narrationIndex);
    expect(mockAddTask).toHaveBeenCalledWith("call-1", "Tool: search_query", "conv-1");
  });

  it("appends an assistant error when the tool request fails before a placeholder exists", async () => {
    invokeMock.mockRejectedValueOnce(new Error("network failed"));

    let state: ToolLoopSlice = {
      conversations: [
        {
          id: "conv-1",
          title: "Test",
          timestamp: new Date(),
          model: "model-1",
          messages: [{ id: "msg-1", role: "user", content: "Search this", timestamp: new Date() }],
        },
      ],
      isStreaming: false,
      generationState: "idle" as const,
      generationLabel: "",
      generationByConversation: {},
    };

    const set = (fn: (state: ToolLoopSlice) => Partial<ToolLoopSlice>) => {
      state = { ...state, ...fn(state) };
    };

    await sendWithToolLoop(
      "conv-1",
      {
        id: "model-1",
        name: "Model",
        apiBase: "https://example.com/v1/chat/completions",
        apiKey: "",
        modelId: "test-model",
      },
      0.7,
      {
        id: "search-1",
        name: "Search",
        provider: "google",
        baseUrl: "https://www.googleapis.com/customsearch/v1",
        maxResults: 5,
        enabled: true,
      },
      "",
      [],
      undefined,
      set,
      () => state,
      vi.fn(),
      vi.fn(),
      null,
    );

    const last = state.conversations[0].messages[state.conversations[0].messages.length - 1];
    expect(last?.role).toBe("assistant");
    expect(last?.content).toContain("**Error:**");
    expect(state.isStreaming).toBe(false);
  });

  it("stops execution if the conversation-specific stream is cancelled (cancellation isolation)", async () => {
    // Mock the invoke call to return immediately (simulating stream complete)
    invokeMock.mockResolvedValueOnce(JSON.stringify({ choices: [{ message: { content: "Subagent content" } }] }));

    // Set state with isStreaming: true, but this conversation is NOT present in generationByConversation (simulating cancelled/idle)
    let state: ToolLoopSlice = {
      conversations: [
        {
          id: "sub-1",
          title: "Subagent test",
          timestamp: new Date(),
          model: "model-1",
          messages: [{ id: "msg-1", role: "user", content: "Go", timestamp: new Date() }],
          isSubagent: true,
          parentId: "parent-1",
        },
      ],
      isStreaming: true, // App is streaming overall...
      generationState: "loading" as const,
      generationLabel: "",
      generationByConversation: {}, // ...but this sub-1 conversation is NOT generating (it is cancelled/stopped)
    };

    const set = (fn: (state: ToolLoopSlice) => Partial<ToolLoopSlice>) => {
      const next = fn(state);
      state = { ...state, ...next };
    };

    // Simulate user clicking stop button (cancelling sub-1) after 2ms
    setTimeout(() => {
      delete state.generationByConversation["sub-1"];
    }, 2);

    await sendWithToolLoop(
      "sub-1",
      {
        id: "model-1",
        name: "Model",
        apiBase: "",
        apiKey: "",
        modelId: "",
      },
      0.7,
      undefined,
      "",
      [],
      undefined,
      set,
      () => state,
      vi.fn(),
      vi.fn(),
      null,
    );

    // It should abort immediately due to isConvStreaming returning false
    const last = state.conversations[0].messages[state.conversations[0].messages.length - 1];
    expect(last?.content).toBe("Cancelled agent execution.");
  });

  it("halts the loop and appends a warning when the parent conversation hits the recursion Safety Limit", async () => {
    // Clear mocks
    mockResumeConversation.mockClear();
    mockAddToast.mockClear();
    mockToasts.length = 0;

    // Set parent's recursion depth to 5
    mockConversations.length = 0;
    mockConversations.push(
      {
        id: "parent-1",
        title: "Parent Chat",
        timestamp: new Date(),
        model: "model-1",
        messages: [{ id: "msg-parent", role: "user", content: "Work task", timestamp: new Date() }],
        recursionDepth: 5,
      },
      {
        id: "sub-1",
        title: "Subagent",
        timestamp: new Date(),
        model: "model-1",
        messages: [{ id: "msg-1", role: "user", content: "Go sub", timestamp: new Date() }],
        isSubagent: true,
        parentId: "parent-1",
        role: "UI Researcher",
      },
    );

    // Mock invoke to return subagent completion
    invokeMock.mockResolvedValueOnce(JSON.stringify({ choices: [{ message: { content: "Subagent finished job" } }] }));

    let state: ToolLoopSlice = {
      conversations: mockConversations,
      isStreaming: true,
      generationState: "loading" as const,
      generationLabel: "",
      generationByConversation: {
        "sub-1": { state: "loading", label: "Loading" },
      },
    };

    const set = (fn: (state: ToolLoopSlice) => Partial<ToolLoopSlice>) => {
      const next = fn(state);
      state = { ...state, ...next };
      if (next.conversations) {
        mockConversations.length = 0;
        mockConversations.push(...next.conversations);
      }
    };

    await sendWithToolLoop(
      "sub-1",
      {
        id: "model-1",
        name: "Model",
        apiBase: "",
        apiKey: "",
        modelId: "",
      },
      0.7,
      undefined,
      "",
      [],
      undefined,
      set,
      () => state,
      vi.fn(),
      vi.fn(),
      null,
    );

    // 1. Verify parent's recursionDepth is incremented to 6
    const parent = mockConversations.find((c) => c.id === "parent-1");
    expect(parent?.recursionDepth).toBe(6);

    // 2. Verify parent did NOT auto-resume
    expect(mockResumeConversation).not.toHaveBeenCalled();

    // 3. Verify parent got the warning message
    const warningMsg = parent?.messages[parent.messages.length - 1];
    expect(warningMsg?.content).toContain("recursion safety limit");

    // 4. Verify user was shown a Toast notification
    expect(mockAddToast).toHaveBeenCalled();
    expect(mockToasts[0].msg).toContain("safety limit reached");
  });
});
