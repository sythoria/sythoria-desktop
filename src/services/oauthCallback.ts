import { invoke } from "@tauri-apps/api/core";
import { openExternalUrl } from "../utils/network/externalUrl";

/** Bind before opening the browser, and release the native listener on every exit. */
export async function authorizeInBrowser(
  authUrl: string,
  redirectUri: string,
  port: number,
  expectedState: string,
  signal?: AbortSignal,
): Promise<string> {
  const sessionId = crypto.randomUUID();
  const checkCancelled = () => {
    if (signal?.aborted) throw new Error("Authorization was cancelled.");
  };
  const cancel = () => {
    void invoke("cancel_oauth_listener", { sessionId }).catch(() => {});
  };
  checkCancelled();
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    await invoke("start_oauth_listener", { sessionId, port, callbackPath: new URL(redirectUri).pathname });
    checkCancelled();
    if (!(await openExternalUrl(authUrl))) {
      throw new Error("Could not open your browser. Check your default browser and try again.");
    }
    checkCancelled();
    const callback = await invoke<{ code: string }>("wait_oauth_callback", { sessionId, expectedState });
    checkCancelled();
    if (!callback.code) throw new Error("No authorization code received. Try connecting again.");
    return callback.code;
  } finally {
    signal?.removeEventListener("abort", cancel);
    await invoke("cancel_oauth_listener", { sessionId });
  }
}
