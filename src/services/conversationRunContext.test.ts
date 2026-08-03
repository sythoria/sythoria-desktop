import { describe, expect, it, vi } from "vitest";
import type { Conversation, ModelConfig, Project } from "../types";
import { buildConversationRunContext } from "./conversationRunContext";

const models: ModelConfig[] = [
  {
    id: "model-a",
    name: "Model A",
    apiBase: "https://provider-a.example/v1",
    apiKey: "",
    modelId: "provider-a-model",
    provider: "openai",
  },
  {
    id: "model-b",
    name: "Model B",
    apiBase: "https://provider-b.example/v1",
    apiKey: "",
    modelId: "provider-b-model",
    provider: "anthropic",
  },
];

const projects: Project[] = [
  { id: "project-a", name: "Project A", path: "/projects/a", permissions: "read", modelOverride: "model-a" },
  { id: "project-b", name: "Project B", path: "/projects/b", permissions: "full", modelOverride: "model-b" },
];

function conversation(projectId: string): Conversation {
  return {
    id: `conversation-${projectId}`,
    title: "Conversation",
    timestamp: new Date(),
    messages: [],
    model: "model-a",
    projectId,
  };
}

describe("buildConversationRunContext", () => {
  it("resolves project and provider from the target conversation rather than global navigation state", () => {
    const context = buildConversationRunContext({
      conversation: conversation("project-a"),
      models,
      selectedModel: "model-b",
      temperature: 0.7,
      projects,
      projectsEnabled: true,
      searchConfig: undefined,
      searchApiKey: "",
      mcpTools: [],
      mcpCallTool: vi.fn(),
    });

    expect(context?.project?.id).toBe("project-a");
    expect(context?.project?.permissions).toBe("read");
    expect(context?.modelConfig.id).toBe("model-a");
    expect(context?.modelConfig.provider).toBe("openai");
  });

  it("remains unchanged when source project and model objects mutate after capture", () => {
    const mutableModels = models.map((model) => ({ ...model }));
    const mutableProjects = projects.map((project) => ({ ...project }));
    const context = buildConversationRunContext({
      conversation: conversation("project-b"),
      models: mutableModels,
      selectedModel: "model-a",
      temperature: 0.4,
      projects: mutableProjects,
      projectsEnabled: true,
      searchConfig: undefined,
      searchApiKey: "",
      mcpTools: [],
      mcpCallTool: undefined,
    });

    mutableProjects[1].modelOverride = "model-a";
    mutableModels[1].provider = "changed";

    expect(context?.project?.modelOverride).toBe("model-b");
    expect(context?.modelConfig.provider).toBe("anthropic");
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context?.project)).toBe(true);
    expect(Object.isFrozen(context?.modelConfig)).toBe(true);
  });

  it("falls back to the conversation model when a project override is unavailable", () => {
    const context = buildConversationRunContext({
      conversation: conversation("project-b"),
      models: models.map((model) => (model.id === "model-b" ? { ...model, enabled: false } : model)),
      selectedModel: "model-b",
      temperature: 0.7,
      projects,
      projectsEnabled: true,
      searchConfig: undefined,
      searchApiKey: "",
      mcpTools: [],
      mcpCallTool: undefined,
    });

    expect(context?.modelConfig.id).toBe("model-a");
  });
});
