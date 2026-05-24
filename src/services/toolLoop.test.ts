import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { TOOL_DEFINITIONS, TOOL_SYSTEM_PROMPT, sendWithToolLoop, type AppState } from "./toolLoop";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  invokeMock.mockReset();
});

describe("TOOL_DEFINITIONS", () => {
  it("defines exactly 2 tools", () => {
    expect(TOOL_DEFINITIONS).toHaveLength(2);
  });

  it("includes search_query tool", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.function.name);
    expect(names).toContain("search_query");
  });

  it("includes fetch_url tool", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.function.name);
    expect(names).toContain("fetch_url");
  });

  it("all tools have required parameters", () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.function.parameters.required).toBeDefined();
      expect(tool.function.parameters.required.length).toBeGreaterThan(0);
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

    let state: AppState = {
      conversations: [
        {
          id: "conv-1",
          title: "Test",
          timestamp: new Date(),
          model: "model-1",
          messages: [{ id: "msg-1", role: "user", content: "Search this", timestamp: new Date() }],
        },
      ],
      activeId: "conv-1",
      isStreaming: false,
      loading: {
        init: false,
        sendMessage: false,
        checkConnection: false,
        saveConfig: false,
        toolExecution: false,
      },
      addToast: vi.fn(),
      persistConversations: vi.fn(),
    };

    const set = (fn: (state: AppState) => Partial<AppState>) => {
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
      {},
      {
        id: "search-1",
        name: "Search",
        provider: "google",
        baseUrl: "https://www.googleapis.com/customsearch/v1",
        maxResults: 5,
        enabled: true,
      },
      "",
      set,
      () => state,
      vi.fn(),
      vi.fn(),
    );

    const last = state.conversations[0].messages[state.conversations[0].messages.length - 1];
    expect(last?.role).toBe("assistant");
    expect(last?.content).toContain("**Error:**");
    expect(state.isStreaming).toBe(false);
  });
});
