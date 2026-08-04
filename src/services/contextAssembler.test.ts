import { describe, expect, it } from "vitest";
import type { ModelConfig } from "../types";
import {
  assembleContext,
  estimateApiMessageTokens,
  resolveContextBudget,
  type ApiContextMessage,
} from "./contextAssembler";

function model(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: "model",
    name: "Model",
    apiBase: "https://api.openai.com/v1/chat/completions",
    apiKey: "",
    modelId: "model-id",
    provider: "openai",
    ...overrides,
  };
}

describe("context budgets", () => {
  it("reports unknown model context explicitly while applying a conservative assembly ceiling", () => {
    const budget = resolveContextBudget(model());
    expect(budget.status).toBe("unknown");
    expect(budget.contextTokens).toBeNull();
    expect(budget.inputTokens).toBeLessThan(budget.assemblyCeilingTokens);
  });

  it("uses provider-aware output reserves", () => {
    const openai = resolveContextBudget(model({ contextSize: 100_000, provider: "openai" }));
    const anthropic = resolveContextBudget(model({ contextSize: 100_000, provider: "anthropic" }));
    expect(anthropic.reservedOutputTokens).toBeGreaterThan(openai.reservedOutputTokens);
  });
});

describe("assembleContext", () => {
  it("keeps the system prompt and latest user turn while sliding older history", () => {
    const messages: ApiContextMessage[] = [
      { role: "system", content: "system" },
      ...Array.from({ length: 20 }, (_value, index) => [
        { role: "user", content: `old user ${index} ${"x".repeat(1_000)}` },
        { role: "assistant", content: `old assistant ${index} ${"y".repeat(1_000)}` },
      ]).flat(),
      { role: "user", content: "latest user instruction" },
    ];

    const result = assembleContext({ messages, model: model({ contextSize: 4_096 }) });
    expect(result.messages[0]).toEqual({ role: "system", content: "system" });
    expect(result.messages).toContainEqual({ role: "user", content: "latest user instruction" });
    expect(result.disclosure?.omittedMessages).toBeGreaterThan(0);
  });

  it("replaces oversized tool payloads with structured summaries without changing the source messages", () => {
    const toolContent = JSON.stringify(Array.from({ length: 5_000 }, (_value, index) => ({ index, value: "data" })));
    const messages: ApiContextMessage[] = [
      { role: "system", content: "system" },
      { role: "user", content: "inspect" },
      { role: "assistant", content: null, tool_calls: [{ id: "call" }] },
      { role: "tool", name: "search", tool_call_id: "call", content: toolContent },
    ];

    const result = assembleContext({ messages, model: model({ contextSize: 32_000 }), tools: [{ name: "search" }] });
    const toolResult = result.messages.find((message) => message.role === "tool");
    expect(toolResult?.content).toContain("contextSummary");
    expect(toolResult?.content).toContain("itemCount");
    expect(messages[3].content).toBe(toolContent);
    expect(result.disclosure?.summarizedToolResults).toBe(1);
    expect(
      result.messages.reduce((total, message) => total + estimateApiMessageTokens(message), 0),
    ).toBeLessThanOrEqual(result.budget.inputTokens);
  });
});
