import assert from "node:assert/strict";
import { test } from "node:test";
import { repaymentCents } from "../src/repayment.ts";

test("adds the product rate once for the whole term", () => {
  assert.equal(repaymentCents(100_000, 2), 102_000);
  assert.equal(repaymentCents(100_000, 5), 105_000);
  assert.equal(repaymentCents(100_000, 7), 107_000);
  assert.equal(repaymentCents(500_000, 15), 575_000);
});

test("rounds a fractional cent of interest to the nearest cent", () => {
  assert.equal(repaymentCents(101, 2), 103);
});

test("rejects a missing principal or a rate outside 0 to 100", () => {
  assert.equal(repaymentCents(0, 2), null);
  assert.equal(repaymentCents(-100, 2), null);
  assert.equal(repaymentCents(100, 2.5), null);
  assert.equal(repaymentCents(100, -1), null);
  assert.equal(repaymentCents(100, 101), null);
});
