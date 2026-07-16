import { describe, expect, it } from "vitest";
import { ConversationSchema } from "./storage";

describe("ConversationSchema", () => {
  it("preserves stopped subagent state and recursion depth", () => {
    const result = ConversationSchema.safeParse({
      id: "subagent-1",
      title: "Security review",
      timestamp: "2026-07-16T12:00:00.000Z",
      messages: [],
      model: "model-1",
      parentId: "conversation-1",
      role: "security",
      isSubagent: true,
      status: "stopped",
      recursionDepth: 3,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.status).toBe("stopped");
    expect(result.data.recursionDepth).toBe(3);
  });

  it("rejects invalid recursion depths", () => {
    const result = ConversationSchema.safeParse({
      id: "subagent-1",
      title: "Security review",
      timestamp: new Date(),
      messages: [],
      model: "model-1",
      isSubagent: true,
      recursionDepth: -1,
    });

    expect(result.success).toBe(false);
  });
});
