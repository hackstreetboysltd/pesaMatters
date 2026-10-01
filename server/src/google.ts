import { createHash, createPublicKey, createVerify, type JsonWebKey as CryptoJsonWebKey } from "node:crypto";
import { log } from "./logger.ts";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_CERTS = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const SKEW_MS = 60_000;
/** Log when the host clock disagrees with Google by more than this. Sign-in still uses Google's Date. */
const CLOCK_WARN_MS = 120_000;

/** Parses an HTTP Date header to epoch ms. Invalid values return null. */
export function httpDateMs(header: string | null | undefined): number | null {
  if (header === null || header === undefined || header.length === 0) return null;
  const ms = Date.parse(header);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Prefer Google's response Date over the local clock for JWT time checks.
 * A drifted host clock otherwise rejects a freshly issued id_token.
 */
export function verificationNowMs(
  localMs: number,
  networkMs: number | null,
): { nowMs: number; clockSkewMs: number } {
  if (networkMs === null) {
    return { nowMs: localMs, clockSkewMs: 0 };
  }
  return { nowMs: networkMs, clockSkewMs: localMs - networkMs };
}

export type GoogleProfile = {
  sub: string;
  email: string;
  name: string;
};

export type RsaJwk = {
  kty: "RSA";
  n: string;
  e: string;
  kid?: string;
};

export class GoogleAuthError extends Error {
  readonly code: "bad_token" | "unverified_email" | "clock_skew";
  /** Short OAuth error code from Google, such as invalid_grant. Never a token or secret. */
  readonly oauthError: string | null;

  constructor(code: "bad_token" | "unverified_email" | "clock_skew", oauthError: string | null = null) {
    super(code);
    this.name = "GoogleAuthError";
    this.code = code;
    this.oauthError = oauthError;
  }
}

/**
 * Read one query parameter from a raw URL.
 * A literal "+" stays "+", because OAuth codes are not form bodies.
 */
export function rawQueryParam(url: string, name: string): string | null {
  const queryIndex = url.indexOf("?");
  if (queryIndex === -1) return null;
  const query = url.slice(queryIndex + 1).split("#")[0] ?? "";
  for (const part of query.split("&")) {
    if (part.length === 0) continue;
    const eq = part.indexOf("=");
    const rawKey = eq === -1 ? part : part.slice(0, eq);
    const rawValue = eq === -1 ? "" : part.slice(eq + 1);
    let key: string;
    let value: string;
    try {
      key = decodeQueryComponent(rawKey);
      value = decodeQueryComponent(rawValue);
    } catch {
      continue;
    }
    if (key === name && value.length > 0 && value.length <= 8192) return value;
  }
  return null;
}

function decodeQueryComponent(raw: string): string {
  return decodeURIComponent(raw.replace(/\+/g, "%2B"));
}

/** S256 PKCE challenge for a verifier the browser never sees. */
export function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Turns Google's GET callback into a same-origin `/login` handoff.
 * The SPA finishes PKCE from sessionStorage, so the verifier never sits in a
 * cookie that bounce-tracking can strip on the 302 to Google.
 * `code` and `state` must already be read with `rawQueryParam` so a "+" stays "+".
 */
export function googleCallbackHandoff(input: {
  error: string | null;
  code: string | null;
  state: string | null;
  clientOrigin: string;
}): string {
  const login = new URL("/login", input.clientOrigin);
  if (input.error !== null && input.error.length > 0) {
    login.searchParams.set("error", googleProviderErrorCode(input.error));
    return login.toString();
  }
  const code = input.code ?? "";
  const state = input.state ?? "";
  if (code.length < 8 || code.length > 8192 || state.length < 32 || state.length > 256) {
    login.searchParams.set("error", "google_state");
    return login.toString();
  }
  login.searchParams.set("code", code);
  login.searchParams.set("state", state);
  return login.toString();
}

/** Maps Google's OAuth `error` query to an allowlisted app code. Never echoes the raw value. */
export function googleProviderErrorCode(providerError: string): "google" | "google_denied" {
  if (providerError === "access_denied") return "google_denied";
  return "google";
}

/**
 * Maps a failed code exchange to an allowlisted sign-in code.
 * Returns null for failures that are not Google's (the caller should surface those as a server error).
 */
export function googleSignInFailure(error: unknown): string | null {
  if (error instanceof GoogleAuthError) {
    if (error.code === "unverified_email") return "email_unverified";
    if (error.code === "clock_skew") return "google_clock";
    if (error.oauthError === "invalid_client") return "google_client";
    if (error.oauthError === "redirect_uri_mismatch") return "google_redirect";
    if (error.oauthError === "network") return "google_network";
    return "google";
  }
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError" || error.name === "TypeError")) {
    return "google_network";
  }
  return null;
}

