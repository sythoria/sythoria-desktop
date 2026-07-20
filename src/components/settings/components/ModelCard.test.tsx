import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModelCard } from "./ModelCard";
import type { ModelConfig } from "../../../types";

const model: ModelConfig = {
  id: "model-1",
  name: "New Model",
  apiBase: "https://example.com/v1/chat/completions",
  apiKey: "",
  modelId: "example-model",
  provider: "custom",
  enabled: true,
};

describe("ModelCard", () => {
  it("uses the themed provider listbox and applies the selected preset", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();

    render(
      <ModelCard
        model={model}
        onUpdate={onUpdate}
        onDelete={vi.fn()}
        showKey={false}
        onToggleKey={vi.fn()}
        connectionStatus="disconnected"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Provider Preset" }));
    expect(screen.getByRole("listbox", { name: "Provider Preset" })).toBeInTheDocument();

    await user.click(screen.getByRole("option", { name: "OpenAI" }));

    expect(onUpdate).toHaveBeenCalledWith("model-1", {
      provider: "openai",
      apiBase: "https://api.openai.com/v1/chat/completions",
      modelId: "gpt-4o",
      name: "OpenAI",
    });
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  });
});
