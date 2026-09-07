import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useChatStore } from "./useChatStore";
import { useModelStore } from "./useModelStore";
import { useProjectStore } from "./useProjectStore";
import { useSearchStore } from "./useSearchStore";
import { useSkillStore } from "./useSkillStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const originalChat = useChatStore.getState();
const originalModel = useModelStore.getState();
const originalProject = useProjectStore.getState();
const originalSearch = useSearchStore.getState();
const originalSkill = useSkillStore.getState();
afterEach(() => {
  useChatStore.setState(originalChat, true);
  useModelStore.setState(originalModel, true);
  useProjectStore.setState(originalProject, true);
  useSearchStore.setState(originalSearch, true);
  useSkillStore.setState(originalSkill, true);
  vi.mocked(invoke).mockReset();
});

it("retains and replays native Responses items in a plain chat without enabling tools", async () => {
  const output = [
    { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "opaque-reasoning" },
    {
      type: "message",
      id: "msg_1",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "Hello" }],
    },
  ];
  let onChunk: (chunk: { kind: "content"; content: string }) => void = () => {};
  let onDone: () => void = () => {};
  useModelStore.setState({
    models: [
      {
        id: "responses",
        name: "Responses",
        provider: "openai-responses",
        apiBase: "https://api.openai.com/v1/responses",
        apiKey: "masked",
        modelId: "gpt-5.6-sol",
      },
    ],
    selectedModel: "responses",
    titleConfig: { ...useModelStore.getState().titleConfig, enabled: false },
    ensureStreamListeners: vi.fn().mockImplementation(async (_id, _conv, chunk, done) => {
      onChunk = chunk;
      onDone = done;
      return vi.fn();
    }),
  });
  useProjectStore.setState({ isProjectsEnabled: false, projects: [] });
  useSkillStore.setState({ skills: [], loadSkills: vi.fn().mockResolvedValue(undefined) });
  useChatStore.setState({
    conversations: [{ id: "plain", title: "Plain", model: "responses", messages: [], timestamp: new Date() }],
    activeId: "plain",
    isCompareMode: false,
    compareIds: [],
    isStreaming: false,
    generationByConversation: {},
    persistConversations: vi.fn().mockResolvedValue(undefined),
  });
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command !== "chat_stream_tools") throw new Error(`Unexpected command: ${command}`);
    onChunk({ kind: "content", content: "Hello" });
    onDone();
    return JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: "Hello", responses_output: output } }],
    });
  });

  expect(await useChatStore.getState().sendMessage("Hi")).toBe("accepted");
  await vi.waitFor(() => expect(useChatStore.getState().isStreaming).toBe(false));
  const assistant = useChatStore.getState().conversations[0].messages.find((message) => message.role === "assistant");
  expect(assistant).toMatchObject({ content: "Hello", responsesOutput: output });

  expect(await useChatStore.getState().sendMessage("Continue")).toBe("accepted");
  await vi.waitFor(() => expect(vi.mocked(invoke)).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(useChatStore.getState().isStreaming).toBe(false));
  const request = vi.mocked(invoke).mock.calls[1][1] as { tools: string; messages: { responses_output?: unknown[] }[] };
  expect(request.tools).toBe("[]");
  expect(request.messages.some((message) => JSON.stringify(message.responses_output) === JSON.stringify(output))).toBe(
    true,
  );
});
