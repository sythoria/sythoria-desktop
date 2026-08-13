import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

    await user.click(screen.getByRole("button", { name: /Worked for/i }));

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

  it("keeps tool activity expanded while working and collapses it after the final response", async () => {
    const startedAt = Date.now() - 5_000;
    const userMessage = makeMessage({
      id: "working-user",
      role: "user",
      content: "Inspect the project",
      timestamp: new Date(startedAt - 1_000),
    });
    const narrationMessage = makeMessage({
      id: "working-narration",
      role: "assistant",
      content: "I’ll inspect the relevant files.",
      timestamp: new Date(startedAt),
    });
    const toolMessage = makeMessage({
      id: "working-tool",
      role: "tool",
      content: "Project: read",
      timestamp: new Date(startedAt + 1_000),
      toolCall: {
        id: "working-call",
        name: "project_read",
        arguments: { file_path: "src/App.tsx" },
      },
      toolResult: {
        id: "working-call",
        name: "project_read",
        content: "export default function App() {}",
      },
    });
    const streamingFinal = makeMessage({
      id: "working-final",
      role: "assistant",
      content: "The project uses",
      timestamp: new Date(),
      isStreaming: true,
    });
    const activeMessages = [userMessage, narrationMessage, toolMessage, streamingFinal];
    const conversation: Conversation = {
      id: "working-chat",
      title: "Working chat",
      timestamp: new Date(),
      messages: activeMessages,
      model: "model-1",
    };
    useChatStore.setState({
      conversations: [conversation],
      generationByConversation: {
        [conversation.id]: { state: "responding", label: "Responding" },
      },
    });

    const { rerender } = render(
      <ChatArea messages={activeMessages} {...defaultProps} conversationId={conversation.id} />,
    );

    const activeDisclosure = screen.getByRole("button", { name: /Working for \d+s/i });
    expect(activeDisclosure).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("I’ll inspect the relevant files.")).toBeInTheDocument();
    expect(screen.getByText("The project uses")).toBeInTheDocument();

    await userEvent.click(activeDisclosure);
    expect(activeDisclosure).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(screen.queryByText("I’ll inspect the relevant files.")).not.toBeInTheDocument());
    expect(screen.getByTestId("working-collapsed-preview")).toHaveClass("pl-5");
    expect(screen.getByTestId("working-collapsed-preview")).toHaveTextContent("App.tsx");

    const latestThought = makeMessage({
      id: "working-latest-thought",
      role: "assistant",
      content: "I’m checking the component state now.",
      timestamp: new Date(),
    });
    const activeThoughtMessages = [userMessage, narrationMessage, toolMessage, latestThought];
    useChatStore.setState({
      conversations: [{ ...conversation, messages: activeThoughtMessages }],
      generationByConversation: {
        [conversation.id]: { state: "responding", label: "Responding" },
      },
    });
    rerender(<ChatArea messages={activeThoughtMessages} {...defaultProps} conversationId={conversation.id} />);
    await waitFor(() => {
      const previews = screen.getAllByTestId("working-collapsed-preview");
      expect(previews).toHaveLength(1);
      expect(previews[0]).toHaveTextContent("I’m checking the component state now.");
    });

    const completedFinal = {
      ...streamingFinal,
      content: "The project uses React.",
      isStreaming: false,
      workingDuration: 8,
    };
    const completedMessages = [userMessage, narrationMessage, toolMessage, completedFinal];
    useChatStore.setState({
      conversations: [{ ...conversation, messages: completedMessages }],
      generationByConversation: {
        [conversation.id]: { state: "idle", label: "" },
      },
    });
    rerender(<ChatArea messages={completedMessages} {...defaultProps} conversationId={conversation.id} />);

    const completedDisclosure = screen.getByRole("button", { name: "Worked for 8s" });
    await waitFor(() => expect(completedDisclosure).toHaveAttribute("aria-expanded", "false"));
    await waitFor(() => expect(screen.queryByText("I’ll inspect the relevant files.")).not.toBeInTheDocument());
    expect(screen.getByText("The project uses React.")).toBeInTheDocument();
  });

  it("keeps the working disclosure mounted when another tool is called", () => {
    const startedAt = Date.now() - 3_000;
    const userMessage = makeMessage({
      id: "multi-tool-user",
      role: "user",
      content: "Inspect both files",
      timestamp: new Date(startedAt - 1_000),
    });
    const firstTool = makeMessage({
      id: "multi-tool-first",
      role: "tool",
      content: "Project: read",
      timestamp: new Date(startedAt),
      toolCall: { id: "first-call", name: "project_read", arguments: { file_path: "src/App.tsx" } },
      toolResult: { id: "first-call", name: "project_read", content: "App contents" },
    });
    const intermediateAssistant = makeMessage({
      id: "multi-tool-intermediate",
      role: "assistant",
      content: "I found the entry point; now I’ll inspect the store.",
      timestamp: new Date(startedAt + 1_000),
      isStreaming: false,
    });
    const firstStepMessages = [userMessage, firstTool, intermediateAssistant];
    const conversation: Conversation = {
      id: "multi-tool-chat",
      title: "Multi-tool chat",
      timestamp: new Date(),
      messages: firstStepMessages,
      model: "model-1",
    };
    useChatStore.setState({
      conversations: [conversation],
      generationByConversation: {
        [conversation.id]: { state: "loading", label: "Loading (continued)" },
      },
    });

    const { rerender } = render(
      <ChatArea messages={firstStepMessages} {...defaultProps} conversationId={conversation.id} />,
    );
    const disclosureBefore = screen.getByRole("button", { name: /Working for \d+s/i });
    expect(disclosureBefore).toHaveAttribute("aria-expanded", "true");

    const secondTool = makeMessage({
      id: "multi-tool-second",
      role: "tool",
      content: "Project: read",
      timestamp: new Date(startedAt + 2_000),
      toolCall: { id: "second-call", name: "project_read", arguments: { file_path: "src/store/useChatStore.ts" } },
    });
    const secondStepMessages = [...firstStepMessages, secondTool];
    useChatStore.setState({
      conversations: [{ ...conversation, messages: secondStepMessages }],
      generationByConversation: {
        [conversation.id]: { state: "loading", label: "Loading (continued)" },
      },
    });
    rerender(<ChatArea messages={secondStepMessages} {...defaultProps} conversationId={conversation.id} />);

    const disclosureAfter = screen.getByRole("button", { name: /Working for \d+s/i });
    expect(disclosureAfter).toBe(disclosureBefore);
    expect(disclosureAfter).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("I found the entry point; now I’ll inspect the store.")).toBeInTheDocument();
  });

  it("keeps completed final reasoning and empty tool placeholders inside the work disclosure", async () => {
    const user = userEvent.setup();
    const startedAt = Date.now() - 10_000;
    const userMessage = makeMessage({
      id: "reasoning-user",
      role: "user",
      content: "Fetch the site",
      timestamp: new Date(startedAt - 1_000),
    });
    const emptyPlaceholder = makeMessage({
      id: "empty-tool-placeholder",
      role: "assistant",
      content: "",
      timestamp: new Date(startedAt),
      isStreaming: false,
    });
    const toolMessage = makeMessage({
      id: "reasoning-tool",
      role: "tool",
      content: "Fetching site",
      timestamp: new Date(startedAt + 1_000),
      toolCall: { id: "fetch-call", name: "fetch_url", arguments: { url: "https://example.com" } },
      toolResult: { id: "fetch-call", name: "fetch_url", content: "Example site" },
    });
    const finalMessage = makeMessage({
      id: "reasoning-final",
      role: "assistant",
      content: "The site is available.",
      reasoningContent: "I inspected the fetched page before answering.",
      thinkingDuration: 6,
      workingDuration: 10,
      timestamp: new Date(),
      isStreaming: false,
    });
    const messages = [userMessage, emptyPlaceholder, toolMessage, finalMessage];
    const conversation: Conversation = {
      id: "reasoning-chat",
      title: "Reasoning chat",
      timestamp: new Date(),
      messages,
      model: "model-1",
    };
    useChatStore.setState({
      conversations: [conversation],
      generationByConversation: { [conversation.id]: { state: "idle", label: "" } },
    });

    render(<ChatArea messages={messages} {...defaultProps} conversationId={conversation.id} />);

    const workDisclosure = screen.getByRole("button", { name: "Worked for 10s" });
    expect(workDisclosure).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Thought for 6s")).not.toBeInTheDocument();
    expect(screen.getByText("The site is available.")).toBeInTheDocument();

    await user.click(workDisclosure);
    expect(screen.getByText("Thought for 6s")).toBeInTheDocument();
    expect(document.querySelector('[aria-label="Assistant message: "]')).not.toBeInTheDocument();
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
