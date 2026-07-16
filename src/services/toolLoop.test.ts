import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { TOOL_DEFINITIONS, TOOL_SYSTEM_PROMPT, sendWithToolLoop, type ToolLoopSlice } from "./toolLoop";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockToasts: any[] = [];
const mockAddToast = vi.fn((msg, variant) => {
  mockToasts.push({ msg, variant });
});

vi.mock("../store/useUIStore", () => ({
  useUIStore: {
    getState: () => ({
      setLoading: vi.fn(),
      addToast: mockAddToast,
    }),
  },
}));

vi.mock("../store/useModelStore", () => ({
  useModelStore: {
    getState: () => ({
      systemPrompt: "",
      maxToolSteps: 25,
      ensureStreamListeners: vi.fn().mockImplementation((_convId, onChunk, onDone) => {
        // Trigger onChunk and onDone asynchronously to simulate completion
        setTimeout(() => {
          onChunk("Simulated content chunk");
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
const mockResumeConversation = vi.fn().mockResolvedValue(undefined);
const mockSetState = vi.fn((fn: any) => {
  const next = typeof fn === "function" ? fn({
    conversations: mockConversations,
    activeStreamContent: mockActiveStreamContent,
  }) : fn;
  if (next.conversations) {
    mockConversations.length = 0;
    mockConversations.push(...next.conversations);
  }
  if (next.activeStreamContent) {
    Object.assign(mockActiveStreamContent, next.activeStreamContent);
  }
});

vi.mock("../store/useChatStore", () => ({
  useChatStore: {
    getState: () => ({
      persistConversations: vi.fn(),
      conversations: mockConversations,
      activeStreamContent: mockActiveStreamContent,
      resumeConversation: mockResumeConversation,
    }),
    setState: (fn: any) => mockSetState(fn),
  },
}));

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  invokeMock.mockReset();
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
      }
    );

    // Mock invoke to return subagent completion
    invokeMock.mockResolvedValueOnce(JSON.stringify({ choices: [{ message: { content: "Subagent finished job" } }] }));

    let state: ToolLoopSlice = {
      conversations: mockConversations,
      isStreaming: true,
      generationState: "loading" as const,
      generationLabel: "",
      generationByConversation: {
        "sub-1": { state: "loading", label: "Loading" }
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
    const parent = mockConversations.find(c => c.id === "parent-1");
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
