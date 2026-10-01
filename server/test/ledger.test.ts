import assert from "node:assert/strict";
import test from "node:test";
import { GENESIS_PREV, blockHash, canonicalPayload, verifyChain } from "../src/ledger.ts";
import { MoneyError, applyEntry, emptyState } from "../src/money.ts";

test("canonical payload sorts keys", () => {
  assert.equal(canonicalPayload({ b: 1, a: "x" }), canonicalPayload({ a: "x", b: 1 }));
});

test("each block points at the previous hash", () => {
  const firstPayload = canonicalPayload({ note: "hackstreet-pot" });
  const firstAt = "2026-01-01T00:00:00.000Z";
  const firstHash = blockHash(GENESIS_PREV, "genesis", firstPayload, firstAt);
  const secondPayload = canonicalPayload({ memberId: "a".repeat(32), amountCents: 100 });
  const secondAt = "2026-02-02T08:00:00.000Z";
  const secondHash = blockHash(firstHash, "deposit", secondPayload, secondAt);
  const ok = verifyChain([
    {
      prevHash: GENESIS_PREV,
      hash: firstHash,
      entryType: "genesis",
      payloadCanonical: firstPayload,
      createdAtIso: firstAt,
    },
    {
      prevHash: firstHash,
      hash: secondHash,
      entryType: "deposit",
      payloadCanonical: secondPayload,
      createdAtIso: secondAt,
    },
  ]);
  assert.equal(ok.ok, true);
});

test("a tampered payload breaks the chain", () => {
  const payload = canonicalPayload({ note: "hackstreet-pot" });
  const at = "2026-01-01T00:00:00.000Z";
  const hash = blockHash(GENESIS_PREV, "genesis", payload, at);
  const check = verifyChain([
    {
      prevHash: GENESIS_PREV,
      hash,
      entryType: "genesis",
      payloadCanonical: canonicalPayload({ note: "tampered" }),
      createdAtIso: at,
    },
  ]);
  assert.equal(check.ok, false);
});

test("transfer moves a claim and leaves pot cash alone", () => {
  const from = "a".repeat(32);
  const to = "b".repeat(32);
  let state = emptyState();
  state = applyEntry(state, "genesis", { note: "hackstreet-pot" });
  state.claims[from] = 0;
  state.claims[to] = 0;
  state = applyEntry(state, "deposit", { memberId: from, amountCents: 50_000 });
  state = applyEntry(state, "transfer", { memberId: from, counterpartyId: to, amountCents: 20_000 });
  assert.equal(state.claims[from], 30_000);
  assert.equal(state.claims[to], 20_000);
  assert.equal(state.cashCents, 50_000);
});

test("withdraw fails when cash is invested", () => {
  const member = "c".repeat(32);
  let state = emptyState();
  state.claims[member] = 0;
  state = applyEntry(state, "deposit", { memberId: member, amountCents: 100_000 });
  state = applyEntry(state, "invest", {
    investmentId: "d".repeat(32),
    symbol: "SCOM",
    name: "Safaricom",
    unitsMicro: 10_000_000,
    priceCents: 5_000,
  });
  assert.throws(
    () => applyEntry(state, "withdraw", { memberId: member, amountCents: 80_000 }),
    (error: unknown) => error instanceof MoneyError && error.code === "insufficient_cash",
  );
});

test("a member cannot send more than their claim", () => {
  const from = "e".repeat(32);
  const to = "f".repeat(32);
  let state = emptyState();
  state.claims[from] = 0;
  state.claims[to] = 0;
  state = applyEntry(state, "deposit", { memberId: from, amountCents: 1_000 });
  assert.throws(
    () =>
      applyEntry(state, "transfer", {
        memberId: from,
        counterpartyId: to,
        amountCents: 2_000,
      }),
    (error: unknown) => error instanceof MoneyError && error.code === "insufficient_claim",
  );
});
