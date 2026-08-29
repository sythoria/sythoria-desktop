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
    useProjectStore.setState({ isProjectsEnabled: true });
    useUIStore.setState({ isAuxPanelOpen: false, activeAuxTab: null, activeAuxConversationId: null });
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

  it("renders model-visible MCP markers as chips in user messages", () => {
    const messages = [
      makeMessage({
        role: "user",
        content: "Using [MCP: Gmail] check my unread email",
        mcpServerIds: ["gmail"],
      }),
    ];
    render(<ChatArea messages={messages} {...defaultProps} />);

    const chip = screen.getByRole("img", { name: "MCP tool: Gmail" });
    const messageArticle = screen.getByRole("article", { name: /User message/ });
    expect(chip).toHaveTextContent("Gmail");
    expect(messageArticle).toHaveTextContent("Using Gmail check my unread email");
    expect(messageArticle).not.toHaveTextContent("[MCP: Gmail]");
  });

  it("renders assistant messages with markdown", () => {
    const messages = [makeMessage({ role: "assistant", content: "Hi there **bold**" })];
    render(<ChatArea messages={messages} {...defaultProps} />);

    expect(screen.getByRole("log")).toBeInTheDocument();
    expect(screen.getByText("bold")).toBeInTheDocument();
  });

  it("shows completed file edits with an expandable list and opens the full Review", async () => {
    const user = userEvent.setup();
    const messages = [makeMessage({ id: "published-answer", role: "assistant", content: "Finished the changes." })];
    const conversation: Conversation = {
      id: "published-chat",
      title: "Published chat",
      timestamp: new Date(),
      messages,
      model: "model-1",
      projectId: "project-a",
      workspaceChanges: {
        projectId: "project-a",
        appliedAt: new Date(),
        undoToken: "undo-token",
        files: [
          { path: "src/one.ts", additions: 4, deletions: 1 },
          { path: "src/two.ts", additions: 3, deletions: 2 },
          { path: "src/three.ts", additions: 2, deletions: 0 },
          { path: "src/four.ts", additions: 1, deletions: 1 },
          { path: "src/five.ts", additions: 5, deletions: 0 },
        ],
      },
    };
    useChatStore.setState({
      conversations: [conversation],
      generationByConversation: { [conversation.id]: { state: "idle", label: "" } },
    });

    render(<ChatArea messages={messages} {...defaultProps} conversationId={conversation.id} />);

    const summary = screen.getByRole("region", { name: "Workspace change summary" });
    expect(summary).toHaveTextContent("Edited 5 files");
    expect(summary).toHaveTextContent("+15");
    expect(summary).toHaveTextContent("−4");
    expect(screen.getByText("src/three.ts")).toBeInTheDocument();
    expect(screen.queryByText("src/four.ts")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show 2 more files" }));
    expect(screen.getByText("src/four.ts")).toBeInTheDocument();
    expect(screen.getByText("src/five.ts")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Review" }));
    expect(useUIStore.getState().activeAuxTab).toBe("review");
    expect(useUIStore.getState().activeAuxConversationId).toBe(conversation.id);
    expect(useUIStore.getState().isAuxPanelOpen).toBe(true);
  });

  it("safely undoes the published agent patch from the completed edit card", async () => {
    const user = userEvent.setup();
    invokeMock.mockResolvedValue(undefined as never);
    const messages = [makeMessage({ id: "undo-answer", role: "assistant", content: "Finished." })];
    const conversation: Conversation = {
      id: "undo-chat",
      title: "Undo chat",
      timestamp: new Date(),
      messages,
      model: "model-1",
      projectId: "project-a",
      workspaceChanges: {
        projectId: "project-a",
        appliedAt: new Date(),
        undoToken: "4aee927d-7e79-4fa3-a4df-a352c1941c71",
        files: [{ path: "src/App.tsx", additions: 2, deletions: 1 }],
      },
    };
    useChatStore.setState({
      conversations: [conversation],
      generationByConversation: { [conversation.id]: { state: "idle", label: "" } },
    });

    render(<ChatArea messages={messages} {...defaultProps} conversationId={conversation.id} />);
    await user.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("git_workspace_undo", {
        projectId: "project-a",
        undoToken: "4aee927d-7e79-4fa3-a4df-a352c1941c71",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Workspace change summary" })).not.toBeInTheDocument(),
    );
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

  it("shows the completed thinking duration while answer text is still streaming", () => {
    const conversationId = "answering-with-reasoning";
    const messages = [
      makeMessage({
        role: "assistant",
        content: "The answer is",
        reasoningContent: "I worked through the problem.",
        isStreaming: true,
      }),
    ];
    useChatStore.setState({
      activeStreamThinkingStart: { [conversationId]: 10_000 },
      activeStreamThinkingEnd: { [conversationId]: 133_900 },
    });

    render(<ChatArea messages={messages} {...defaultProps} conversationId={conversationId} />);

    expect(screen.getByRole("button", { name: "Expand reasoning" })).toHaveTextContent("Thought for 2m 3s");
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

    expect(screen.getByRole("status")).toHaveTextContent("Cancelled agent execution.");
    expect(screen.getByRole("button", { name: "Copy" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeEnabled();
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

  it("renders native skill reads as a skill disclosure instead of a generic tool result", async () => {
    const user = userEvent.setup();
    const messages = [
      makeMessage({
        role: "tool",
        content: "Reading Skill: react-patterns",
        toolCall: {
          id: "skill-call",
          name: "read_skill",
          arguments: { id: "react-patterns", offset: "0" },
        },
        toolResult: {
          id: "skill-call",
          name: "read_skill",
          content: JSON.stringify({
            path: "SKILL.md",
            content: "# React Patterns\n\nUse semantic components.",
            offset: 0,
            nextOffset: null,
            totalCharacters: 43,
          }),
        },
      }),
    ];

    render(<ChatArea messages={messages} {...defaultProps} />);
    await user.click(screen.getByRole("button", { name: /Worked for/i }));

    expect(screen.getByText("Read skill")).toBeInTheDocument();
    expect(screen.getByText("react-patterns").parentElement).toHaveClass("text-red-600");
    expect(screen.queryByText("Tool result")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Expand details" }));
    expect(screen.getByRole("region", { name: "Skill content" })).toHaveTextContent("SKILL.md");
    expect(screen.getByText("# React Patterns")).toBeInTheDocument();
    expect(screen.queryByText("Arguments")).not.toBeInTheDocument();
    expect(screen.queryByText("Result")).not.toBeInTheDocument();
  });

  it("renders packaged skill resources as a native resource list", async () => {
    const user = userEvent.setup();
    const messages = [
      makeMessage({
        role: "tool",
        content: "Listing Skill Resources: react-patterns",
        toolCall: {
          id: "skill-resource-call",
          name: "list_skill_resources",
          arguments: { id: "react-patterns" },
        },
        toolResult: {
          id: "skill-resource-call",
          name: "list_skill_resources",
          content: JSON.stringify([
            { path: "rules/hooks.md", size: 2048 },
            { path: "examples/forms.md", size: 512 },
          ]),
        },
      }),
    ];

    render(<ChatArea messages={messages} {...defaultProps} />);
    await user.click(screen.getByRole("button", { name: /Worked for/i }));
    expect(screen.getByText("Listed skill resources")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Expand details" }));
    const resources = screen.getByRole("list", { name: "Skill resources" });
    expect(resources).toHaveTextContent("rules/hooks.md");
    expect(resources).toHaveTextContent("2.0 KB");
    expect(resources).toHaveTextContent("examples/forms.md");
  });

  it("renders a failed MCP file write as its intended diff instead of generic tool details", async () => {
    const user = userEvent.setup();
    const messages = [
      makeMessage({
        role: "tool",
        content: "Error: Failed to write file: No such file or directory (os error 2)",
        toolCall: {
          id: "failed-write",
          name: "workspace__write_file",
          arguments: {
            file_path: "cap_bypass_poc.py",
            content: "#!/usr/bin/env python3\nprint('proof')",
          },
        },
        toolResult: {
          id: "failed-write",
          name: "workspace__write_file",
          content: "Failed to write file: No such file or directory (os error 2)",
          diffSummary: {
            added: 2,
            deleted: 0,
            isNew: true,
            filename: "cap_bypass_poc.py",
            language: "python",
            error: true,
            hunks: [
              {
                oldStart: 0,
                oldLines: 0,
                newStart: 1,
                newLines: 2,
                lines: [
                  { type: "add", newNumber: 1, content: "#!/usr/bin/env python3" },
                  { type: "add", newNumber: 2, content: "print('proof')" },
                ],
              },
            ],
          },
        },
      }),
    ];

    render(<ChatArea messages={messages} {...defaultProps} />);
    await user.click(screen.getByRole("button", { name: /Worked for/i }));

    expect(screen.getByText("Create failed")).toBeInTheDocument();
    expect(screen.queryByText("Run: write_file")).not.toBeInTheDocument();
    expect(screen.getAllByText("cap_bypass_poc.py")).toHaveLength(2);
    expect(screen.getByText("#!/usr/bin/env python3")).toBeInTheDocument();
    expect(screen.getByRole("log")).toHaveTextContent("print('proof')");
    expect(screen.getByText(/Failed to write file: No such file or directory/)).toBeInTheDocument();
    expect(screen.queryByText("Arguments")).not.toBeInTheDocument();
    expect(screen.queryByText("Result")).not.toBeInTheDocument();
  });

  it("renders project shell commands as a terminal transcript", async () => {
    const user = userEvent.setup();
    const messages = [
      makeMessage({
        role: "tool",
        content: "Command completed",
        toolCall: {
          id: "shell-call",
          name: "project_bash",
          arguments: { command: "printf 'hello\\n' && pwd" },
        },
        toolResult: {
          id: "shell-call",
          name: "project_bash",
          content: "hello\n/tmp/project",
        },
      }),
    ];
    render(<ChatArea messages={messages} {...defaultProps} />);

    await user.click(screen.getByRole("button", { name: /Worked for/i }));
    const commandLabel = screen.getByText("Ran printf 'hello\\n' && pwd");
    expect(commandLabel.parentElement).toHaveClass("text-sm");
    expect(commandLabel).not.toHaveClass("font-mono", "text-xs", "text-text-primary");
    await user.click(screen.getByRole("button", { name: "Expand details" }));

    const transcript = screen.getByRole("region", { name: "Shell command output" });
    expect(transcript).toHaveTextContent("$ printf 'hello\\n' && pwd hello /tmp/project");
    expect(transcript).not.toHaveTextContent("Arguments");
    expect(transcript).not.toHaveTextContent("Result");
  });

  it("keeps active assistant output inside working and promotes only the completed final response", async () => {
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
      content: "",
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
      activeStreamReasoning: {
        [conversation.id]: "I’m checking how the chat items are grouped.",
      },
    });

    const { rerender } = render(
      <ChatArea messages={activeMessages} {...defaultProps} conversationId={conversation.id} />,
    );

    const activeDisclosure = screen.getByRole("button", { name: /Working for \d+s/i });
    expect(activeDisclosure).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("I’ll inspect the relevant files.")).toBeInTheDocument();
    const reasoningDisclosure = screen.getByRole("button", { name: "Expand reasoning" });
    expect(activeDisclosure.closest("section")).toContainElement(reasoningDisclosure);
    expect(reasoningDisclosure).toHaveTextContent(/Thinking for \d+s/);

    await userEvent.click(activeDisclosure);
    expect(activeDisclosure).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(screen.queryByText("I’ll inspect the relevant files.")).not.toBeInTheDocument());
    expect(screen.queryByText("App.tsx")).not.toBeInTheDocument();
    expect(screen.queryByTestId("working-collapsed-preview")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Expand reasoning" })).not.toBeInTheDocument();

    const answeringFinal = { ...streamingFinal, content: "The project uses" };
    const answeringMessages = [userMessage, narrationMessage, toolMessage, answeringFinal];
    useChatStore.setState({ conversations: [{ ...conversation, messages: answeringMessages }] });
    rerender(<ChatArea messages={answeringMessages} {...defaultProps} conversationId={conversation.id} />);
    expect(screen.queryByText("The project uses")).not.toBeInTheDocument();
    expect(screen.queryByTestId("working-collapsed-preview")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Expand reasoning" })).not.toBeInTheDocument();

    const activeToolMessages = [userMessage, narrationMessage, toolMessage];
    useChatStore.setState({
      conversations: [{ ...conversation, messages: activeToolMessages }],
      generationByConversation: {
        [conversation.id]: { state: "loading", label: "Loading" },
      },
    });
    rerender(<ChatArea messages={activeToolMessages} {...defaultProps} conversationId={conversation.id} />);
    await waitFor(() => expect(screen.getByTestId("working-collapsed-preview")).toHaveTextContent("App.tsx"));

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
    await waitFor(() => expect(screen.queryByTestId("working-collapsed-preview")).not.toBeInTheDocument());
    expect(screen.queryByText("I’m checking the component state now.")).not.toBeInTheDocument();

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
    expect(completedDisclosure).toBe(activeDisclosure);
    await waitFor(() => expect(completedDisclosure).toHaveAttribute("aria-expanded", "false"));
    await waitFor(() => expect(screen.queryByText("I’ll inspect the relevant files.")).not.toBeInTheDocument());
    expect(screen.getByText("The project uses React.")).toBeInTheDocument();
  });

  it("uses the full run start for the live working duration", async () => {
    const runStartedAt = Date.now() - 10_000;
    const latestThinkingStartedAt = Date.now() - 2_000;
    const conversationId = "full-working-duration";
    const messages = [
      makeMessage({
        id: "full-working-user",
        role: "user",
        content: "Inspect the project",
        timestamp: new Date(runStartedAt),
      }),
      makeMessage({
        id: "latest-thinking",
        role: "assistant",
        content: "I’m checking the latest result.",
        timestamp: new Date(latestThinkingStartedAt),
      }),
      makeMessage({
        id: "full-working-tool",
        role: "tool",
        content: "Project: read",
        timestamp: new Date(latestThinkingStartedAt + 100),
        toolCall: { id: "full-working-call", name: "project_read", arguments: { file_path: "src/App.tsx" } },
        toolResult: { id: "full-working-call", name: "project_read", content: "export default function App() {}" },
      }),
    ];

    useChatStore.setState({
      generationByConversation: { [conversationId]: { state: "loading", label: "Loading" } },
      activeStreamStartTime: { [conversationId]: runStartedAt },
    });

    render(<ChatArea messages={messages} {...defaultProps} conversationId={conversationId} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Working for 10s" })).toBeInTheDocument());
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

  it("keeps a previous tool turn completed while the next turn is working", () => {
    const firstUser = makeMessage({
      id: "first-user",
      role: "user",
      content: "Inspect the app",
      timestamp: new Date(Date.now() - 12_000),
    });
    const firstTool = makeMessage({
      id: "first-tool",
      role: "tool",
      content: "Project: read",
      timestamp: new Date(Date.now() - 11_000),
      toolCall: { id: "first-call", name: "project_read", arguments: { file_path: "src/App.tsx" } },
      toolResult: { id: "first-call", name: "project_read", content: "App contents" },
    });
    const firstFinal = makeMessage({
      id: "first-final",
      role: "assistant",
      content: "The app uses React.",
      timestamp: new Date(Date.now() - 10_000),
      isStreaming: false,
      workingDuration: 2,
    });
    const secondUser = makeMessage({
      id: "second-user",
      role: "user",
      content: "Now inspect the store",
      timestamp: new Date(Date.now() - 1_000),
    });
    const secondTool = makeMessage({
      id: "second-tool",
      role: "tool",
      content: "Project: read",
      timestamp: new Date(),
      toolCall: {
        id: "second-call",
        name: "project_read",
        arguments: { file_path: "src/store/useChatStore.ts" },
      },
    });
    const messages = [firstUser, firstTool, firstFinal, secondUser, secondTool];
    const conversation: Conversation = {
      id: "second-turn-working",
      title: "Second turn working",
      timestamp: new Date(),
      messages,
      model: "model-1",
    };
    useChatStore.setState({
      conversations: [conversation],
      generationByConversation: {
        [conversation.id]: { state: "loading", label: "Loading" },
      },
    });

    render(<ChatArea messages={messages} {...defaultProps} conversationId={conversation.id} />);

    expect(screen.getByRole("button", { name: "Worked for 2s" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Working for \d+s/i })).toBeInTheDocument();
    expect(screen.getByText("The app uses React.")).toBeInTheDocument();
    expect(screen.getByText("useChatStore.ts")).toBeInTheDocument();
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
});
