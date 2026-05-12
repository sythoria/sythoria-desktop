import { useCallback } from "react";
import { useConnection } from "../contexts/ConnectionContext";
import { invoke } from "@tauri-apps/api/core";

export function useWebSocket() {
  const { connect, disconnect } = useConnection();

  const sendMessage = useCallback(
    async (model: string) => {
      connect();

      try {
        const result = await invoke("ws_chat", {
          url: "ws://localhost:8080/chat",
          apiKey: null,
          model: model,
        });

        return result;
      } catch (err) {
        disconnect();
        throw err;
      }
    },
    [connect, disconnect]
  );

  return {
    sendMessage,
  };
}
