import { api, ApiError } from "../api";
import { safeReturnTo } from "../returnTo";

const PENDING_KEY = "pesamatters.oauth";
const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";

export type GooglePending = {
  state: string;
  verifier: string;
  returnTo: string;
};

const completingKeys = new Set<string>();

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** RFC 7636 S256 challenge for a PKCE verifier. */
export async function s256Challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

export async function newPkce(): Promise<{ state: string; verifier: string; challenge: string }> {
  const verifier = b64url(randomBytes(32));
  const state = Array.from(randomBytes(32), (b) => b.toString(16).padStart(2, "0")).join("");
  return { state, verifier, challenge: await s256Challenge(verifier) };
}

export function googleAuthorizationUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  const url = new URL(GOOGLE_AUTH);
  url.searchParams.set("client_id", opts.clientId);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", opts.state);
  url.searchParams.set("prompt", "select_account");
  url.searchParams.set("code_challenge", opts.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

/** True when this mount may finish the handoff. A remount of the same code must not exchange it twice. */
export function claimOauthCompletion(state: string, code: string): boolean {
  const key = `${state}:${code.length}`;
  if (completingKeys.has(key)) return false;
  completingKeys.add(key);
  return true;
}

export function storeGooglePending(pending: GooglePending): boolean {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    return true;
  } catch {
    return false;
  }
}

export function readGooglePending(): GooglePending | null {
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "");
    if (raw === null || typeof raw !== "object") return null;
    const rec = raw as Record<string, unknown>;
    const state = rec["state"];
    const verifier = rec["verifier"];
    const returnTo = rec["returnTo"];
    if (typeof state !== "string" || state.length < 32 || state.length > 256) return null;
    if (typeof verifier !== "string" || verifier.length < 43 || verifier.length > 128) return null;
    return {
      state,
      verifier,
      returnTo: safeReturnTo(typeof returnTo === "string" ? returnTo : null),
    };
  } catch {
    return null;
  }
}

export function clearGooglePending(): void {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* private mode */
  }
}

/** True when the URL still carries an OAuth code handoff. Boot must not leave `/login` yet. */
export function hasOauthHandoffParams(search: string): boolean {
  const params = new URLSearchParams(search);
  const code = params.get("code");
  const state = params.get("state");
  return code !== null && code.length > 0 && state !== null && state.length > 0;
}

export function pendingMatches(pending: GooglePending, state: string): boolean {
  return pending.state.length === state.length && pending.state === state;
}

/** Full-page navigation to Google. Isolated so a test can stub it. */
export function leaveForGoogle(url: string): void {
  window.location.assign(url);
}

/**
 * Starts Google sign-in. The verifier stays in sessionStorage for this tab.
 * Google later redirects to the API, which only hands `code` and `state` back to `/login`.
 */
export async function beginGoogleSignIn(returnTo: string): Promise<void> {
  const cfg = await api.googleConfig();
  if (!cfg.enabled || cfg.clientId === undefined || cfg.redirectUri === undefined || cfg.clientId.length === 0) {
    throw new ApiError(503, "google_off", "Google sign-in needs a client id and secret in the server environment.");
  }
  const pkce = await newPkce();
  const stored = storeGooglePending({
    state: pkce.state,
    verifier: pkce.verifier,
    returnTo: safeReturnTo(returnTo),
  });
  if (!stored) {
    throw new ApiError(400, "google_state", "That sign-in expired. Try Continue with Google again.");
  }
  leaveForGoogle(
    googleAuthorizationUrl({
      clientId: cfg.clientId,
      redirectUri: cfg.redirectUri,
      state: pkce.state,
      challenge: pkce.challenge,
    }),
  );
}
