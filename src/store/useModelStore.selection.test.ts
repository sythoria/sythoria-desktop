import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelConfig } from "../types";

const storageMocks = vi.hoisted(() => ({
  saveSelectedModel: vi.fn(),
  saveMaxToolSteps: vi.fn(),
}));

vi.mock("../utils/storage", () => ({
  saveModelConfigs: vi.fn(),
  saveApiKeys: vi.fn(),
  saveTitleConfig: vi.fn(),
  saveSystemPrompt: vi.fn(),
  saveMaxToolSteps: storageMocks.saveMaxToolSteps,
  saveSelectedModel: storageMocks.saveSelectedModel,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { useModelStore } from "./useModelStore";

const models: ModelConfig[] = [
  {
    id: "model-1",
    name: "First model",
    apiBase: "https://example.com/v1",
    apiKey: "",
    modelId: "first-model",
    enabled: true,
  },
  {
    id: "model-2",
    name: "Selected model",
    apiBase: "https://example.com/v1",
    apiKey: "",
    modelId: "selected-model",
    enabled: true,
  },
];

describe("useModelStore model selection", () => {
  beforeEach(() => {
    storageMocks.saveSelectedModel.mockReset();
    storageMocks.saveMaxToolSteps.mockReset();
    useModelStore.setState({
      models,
      selectedModel: "model-1",
      modelStatuses: {
        "model-1": "connected",
        "model-2": "connected",
      },
    });
  });

  it("persists an enabled model selection", () => {
    useModelStore.getState().setSelectedModel("model-2");

    expect(useModelStore.getState().selectedModel).toBe("model-2");
    expect(storageMocks.saveSelectedModel).toHaveBeenCalledWith("model-2");
  });

  it("does not replace the selection with an unknown model", () => {
    useModelStore.getState().setSelectedModel("missing-model");

    expect(useModelStore.getState().selectedModel).toBe("model-1");
    expect(storageMocks.saveSelectedModel).not.toHaveBeenCalled();
  });

  it("moves and persists selection when the selected model is disabled", () => {
    useModelStore.getState().updateModel("model-1", { enabled: false });

    expect(useModelStore.getState().selectedModel).toBe("model-2");
    expect(storageMocks.saveSelectedModel).toHaveBeenCalledWith("model-2");
  });

  it("clamps the tool loop to the supported step range", () => {
    useModelStore.getState().setMaxToolSteps(100);

    expect(useModelStore.getState().maxToolSteps).toBe(25);
    expect(storageMocks.saveMaxToolSteps).toHaveBeenCalledWith(25);
  });
});
