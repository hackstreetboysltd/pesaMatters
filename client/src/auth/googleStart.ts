import { api, ApiError } from "../api";
import { safeAdminReturnTo, safeReturnTo } from "../returnTo";

const PENDING_KEY = "pesamatters.oauth";
const ADMIN_PENDING_KEY = "pesamatters.admin.oauth";
/** Must match server `ADMIN_OAUTH_STATE_PREFIX` so the shared Google callback hands off to /admin/login. */
const ADMIN_OAUTH_STATE_PREFIX = "a.";
const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";

export type GooglePending = {
  state: string;
  verifier: string;
  returnTo: string;
};

export type GoogleConfigPayload = {
  enabled: boolean;
  clientId?: string;
  redirectUri?: string;
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

export async function newPkce(statePrefix = ""): Promise<{ state: string; verifier: string; challenge: string }> {
  const verifier = b64url(randomBytes(32));
  const nonce = Array.from(randomBytes(32), (b) => b.toString(16).padStart(2, "0")).join("");
  const state = `${statePrefix}${nonce}`;
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

function storePending(key: string, pending: GooglePending): boolean {
  try {
    sessionStorage.setItem(key, JSON.stringify(pending));
    return true;
  } catch {
    return false;
  }
}

function readPending(key: string, sanitize: (raw: string | null) => string): GooglePending | null {
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(key) ?? "");
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
      returnTo: sanitize(typeof returnTo === "string" ? returnTo : null),
    };
  } catch {
    return null;
  }
}

function clearPending(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* private mode */
  }
}

export function storeGooglePending(pending: GooglePending): boolean {
  return storePending(PENDING_KEY, pending);
}

export function readGooglePending(): GooglePending | null {
  return readPending(PENDING_KEY, (raw) => safeReturnTo(raw));
}

export function clearGooglePending(): void {
  clearPending(PENDING_KEY);
}

export function storeAdminGooglePending(pending: GooglePending): boolean {
  return storePending(ADMIN_PENDING_KEY, pending);
}

export function readAdminGooglePending(): GooglePending | null {
  return readPending(ADMIN_PENDING_KEY, (raw) => safeAdminReturnTo(raw));
}

export function clearAdminGooglePending(): void {
  clearPending(ADMIN_PENDING_KEY);
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

async function beginSignIn(opts: {
  returnTo: string;
  sanitize: (raw: string) => string;
  store: (pending: GooglePending) => boolean;
  loadConfig: () => Promise<GoogleConfigPayload>;
  statePrefix?: string;
}): Promise<void> {
  const cfg = await opts.loadConfig();
  if (!cfg.enabled || cfg.clientId === undefined || cfg.redirectUri === undefined || cfg.clientId.length === 0) {
    throw new ApiError(503, "google_off", "Google sign-in needs a client id and secret in the server environment.");
  }
  const pkce = await newPkce(opts.statePrefix ?? "");
  const stored = opts.store({
    state: pkce.state,
    verifier: pkce.verifier,
    returnTo: opts.sanitize(opts.returnTo),
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

/**
 * Starts Google sign-in. The verifier stays in sessionStorage for this tab.
 * Google later redirects to the API, which only hands `code` and `state` back to `/login`.
 */
export async function beginGoogleSignIn(returnTo: string): Promise<void> {
  await beginSignIn({
    returnTo,
    sanitize: (raw) => safeReturnTo(raw),
    store: storeGooglePending,
    loadConfig: () => api.googleConfig(),
  });
}

/** Admin portal Google sign-in. Shared redirect URI; state prefix routes handoff to `/admin/login`. */
export async function beginAdminGoogleSignIn(
  returnTo: string,
  loadConfig: () => Promise<GoogleConfigPayload>,
): Promise<void> {
  await beginSignIn({
    returnTo,
    sanitize: (raw) => safeAdminReturnTo(raw),
    store: storeAdminGooglePending,
    loadConfig,
    statePrefix: ADMIN_OAUTH_STATE_PREFIX,
  });
}
