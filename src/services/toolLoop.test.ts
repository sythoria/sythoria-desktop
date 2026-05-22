import { describe, it, expect } from "vitest";
import { TOOL_DEFINITIONS, TOOL_SYSTEM_PROMPT } from "./toolLoop";

describe("TOOL_DEFINITIONS", () => {
  it("defines exactly 2 tools", () => {
    expect(TOOL_DEFINITIONS).toHaveLength(2);
  });

  it("includes search_query tool", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.function.name);
    expect(names).toContain("search_query");
  });

  it("includes fetch_url tool", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.function.name);
    expect(names).toContain("fetch_url");
  });

  it("all tools have required parameters", () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.function.parameters.required).toBeDefined();
      expect(tool.function.parameters.required.length).toBeGreaterThan(0);
    }
  });
});

describe("TOOL_SYSTEM_PROMPT", () => {
  it("mentions both tools", () => {
    expect(TOOL_SYSTEM_PROMPT).toContain("search_query");
    expect(TOOL_SYSTEM_PROMPT).toContain("fetch_url");
  });

  it("mentions citing sources", () => {
    expect(TOOL_SYSTEM_PROMPT.toLowerCase()).toContain("cite");
  });
});
