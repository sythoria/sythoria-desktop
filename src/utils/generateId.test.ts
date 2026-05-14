import { describe, it, expect } from "vitest";
import { generateId } from "../utils/generateId";

describe("generateId", () => {
  it("returns a string", () => {
    const id = generateId();
    expect(typeof id).toBe("string");
  });

  it("returns an 8-character id", () => {
    const id = generateId();
    expect(id.length).toBe(8);
  });

  it("returns unique ids", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});
