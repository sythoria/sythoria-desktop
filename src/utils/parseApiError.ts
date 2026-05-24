const ERROR_MESSAGES: Record<string, string> = {
  400: "Bad request — the API received invalid parameters.",
  401: "Invalid API key — check your credentials in Settings.",
  403: "Access denied — your API key does not have permission for this model.",
  404: "Model not found — the model ID may be incorrect or deprecated.",
  429: "Rate limited — too many requests. Wait a moment and try again.",
  500: "Server error — the provider is having issues. Try again later.",
  502: "Bad gateway — the provider server is temporarily unreachable.",
  503: "Service unavailable — the provider is temporarily down.",
};

interface StructuredAppError {
  ApiError?: { status: number; message: string };
  ConfigIo?: string;
  AppPath?: string;
  RequestFailed?: string;
  StreamError?: string;
  ParseError?: string;
  AuthError?: string;
  SearchError?: string;
  UrlValidationError?: string;
  KeyNotFound?: string;
}

export function parseApiError(err: unknown): string {
  if (err instanceof Error) {
    const structured = tryParseStructuredError(err.message);
    if (structured) return structured;
    return userFriendlyMessage(err.message);
  }
  if (typeof err === "string") {
    const structured = tryParseStructuredError(err);
    if (structured) return structured;
    return userFriendlyMessage(err);
  }
  return "An unexpected error occurred. Please try again.";
}

function tryParseStructuredError(raw: string): string | null {
  try {
    const parsed: StructuredAppError = JSON.parse(raw);
    if (parsed.ApiError) {
      const code = String(parsed.ApiError.status);
      return ERROR_MESSAGES[code] ?? `API error ${code}: ${parsed.ApiError.message}`;
    }
    if (parsed.UrlValidationError) return `URL validation error: ${parsed.UrlValidationError}`;
    if (parsed.KeyNotFound) return parsed.KeyNotFound;
    if (parsed.AuthError) return `Authentication error: ${parsed.AuthError}`;
    if (parsed.SearchError) return `Search error: ${parsed.SearchError}`;
    if (parsed.ConfigIo) return "Configuration error — try restarting the app.";
    if (parsed.StreamError) return "Stream error — the connection was interrupted.";
    if (parsed.ParseError) return "Response parse error — the API returned unexpected data.";
    if (parsed.RequestFailed) return userFriendlyMessage(parsed.RequestFailed);
    if (parsed.AppPath) return "App path error — try reinstalling.";
  } catch {
    // Not structured JSON, fall through.
  }
  return null;
}

function userFriendlyMessage(raw: string): string {
  const statusMatch = raw.match(/API error (\d{3})/);
  if (statusMatch) {
    const code = statusMatch[1];
    return ERROR_MESSAGES[code] ?? `API error ${code}: ${raw.replace(/API error \d{3}:\s*/, "")}`;
  }

  if (raw.includes("Failed to fetch") || raw.includes("NetworkError") || raw.includes("error sending request")) {
    return "Network error — check your internet connection and API base URL.";
  }
  if (raw.includes("timeout") || raw.includes("Timed out")) {
    return "Request timed out — the provider took too long to respond.";
  }
  if (raw.includes("Invalid URL") || raw.includes("relative URL without a base")) {
    return "Invalid API URL — check the base URL in Settings.";
  }

  return raw.length > 200 ? raw.slice(0, 200) + "…" : raw;
}
