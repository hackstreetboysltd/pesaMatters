import assert from "node:assert/strict";
import { createSign, generateKeyPairSync, randomUUID } from "node:crypto";
import test from "node:test";
import {
  GoogleAuthError,
  codeChallenge,
  googleAuthorizeUrl,
  googleCallbackHandoff,
  googleSignInFailure,
  httpDateMs,
  rawQueryParam,
  verificationNowMs,
  verifyGoogleIdToken,
  type RsaJwk,
} from "../src/google.ts";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const exported = publicKey.export({ format: "jwk" });
if (exported.n === undefined || exported.e === undefined) {
  throw new Error("RSA test key is missing modulus or exponent");
}
const jwk: RsaJwk = { kty: "RSA", n: exported.n, e: exported.e, kid: "test-key" };

const clientId = "client.apps.googleusercontent.com";

function signToken(claims: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", kid: "test-key" }): string {
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signer = createSign("RSA-SHA256");
  signer.update(`${encodedHeader}.${encodedPayload}`);
  signer.end();
  const signature = signer.sign(privateKey).toString("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: "https://accounts.google.com",
    aud: clientId,
    sub: randomUUID(),
    email: "kakai@gmail.com",
    email_verified: true,
    name: "Kakai",
    exp: Math.floor(Date.now() / 1000) + 600,
    ...overrides,
  };
}

test("a plus in an OAuth code is not read as a space", () => {
  assert.equal(rawQueryParam("http://127.0.0.1/cb?code=a+b&state=s", "code"), "a+b");
  assert.equal(rawQueryParam("http://127.0.0.1/cb?code=a%2Bb&state=s", "code"), "a+b");
  assert.equal(rawQueryParam("http://127.0.0.1/cb?code=&state=s", "code"), null);
});

test("authorize url carries the S256 challenge and state", () => {
  const url = new URL(googleAuthorizeUrl({
    clientId,
    redirectUri: "http://127.0.0.1:5173/api/auth/google/callback",
    state: "state-1",
    verifier: "verifier-value",
  }));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("state"), "state-1");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge"), codeChallenge("verifier-value"));
  assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:5173/api/auth/google/callback");
});

test("a signed Google ID token becomes a profile", () => {
  const profile = verifyGoogleIdToken(signToken(claims()), { clientId, certs: [jwk] });
  assert.equal(profile.email, "kakai@gmail.com");
  assert.equal(profile.name, "Kakai");
  assert.ok(profile.sub.length > 0);
});

test("the wrong audience is rejected", () => {
  assert.throws(
    () => verifyGoogleIdToken(signToken(claims({ aud: "other-client" })), { clientId, certs: [jwk] }),
    (error: unknown) => error instanceof GoogleAuthError && error.code === "bad_token",
  );
});

test("an unverified email is rejected", () => {
  assert.throws(
    () => verifyGoogleIdToken(signToken(claims({ email_verified: false })), { clientId, certs: [jwk] }),
    (error: unknown) => error instanceof GoogleAuthError && error.code === "unverified_email",
  );
});

test("a fast local clock still accepts a fresh token when Google sends Date", () => {
  const googleNowSec = Math.floor(Date.now() / 1000) - 3 * 60 * 60;
  const profile = verifyGoogleIdToken(
    signToken(claims({ exp: googleNowSec + 60 * 60, iat: googleNowSec, email: "skew@gmail.com" })),
    {
      clientId,
      certs: [jwk],
      googleDate: new Date(googleNowSec * 1000).toUTCString(),
    },
  );
  assert.equal(profile.email, "skew@gmail.com");
});

test("hours past expiry is a clock problem only when Google sends no Date", () => {
  const exp = Math.floor(Date.now() / 1000) - 2 * 60 * 60;
  const iat = exp - 60 * 60;
  assert.throws(
    () => verifyGoogleIdToken(signToken(claims({ exp, iat })), { clientId, certs: [jwk] }),
    (error: unknown) => error instanceof GoogleAuthError && error.code === "clock_skew",
  );
});

