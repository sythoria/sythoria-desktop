import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store/useAppStore";
import { API_CONFIG } from "../config/constants";
import { logError } from "../utils/logger";

export function useWebSocket() {
  const setConnectionStatus = useAppStore((s) => s.setConnectionStatus);

  const sendMessage = useCallback(
    async (model: string) => {
      setConnectionStatus("connecting");

      try {
        const result = await invoke("ws_chat", {
          url: API_CONFIG.wsEndpoint,
          apiKey: null,
          model,
        });
        return result;
      } catch (err) {
        setConnectionStatus("error");
        logError("WebSocket send failed", err);
        throw err;
      }
    },
    [setConnectionStatus]
  );

  return { sendMessage };
}
