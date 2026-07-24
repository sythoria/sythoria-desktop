import { describe, expect, it } from "vitest";
import { getContrastColor } from "./themePresets";

describe("getContrastColor", () => {
  it("chooses the higher-contrast foreground for bright accents", () => {
    expect(getContrastColor("#3b82f6")).toBe("#000000");
    expect(getContrastColor("#f92672")).toBe("#000000");
    expect(getContrastColor("#ffffff")).toBe("#000000");
  });

  it("uses white for dark accents", () => {
    expect(getContrastColor("#0f172a")).toBe("#ffffff");
    expect(getContrastColor("#000000")).toBe("#ffffff");
  });

  it("supports shorthand colors", () => {
    expect(getContrastColor("#fff")).toBe("#000000");
    expect(getContrastColor("#111")).toBe("#ffffff");
  });
});
