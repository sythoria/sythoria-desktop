import { invoke } from "@tauri-apps/api/core";
import { openExternalUrl } from "../utils/externalUrl";

export const DEFAULT_GOOGLE_CLIENT_ID = "566025429774-vh5b4ie4edatstbismtj0d5ku233ndlk.apps.googleusercontent.com";
export const DEFAULT_GOOGLE_SCOPES =
  "openid email profile https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.readonly";
export const DEFAULT_GOOGLE_PORT = 54321;
export const DEFAULT_GOOGLE_REDIRECT_URI = `http://127.0.0.1:${DEFAULT_GOOGLE_PORT}/oauth/callback`;

export interface GoogleTokenResult {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

function generateRandomString(length: number): string {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => possible[b % possible.length])
    .join("");
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Initiates the 1-Click Google OAuth 2.0 PKCE Flow.
 * 1. Generates PKCE code_verifier and code_challenge.
 * 2. Starts a local loopback listener on port 54321.
 * 3. Opens the user's browser to Google authorization consent page.
 * 4. Captures authorization code on loopback redirect.
 * 5. Exchanges code for Google OAuth access and refresh tokens.
 */
export interface GoogleOAuthResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scope?: string;
}

export async function startGoogleOAuthFlow(
  clientId: string = DEFAULT_GOOGLE_CLIENT_ID,
  scope: string = DEFAULT_GOOGLE_SCOPES,
  redirectUri: string = DEFAULT_GOOGLE_REDIRECT_URI,
  port: number = DEFAULT_GOOGLE_PORT,
  signal?: AbortSignal,
): Promise<GoogleOAuthResult> {
  const codeVerifier = generateRandomString(64);
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = generateRandomString(32);

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(
    clientId,
  )}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(
    scope,
  )}&access_type=offline&prompt=consent&state=${encodeURIComponent(
    state,
  )}&code_challenge=${encodeURIComponent(codeChallenge)}&code_challenge_method=S256`;

  // Start background loopback listener
  const listenerPromise = invoke<{ code: string; state?: string }>("listen_oauth_callback", {
    port,
    expectedState: state,
  });

  // Open user's default browser to Google
  await openExternalUrl(authUrl);

  // Wait for callback or abort signal
  const callbackResult = await Promise.race([
    listenerPromise,
    new Promise<{ code: string; state?: string }>((_, reject) => {
      if (signal) {
        signal.addEventListener("abort", () => reject(new Error("Google authorization was cancelled.")), {
          once: true,
        });
      }
    }),
  ]);

  if (!callbackResult.code) {
    throw new Error("No authorization code received from Google callback.");
  }

  // Exchange code + codeVerifier for access_token
  const tokenResult = await invoke<GoogleTokenResult>("google_exchange_token", {
    clientId,
    code: callbackResult.code,
    codeVerifier,
    redirectUri,
  });

  if (tokenResult.error) {
    throw new Error(tokenResult.error_description || tokenResult.error || "Failed to exchange token with Google.");
  }

  if (!tokenResult.access_token) {
    throw new Error("No access token returned from Google OAuth exchange.");
  }

  return {
    accessToken: tokenResult.access_token,
    refreshToken: tokenResult.refresh_token,
    expiresIn: tokenResult.expires_in,
    scope: tokenResult.scope,
  };
}

export interface GoogleMcpTokenPaths {
  oauthKeysPath: string;
  tokenPath: string;
  credentialsPath: string;
}

export async function saveGoogleMcpTokens(
  clientId: string,
  accessToken: string,
  refreshToken?: string,
  expiresIn?: number,
  scope?: string,
): Promise<GoogleMcpTokenPaths> {
  return invoke<GoogleMcpTokenPaths>("save_google_mcp_tokens", {
    clientId,
    accessToken,
    refreshToken,
    expiresIn,
    scope,
  });
}
