import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.ts";

function baseEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: "postgres://pesamatters:secret@127.0.0.1:5433/pesamatters",
    APP_ORIGIN: "http://127.0.0.1:5173",
    COOKIE_SECURE: "false",
    MPESA_MODE: "mock",
    ...overrides,
  };
}

function liveEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return baseEnv({
    MPESA_MODE: "live",
    MPESA_ENV: "production",
    MPESA_CONSUMER_KEY: "consumer-key-value",
    MPESA_CONSUMER_SECRET: "consumer-secret-value",
    MPESA_SHORTCODE: "400200",
    MPESA_ACCOUNT_NUMBER: "0123456789",
    MPESA_PASSKEY: "passkey-value-here",
    MPESA_CALLBACK_URL: "https://example.vercel.app/api/payments/mpesa/stk",
    ...overrides,
  });
}

test("mock mode ignores missing Daraja credentials", () => {
  const config = loadConfig(baseEnv());
  assert.equal(config.mpesa.mode, "mock");
});

test("live mode requires paybill shortcode and account number", () => {
  const config = loadConfig(liveEnv());
  assert.equal(config.mpesa.mode, "live");
  if (config.mpesa.mode !== "live") throw new Error("expected live");
  assert.equal(config.mpesa.shortcode, "400200");
  assert.equal(config.mpesa.accountNumber, "0123456789");
  assert.equal(config.mpesa.b2c, null);
});

test("live mode rejects a missing account number", () => {
  assert.throws(
    () => loadConfig(liveEnv({ MPESA_ACCOUNT_NUMBER: undefined })),
    /Invalid configuration: MPESA_CONSUMER_KEY/,
  );
});

test("live mode rejects an account number longer than twelve characters", () => {
  assert.throws(
    () => loadConfig(liveEnv({ MPESA_ACCOUNT_NUMBER: "1234567890123" })),
    /Invalid configuration: MPESA_ACCOUNT_NUMBER/,
  );
});

test("live mode rejects a non-https STK callback", () => {
  assert.throws(
    () => loadConfig(liveEnv({ MPESA_CALLBACK_URL: "http://example.com/api/payments/mpesa/stk" })),
    /Invalid configuration: MPESA_CALLBACK_URL/,
  );
});
