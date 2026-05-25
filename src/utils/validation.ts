import { z } from "zod";

const BLOCKED_PROTOCOLS = ["file:", "ftp:", "data:", "javascript:", "vbscript:"];

const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^127\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^0\.0\.0\.0$/,
  /^\[?::1\]?$/,
  /^localhost$/,
  /^169\.254\.\d+\.\d+$/,
];

function isPrivateHostname(hostname: string): boolean {
  return PRIVATE_HOST_PATTERNS.some((p) => p.test(hostname));
}

export const ModelConfigSchema = z.object({
  id: z.string().min(1, "Model ID is required"),
  name: z.string().min(1, "Name is required").max(60, "Name is too long"),
  apiBase: z
    .string()
    .min(1, "API Base URL is required")
    .refine(
      (val) => {
        try {
          const url = new URL(val);
          if (!["http:", "https:"].includes(url.protocol)) return false;
          if (BLOCKED_PROTOCOLS.includes(url.protocol)) return false;
          if (isPrivateHostname(url.hostname)) return false;
          return true;
        } catch {
          return false;
        }
      },
      { message: "Must be a valid public HTTP or HTTPS URL" },
    ),
  apiKey: z.string(),
  modelId: z.string().min(1, "Model ID is required"),
  provider: z.string().optional(),
  enabled: z.boolean().optional(),
});

const SearchApiConfigSchema = z.object({
  id: z.string().min(1, "Search config ID is required"),
  name: z.string().min(1, "Name is required").max(60, "Name is too long"),
  provider: z.enum(["google", "searxng", "firecrawl", "custom"]),
  baseUrl: z.string().min(1, "Base URL is required"),
  apiKey: z.string().optional(),
  cx: z.string().optional(),
  maxResults: z.number().min(1).max(20),
  enabled: z.boolean(),
});

export function validateModelConfig(config: unknown) {
  return ModelConfigSchema.safeParse(config);
}

export function validateSearchConfig(config: unknown) {
  return SearchApiConfigSchema.safeParse(config);
}

export function validateApiUrl(url: string, allowPrivate = true): { valid: boolean; error?: string; warning?: string } {
  try {
    const parsed = new URL(url);
    if (BLOCKED_PROTOCOLS.includes(parsed.protocol)) {
      return { valid: false, error: `${parsed.protocol} protocol is not allowed` };
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { valid: false, error: "URL must use HTTP or HTTPS protocol" };
    }
    if (!allowPrivate && isPrivateHostname(parsed.hostname)) {
      return { valid: false, error: "Private or local network addresses are not allowed" };
    }
    if (allowPrivate && isPrivateHostname(parsed.hostname)) {
      return { valid: true, warning: "This is a local/private network address — ensure it is intentional" };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }
}

export function validateApiKey(key: string, provider?: string): { valid: boolean; warning?: string } {
  const noKeyProviders = ["Ollama (Local)", "Local", "Custom"];
  if (noKeyProviders.includes(provider ?? "")) {
    return { valid: true };
  }
  if (!key || key.trim().length === 0) {
    return { valid: false, warning: "API key is required for this provider" };
  }
  return { valid: true };
}

export function validateSearchApiKey(key: string | undefined, provider: string): { valid: boolean; warning?: string } {
  const noKeyProviders = ["searxng", "custom"];
  if (noKeyProviders.includes(provider)) {
    return { valid: true };
  }
  if (!key || key.trim().length === 0) {
    return { valid: false, warning: "API key is required for this provider" };
  }
  return { valid: true };
}