test("Google Date wins over a drifted host clock", () => {
  const network = Date.parse("Mon, 21 Sep 2026 08:26:55 GMT");
  assert.equal(httpDateMs("Mon, 21 Sep 2026 08:26:55 GMT"), network);
  assert.equal(httpDateMs(null), null);
  assert.equal(httpDateMs("not-a-date"), null);
  assert.deepEqual(verificationNowMs(network + 3 * 3600 * 1000, network), {
    nowMs: network,
    clockSkewMs: 3 * 3600 * 1000,
  });
  assert.deepEqual(verificationNowMs(network, null), { nowMs: network, clockSkewMs: 0 });
});

test("a few minutes past expiry is a bad token, not a clock problem", () => {
  const exp = Math.floor(Date.now() / 1000) - 5 * 60;
  const iat = exp - 60 * 60;
  assert.throws(
    () => verifyGoogleIdToken(signToken(claims({ exp, iat })), { clientId, certs: [jwk] }),
    (error: unknown) => error instanceof GoogleAuthError && error.code === "bad_token",
  );
});

test("exchange failures keep Google's codes off the login page", () => {
  assert.equal(googleSignInFailure(new GoogleAuthError("clock_skew")), "google_clock");
  assert.equal(googleSignInFailure(new GoogleAuthError("bad_token", "network")), "google_network");
  assert.equal(googleSignInFailure(new GoogleAuthError("bad_token", "invalid_grant")), "google");
  assert.equal(googleSignInFailure(new GoogleAuthError("bad_token", "invalid_client")), "google_client");
  assert.equal(googleSignInFailure(new GoogleAuthError("unverified_email")), "email_unverified");
  assert.equal(googleSignInFailure(new Error("database down")), null);
});

test("an expired token is rejected", () => {
  assert.throws(
    () =>
      verifyGoogleIdToken(signToken(claims({ exp: Math.floor(Date.now() / 1000) - 120 })), {
        clientId,
        certs: [jwk],
      }),
    (error: unknown) => error instanceof GoogleAuthError && error.code === "bad_token",
  );
});

test("a Google callback with no cookies still hands the code to the login page", () => {
  const state = "a".repeat(64);
  const url = new URL(
    googleCallbackHandoff({
      error: null,
      code: "abc+defghi",
      state,
      clientOrigin: "http://127.0.0.1:5173",
    }),
  );
  assert.equal(url.origin, "http://127.0.0.1:5173");
  assert.equal(url.pathname, "/login");
  assert.equal(url.searchParams.get("code"), "abc+defghi");
  assert.equal(url.searchParams.get("state"), state);
  assert.equal(url.searchParams.get("error"), null);
});

test("a cancelled Google callback becomes google_denied, and any other provider error stays generic", () => {
  const denied = new URL(
    googleCallbackHandoff({
      error: "access_denied",
      code: null,
      state: null,
      clientOrigin: "http://127.0.0.1:5173",
    }),
  );
  assert.equal(denied.searchParams.get("error"), "google_denied");
  assert.equal(denied.searchParams.get("code"), null);
  const other = new URL(
    googleCallbackHandoff({
      error: "server_error",
      code: null,
      state: null,
      clientOrigin: "http://127.0.0.1:5173",
    }),
  );
  assert.equal(other.searchParams.get("error"), "google");
  assert.equal(other.searchParams.has("error_description"), false);
});

test("a callback missing the code or a long state does not start a session", () => {
  const url = new URL(
    googleCallbackHandoff({
      error: null,
      code: "short",
      state: "tiny",
      clientOrigin: "http://127.0.0.1:5173",
    }),
  );
  assert.equal(url.searchParams.get("error"), "google_state");
  assert.equal(url.searchParams.get("code"), null);
});

test("alg none is rejected", () => {
  const encodedHeader = Buffer.from(JSON.stringify({ alg: "none", kid: "test-key" })).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(claims())).toString("base64url");
  assert.throws(
    () => verifyGoogleIdToken(`${encodedHeader}.${encodedPayload}.`, { clientId, certs: [jwk] }),
    (error: unknown) => error instanceof GoogleAuthError && error.code === "bad_token",
  );
});
