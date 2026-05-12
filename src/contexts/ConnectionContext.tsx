import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

interface ConnectionContextType {
  status: ConnectionStatus;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  connect: () => void;
  disconnect: () => void;
  reconnect: () => void;
}

const ConnectionContext = createContext<ConnectionContextType | undefined>(undefined);

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unlistenFns: UnlistenFn[] = [];
    let cancelled = false;

    async function setupListeners() {
      unlistenFns.push(
        await listen<string>("ws-error", (event) => {
          if (!cancelled) {
            setStatus("error");
            setError(typeof event.payload === "string" ? event.payload : JSON.stringify(event.payload));
          }
        })
      );

      unlistenFns.push(
        await listen("ws-closed", () => {
          if (!cancelled) {
            setStatus("disconnected");
          }
        })
      );

      unlistenFns.push(
        await listen("ws-connected", () => {
          if (!cancelled) {
            setStatus("connected");
            setError(null);
          }
        })
      );

      unlistenFns.push(
        await listen("ws-reconnecting", () => {
          if (!cancelled) {
            setStatus("connecting");
          }
        })
      );
    }

    setupListeners();

    return () => {
      cancelled = true;
      unlistenFns.forEach((fn) => fn());
    };
  }, []);

  const connect = useCallback(() => {
    setStatus("connecting");
    setError(null);
  }, []);

  const disconnect = useCallback(() => {
    setStatus("disconnected");
    setError(null);
  }, []);

  const reconnect = useCallback(() => {
    setStatus("connecting");
  }, []);

  return (
    <ConnectionContext.Provider
      value={{
        status,
        isConnected: status === "connected",
        isConnecting: status === "connecting",
        error,
        connect,
        disconnect,
        reconnect,
      }}
    >
      {children}
    </ConnectionContext.Provider>
  );
}

export function useConnection() {
  const context = useContext(ConnectionContext);
  if (context === undefined) {
    throw new Error("useConnection must be used within a ConnectionProvider");
  }
  return context;
}
