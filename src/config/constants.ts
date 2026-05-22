export const API_CONFIG = {
  wsEndpoint: import.meta.env.VITE_WS_ENDPOINT || "ws://localhost:8080/chat",
  chatStream: "/api/chat-stream",
} as const;

export const MAX_INPUT_LENGTH = 10000;
export const MAX_TEXTAREA_HEIGHT = 200;
export const DEBOUNCE_MS = 150;
export const TITLE_MAX_LENGTH = 40;
export const ID_LENGTH = 8;
export const WS_TIMEOUT_SECS = 30;
export const WS_MAX_RECONNECT = 5;
export const WS_BASE_BACKOFF_SECS = 1;
export const WS_MAX_BACKOFF_SECS = 30;
export const DEFAULT_TEMPERATURE = 0.7;
export const MAX_TEMPERATURE = 2.0;
export const MIN_TEMPERATURE = 0.0;
export const TEMPERATURE_STEP = 0.1;
export const SIDEBAR_WIDTH = 260;
export const MAX_TOOL_STEPS = 5;
