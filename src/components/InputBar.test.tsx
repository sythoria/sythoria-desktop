import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InputBar from "./InputBar";
import type { ModelConfig, ModelStatuses, McpServerStatus } from "../types";
import { useChatStore } from "../store/useChatStore";

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

const mockMcpServerStatuses: Record<string, McpServerStatus> = {};

const defaultMcpProps = {
  mcpServers: [],
  mcpServerStatuses: mockMcpServerStatuses,
  enabledMcpServerIds: new Set<string>(),
  onToggleMcpServer: vi.fn(),
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
        isSearchEnabled={false}
        onToggleSearch={vi.fn()}
        {...defaultMcpProps}
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
        isSearchEnabled={false}
        onToggleSearch={vi.fn()}
        {...defaultMcpProps}
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
        isSearchEnabled={false}
        onToggleSearch={vi.fn()}
        {...defaultMcpProps}
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
        isSearchEnabled={false}
        onToggleSearch={vi.fn()}
        {...defaultMcpProps}
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
        isSearchEnabled={false}
        onToggleSearch={vi.fn()}
        {...defaultMcpProps}
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
        isSearchEnabled={false}
        onToggleSearch={vi.fn()}
        {...defaultMcpProps}
      />,
    );

    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, "Hello");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("shows web search option in plus dropdown", () => {
    render(
      <InputBar
        models={mockModels}
        onSend={vi.fn()}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
        isSearchEnabled={false}
        onToggleSearch={vi.fn()}
        {...defaultMcpProps}
      />,
    );

    const plusButton = screen.getByLabelText("Attach or search");
    expect(plusButton).toBeInTheDocument();
  });

  it("toggles web search from plus dropdown", async () => {
    const user = userEvent.setup();
    const onToggleSearch = vi.fn();
    render(
      <InputBar
        models={mockModels}
        onSend={vi.fn()}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
        isSearchEnabled={false}
        onToggleSearch={onToggleSearch}
        {...defaultMcpProps}
      />,
    );

    const plusButton = screen.getByLabelText("Attach or search");
    await user.click(plusButton);

    const searchOption = screen.getByRole("menuitemcheckbox", { name: /web search/i });
    expect(searchOption).toBeInTheDocument();

    await user.click(searchOption);
    expect(onToggleSearch).toHaveBeenCalledWith(true);
  });

  it("renders image attachment and allows opening preview modal", async () => {
    const user = userEvent.setup();
    act(() => {
      useChatStore.getState().setDraftAttachments([
        {
          id: "attachment-1",
          name: "test-image.png",
          mimeType: "image/png",
          size: 1024,
          kind: "image",
          dataUrl:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        },
      ]);
    });

    render(
      <InputBar
        models={mockModels}
        onSend={vi.fn()}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
        isSearchEnabled={false}
        onToggleSearch={vi.fn()}
        {...defaultMcpProps}
      />,
    );

    // Verify thumbnail image is rendered
    const imgEl = screen.getByAltText("test-image.png");
    expect(imgEl).toBeInTheDocument();
    expect(imgEl).toHaveAttribute("src", expect.stringContaining("data:image/png"));

    // Click on the attachment element to trigger preview modal
    const attachmentPill = screen.getByTitle("View test-image.png");
    await user.click(attachmentPill);

    // Verify ImagePreviewModal is open
    expect(screen.getAllByText("test-image.png")).toHaveLength(2);

    // Close preview modal
    const closeBtn = screen.getByTitle("Close viewer (Esc)");
    await user.click(closeBtn);
    expect(screen.queryByTitle("Close viewer (Esc)")).not.toBeInTheDocument();

    // Clean up
    act(() => {
      useChatStore.getState().setDraftAttachments([]);
    });
  });
});
