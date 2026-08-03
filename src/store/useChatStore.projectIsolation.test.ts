import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation, Project } from "../types";

const mocks = vi.hoisted(() => ({
  sendWithToolLoop: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/toolLoop", () => ({ sendWithToolLoop: mocks.sendWithToolLoop }));

import { useChatStore } from "./useChatStore";
import { useModelStore } from "./useModelStore";
import { useProjectStore } from "./useProjectStore";

describe("conversation project isolation", () => {
  const projects: Project[] = [
    { id: "project-a", name: "A", path: "C:/projects/a", permissions: "read" },
    { id: "project-b", name: "B", path: "C:/projects/b", permissions: "read" },
  ];
  const conversation: Conversation = {
    id: "conversation-a",
    title: "A task",
    timestamp: new Date(),
    messages: [{ id: "message-a", role: "user", content: "Continue", timestamp: new Date() }],
    model: "model-a",
    projectId: "project-a",
  };

  beforeEach(() => {
    mocks.sendWithToolLoop.mockClear();
    useChatStore.setState({ conversations: [conversation], activeId: conversation.id });
    useModelStore.setState({
      selectedModel: "model-a",
      models: [
        {
          id: "model-a",
          name: "Model A",
          apiBase: "https://example.test/v1/chat/completions",
          apiKey: "",
          modelId: "model-a",
          enabled: true,
        },
      ],
    });
    useProjectStore.setState({
      projects,
      isProjectsEnabled: true,
      activeProjectId: "project-b",
    });
  });

  it("resumes with the conversation's project even when another project is visible", async () => {
    await useChatStore.getState().resumeConversation(conversation.id);

    expect(mocks.sendWithToolLoop).toHaveBeenCalledOnce();
    expect(mocks.sendWithToolLoop.mock.calls[0][0].project).toEqual(projects[0]);
  });
});