/** Authorization URL for the Google sign-in redirect. */
export function googleAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  verifier: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: input.state,
    code_challenge: codeChallenge(input.verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `${GOOGLE_AUTH}?${params.toString()}`;
}

export type LoadedGoogleCerts = {
  certs: RsaJwk[];
  /** Google's Date header, used so expiry does not follow this machine's clock. */
  date: string | null;
};

/** Google's current RSA signing keys for ID tokens. */
export async function loadGoogleCerts(fetchImpl: typeof fetch = fetch): Promise<LoadedGoogleCerts> {
  let response: Response;
  try {
    response = await fetchImpl(GOOGLE_CERTS, { signal: AbortSignal.timeout(8000) });
  } catch {
    throw new GoogleAuthError("bad_token", "network");
  }
  if (!response.ok) {
    throw new GoogleAuthError("bad_token");
  }
  const body: unknown = await response.json();
  if (body === null || typeof body !== "object" || !("keys" in body) || !Array.isArray(body.keys)) {
    throw new GoogleAuthError("bad_token");
  }
  return { certs: body.keys.filter(isRsaJwk), date: response.headers.get("date") };
}

/**
 * Exchange an authorization code and return the verified profile.
 * The ID token is checked here; the access token is not trusted on its own.
 */
export async function exchangeGoogleCode(
  input: {
    code: string;
    verifier: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    certs: RsaJwk[];
    now?: Date;
    /** Date header from Google's certs response, used if the token response has none. */
    googleDate?: string | null;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleProfile> {
  const body = new URLSearchParams({
    code: input.code,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
    code_verifier: input.verifier,
  });
  let response: Response;
  try {
    response = await fetchImpl(GOOGLE_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new GoogleAuthError("bad_token", "network");
  }
  if (!response.ok) {
    throw new GoogleAuthError("bad_token", await oauthErrorCode(response));
  }
  const payload: unknown = await response.json();
  const idToken =
    payload !== null && typeof payload === "object" && "id_token" in payload && typeof payload.id_token === "string"
      ? payload.id_token
      : null;
  if (idToken === null) {
    throw new GoogleAuthError("bad_token");
  }
  return verifyGoogleIdToken(idToken, {
    clientId: input.clientId,
    certs: input.certs,
    googleDate: response.headers.get("date") ?? input.googleDate ?? null,
    ...(input.now !== undefined ? { now: input.now } : {}),
  });
}

/** Verify a Google ID token against the supplied certs and this app's client id. */
export function verifyGoogleIdToken(
  token: string,
  input: { clientId: string; certs: RsaJwk[]; now?: Date; googleDate?: string | null },
): GoogleProfile {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new GoogleAuthError("bad_token");
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  if (encodedHeader === undefined || encodedPayload === undefined || encodedSignature === undefined) {
    throw new GoogleAuthError("bad_token");
  }
  const header = parseJson(encodedHeader);
  if (header === null || header["alg"] !== "RS256" || typeof header["kid"] !== "string") {
    throw new GoogleAuthError("bad_token");
  }
  const cert = input.certs.find((item) => item.kid === header["kid"]);
  if (cert === undefined || !signatureMatches(encodedHeader, encodedPayload, encodedSignature, cert)) {
    throw new GoogleAuthError("bad_token");
  }
  const claims = parseJson(encodedPayload);
  if (claims === null) {
    throw new GoogleAuthError("bad_token");
  }
  const localMs = (input.now ?? new Date()).getTime();
  const { nowMs, clockSkewMs } = verificationNowMs(localMs, httpDateMs(input.googleDate));
  if (Math.abs(clockSkewMs) > CLOCK_WARN_MS) {
    log.warn("google_clock_skew", { skew_sec: Math.round(clockSkewMs / 1000) });
  }
  return profileFromClaims(claims, input.clientId, nowMs, localMs);
}

function signatureMatches(header: string, payload: string, signature: string, cert: RsaJwk): boolean {
  try {
    const jwk: CryptoJsonWebKey = { kty: cert.kty, n: cert.n, e: cert.e };
    if (cert.kid !== undefined) jwk["kid"] = cert.kid;
    const key = createPublicKey({ key: jwk, format: "jwk" });
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${header}.${payload}`);
    verifier.end();
    return verifier.verify(key, Buffer.from(signature, "base64url"));
  } catch {
    return false;
  }
}

function profileFromClaims(
  claims: Record<string, unknown>,
  clientId: string,
  verifyMs: number,
  localMs: number,
): GoogleProfile {
  const iss = claims["iss"];
  if (typeof iss !== "string" || !ISSUERS.has(iss)) {
    throw new GoogleAuthError("bad_token");
  }
  const aud = claims["aud"];
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (!audiences.includes(clientId)) {
    throw new GoogleAuthError("bad_token");
  }
  const azp = claims["azp"];
  if (azp !== undefined && azp !== clientId) {
    throw new GoogleAuthError("bad_token");
  }
  const exp = claims["exp"];
  if (typeof exp !== "number" || !Number.isFinite(exp)) {
    throw new GoogleAuthError("bad_token");
  }
  const expMs = exp * 1000;
  if (expMs <= verifyMs - SKEW_MS) {
    const iat = claims["iat"];
    const lifetimeMs = typeof iat === "number" ? (exp - iat) * 1000 : 0;
    const expiredByMs = verifyMs - expMs;
    // Only when Google sent no Date. A 1h token that looks hours expired is this machine's clock, not a waited-out login.
    if (
      verifyMs === localMs &&
      expiredByMs > 30 * 60 * 1000 &&
      lifetimeMs >= 15 * 60 * 1000 &&
      lifetimeMs <= 2 * 60 * 60 * 1000
    ) {
      throw new GoogleAuthError("clock_skew");
    }
    throw new GoogleAuthError("bad_token");
  }
  if (claims["email_verified"] !== true) {
    throw new GoogleAuthError("unverified_email");
  }
  const email = claims["email"];
  const sub = claims["sub"];
  if (typeof email !== "string" || typeof sub !== "string" || !email.includes("@") || sub.length < 1 || sub.length > 255) {
    throw new GoogleAuthError("bad_token");
  }
  const normalized = email.trim().toLowerCase();
  if (normalized.length > 254) {
    throw new GoogleAuthError("bad_token");
  }
  return { sub, email: normalized, name: displayName(claims["name"], normalized) };
}

function displayName(raw: unknown, email: string): string {
  const source = typeof raw === "string" && raw.trim().length > 0 ? raw : (email.split("@")[0] ?? "Member");
  const cleaned = source.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, 80);
  return cleaned.length > 0 ? cleaned : "Member";
}

function parseJson(encoded: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function oauthErrorCode(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (body === null || typeof body !== "object" || !("error" in body) || typeof body.error !== "string") {
      return null;
    }
    return /^[a-z0-9_]{1,40}$/.test(body.error) ? body.error : null;
  } catch {
    return null;
  }
}

function isRsaJwk(value: unknown): value is RsaJwk {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record["kty"] === "RSA" && typeof record["n"] === "string" && typeof record["e"] === "string";
}
