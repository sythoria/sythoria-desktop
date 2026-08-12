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
    expect(summary).toHaveTextContent("Edited 1 file");
    expect(summary).toHaveTextContent("src/App.tsx");
    expect(summary).toHaveTextContent("+1");
    expect(summary).toHaveTextContent("−1");

    await user.click(screen.getByRole("button", { name: "Review" }));
    expect(useUIStore.getState().activeAuxTab).toBe("review");
    expect(useUIStore.getState().isAuxPanelOpen).toBe(true);
    expect(useUIStore.getState().activeAuxConversationId).toBe("changed-chat");
  });

  it("shows a live changed-file pill while generation is active", async () => {
    const user = userEvent.setup();
    invokeMock.mockImplementation(async (command) => {
      if (command === "git_get_status") {
        return { unstagedFiles: ["src/App.tsx", "src/Sidebar.tsx"], stagedFiles: [] } as never;
      }
      if (command === "git_diff_changes") {
        return `diff --git a/src/App.tsx b/src/App.tsx
--- a/src/App.tsx
+++ b/src/App.tsx
@@ -1 +1 @@
-old
+new
diff --git a/src/Sidebar.tsx b/src/Sidebar.tsx
--- a/src/Sidebar.tsx
+++ b/src/Sidebar.tsx
@@ -1 +1 @@
-old
+new` as never;
      }
      return undefined as never;
    });
    const assistantMessage = makeMessage({ role: "assistant", content: "Still working...", isStreaming: true });
    const pendingWorktree = {
      path: "/worktrees/run-live",
      branch: "sythoria-agent-live",
      commitScope: {
        projectId: "project-live",
        projectRoot: "/projects/live",
        modelId: "model-live",
      },
    };
    useProjectStore.setState({ isProjectsEnabled: true });
    useUIStore.setState({ isAuxPanelOpen: false, activeAuxTab: "files", activeAuxConversationId: null });
    useChatStore.setState({
      conversations: [
        {
          id: "live-chat",
          title: "Live chat",
          timestamp: new Date(),
          messages: [assistantMessage],
          model: "model-live",
          pendingWorktree,
        },
      ],
      generationByConversation: {
        "live-chat": { state: "responding", label: "Responding" },
      },
    });

    render(
      <ChatArea
        messages={[assistantMessage]}
        {...defaultProps}
        conversationId="live-chat"
        pendingWorktree={pendingWorktree}
      />,
    );

    const liveSummary = await screen.findByRole("button", { name: /2 files changed/i });
    expect(liveSummary).toHaveTextContent("+2");
    expect(liveSummary).toHaveTextContent("−2");
    expect(screen.queryByRole("region", { name: "Workspace change summary" })).not.toBeInTheDocument();

    await user.click(liveSummary);
    expect(useUIStore.getState().activeAuxTab).toBe("review");
    expect(useUIStore.getState().activeAuxConversationId).toBe("live-chat");
  });

  it("shows three edited files initially and expands the remaining files in place", async () => {
    const user = userEvent.setup();
    const paths = ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"];
    invokeMock.mockImplementation(async (command) => {
      if (command === "git_get_status") return { unstagedFiles: paths, stagedFiles: [] } as never;
      if (command === "git_diff_changes") {
        return paths
          .map(
            (path) => `diff --git a/${path} b/${path}
--- a/${path}
+++ b/${path}
@@ -1 +1 @@
-old
+new`,
          )
          .join("\n");
      }
      return undefined as never;
    });
    const assistantMessage = makeMessage({ role: "assistant", content: "Implemented all requested changes." });
    const pendingWorktree = {
      path: "/worktrees/run-expanded",
      branch: "sythoria-agent-expanded",
      commitScope: {
        projectId: "project-expanded",
        projectRoot: "/projects/expanded",
        modelId: "model-expanded",
      },
    };
    useChatStore.setState({
      conversations: [
        {
          id: "expanded-chat",
          title: "Expanded chat",
          timestamp: new Date(),
          messages: [assistantMessage],
          model: "model-expanded",
          pendingWorktree,
        },
      ],
      generationByConversation: {
        "expanded-chat": { state: "idle", label: "" },
      },
    });

    render(
      <ChatArea
        messages={[assistantMessage]}
        {...defaultProps}
        conversationId="expanded-chat"
        pendingWorktree={pendingWorktree}
      />,
    );

    const summary = await screen.findByRole("region", { name: "Workspace change summary" });
    expect(summary).toHaveTextContent("Edited 4 files");
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(screen.getByText("src/c.ts")).toBeInTheDocument();
    expect(screen.queryByText("src/d.ts")).not.toBeInTheDocument();

    const expandButton = screen.getByRole("button", { name: "Show 1 more file" });
    expect(expandButton).toHaveAttribute("aria-expanded", "false");
    await user.click(expandButton);
    expect(screen.getByText("src/d.ts")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show fewer files" })).toHaveAttribute("aria-expanded", "true");
  });
});
