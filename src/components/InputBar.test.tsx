import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InputBar from "./InputBar";
import type { ModelConfig, ModelStatuses } from "../types";

const mockModels: ModelConfig[] = [
  {
    id: "model-1",
    name: "GPT-4o",
    apiBase: "https://api.openai.com/v1/chat/completions",
    apiKey: "sk-test",
    modelId: "gpt-4o",
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

const mockStatuses: ModelStatuses = {
  "model-1": "connected",
  "model-2": "disconnected",
};

describe("InputBar", () => {
  it("renders textarea with placeholder", () => {
    render(
      <InputBar
        models={mockModels}
        onSend={vi.fn()}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
      />,
    );

    const textarea = screen.getByLabelText("Message");
    expect(textarea).toBeInTheDocument();
  });

  it("disables send when input is empty", () => {
    render(
      <InputBar
        models={mockModels}
        onSend={vi.fn()}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
      />,
    );

    const sendBtn = screen.getByLabelText("Send message");
    expect(sendBtn).toBeDisabled();
  });

  it("disables input when disabled prop is true", () => {
    render(
      <InputBar
        models={mockModels}
        onSend={vi.fn()}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        disabled={true}
        modelStatuses={mockStatuses}
      />,
    );

    const textarea = screen.getByRole("textbox");
    expect(textarea).toBeDisabled();
  });

  it("shows model selector with current model name", () => {
    render(
      <InputBar
        models={mockModels}
        onSend={vi.fn()}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
      />,
    );

    expect(screen.getByText("GPT-4o")).toBeInTheDocument();
  });

  it("calls onSend when Enter is pressed with content", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(
      <InputBar
        models={mockModels}
        onSend={onSend}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
      />,
    );

    const textarea = screen.getByRole("textbox");
    await user.type(textarea, "Hello{Enter}");

    expect(onSend).toHaveBeenCalledWith("Hello");
  });

  it("does not send on Shift+Enter", async () => {
    const onSend = vi.fn();
    render(
      <InputBar
        models={mockModels}
        onSend={onSend}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
      />,
    );

    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, "Hello");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });

    expect(onSend).not.toHaveBeenCalled();
  });
});
