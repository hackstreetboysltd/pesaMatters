import assert from "node:assert/strict";
import test from "node:test";
import { applyEntry, emptyState, MoneyError } from "../src/money.ts";
import { assertProductShape, ProductError, type ProductInput } from "../src/loans/products.ts";

const valid: ProductInput = {
  code: "TEST1W",
  name: "Test week",
  interestPercent: 3,
  termMin: 1,
  termMax: 2,
  termUnit: "weeks",
  minimumCents: 100_000,
  maximumCents: 5_000_000,
  minimumGuarantors: 0,
  coveragePercent: 0,
  feePercent: 0,
};

test("assertProductShape accepts a well-formed product", () => {
  assert.doesNotThrow(() => assertProductShape(valid));
});

test("assertProductShape rejects a bad code", () => {
  assert.throws(
    () => assertProductShape({ ...valid, code: "bad" }),
    (error: unknown) => error instanceof ProductError && error.code === "bad_code",
  );
});

test("assertProductShape rejects an inverted term range", () => {
  assert.throws(
    () => assertProductShape({ ...valid, termMin: 4, termMax: 2 }),
    (error: unknown) => error instanceof ProductError && error.code === "bad_term",
  );
});

test("assertProductShape rejects maximum below minimum", () => {
  assert.throws(
    () => assertProductShape({ ...valid, minimumCents: 500_000, maximumCents: 100_000 }),
    (error: unknown) => error instanceof ProductError && error.code === "bad_amount",
  );
});

test("invest buy fails when pot cash is short", () => {
  const state = emptyState();
  assert.throws(
    () =>
      applyEntry(state, "invest", {
        investmentId: "a".repeat(32),
        symbol: "SCOM",
        name: "Safaricom",
        unitsMicro: 10_000_000,
        priceCents: 5_000,
      }),
    (error: unknown) => error instanceof MoneyError && error.code === "insufficient_cash",
  );
});

test("invest buy lands when cash covers the close", () => {
  let state = emptyState();
  const member = "b".repeat(32);
  state.claims[member] = 0;
  state = applyEntry(state, "deposit", { memberId: member, amountCents: 100_000 });
  state = applyEntry(state, "invest", {
    investmentId: "c".repeat(32),
    symbol: "SCOM",
    name: "Safaricom",
    unitsMicro: 10_000_000,
    priceCents: 5_000,
  });
  assert.equal(state.cashCents, 50_000);
  assert.equal(Object.keys(state.positions).length, 1);
});
