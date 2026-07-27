import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation } from "../types";
import { useChatStore } from "./useChatStore";
import { useModelStore } from "./useModelStore";
import { useUIStore } from "./useUIStore";

const primaryConversation: Conversation = {
  id: "primary-chat",
  title: "Existing chat",
  timestamp: new Date("2026-07-18T20:00:00Z"),
  messages: [
    {
      id: "message-1",
      role: "user",
      content: "Existing prompt",
      timestamp: new Date("2026-07-18T20:00:00Z"),
    },
  ],
  model: "model-1",
};

const comparisonConversation: Conversation = {
  ...primaryConversation,
  id: "compare-existing",
  title: "Existing chat (Compare)",
  model: "model-2",
};

describe("compare mode chat transitions", () => {
  beforeEach(() => {
    useChatStore.setState({
      conversations: [primaryConversation, comparisonConversation],
      activeId: primaryConversation.id,
      compareIds: [comparisonConversation.id],
      isCompareMode: true,
      navigationHistory: [primaryConversation.id],
      navigationIndex: 0,
    });
  });

  it("starts a new chat outside compare mode and removes stale comparison state", () => {
    const newId = useChatStore.getState().newChat();
    const state = useChatStore.getState();

    expect(state.activeId).toBe(newId);
    expect(state.isCompareMode).toBe(false);
    expect(state.compareIds).toEqual([]);
    expect(state.conversations.some((conversation) => conversation.id === comparisonConversation.id)).toBe(false);
  });

  it("starts a temporary chat outside compare mode and removes stale comparison state", () => {
    const newId = useChatStore.getState().newTemporaryChat();
    const state = useChatStore.getState();

    expect(state.activeId).toBe(newId);
    expect(state.conversations.find((conversation) => conversation.id === newId)?.isTemporary).toBe(true);
    expect(state.isCompareMode).toBe(false);
    expect(state.compareIds).toEqual([]);
    expect(state.conversations.some((conversation) => conversation.id === comparisonConversation.id)).toBe(false);
  });
});

describe("subagent cancellation", () => {
  it("stops the selected subagent and all of its descendants", async () => {
    const cancelConversationStream = vi.fn();
    const resolveSelectedConfirmation = vi.fn();
    const resolveUnrelatedConfirmation = vi.fn();
    const originalCancelConversationStream = useModelStore.getState().cancelConversationStream;
    useModelStore.setState({ cancelConversationStream });

    const subagent = {
      ...primaryConversation,
      id: "subagent-1",
      parentId: primaryConversation.id,
      isSubagent: true,
      status: "running" as const,
      messages: [{ ...primaryConversation.messages[0], id: "subagent-message", isStreaming: true }],
    };
    const childSubagent = {
      ...subagent,
      id: "subagent-2",
      parentId: subagent.id,
      messages: [{ ...subagent.messages[0], id: "child-message" }],
    };
    const unrelatedSubagent = {
      ...subagent,
      id: "subagent-unrelated",
      parentId: primaryConversation.id,
      messages: [{ ...subagent.messages[0], id: "unrelated-message" }],
    };

    useChatStore.setState({
      conversations: [primaryConversation, subagent, childSubagent, unrelatedSubagent],
      activeId: primaryConversation.id,
      isStreaming: true,
      generationState: "loading",
      generationLabel: "Running agents",
      generationByConversation: {
        [subagent.id]: { state: "responding", label: "Responding" },
        [childSubagent.id]: { state: "searching", label: "Searching" },
        [unrelatedSubagent.id]: { state: "responding", label: "Responding" },
      },
    });
    useUIStore.setState({
      pendingToolConfirmations: [
        {
          id: "selected-confirmation",
          conversationId: childSubagent.id,
          toolName: "project_write",
          arguments: {},
          resolve: resolveSelectedConfirmation,
        },
        {
          id: "unrelated-confirmation",
          conversationId: unrelatedSubagent.id,
          toolName: "project_write",
          arguments: {},
          resolve: resolveUnrelatedConfirmation,
        },
      ],
    });

    try {
      await useChatStore.getState().stopStreaming(subagent.id);

      const state = useChatStore.getState();
      expect(cancelConversationStream).toHaveBeenCalledTimes(2);
      expect(cancelConversationStream).toHaveBeenCalledWith(subagent.id);
      expect(cancelConversationStream).toHaveBeenCalledWith(childSubagent.id);
      expect(state.conversations.find((conversation) => conversation.id === subagent.id)?.status).toBe("stopped");
      expect(state.conversations.find((conversation) => conversation.id === childSubagent.id)?.status).toBe("stopped");
      expect(state.conversations.find((conversation) => conversation.id === unrelatedSubagent.id)?.status).toBe(
        "running",
      );
      expect(state.generationByConversation[subagent.id]).toBeUndefined();
      expect(state.generationByConversation[childSubagent.id]).toBeUndefined();
      expect(state.generationByConversation[unrelatedSubagent.id]).toBeDefined();
      expect(resolveSelectedConfirmation).toHaveBeenCalledWith(false);
      expect(resolveUnrelatedConfirmation).not.toHaveBeenCalled();
      expect(useUIStore.getState().pendingToolConfirmations).toHaveLength(1);
      expect(useUIStore.getState().pendingToolConfirmations[0].id).toBe("unrelated-confirmation");
    } finally {
      useModelStore.setState({ cancelConversationStream: originalCancelConversationStream });
      useUIStore.setState({ pendingToolConfirmations: [] });
    }
  });
});
