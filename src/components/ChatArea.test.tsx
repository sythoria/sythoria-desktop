import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import ChatArea from "./ChatArea";
import type { Conversation, Message } from "../types";
import { useChatStore } from "../store/useChatStore";
import { useProjectStore } from "../store/useProjectStore";
import { useUIStore } from "../store/useUIStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    role: "user",
    content: "Hello",
    timestamp: new Date(),
    ...overrides,
  };
}

const defaultProps = {
  isAtBottom: true,
  setIsAtBottom: vi.fn(),
  virtuosoRef: { current: null } as React.RefObject<null>,
  onRetry: vi.fn(),
};

describe("ChatArea", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });
  it("shows empty state when no messages", () => {
    render(<ChatArea messages={[]} {...defaultProps} />);

    expect(screen.getByRole("region", { name: /empty chat/i })).toBeInTheDocument();
  });

  it("can suppress repeated empty prompts in comparison columns", () => {
    render(<ChatArea messages={[]} {...defaultProps} showEmptyState={false} />);

    expect(screen.getByRole("region", { name: "No messages yet" })).toBeInTheDocument();
    expect(screen.queryByText("What should we work on?")).not.toBeInTheDocument();
  });

  it("renders user messages", () => {
    const messages = [makeMessage({ role: "user", content: "Hello world" })];
    render(<ChatArea messages={messages} {...defaultProps} />);

    expect(screen.getByRole("log", { name: /chat messages/i })).toBeInTheDocument();
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("renders assistant messages with markdown", () => {
    const messages = [makeMessage({ role: "assistant", content: "Hi there **bold**" })];
    render(<ChatArea messages={messages} {...defaultProps} />);

    expect(screen.getByRole("log")).toBeInTheDocument();
    expect(screen.getByText("bold")).toBeInTheDocument();
  });

  it("shows loading text when assistant is streaming with empty content", () => {
    const messages = [makeMessage({ role: "assistant", content: "", isStreaming: true })];
    render(<ChatArea messages={messages} {...defaultProps} />);

    expect(screen.getByText(/Loading/)).toBeInTheDocument();
  });

  it("shows cursor when assistant is streaming with content", () => {
    const messages = [makeMessage({ role: "assistant", content: "Loading...", isStreaming: true })];
    render(<ChatArea messages={messages} {...defaultProps} />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    const cursor = document.querySelector(".cursor-blink");
    expect(cursor).toBeInTheDocument();
  });

  it("shows one cancellation message without a duplicate status label", () => {
    const messages = [makeMessage({ role: "assistant", content: "Cancelled agent execution." })];
    const conversation: Conversation = {
      id: "cancelled-chat",
      title: "Cancelled chat",
      timestamp: new Date(),
      messages,
      model: "model-1",
    };
    useChatStore.setState({
      conversations: [conversation],
      generationState: "cancelled",
      generationByConversation: {
        [conversation.id]: { state: "cancelled", label: "Cancelled" },
      },
    });
    render(<ChatArea messages={messages} {...defaultProps} conversationId={conversation.id} />);

    expect(screen.getByText("Cancelled agent execution.")).toBeInTheDocument();
    expect(screen.queryByText("Cancelled", { exact: true })).not.toBeInTheDocument();
  });

  it("keeps completed message actions available after an API error", () => {
    const messages = [makeMessage({ role: "assistant", content: "**Error:** Rate limit exceeded" })];
    const conversation: Conversation = {
      id: "errored-chat",
      title: "Errored chat",
      timestamp: new Date(),
      messages,
      model: "model-1",
    };
    useChatStore.setState({
      conversations: [conversation],
      isStreaming: false,
      generationState: "error",
      generationByConversation: {
        [conversation.id]: { state: "error", label: "Generation failed: Rate limit exceeded" },
      },
    });
    render(<ChatArea messages={messages} {...defaultProps} conversationId={conversation.id} />);

    expect(screen.getByRole("button", { name: "Regenerate" })).toBeEnabled();
  });

  it("renders MCP tool message and expandable arguments/result/images", async () => {
    const user = userEvent.setup();
    const messages = [
      makeMessage({
        role: "tool",
        content: "Tool completed successfully",
        toolCall: {
          id: "call-123",
          name: "mcp-server__my_tool",
          arguments: { arg1: "val1" },
        },
        toolResult: {
          id: "call-123",
          name: "mcp-server__my_tool",
          content: '{"status": "ok"}',
          images: [
            {
              mimeType: "image/png",
              data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
            },
          ],
        },
      }),
    ];
    render(<ChatArea messages={messages} {...defaultProps} />);

    // It should render the tool header
    expect(screen.getByText("Run: my_tool")).toBeInTheDocument();

    // Click expand
    const button = screen.getByLabelText("Expand details");
    await user.click(button);

    // Verify it renders the arguments, result, and images sections
    expect(screen.getByText("Arguments")).toBeInTheDocument();
    expect(screen.getByText("Result")).toBeInTheDocument();
    expect(screen.getByText("Images")).toBeInTheDocument();
  });

  it("keeps recovery actions visible when the worktree status is empty", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "git_get_status") return { unstagedFiles: [], stagedFiles: [] } as never;
      if (command === "git_diff_changes") return "" as never;
      return undefined as never;
    });
    const pendingWorktree = {
      path: "/worktrees/run-a",
      branch: "sythoria-agent-a",
      commitScope: {
        projectId: "project-a",
        projectRoot: "/projects/a",
        modelId: "model-a",
      },
    };
    useChatStore.setState({
      conversations: [
        {
          id: "pending-chat",
          title: "Pending chat",
          timestamp: new Date(),
          messages: [makeMessage()],
          model: "model-a",
          pendingWorktree,
        },
      ],
    });

    render(
      <ChatArea
        messages={[makeMessage()]}
        {...defaultProps}
        conversationId="pending-chat"
        pendingWorktree={pendingWorktree}
      />,
    );

    expect(await screen.findByText(/Committed or binary-only changes/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Review" })).toBeEnabled();
    expect(invokeMock).toHaveBeenCalledWith("git_get_status", {
      projectId: "project-a",
      worktreePath: "/worktrees/run-a",
    });
  });

  it("keeps recovery actions and retry visible when status loading fails", async () => {
    invokeMock.mockRejectedValue(new Error("status unavailable"));
    const pendingWorktree = {
      path: "/worktrees/run-b",
      branch: "sythoria-agent-b",
      commitScope: {
        projectId: "project-b",
        projectRoot: "/projects/b",
        modelId: "model-b",
      },
    };
    useChatStore.setState({
      conversations: [
        {
          id: "errored-pending-chat",
          title: "Errored pending chat",
          timestamp: new Date(),
          messages: [makeMessage()],
          model: "model-b",
          pendingWorktree,
        },
      ],
    });

    render(
      <ChatArea
        messages={[makeMessage()]}
        {...defaultProps}
        conversationId="errored-pending-chat"
        pendingWorktree={pendingWorktree}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(/file list could not be loaded/i);
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
  });

  it("renders a Codex-style inline change summary and opens review", async () => {
    const user = userEvent.setup();
    invokeMock.mockImplementation(async (command) => {
      if (command === "git_get_status") {
        return { unstagedFiles: ["src/App.tsx"], stagedFiles: [] } as never;
      }
      if (command === "git_diff_changes") {
        return `diff --git a/src/App.tsx b/src/App.tsx
--- a/src/App.tsx
+++ b/src/App.tsx
@@ -1 +1 @@
-old
+new` as never;
      }
      return undefined as never;
    });
    const pendingWorktree = {
      path: "/worktrees/run-c",
      branch: "sythoria-agent-c",
      commitScope: {
        projectId: "project-c",
        projectRoot: "/projects/c",
        modelId: "model-c",
      },
    };
    useProjectStore.setState({ isProjectsEnabled: true });
    useUIStore.setState({ isAuxPanelOpen: false, activeAuxTab: "files", activeAuxConversationId: null });
    useChatStore.setState({
      conversations: [
        {
          id: "changed-chat",
          title: "Changed chat",
          timestamp: new Date(),
          messages: [makeMessage({ role: "assistant", content: "Implemented the change." })],
          model: "model-c",
          pendingWorktree,
        },
      ],
    });

    render(
      <ChatArea
        messages={[makeMessage({ role: "assistant", content: "Implemented the change." })]}
        {...defaultProps}
        conversationId="changed-chat"
        pendingWorktree={pendingWorktree}
      />,
    );

    const summary = await screen.findByRole("region", { name: "Workspace change summary" });
    expect(summary).toHaveTextContent("Edited App.tsx");
    expect(summary).toHaveTextContent("+1");
    expect(summary).toHaveTextContent("−1");

    await user.click(screen.getByRole("button", { name: "Review" }));
    expect(useUIStore.getState().activeAuxTab).toBe("review");
    expect(useUIStore.getState().isAuxPanelOpen).toBe(true);
    expect(useUIStore.getState().activeAuxConversationId).toBe("changed-chat");
  });
});
