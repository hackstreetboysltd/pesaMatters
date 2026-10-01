import { createHash } from "node:crypto";

/** Previous-hash of the first block. Not a real block hash. */
export const GENESIS_PREV = "0".repeat(64);

export type PayloadValue = string | number | null;
export type Payload = Record<string, PayloadValue>;

const ENTRY_TYPES = [
  "genesis",
  "deposit",
  "withdraw",
  "transfer",
  "invest",
  "mark",
] as const;

export type EntryType = (typeof ENTRY_TYPES)[number];

export function isEntryType(value: string): value is EntryType {
  return (ENTRY_TYPES as readonly string[]).includes(value);
}

/** Stable JSON so the same payload always hashes the same way. One level deep. */
export function canonicalPayload(payload: Payload): string {
  const keys = Object.keys(payload).sort();
  const sorted: Payload = {};
  for (const key of keys) {
    const value = payload[key];
    if (value === undefined) {
      throw new Error("Payload values cannot be undefined");
    }
    sorted[key] = value;
  }
  return JSON.stringify(sorted);
}

export function blockHash(
  prevHash: string,
  entryType: string,
  payloadCanonical: string,
  createdAtIso: string,
): string {
  return createHash("sha256")
    .update(`${prevHash}|${entryType}|${payloadCanonical}|${createdAtIso}`)
    .digest("hex");
}

export type ChainBlock = {
  prevHash: string;
  hash: string;
  entryType: string;
  payloadCanonical: string;
  createdAtIso: string;
};

export type ChainCheck =
  | { ok: true }
  | { ok: false; index: number; reason: string };

/** Walk the linked list and confirm each hash and previous-hash pointer. */
export function verifyChain(blocks: readonly ChainBlock[]): ChainCheck {
  let expectedPrev = GENESIS_PREV;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block === undefined) {
      return { ok: false, index, reason: "missing block" };
    }
    if (block.prevHash !== expectedPrev) {
      return { ok: false, index, reason: "prev hash does not match the previous block" };
    }
    const recomputed = blockHash(
      block.prevHash,
      block.entryType,
      block.payloadCanonical,
      block.createdAtIso,
    );
    if (recomputed !== block.hash) {
      return { ok: false, index, reason: "hash does not match the payload" };
    }
    expectedPrev = block.hash;
  }
  return { ok: true };
}
