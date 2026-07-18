import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResponseSettingsSelector } from "./ResponseSettingsSelector";
import type { ModelConfig, ModelStatuses } from "../types";

const models: ModelConfig[] = [
  {
    id: "model-1",
    name: "GPT-5",
    apiBase: "https://api.openai.com/v1/chat/completions",
    apiKey: "sk-test",
    modelId: "gpt-5",
    provider: "OpenAI",
  },
  {
    id: "model-2",
    name: "Llama 3",
    apiBase: "http://localhost:11434/v1/chat/completions",
    apiKey: "",
    modelId: "llama3.1",
    provider: "Ollama (Local)",
  },
];

const modelStatuses: ModelStatuses = {
  "model-1": "connected",
  "model-2": "disconnected",
};

describe("ResponseSettingsSelector", () => {
  it("opens a padded, centered panel below comparison triggers and changes models", async () => {
    const user = userEvent.setup();
    const onModelChange = vi.fn();

    render(
      <ResponseSettingsSelector
        models={models}
        selectedModel="model-1"
        onModelChange={onModelChange}
        modelStatuses={modelStatuses}
        placement="below"
      />,
    );

    await user.click(screen.getByRole("button", { name: /response settings/i }));

    const dialog = screen.getByRole("dialog", { name: /model and thinking settings/i });
    expect(dialog).toHaveClass("left-1/2", "top-full", "p-1.5", "font-normal");

    await user.click(screen.getByRole("button", { name: /^model/i }));
    await user.click(screen.getByRole("button", { name: "Llama 3" }));

    expect(onModelChange).toHaveBeenCalledWith("model-2");
  });
});
