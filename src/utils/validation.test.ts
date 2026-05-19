import { describe, it, expect } from "vitest";
import { validateApiUrl, validateApiKey, validateModelConfig, ModelConfigSchema } from "../utils/validation";

describe("validateApiUrl", () => {
  it("accepts valid HTTPS URLs", () => {
    expect(validateApiUrl("https://api.openai.com/v1/chat/completions")).toEqual({ valid: true });
  });

  it("accepts valid HTTP URLs", () => {
    expect(validateApiUrl("http://localhost:11434/v1/chat/completions")).toEqual({ valid: true });
  });

  it("rejects empty strings", () => {
    expect(validateApiUrl("")).toEqual({ valid: false, error: "Invalid URL format" });
  });

  it("rejects non-HTTP protocols", () => {
    expect(validateApiUrl("ftp://example.com")).toEqual({ valid: false, error: "URL must use HTTP or HTTPS protocol" });
  });

  it("rejects malformed URLs", () => {
    expect(validateApiUrl("not-a-url")).toEqual({ valid: false, error: "Invalid URL format" });
  });
});

describe("validateApiKey", () => {
  it("accepts non-empty keys for non-local providers", () => {
    expect(validateApiKey("sk-abc123", "OpenAI")).toEqual({ valid: true });
  });

  it("warns on empty key for non-local providers", () => {
    expect(validateApiKey("", "OpenAI")).toEqual({ valid: false, warning: "API key is required for this provider" });
  });

  it("accepts empty key for local providers", () => {
    expect(validateApiKey("", "Ollama (Local)")).toEqual({ valid: true });
  });

  it("accepts empty key for Local provider", () => {
    expect(validateApiKey("", "Local")).toEqual({ valid: true });
  });
});

describe("ModelConfigSchema", () => {
  const validConfig = {
    id: "test-1",
    name: "Test Model",
    apiBase: "https://api.openai.com/v1/chat/completions",
    apiKey: "sk-test",
    modelId: "gpt-4o",
  };

  it("validates a correct model config", () => {
    const result = ModelConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it("rejects config with empty name", () => {
    const result = ModelConfigSchema.safeParse({ ...validConfig, name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects config with invalid URL", () => {
    const result = ModelConfigSchema.safeParse({ ...validConfig, apiBase: "not-a-url" });
    expect(result.success).toBe(false);
  });

  it("rejects config with empty modelId", () => {
    const result = ModelConfigSchema.safeParse({ ...validConfig, modelId: "" });
    expect(result.success).toBe(false);
  });

  it("accepts optional provider field", () => {
    const result = ModelConfigSchema.safeParse({ ...validConfig, provider: "OpenAI" });
    expect(result.success).toBe(true);
  });
});

describe("validateModelConfig", () => {
  it("returns success for valid config", () => {
    const result = validateModelConfig({
      id: "test-1",
      name: "Test Model",
      apiBase: "https://api.openai.com/v1/chat/completions",
      apiKey: "sk-test",
      modelId: "gpt-4o",
    });
    expect(result.success).toBe(true);
  });

  it("returns error for invalid config", () => {
    const result = validateModelConfig({
      id: "",
      name: "",
      apiBase: "bad",
      apiKey: "",
      modelId: "",
    });
    expect(result.success).toBe(false);
  });
});
