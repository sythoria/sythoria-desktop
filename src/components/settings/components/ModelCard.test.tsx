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

    render(<ModelCard model={model} onUpdate={onUpdate} onDelete={vi.fn()} connectionStatus="disconnected" />);

    await user.click(screen.getByRole("button", { name: "Provider Preset" }));
    expect(screen.getByRole("listbox", { name: "Provider Preset" })).toBeInTheDocument();

    await user.click(screen.getByRole("option", { name: "OpenAI" }));

    expect(onUpdate).toHaveBeenCalledWith("model-1", {
      provider: "openai",
      apiBase: "https://api.openai.com/v1/chat/completions",
      modelId: "gpt-5.6-sol",
      name: "OpenAI",
    });
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  });

  it("shows a compact status when an API key is already configured", () => {
    render(
      <ModelCard
        model={{ ...model, apiKey: "••••••••••••" }}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        connectionStatus="disconnected"
      />,
    );

    expect(screen.getByText("Added")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show api key/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText("API Key")).toHaveValue("");
    expect(screen.getByLabelText("API Key")).toHaveAttribute("placeholder", "Enter a new key to replace");
  });

  it("does not require an API key for a custom endpoint", () => {
    render(<ModelCard model={model} onUpdate={vi.fn()} onDelete={vi.fn()} connectionStatus="disconnected" />);

    expect(screen.getByLabelText("API Key")).toHaveAttribute("placeholder", "API Key (optional)");
    expect(screen.queryByText("API key is required for this provider")).not.toBeInTheDocument();
  });
});
