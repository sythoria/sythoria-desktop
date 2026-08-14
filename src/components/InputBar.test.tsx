import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InputBar from "./InputBar";
import type { ModelConfig, ModelStatuses, McpServerStatus } from "../types";
import { useChatStore } from "../store/useChatStore";
import { useModelStore } from "../store/useModelStore";
import { useProjectStore } from "../store/useProjectStore";

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
};

describe("InputBar", () => {
  it("renders the placeholder outside the editable DOM", () => {
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

    const editor = screen.getByLabelText("Message");
    const placeholder = screen.getByText("Ask for follow-up changes...");
    expect(editor).toBeInTheDocument();
    expect(placeholder).toHaveAttribute("aria-hidden", "true");
    expect(editor).not.toContainElement(placeholder);
    expect(editor).toHaveTextContent("");
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

  it("calls the stop callback without forwarding the React click event", async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();

    render(
      <InputBar
        models={mockModels}
        onSend={vi.fn()}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
        isSearchEnabled={false}
        onToggleSearch={vi.fn()}
        isStreaming
        onStop={onStop}
        {...defaultMcpProps}
      />,
    );

    await user.click(screen.getByLabelText("Stop generating"));

    expect(onStop).toHaveBeenCalledOnce();
    expect(onStop).toHaveBeenCalledWith();
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
    expect(textarea).toHaveAttribute("contenteditable", "false");
    expect(textarea).toHaveAttribute("aria-disabled", "true");
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

    expect(screen.getAllByText("GPT-4o").length).toBeGreaterThan(0);
  });

  it("uses shared compare input without a contradictory model selector", () => {
    render(
      <InputBar
        models={mockModels}
        onSend={vi.fn()}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
        isSearchEnabled={false}
        onToggleSearch={vi.fn()}
        isCompareMode
        {...defaultMcpProps}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "Message" });
    expect(screen.getByText("Ask all models...")).not.toBe(editor);
    expect(editor).toHaveTextContent("");
    expect(screen.queryByRole("button", { name: /response settings/i })).not.toBeInTheDocument();
  });

  it("organizes response settings into model and thinking sections", async () => {
    const user = userEvent.setup();
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

    await user.click(screen.getByRole("button", { name: /response settings/i }));

    expect(screen.getByRole("button", { name: /^model/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^thinking/i })).toBeInTheDocument();
  });

  it("updates the thinking level for a supported model", async () => {
    const user = userEvent.setup();
    const updateModel = vi.fn();
    const originalUpdateModel = useModelStore.getState().updateModel;
    act(() => useModelStore.setState({ updateModel }));

    const reasoningModel: ModelConfig = {
      ...mockModels[0],
      modelId: "gpt-5",
      thinkingLevel: "auto",
    };

    render(
      <InputBar
        models={[reasoningModel]}
        onSend={vi.fn()}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
        isSearchEnabled={false}
        onToggleSearch={vi.fn()}
        {...defaultMcpProps}
      />,
    );

    await user.click(screen.getByRole("button", { name: /response settings/i }));
    await user.click(screen.getByRole("button", { name: /^thinking/i }));
    await user.click(await screen.findByRole("button", { name: /^high/i }));

    expect(updateModel).toHaveBeenCalledWith("model-1", { thinkingLevel: "high" });
    act(() => useModelStore.setState({ updateModel: originalUpdateModel }));
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

    expect(onSend).toHaveBeenCalledWith("Hello", undefined, []);
  });

  it("tracks visual editor emptiness from the parsed draft", async () => {
    const user = userEvent.setup();
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

    const editor = screen.getByRole("textbox", { name: "Message" });
    expect(editor).toHaveAttribute("data-editor-empty", "true");
    expect(screen.getByText("Ask for follow-up changes...")).toBeInTheDocument();

    await user.type(editor, "w");
    expect(editor).toHaveAttribute("data-editor-empty", "false");
    expect(screen.queryByText("Ask for follow-up changes...")).not.toBeInTheDocument();

    await user.keyboard("{Backspace}");
    expect(editor).toHaveAttribute("data-editor-empty", "true");
    expect(screen.getByText("Ask for follow-up changes...")).toBeInTheDocument();
  });

  it("treats WebKit filler markup as an empty draft", () => {
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

    const editor = screen.getByRole("textbox", { name: "Message" });
    editor.innerHTML = "<div><br></div>";
    fireEvent.input(editor);

    expect(editor).toHaveAttribute("data-editor-empty", "true");
    expect(screen.getByText("Ask for follow-up changes...")).toBeInTheDocument();
    expect(screen.getByLabelText("Send message")).toBeDisabled();
  });

  it("keeps over-limit content in draft state so it cannot send a stale shorter value", () => {
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

    const editor = screen.getByRole("textbox", { name: "Message" });
    editor.textContent = "a".repeat(10_101);
    fireEvent.input(editor);

    expect(editor).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Send message")).toBeDisabled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("adds repeated MCP labels inline and sends only their server references", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue("accepted");
    const documentsServer = {
      id: "documents",
      name: "Documents",
      transport: "stdio" as const,
      command: "documents-mcp",
      enabled: true,
    };

    render(
      <InputBar
        models={mockModels}
        onSend={onSend}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
        isSearchEnabled={false}
        onToggleSearch={vi.fn()}
        mcpServers={[documentsServer]}
        mcpServerStatuses={{ documents: "connected" }}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "Message" });
    await user.type(editor, "Open this using ");
    await user.click(screen.getByLabelText("Attach or search"));
    await user.click(screen.getByRole("menuitem", { name: /Documents/i }));
    await user.click(screen.getByLabelText("Attach or search"));
    await user.click(screen.getByRole("menuitem", { name: /Documents/i }));
    await user.type(editor, " please");

    const mentions = screen.getAllByRole("img", { name: "MCP tool: Documents" });
    expect(mentions).toHaveLength(2);
    expect(mentions[0]).toHaveClass("text-[1em]");
    expect(mentions[0].querySelector(".lucide-cpu")).toBeInTheDocument();
    expect(mentions[0].querySelector("button")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Send message"));

    expect(onSend).toHaveBeenCalledWith("Open this using  please", undefined, ["documents", "documents"]);
    expect(editor).toHaveTextContent("");
  });

  it("removes an inline MCP label with one Backspace and preserves the caret position", async () => {
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
        mcpServers={[
          { id: "computer", name: "Computer Use", transport: "stdio", command: "computer-mcp", enabled: true },
        ]}
        mcpServerStatuses={{ computer: "connected" }}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "Message" });
    await user.type(editor, "Open my browser using ");
    await user.click(screen.getByLabelText("Attach or search"));
    await user.click(screen.getByRole("menuitem", { name: /Computer Use/i }));
    expect(editor).toHaveTextContent("Open my browser using Computer Use");
    const mention = screen.getByRole("img", { name: "MCP tool: Computer Use" });
    const spacer = mention.nextSibling;
    expect(spacer).not.toBeNull();
    const range = document.createRange();
    range.setStartAfter(spacer!);
    range.collapse(true);
    editor.focus();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    expect(selection?.isCollapsed).toBe(true);
    expect(selection?.anchorNode).toBe(editor);
    expect(selection?.anchorOffset).toBe(Array.from(editor.childNodes).indexOf(spacer!) + 1);
    fireEvent.keyDown(editor, { key: "Backspace" });

    expect(screen.queryByRole("img", { name: "MCP tool: Computer Use" })).not.toBeInTheDocument();
    expect(editor).toHaveTextContent("Open my browser using ");
    expect(selection?.isCollapsed).toBe(true);
    expect(editor.contains(selection?.anchorNode ?? null)).toBe(true);
    await user.keyboard("the available tool");
    await user.keyboard("{Enter}");

    expect(onSend).toHaveBeenCalledWith("Open my browser using the available tool", undefined, []);
    expect(screen.queryByRole("img", { name: "MCP tool: Computer Use" })).not.toBeInTheDocument();
  });

  it("removes an inline MCP label with one forward Delete", async () => {
    const user = userEvent.setup();
    render(
      <InputBar
        models={mockModels}
        onSend={vi.fn()}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
        isSearchEnabled={false}
        onToggleSearch={vi.fn()}
        mcpServers={[
          { id: "computer", name: "Computer Use", transport: "stdio", command: "computer-mcp", enabled: true },
        ]}
        mcpServerStatuses={{ computer: "connected" }}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "Message" });
    await user.type(editor, "Use ");
    await user.click(screen.getByLabelText("Attach or search"));
    await user.click(screen.getByRole("menuitem", { name: /Computer Use/i }));
    const mention = screen.getByRole("img", { name: "MCP tool: Computer Use" });
    const range = document.createRange();
    range.setStartBefore(mention);
    range.collapse(true);
    editor.focus();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    fireEvent.keyDown(editor, { key: "Delete" });

    expect(screen.queryByRole("img", { name: "MCP tool: Computer Use" })).not.toBeInTheDocument();
    expect(editor).toHaveTextContent("Use ");
    expect(selection?.isCollapsed).toBe(true);
    expect(editor.contains(selection?.anchorNode ?? null)).toBe(true);
    await user.keyboard("the tool");
    expect(editor).toHaveTextContent("Use the tool");
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
    const imgEl = screen.getByRole("button", { name: "Preview test-image.png" }).querySelector("img");
    expect(imgEl).toBeInTheDocument();
    expect(imgEl).toHaveAttribute("alt", "");
    expect(imgEl).toHaveAttribute("src", expect.stringContaining("data:image/png"));

    // Click on the attachment element to trigger preview modal
    const attachmentPill = screen.getByRole("button", { name: "Preview test-image.png" });
    await user.click(attachmentPill);

    // Verify ImagePreviewModal is open
    expect(screen.getByText("test-image.png")).toBeInTheDocument();

    // Close preview modal
    const closeBtn = screen.getByTitle("Close viewer (Esc)");
    await user.click(closeBtn);
    expect(screen.queryByTitle("Close viewer (Esc)")).not.toBeInTheDocument();

    // Clean up
    act(() => {
      useChatStore.getState().setDraftAttachments([]);
    });
  });

  it("blocks project detachment while workspace changes are pending", async () => {
    const user = userEvent.setup();
    act(() => {
      useProjectStore.setState({
        projects: [{ id: "project-a", name: "Project A", path: "/projects/a", permissions: "write" }],
        activeProjectId: "project-a",
        isProjectsEnabled: true,
      });
      useChatStore.setState({
        activeId: "pending-chat",
        conversations: [
          {
            id: "pending-chat",
            title: "Pending chat",
            timestamp: new Date(),
            messages: [],
            model: "model-1",
            projectId: "project-a",
            pendingWorktree: { path: "/worktrees/a", branch: "sythoria-agent-a" },
          },
        ],
      });
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

    await user.click(screen.getByRole("button", { name: "Project context" }));

    expect(screen.getByRole("menuitem", { name: "Detach Project" })).toBeDisabled();
    expect(screen.getByText(/Apply or discard the pending workspace changes/i)).toBeInTheDocument();
  });
});
