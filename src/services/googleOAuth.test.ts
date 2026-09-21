import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildGoogleMcpEnvironment, parseGoogleClientSecretsFile } from "./googleOAuth";

describe("parseGoogleClientSecretsFile", () => {
  it("parses Google Cloud installed (Desktop app) client credentials JSON", () => {
    const json = JSON.stringify({
      installed: {
        client_id: "566025429774-test.apps.googleusercontent.com",
        project_id: "sythoria-desktop",
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://oauth2.googleapis.com/token",
        client_secret: "GOCSPX-installed-secret-12345",
        redirect_uris: ["http://127.0.0.1:54321/oauth/callback", "http://localhost"],
      },
    });

    const parsed = parseGoogleClientSecretsFile(json);
    expect(parsed.clientId).toBe("566025429774-test.apps.googleusercontent.com");
    expect(parsed.clientSecret).toBe("GOCSPX-installed-secret-12345");
    expect(parsed.projectId).toBe("sythoria-desktop");
  });

  it("parses Google Cloud web application client credentials JSON", () => {
    const json = JSON.stringify({
      web: {
        client_id: "566025429774-web.apps.googleusercontent.com",
        project_id: "sythoria-web",
        client_secret: "GOCSPX-web-secret-67890",
        redirect_uris: ["http://127.0.0.1:54321/oauth/callback"],
      },
    });

    const parsed = parseGoogleClientSecretsFile(json);
    expect(parsed.clientId).toBe("566025429774-web.apps.googleusercontent.com");
    expect(parsed.clientSecret).toBe("GOCSPX-web-secret-67890");
    expect(parsed.projectId).toBe("sythoria-web");
  });

  it("handles malformed or invalid JSON gracefully", () => {
    expect(parseGoogleClientSecretsFile("not valid json")).toEqual({});
    expect(parseGoogleClientSecretsFile("{}")).toEqual({
      clientId: undefined,
      clientSecret: undefined,
      projectId: undefined,
    });
  });
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../utils/externalUrl", () => ({ openExternalUrl: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { openExternalUrl } from "../utils/externalUrl";
import { startGoogleOAuthFlow } from "./googleOAuth";

describe("Google OAuth lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "start_google_oauth_listener") return 49152;
      if (command === "wait_google_oauth_callback") return { code: "code" };
      if (command === "google_exchange_token") return { access_token: "token" };
      return undefined;
    });
    vi.mocked(openExternalUrl).mockResolvedValue(true);
  });

  it("binds a listener before opening the browser and uses its port for exchange", async () => {
    await startGoogleOAuthFlow("client", "scope");
    const url = new URL(vi.mocked(openExternalUrl).mock.calls[0][0]);
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:49152/oauth/callback");
    expect(invoke).toHaveBeenCalledWith(
      "google_exchange_token",
      expect.objectContaining({ redirectUri: url.searchParams.get("redirect_uri") }),
    );
    expect(invoke).toHaveBeenLastCalledWith("cancel_google_oauth_listener", expect.any(Object));
  });

  it("releases the listener when the browser fails to open", async () => {
    vi.mocked(openExternalUrl).mockResolvedValue(false);
    await expect(startGoogleOAuthFlow("client", "scope")).rejects.toThrow("Could not open your browser");
    expect(invoke).not.toHaveBeenCalledWith("google_exchange_token", expect.anything());
    expect(invoke).toHaveBeenLastCalledWith("cancel_google_oauth_listener", expect.any(Object));
  });

  it("does not publish tokens if cancelled during exchange", async () => {
    const controller = new AbortController();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "start_google_oauth_listener") return 49152;
      if (command === "wait_google_oauth_callback") return { code: "code" };
      if (command === "google_exchange_token") {
        controller.abort();
        return { access_token: "token" };
      }
      return undefined;
    });
    await expect(startGoogleOAuthFlow("client", "scope", controller.signal)).rejects.toThrow("cancelled");
  });
});

describe("Google server credential contracts", () => {
  const paths = {
    oauthKeysPath: "/grant/keys.json",
    tokenPath: "/grant/tokens.json",
    credentialsPath: "/grant/credentials.json",
  };
  it("configures Gmail with separate client keys and Node credentials", () => {
    expect(buildGoogleMcpEnvironment("gmail", paths)).toEqual({
      GMAIL_OAUTH_PATH: paths.oauthKeysPath,
      GMAIL_CREDENTIALS_PATH: paths.credentialsPath,
    });
  });
  it.each(["google-drive", "google-calendar"])(
    "uses local OAuth without activating service-account mode for %s",
    (id) => {
      expect(buildGoogleMcpEnvironment(id, paths)).toEqual({
        GOOGLE_DRIVE_OAUTH_CREDENTIALS: paths.oauthKeysPath,
        GOOGLE_DRIVE_MCP_TOKEN_PATH: paths.tokenPath,
      });
    },
  );
});
