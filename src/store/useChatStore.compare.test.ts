import { beforeEach, describe, expect, it } from "vitest";
import type { Conversation } from "../types";
import { useChatStore } from "./useChatStore";

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
