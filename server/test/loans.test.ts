import assert from "node:assert/strict";
import test from "node:test";
import { coverMismatch, freeDepositsCents, payoutCents, refuseBorrow, refuseGuarantee } from "../src/loans/capacity.ts";
import { gate, guaranteesMet, statusAfterSubmit } from "../src/loans/status.ts";

test("free deposits subtract loans and pledged guarantees", () => {
  assert.equal(freeDepositsCents(100_000, 0, 0), 100_000);
  assert.equal(freeDepositsCents(100_000, 40_000, 0), 60_000);
  assert.equal(freeDepositsCents(100_000, 40_000, 30_000), 30_000);
  assert.equal(freeDepositsCents(100_000, 70_000, 50_000), 0);
});

test("a member cannot borrow more than free deposits", () => {
  const free = freeDepositsCents(80_000, 0, 0);
  assert.equal(refuseBorrow({ amountCents: 80_000, freeCents: free, minimumCents: 1_000, maximumCents: 200_000 }), null);
  assert.equal(
    refuseBorrow({ amountCents: 80_001, freeCents: free, minimumCents: 1_000, maximumCents: 200_000 }),
    "above_free",
  );
});

test("a product ceiling still applies under the deposit cap", () => {
  assert.equal(
    refuseBorrow({ amountCents: 150_000, freeCents: 500_000, minimumCents: 1_000, maximumCents: 100_000 }),
    "above_product",
  );
  assert.equal(
    refuseBorrow({ amountCents: 500, freeCents: 500_000, minimumCents: 1_000, maximumCents: 100_000 }),
    "below_minimum",
  );
});

test("the borrower can guarantee their own loan up to free deposits", () => {
  assert.equal(
    refuseGuarantee({ borrowerId: "a", guarantorId: "a", amountCents: 1_000, guarantorFreeCents: 1_000 }),
    null,
  );
  assert.equal(
    refuseGuarantee({ borrowerId: "a", guarantorId: "a", amountCents: 1_001, guarantorFreeCents: 1_000 }),
    "above_free",
  );
});

test("guarantees have to add up to the loan", () => {
  assert.equal(coverMismatch(10_000, [10_000]), null);
  assert.equal(coverMismatch(10_000, [6_000, 4_000]), null);
  assert.equal(coverMismatch(10_000, [6_000]), "short");
  assert.equal(coverMismatch(10_000, [6_000, 5_000]), "over");
});

test("a second pledge cannot use deposits already promised", () => {
  const afterFirst = freeDepositsCents(100_000, 0, 60_000);
  assert.equal(
    refuseGuarantee({ borrowerId: "borrower", guarantorId: "guarantor", amountCents: 50_000, guarantorFreeCents: afterFirst }),
    "above_free",
  );
  assert.equal(
    refuseGuarantee({ borrowerId: "borrower", guarantorId: "guarantor", amountCents: 40_000, guarantorFreeCents: afterFirst }),
    null,
  );
});

test("a guarantee shrinks what that member can borrow", () => {
  const free = freeDepositsCents(100_000, 0, 40_000);
  assert.equal(refuseBorrow({ amountCents: 70_000, freeCents: free, minimumCents: 1_000, maximumCents: 9_000_000 }), "above_free");
  assert.equal(refuseBorrow({ amountCents: 60_000, freeCents: free, minimumCents: 1_000, maximumCents: 9_000_000 }), null);
});

test("appraisal waits until required guarantees are in", () => {
  assert.equal(gate("appraise", "awaiting_guarantors", false), "not_ready");
  assert.equal(gate("appraise", "under_appraisal", false), "not_ready");
  assert.equal(gate("appraise", "under_appraisal", true), null);
  assert.equal(gate("decide", "under_appraisal", true), "not_ready");
  assert.equal(gate("decide", "awaiting_approval", true), null);
  assert.equal(gate("disburse", "awaiting_approval", true), "not_ready");
  assert.equal(gate("disburse", "approved", true), null);
});

test("submit parks on guarantors until cover is accepted", () => {
  assert.equal(statusAfterSubmit({ invites: 2, guaranteesMet: false }), "awaiting_guarantors");
  assert.equal(statusAfterSubmit({ invites: 1, guaranteesMet: true }), "awaiting_guarantors");
  assert.equal(statusAfterSubmit({ invites: 0, guaranteesMet: true }), "under_appraisal");
  assert.equal(
    guaranteesMet({
      minimumGuarantors: 2,
      coveragePercent: 100,
      requestedCents: 10_000,
      acceptedCount: 2,
      acceptedCents: 10_000,
    }),
    true,
  );
  assert.equal(
    guaranteesMet({
      minimumGuarantors: 2,
      coveragePercent: 100,
      requestedCents: 10_000,
      acceptedCount: 1,
      acceptedCents: 10_000,
    }),
    false,
  );
});

test("the fee comes off the payout in whole shillings", () => {
  assert.deepEqual(payoutCents(100_000, 0), { feeCents: 0, netCents: 100_000 });
  assert.deepEqual(payoutCents(100_000, 1), { feeCents: 1_000, netCents: 99_000 });
});
