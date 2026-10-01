import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_AMOUNT_CENTS,
  MAX_MPESA_CENTS,
  explainShillings,
  formatShillingsTyping,
  parseShillings,
  shillingsToCents,
} from "../src/format.ts";

test("formatShillingsTyping keeps every digit and groups thousands", () => {
  assert.equal(formatShillingsTyping("10000000000"), "10,000,000,000");
  assert.equal(formatShillingsTyping("KES 1,250.5"), "1,250.5");
  assert.equal(formatShillingsTyping("12.345"), "12.34");
});

test("parseShillings accepts any positive figure within the ledger max", () => {
  assert.deepEqual(parseShillings("1,000.50"), { ok: true, cents: 100_050 });
  assert.deepEqual(parseShillings("100,000,000"), { ok: true, cents: MAX_AMOUNT_CENTS });
  assert.deepEqual(parseShillings("250,000"), { ok: true, cents: MAX_MPESA_CENTS });
});

test("parseShillings distinguishes empty, format, and range failures", () => {
  assert.deepEqual(parseShillings(""), { ok: false, reason: "empty" });
  assert.deepEqual(parseShillings("12.345"), { ok: false, reason: "format" });
  assert.deepEqual(parseShillings("10,000,000,000"), { ok: false, reason: "range" });
  assert.deepEqual(parseShillings("100,000,001"), { ok: false, reason: "range" });
});

test("shillingsToCents stays a null-or-cents helper", () => {
  assert.equal(shillingsToCents("10,000,000,000"), null);
  assert.equal(shillingsToCents("1,000"), 100_000);
});

test("explainShillings names KES limits instead of a vague format error", () => {
  assert.equal(explainShillings("10,000,000,000"), "Amount can be at most KES 100,000,000.");
  assert.equal(
    explainShillings("500,000", { maxCents: MAX_MPESA_CENTS, wholeOnly: true }),
    "M-Pesa takes whole shillings, up to KES 250,000.",
  );
  assert.equal(
    explainShillings("100.50", { maxCents: MAX_MPESA_CENTS, wholeOnly: true }),
    "M-Pesa takes whole shillings, up to KES 250,000.",
  );
  assert.equal(explainShillings("1,000.50"), null);
  assert.equal(explainShillings(""), "Enter an amount in KES, up to two decimals.");
});
