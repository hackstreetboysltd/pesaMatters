import type { Payload } from "./ledger.ts";

export const MICRO = 1_000_000;
export const MAX_CENTS = 100_000_000_00;

export class MoneyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MoneyError";
    this.code = code;
  }
}

export type Position = {
  unitsMicro: number;
  costCents: number;
  priceCents: number;
  symbol: string;
  name: string;
};

export type MoneyState = {
  cashCents: number;
  claims: Record<string, number>;
  positions: Record<string, Position>;
};

export function emptyState(): MoneyState {
  return { cashCents: 0, claims: {}, positions: {} };
}

export function positionValueCents(position: Position): number {
  return Math.round((position.unitsMicro * position.priceCents) / MICRO);
}

export function marketValueCents(state: MoneyState): number {
  return Object.values(state.positions).reduce(
    (sum, position) => sum + positionValueCents(position),
    0,
  );
}

function requireMember(state: MoneyState, memberId: string): number {
  const claim = state.claims[memberId];
  if (claim === undefined) {
    throw new MoneyError("unknown_member", "That member is not in the crew.");
  }
  return claim;
}

function requireCents(amount: number): void {
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_CENTS) {
    throw new MoneyError("bad_amount", "Amount must be a positive number of cents within the limit.");
  }
}

function clone(state: MoneyState): MoneyState {
  return {
    cashCents: state.cashCents,
    claims: { ...state.claims },
    positions: { ...state.positions },
  };
}

export function applyEntry(state: MoneyState, entryType: string, payload: Payload): MoneyState {
  if (entryType === "genesis") {
    return state;
  }
  const next = clone(state);
  if (entryType === "deposit") {
    const memberId = requiredString(payload, "memberId");
    const amount = requiredInt(payload, "amountCents");
    requireCents(amount);
    requireMember(next, memberId);
    const current = next.claims[memberId] ?? 0;
    next.claims[memberId] = current + amount;
    next.cashCents += amount;
    return next;
  }
  if (entryType === "withdraw") {
    const memberId = requiredString(payload, "memberId");
    const amount = requiredInt(payload, "amountCents");
    requireCents(amount);
    const claim = requireMember(next, memberId);
    if (claim < amount) {
      throw new MoneyError("insufficient_claim", "That is more than this member can move.");
    }
    if (next.cashCents < amount) {
      throw new MoneyError(
        "insufficient_cash",
        "The pot's cash is tied up in investments. A sale has to happen before this withdrawal.",
      );
    }
    next.claims[memberId] = claim - amount;
    next.cashCents -= amount;
    return next;
  }
  if (entryType === "transfer") {
    const fromId = requiredString(payload, "memberId");
    const toId = requiredString(payload, "counterpartyId");
    const amount = requiredInt(payload, "amountCents");
    requireCents(amount);
    if (fromId === toId) {
      throw new MoneyError("same_member", "Choose a different member.");
    }
    const fromClaim = requireMember(next, fromId);
    requireMember(next, toId);
    if (fromClaim < amount) {
      throw new MoneyError("insufficient_claim", "That is more than this member can move.");
    }
    next.claims[fromId] = fromClaim - amount;
    next.claims[toId] = (next.claims[toId] ?? 0) + amount;
    return next;
  }
  if (entryType === "invest") {
    const investmentId = requiredString(payload, "investmentId");
    const symbol = requiredString(payload, "symbol");
    const name = requiredString(payload, "name");
    const unitsMicro = requiredInt(payload, "unitsMicro");
    const priceCents = requiredInt(payload, "priceCents");
    if (!Number.isInteger(unitsMicro) || unitsMicro <= 0) {
      throw new MoneyError("bad_units", "Units must be a positive number.");
    }
    requireCents(priceCents);
    const cost = Math.round((unitsMicro * priceCents) / MICRO);
    if (!Number.isInteger(cost) || cost <= 0) {
      throw new MoneyError("bad_amount", "That buy does not have a real cost.");
    }
    if (next.cashCents < cost) {
      throw new MoneyError("insufficient_cash", "The pot does not have enough cash for this buy.");
    }
    if (next.positions[investmentId] !== undefined) {
      throw new MoneyError("duplicate_investment", "That investment is already on the books.");
    }
    next.cashCents -= cost;
    next.positions[investmentId] = {
      unitsMicro,
      costCents: cost,
      priceCents,
      symbol,
      name,
    };
    return next;
  }
  if (entryType === "mark") {
    const investmentId = requiredString(payload, "investmentId");
    const priceCents = requiredInt(payload, "priceCents");
    requireCents(priceCents);
    const position = next.positions[investmentId];
    if (position === undefined) {
      throw new MoneyError("unknown_investment", "That investment is not on the books.");
    }
    next.positions[investmentId] = { ...position, priceCents };
    return next;
  }
  throw new MoneyError("unknown_entry", "That ledger entry is not supported.");
}

function requiredString(payload: Payload, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || value.length === 0 || value.length > 80) {
    throw new MoneyError("bad_payload", "The ledger entry is missing a required field.");
  }
  return value;
}

function requiredInt(payload: Payload, key: string): number {
  const value = payload[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new MoneyError("bad_payload", "The ledger entry has a bad number.");
  }
  return value;
}

export function totalClaims(state: MoneyState): number {
  return Object.values(state.claims).reduce((sum, value) => sum + value, 0);
}

export function economicShareCents(state: MoneyState, memberId: string): number {
  const claim = state.claims[memberId] ?? 0;
  const total = totalClaims(state);
  if (total <= 0 || claim <= 0) {
    return 0;
  }
  const pot = state.cashCents + marketValueCents(state);
  return Math.round((pot * claim) / total);
}
