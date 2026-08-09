import { fireEvent, render, screen } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore } from "../store/useChatStore";
import { useProjectStore } from "../store/useProjectStore";
import { useUIStore } from "../store/useUIStore";
import { AuxiliaryPanel, TerminalPane } from "./AuxiliaryPanel";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

describe("TerminalPane", () => {
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

  afterEach(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: originalScrollIntoView,
    });
  });

  it("does not return the WebView scroll result as an effect cleanup", () => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(() => ({ webviewResult: true })),
    });

    const { unmount } = render(<TerminalPane projectId="project-1" projectPath="C:\\workspace" canExecute={true} />);

    expect(() => unmount()).not.toThrow();
  });
});

describe("workspace panel", () => {
  beforeEach(() => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "project_browse_begin") return "browser-run-token" as never;
      if (command === "git_get_status") {
        return {
          isRepo: true,
          path: "C:\\workspace",
          branch: "main",
          isDirty: true,
          stagedFiles: [],
          unstagedFiles: ["src/App.tsx"],
          ahead: 0,
          behind: 0,
        } as never;
      }
      if (command === "git_diff_changes") {
        return `diff --git a/src/App.tsx b/src/App.tsx
--- a/src/App.tsx
+++ b/src/App.tsx
@@ -1 +1 @@
-old
+new` as never;
      }
      return [] as never;
    });

    useUIStore.setState({
      isAuxPanelOpen: true,
      activeAuxTab: null,
      openAuxTabs: [],
      activeAuxConversationId: null,
      sideChatConversationId: null,
      backgroundTasks: [
        {
          id: "task-1",
          title: "npm run typecheck",
          convId: "conversation-1",
          status: "running",
          timestamp: new Date(),
        },
      ],
    });
    useProjectStore.setState({
      activeProjectId: "project-1",
      activeWorktreePath: null,
      activeWorktreeBranch: null,
      projects: [{ id: "project-1", name: "Sythoria", path: "C:\\workspace", permissions: "full" }],
    });
    useChatStore.setState({
      activeId: "conversation-1",
      conversations: [
        {
          id: "conversation-1",
          title: "Workspace task",
          timestamp: new Date(),
          model: "test-model",
          projectId: "project-1",
          messages: [
            {
              id: "message-1",
              role: "user",
              content: "Review this source",
              timestamp: new Date(),
              sources: [{ title: "Reference", url: "https://example.com" }],
            },
          ],
        },
      ],
    });
  });

  afterEach(() => {
    invokeMock.mockReset();
  });

  it("renders the Codex-style launcher and opens a full panel view", async () => {
    render(<AuxiliaryPanel />);

    expect(screen.getByRole("navigation", { name: "Workspace panel launcher" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Review/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Terminal/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Browser/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Files/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Side chat/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Review/ }));
    expect(await screen.findByText("1 file changed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close Review" })).toBeInTheDocument();
  });

  it("opens a temporary side chat and supports the launcher shortcuts", async () => {
    render(<AuxiliaryPanel />);

    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    expect(useUIStore.getState().activeAuxTab).toBe("files");

    fireEvent.click(await screen.findByRole("button", { name: "Close Files" }));
    fireEvent.click(await screen.findByRole("button", { name: /Side chat/ }));
    await vi.waitFor(() => expect(useUIStore.getState().sideChatConversationId).toBeTruthy());
    expect(useUIStore.getState().activeAuxTab).toBe("chat");
    expect(useUIStore.getState().isAuxPanelOpen).toBe(true);
    expect(
      useChatStore
        .getState()
        .conversations.find((conversation) => conversation.id === useUIStore.getState().sideChatConversationId)
        ?.isTemporary,
    ).toBe(true);
  });

  it("adds a workspace tab without replacing the existing tab", async () => {
    render(<AuxiliaryPanel />);

    fireEvent.click(screen.getByRole("button", { name: /Review/ }));
    expect(await screen.findByRole("tab", { name: "Review" })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("button", { name: "Add workspace tab" }));
    fireEvent.click(screen.getByRole("button", { name: /Files/ }));

    expect(screen.getByRole("tab", { name: "Review" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("aria-selected", "true");
    expect(useUIStore.getState().openAuxTabs).toEqual(["review", "files"]);
  });
});
