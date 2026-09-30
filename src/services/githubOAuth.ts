import { invoke } from "@tauri-apps/api/core";

export interface GitHubDeviceCodeResult {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface GitHubDeviceTokenResult {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

/**
 * Initiates the GitHub Device Authorization Flow (Zero secrets required on client).
 */
export async function startGitHubDeviceFlow(
  clientId: string,
  scope = "repo,read:user,workflow",
): Promise<GitHubDeviceCodeResult> {
  return await invoke<GitHubDeviceCodeResult>("github_start_device_flow", {
    clientId,
    scope,
  });
}

/**
 * Polls GitHub until the user approves or rejects authorization in their browser.
 */
export async function pollGitHubDeviceToken(
  deviceCode: string,
  clientId: string,
  initialInterval = 5,
  signal?: AbortSignal,
  expiresIn = 900,
): Promise<string> {
  let interval = Math.max(initialInterval, 5);
  const startTime = Date.now();
  const maxDurationMs = Math.max(1, expiresIn) * 1000;

  while (Date.now() - startTime < maxDurationMs) {
    if (signal?.aborted) {
      throw new Error("GitHub authorization was cancelled.");
    }

    // Remove each abort handler when its timer settles.
    await new Promise<void>((resolve, reject) => {
      const cancel = () => {
        clearTimeout(timer);
        reject(new Error("GitHub authorization was cancelled."));
      };
      const timer = setTimeout(
        () => {
          signal?.removeEventListener("abort", cancel);
          resolve();
        },
        Math.min(interval * 1000, maxDurationMs - (Date.now() - startTime)),
      );
      signal?.addEventListener("abort", cancel, { once: true });
    });

    if (signal?.aborted) {
      throw new Error("GitHub authorization was cancelled.");
    }

    const response = await invoke<GitHubDeviceTokenResult>("github_poll_device_token", {
      clientId,
      deviceCode,
    });

    if (signal?.aborted) throw new Error("GitHub authorization was cancelled.");

    if (response.access_token) {
      return response.access_token;
    }

    if (response.error) {
      switch (response.error) {
        case "authorization_pending":
          // Continue polling
          break;
        case "slow_down":
          // Increase polling interval by 5s as per RFC 8628
          interval += 5;
          break;
        case "expired_token":
          throw new Error("The device code has expired. Please try connecting again.");
        case "access_denied":
          throw new Error("Access was denied in browser.");
        default:
          throw new Error(response.error_description || response.error || "Authorization failed.");
      }
    }
  }

  throw new Error("GitHub authorization timed out. Please try again.");
}
