import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { openExternalUrl } from "../utils/network/externalUrl";
import { authorizeInBrowser } from "./oauthCallback";
import { startSpotifyOAuthFlow } from "./spotifyOAuth";
import { startLinearOAuthFlow } from "./linearOAuth";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../utils/network/externalUrl", () => ({ openExternalUrl: vi.fn() }));

describe("browser OAuth callbacks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(openExternalUrl).mockResolvedValue(true);
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "start_oauth_listener") return 8888;
      if (command === "wait_oauth_callback") return { code: "code" };
      if (command.endsWith("exchange_token")) return { access_token: "token", refresh_token: "refresh" };
      return undefined;
    });
  });

  it("binds Spotify's exact callback path before opening the browser", async () => {
    await startSpotifyOAuthFlow("client");
    expect(invoke).toHaveBeenNthCalledWith(
      1,
      "start_oauth_listener",
      expect.objectContaining({ port: 8888, callbackPath: "/callback" }),
    );
    const url = new URL(vi.mocked(openExternalUrl).mock.calls[0][0]);
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:8888/callback");
    expect(invoke).toHaveBeenCalledWith(
      "spotify_exchange_token",
      expect.objectContaining({ redirectUri: url.searchParams.get("redirect_uri"), code: "code" }),
    );
    expect(vi.mocked(invoke).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(openExternalUrl).mock.invocationCallOrder[0],
    );
  });

  it("does not open a browser if the native port cannot be bound", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Port in use"));
    await expect(startLinearOAuthFlow("client")).rejects.toThrow("Port in use");
    expect(openExternalUrl).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenLastCalledWith("cancel_oauth_listener", expect.any(Object));
  });

  it("releases the reserved port if browser opening fails", async () => {
    vi.mocked(openExternalUrl).mockResolvedValue(false);
    await expect(
      authorizeInBrowser("https://example.com", "http://127.0.0.1:8888/callback", 8888, "state"),
    ).rejects.toThrow("Could not open your browser");
    expect(invoke).not.toHaveBeenCalledWith("wait_oauth_callback", expect.anything());
    expect(invoke).toHaveBeenLastCalledWith("cancel_oauth_listener", expect.any(Object));
  });

  it.each([startSpotifyOAuthFlow, startLinearOAuthFlow])(
    "rejects tokens returned after cancellation",
    async (startFlow) => {
      const controller = new AbortController();
      vi.mocked(invoke).mockImplementation(async (command) => {
        if (command === "start_oauth_listener") return 8888;
        if (command === "wait_oauth_callback") return { code: "code" };
        if (command.endsWith("exchange_token")) {
          controller.abort();
          return { access_token: "late-token" };
        }
        return undefined;
      });
      await expect(startFlow("client", undefined, undefined, undefined, controller.signal)).rejects.toThrow(
        "cancelled",
      );
    },
  );
});
