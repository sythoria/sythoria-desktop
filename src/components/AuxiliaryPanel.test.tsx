import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

describe("pinned workspace summary", () => {
  beforeEach(() => {
    invokeMock.mockImplementation(async (command) => {
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
      isAuxPanelExpanded: false,
      isAuxSummaryPinned: true,
      activeAuxTab: "review",
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
    useUIStore.getState().setAuxSummaryPinned(false);
  });

  it("renders live workspace details and can be unpinned", async () => {
    render(<AuxiliaryPanel />);

    const summary = screen.getByLabelText("Pinned workspace summary");
    await within(summary).findByText("main");
    expect(within(summary).getByText("Environment")).toBeInTheDocument();
    expect(within(summary).getByText("Sythoria")).toBeInTheDocument();
    expect(within(summary).getByText("npm run typecheck")).toBeInTheDocument();
    expect(within(summary).getByText("Reference")).toBeInTheDocument();

    fireEvent.click(within(summary).getByTitle("Unpin summary"));

    await waitFor(() => expect(screen.queryByLabelText("Pinned workspace summary")).not.toBeInTheDocument());
    expect(useUIStore.getState().isAuxSummaryPinned).toBe(false);
  });

  it("keeps the expand control but removes the redundant close control", () => {
    useUIStore.setState({ isAuxSummaryPinned: false, activeAuxTab: "terminals" });
    render(<AuxiliaryPanel />);

    fireEvent.click(screen.getByTitle("Expand workspace sidebar"));
    expect(useUIStore.getState().isAuxPanelExpanded).toBe(true);
    expect(screen.getByTitle("Minimize workspace sidebar")).toBeInTheDocument();
    expect(screen.queryByTitle("Close workspace sidebar")).not.toBeInTheDocument();
  });
});
