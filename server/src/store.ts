import { createHash, randomBytes } from "node:crypto";
import type { Conn, Db, Row } from "./db.ts";
import {
  GENESIS_PREV,
  blockHash,
  canonicalPayload,
  isEntryType,
  verifyChain,
  type ChainBlock,
  type Payload,
} from "./ledger.ts";
import {
  applyEntry,
  economicShareCents,
  emptyState,
  marketValueCents,
  positionValueCents,
  totalClaims,
  type MoneyState,
  type Position,
} from "./money.ts";
import { hashPassword } from "./passwords.ts";
import { dayChangeBps } from "./quotes.ts";

const LOCK = "hackstreet_ledger";

export type Member = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
};

export type PublicBlock = {
  id: number;
  prevHash: string;
  hash: string;
  entryType: string;
  payload: Payload;
  createdAt: string;
};

type BlockRow = Row & {
  id: number;
  prev_hash: string;
  hash: string;
  entry_type: string;
  payload: Payload | string;
  created_at_iso: string;
};

function asPayload(value: Payload | string): Payload {
  if (typeof value === "string") {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Block payload is not an object");
    }
    const payload: Payload = {};
    for (const [key, item] of Object.entries(parsed)) {
      if (typeof item === "string" || typeof item === "number" || item === null) {
        payload[key] = item;
      } else {
        throw new Error("Block payload has a nested value");
      }
    }
    return payload;
  }
  return value;
}

async function withLedger<T>(pool: Db, fn: (conn: Conn) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("SELECT pg_advisory_xact_lock(hashtext(?))", [LOCK]);
    try {
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (error) {
      await conn.rollback();
      throw error;
    }
  } finally {
    conn.release();
  }
}

async function tipHash(conn: Conn): Promise<string> {
  const [rows] = await conn.query<Row>(
    "SELECT hash FROM blocks ORDER BY id DESC LIMIT 1 FOR UPDATE",
  );
  const hash = rows[0]?.["hash"];
  return typeof hash === "string" ? hash : GENESIS_PREV;
}

async function insertBlock(
  conn: Conn,
  entryType: string,
  payload: Payload,
  createdAt: Date,
): Promise<PublicBlock> {
  const prevHash = await tipHash(conn);
  const createdAtIso = createdAt.toISOString();
  const payloadCanonical = canonicalPayload(payload);
  const hash = blockHash(prevHash, entryType, payloadCanonical, createdAtIso);
  const [rows] = await conn.query<Row>(
    `INSERT INTO blocks (prev_hash, hash, entry_type, payload, created_at_iso, created_at)
     VALUES (?, ?, ?, ?::jsonb, ?, ?)
     RETURNING id`,
    [prevHash, hash, entryType, JSON.stringify(payload), createdAtIso, createdAtIso],
  );
  const id = Number(rows[0]?.["id"]);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Block insert did not return an id");
  }
  return {
    id,
    prevHash,
    hash,
    entryType,
    payload,
    createdAt: createdAtIso,
  };
}

async function loadState(conn: Conn): Promise<MoneyState> {
  const state = emptyState();
  const [treasury] = await conn.query<Row>(
    "SELECT cash_cents FROM treasury WHERE id = 1 FOR UPDATE",
  );
  const cash = treasury[0]?.["cash_cents"];
  state.cashCents = typeof cash === "number" ? cash : Number(cash ?? 0);
  const [claims] = await conn.query<Row>(
    "SELECT member_id, claim_cents FROM claims FOR UPDATE",
  );
  for (const row of claims) {
    const id = row["member_id"];
    const claim = row["claim_cents"];
    if (typeof id === "string") {
      state.claims[id] = typeof claim === "number" ? claim : Number(claim);
    }
  }
  const [positions] = await conn.query<Row>(
    "SELECT id, symbol, name, units_micro, cost_cents, price_cents FROM investments FOR UPDATE",
  );
  for (const row of positions) {
    const id = row["id"];
    if (typeof id !== "string") continue;
    state.positions[id] = {
      symbol: String(row["symbol"]),
      name: String(row["name"]),
      unitsMicro: Number(row["units_micro"]),
      costCents: Number(row["cost_cents"]),
      priceCents: Number(row["price_cents"]),
    };
  }
  return state;
}

async function saveState(conn: Conn, state: MoneyState): Promise<void> {
  await conn.query(
    `INSERT INTO treasury (id, cash_cents) VALUES (1, ?)
     ON CONFLICT (id) DO UPDATE SET cash_cents = EXCLUDED.cash_cents`,
    [state.cashCents],
  );
  for (const [memberId, claimCents] of Object.entries(state.claims)) {
    await conn.query(
      `INSERT INTO claims (member_id, claim_cents) VALUES (?, ?)
       ON CONFLICT (member_id) DO UPDATE SET claim_cents = EXCLUDED.claim_cents`,
      [memberId, claimCents],
    );
  }
  for (const [id, position] of Object.entries(state.positions)) {
    await conn.query(
      `INSERT INTO investments (id, symbol, name, units_micro, cost_cents, price_cents, opened_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())
       ON CONFLICT (id) DO UPDATE SET price_cents = EXCLUDED.price_cents`,
      [id, position.symbol, position.name, position.unitsMicro, position.costCents, position.priceCents],
    );
  }
}

function sessionOrNull(value: Payload[string] | undefined): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function centsOrNull(value: Payload[string] | undefined): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return null;
  return value;
}

/** The buy and each later close share one mark row plus the day-move columns. */
async function recordClose(conn: Conn, payload: Payload, createdAt: Date): Promise<void> {
  const investmentId = payload["investmentId"];
  const price = payload["priceCents"];
  if (typeof investmentId !== "string" || typeof price !== "number") return;
  const session = sessionOrNull(payload["sessionDate"]);
  const priorClose = centsOrNull(payload["priorCloseCents"]);
  const priorSession = sessionOrNull(payload["priorSession"]);
  const markedAt = session !== null ? `${session}T12:00:00.000Z` : createdAt.toISOString();
  await conn.query(
    "INSERT INTO investment_marks (investment_id, price_cents, marked_at, session_date) VALUES (?, ?, ?, ?)",
    [investmentId, price, markedAt, session],
  );
  await conn.query(
    "UPDATE investments SET prior_close_cents = ?, close_session = ?, prior_session = ? WHERE id = ?",
    [priorClose, session, priorSession, investmentId],
  );
}

export async function appendEntry(
  pool: Db,
  entryType: string,
  payload: Payload,
  createdAt = new Date(),
): Promise<PublicBlock> {
  if (!isEntryType(entryType) || entryType === "genesis") {
    throw new Error("Refusing to append that entry type");
  }
  return withLedger(pool, async (conn) => {
    const current = await loadState(conn);
    const next = applyEntry(current, entryType, payload);
    const block = await insertBlock(conn, entryType, payload, createdAt);
    await saveState(conn, next);
    if (entryType === "invest") {
      const investmentId = payload["investmentId"];
      if (typeof investmentId === "string") {
        await conn.query("UPDATE investments SET opened_at = ? WHERE id = ?", [
          createdAt.toISOString(),
          investmentId,
        ]);
      }
    }
    if (entryType === "mark" || entryType === "invest") {
      await recordClose(conn, payload, createdAt);
    }
    return block;
  });
}

export async function ensureGenesis(pool: Db): Promise<void> {
  await withLedger(pool, async (conn) => {
    const [rows] = await conn.query<Row>("SELECT id FROM blocks LIMIT 1");
    if (rows.length > 0) return;
    await conn.query(
      "INSERT INTO treasury (id, cash_cents) VALUES (1, 0)",
    );
    await insertBlock(conn, "genesis", { note: "hackstreet-pot" }, new Date("2026-01-01T00:00:00.000Z"));
  });
}

export async function createMember(
  pool: Db,
  input: { name: string; email: string; password?: string; googleSub?: string },
): Promise<Member> {
  const id = randomBytes(16).toString("hex");
  // Google accounts have no password. The stored marker is not a scrypt hash, so it cannot pass verification.
  const passwordHash = input.password === undefined ? "google" : await hashPassword(input.password);
  const createdAt = new Date();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      "INSERT INTO members (id, name, email, password_hash, google_sub, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [id, input.name, input.email, passwordHash, input.googleSub ?? null, createdAt.toISOString()],
    );
    await conn.query("INSERT INTO claims (member_id, claim_cents) VALUES (?, 0)", [id]);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  return { id, name: input.name, email: input.email, createdAt: createdAt.toISOString() };
}

/** The Google account is already linked to a different subject than the one signing in. */
export class GoogleAccountConflict extends Error {
  readonly code = "google_conflict" as const;

  constructor() {
    super("google_conflict");
    this.name = "GoogleAccountConflict";
  }
}

/**
 * Sign in an existing Google account, or open one from a verified profile.
 * An email already linked to a different Google subject is a conflict, not a rebind.
 */
export async function memberFromGoogle(
  pool: Db,
  profile: { sub: string; email: string; name: string },
): Promise<Member> {
  const bySub = await findMemberByGoogleSub(pool, profile.sub);
  if (bySub !== null) return bySub;
  const byEmail = await findMemberByEmail(pool, profile.email);
  if (byEmail !== null) {
    if (byEmail.googleSub !== null && byEmail.googleSub !== profile.sub) {
      throw new GoogleAccountConflict();
    }
    await pool.query("UPDATE members SET google_sub = ? WHERE id = ?", [profile.sub, byEmail.id]);
    return { id: byEmail.id, name: byEmail.name, email: byEmail.email, createdAt: byEmail.createdAt };
  }
  return createMember(pool, { name: profile.name, email: profile.email, googleSub: profile.sub });
}

async function findMemberByGoogleSub(pool: Db, sub: string): Promise<Member | null> {
  const [rows] = await pool.query<Row>(
    "SELECT id, name, email, created_at FROM members WHERE google_sub = ? LIMIT 1",
    [sub],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    id: String(row["id"]),
    name: String(row["name"]),
    email: String(row["email"]),
    createdAt: toIso(row["created_at"]),
  };
}

export async function findMemberByEmail(
  pool: Db,
  email: string,
): Promise<(Member & { passwordHash: string; googleSub: string | null }) | null> {
  const [rows] = await pool.query<Row>(
    "SELECT id, name, email, password_hash, google_sub, created_at FROM members WHERE email = ? LIMIT 1",
    [email],
  );
  const row = rows[0];
  if (row === undefined) return null;
  const googleSub = row["google_sub"];
  return {
    id: String(row["id"]),
    name: String(row["name"]),
    email: String(row["email"]),
    passwordHash: String(row["password_hash"]),
    googleSub: googleSub === null || googleSub === undefined ? null : String(googleSub),
    createdAt: toIso(row["created_at"]),
  };
}

export async function openSession(pool: Db, memberId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 12);
  await pool.query(
    "INSERT INTO sessions (token_hash, member_id, expires_at) VALUES (?, ?, ?)",
    [tokenHash, memberId, expires.toISOString()],
  );
  return token;
}

export async function memberFromToken(pool: Db, token: string): Promise<Member | null> {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const [rows] = await pool.query<Row>(
    `SELECT m.id, m.name, m.email, m.created_at
     FROM sessions s
     JOIN members m ON m.id = s.member_id
     WHERE s.token_hash = ? AND s.expires_at > NOW()
     LIMIT 1`,
    [tokenHash],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    id: String(row["id"]),
    name: String(row["name"]),
    email: String(row["email"]),
    createdAt: toIso(row["created_at"]),
  };
}

export async function closeSession(pool: Db, token: string): Promise<void> {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await pool.query("DELETE FROM sessions WHERE token_hash = ?", [tokenHash]);
}

export async function listMembers(pool: Db): Promise<Member[]> {
  const [rows] = await pool.query<Row>(
    "SELECT id, name, email, created_at FROM members ORDER BY name ASC",
  );
  return rows.map((row) => ({
    id: String(row["id"]),
    name: String(row["name"]),
    email: String(row["email"]),
    createdAt: toIso(row["created_at"]),
  }));
}

async function readBlocks(connOrPool: Db | Conn): Promise<ChainBlock[]> {
  const [rows] = await connOrPool.query<BlockRow>(
    "SELECT id, prev_hash, hash, entry_type, payload, created_at_iso FROM blocks ORDER BY id ASC",
  );
  return rows.map((row) => ({
    prevHash: row.prev_hash,
    hash: row.hash,
    entryType: row.entry_type,
    payloadCanonical: canonicalPayload(asPayload(row.payload)),
    createdAtIso: row.created_at_iso,
  }));
}

export async function listBlocks(pool: Db): Promise<PublicBlock[]> {
  const [rows] = await pool.query<BlockRow>(
    "SELECT id, prev_hash, hash, entry_type, payload, created_at_iso FROM blocks ORDER BY id ASC",
  );
  return rows.map((row) => ({
    id: Number(row.id),
    prevHash: row.prev_hash,
    hash: row.hash,
    entryType: row.entry_type,
    payload: asPayload(row.payload),
    createdAt: row.created_at_iso,
  }));
}

export async function verifyStoredChain(pool: Db): Promise<{ ok: true; length: number } | { ok: false; index: number; reason: string }> {
  const blocks = await readBlocks(pool);
  const check = verifyChain(blocks);
  if (!check.ok) return check;
  let state = emptyState();
  const [memberRows] = await pool.query<Row>("SELECT id FROM members");
  for (const row of memberRows) {
    state.claims[String(row["id"])] = 0;
  }
  const [blockRows] = await pool.query<BlockRow>(
    "SELECT id, prev_hash, hash, entry_type, payload, created_at_iso FROM blocks ORDER BY id ASC",
  );
  for (const row of blockRows) {
    state = applyEntry(state, row.entry_type, asPayload(row.payload));
  }
  const stored = await loadStateUnlocked(pool);
  if (stored.cashCents !== state.cashCents) {
    return { ok: false, index: -1, reason: "treasury does not match the chain" };
  }
  const claimIds = new Set([...Object.keys(stored.claims), ...Object.keys(state.claims)]);
  for (const id of claimIds) {
    if ((stored.claims[id] ?? 0) !== (state.claims[id] ?? 0)) {
      return { ok: false, index: -1, reason: "a claim does not match the chain" };
    }
  }
  return { ok: true, length: blocks.length };
}

async function loadStateUnlocked(pool: Db): Promise<MoneyState> {
  const conn = await pool.getConnection();
  try {
    return await loadState(conn);
  } finally {
    conn.release();
  }
}

export type HomeSnapshot = {
  you: { claimCents: number; economicCents: number; share: number };
  pot: { cashCents: number; investedCostCents: number; marketCents: number; valueCents: number };
};

export async function homeFor(pool: Db, memberId: string): Promise<HomeSnapshot> {
  const state = await loadStateUnlocked(pool);
  const claim = state.claims[memberId] ?? 0;
  const total = totalClaims(state);
  const market = marketValueCents(state);
  const investedCost = Object.values(state.positions).reduce((sum, position) => sum + position.costCents, 0);
  return {
    you: {
      claimCents: claim,
      economicCents: economicShareCents(state, memberId),
      share: total > 0 ? claim / total : 0,
    },
    pot: {
      cashCents: state.cashCents,
      investedCostCents: investedCost,
      marketCents: market,
      valueCents: state.cashCents + market,
    },
  };
}

export type ActivityLine = {
  id: number;
  at: string;
  text: string;
  amountCents: number | null;
  direction: "in" | "out" | "neutral";
};

export async function activityFor(pool: Db, memberId: string | null, limit: number): Promise<ActivityLine[]> {
  const blocks = await listBlocks(pool);
  const members = await listMembers(pool);
  const names = new Map(members.map((member) => [member.id, member.name]));
  const lines: ActivityLine[] = [];
  for (const block of blocks) {
    if (block.entryType === "genesis") continue;
    const line = describe(block, memberId, names);
    if (line !== null) lines.push(line);
  }
  return lines.slice(-limit).reverse();
}

function describe(
  block: PublicBlock,
  viewerId: string | null,
  names: Map<string, string>,
): ActivityLine | null {
  const amount = typeof block.payload["amountCents"] === "number" ? block.payload["amountCents"] : null;
  const memberId = typeof block.payload["memberId"] === "string" ? block.payload["memberId"] : null;
  const counterparty = typeof block.payload["counterpartyId"] === "string" ? block.payload["counterpartyId"] : null;
  const nameOf = (id: string | null): string => (id ? names.get(id) ?? "a member" : "a member");
  if (block.entryType === "deposit" && memberId) {
    if (viewerId !== null && viewerId !== memberId) return null;
    const who = viewerId === memberId ? "You added" : `${nameOf(memberId)} added`;
    return { id: block.id, at: block.createdAt, text: `${who} ${kes(amount)}`, amountCents: amount, direction: "in" };
  }
  if (block.entryType === "withdraw" && memberId) {
    if (viewerId !== null && viewerId !== memberId) return null;
    const who = viewerId === memberId ? "You took out" : `${nameOf(memberId)} took out`;
    return { id: block.id, at: block.createdAt, text: `${who} ${kes(amount)}`, amountCents: amount, direction: "out" };
  }
  if (block.entryType === "transfer" && memberId && counterparty) {
    if (viewerId !== null && viewerId !== memberId && viewerId !== counterparty) return null;
    if (viewerId === memberId) {
      return {
        id: block.id,
        at: block.createdAt,
        text: `Sent ${kes(amount)} to ${nameOf(counterparty)}`,
        amountCents: amount,
        direction: "out",
      };
    }
    if (viewerId === counterparty) {
      return {
        id: block.id,
        at: block.createdAt,
        text: `Received ${kes(amount)} from ${nameOf(memberId)}`,
        amountCents: amount,
        direction: "in",
      };
    }
    return {
      id: block.id,
      at: block.createdAt,
      text: `${nameOf(memberId)} sent ${kes(amount)} to ${nameOf(counterparty)}`,
      amountCents: amount,
      direction: "neutral",
    };
  }
  if (block.entryType === "invest") {
    if (viewerId !== null && viewerId !== memberId) return null;
    const symbol = typeof block.payload["name"] === "string" ? block.payload["name"] : "an investment";
    return {
      id: block.id,
      at: block.createdAt,
      text: `Crew bought ${symbol}`,
      amountCents: null,
      direction: "neutral",
    };
  }
  if (block.entryType === "mark") {
    return null;
  }
  return null;
}

function kes(cents: number | null): string {
  if (cents === null) return "KES 0";
  const amount = new Intl.NumberFormat("en-KE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
  return `KES ${amount}`;
}

export type InvestmentView = {
  id: string;
  symbol: string;
  name: string;
  units: number;
  costCents: number;
  priceCents: number;
  valueCents: number;
  openedAt: string;
  gainCents: number;
  priorCloseCents: number | null;
  closeSession: string | null;
  priorSession: string | null;
  dayChangeBps: number | null;
};

export async function listInvestments(pool: Db): Promise<InvestmentView[]> {
  const [rows] = await pool.query<Row>(
    `SELECT id, symbol, name, units_micro, cost_cents, price_cents, opened_at,
            prior_close_cents, close_session, prior_session
     FROM investments ORDER BY opened_at ASC`,
  );
  return rows.map(mapInvestment);
}

export async function getInvestment(pool: Db, id: string): Promise<(InvestmentView & { marks: { at: string; priceCents: number }[] }) | null> {
  const [rows] = await pool.query<Row>(
    `SELECT id, symbol, name, units_micro, cost_cents, price_cents, opened_at,
            prior_close_cents, close_session, prior_session
     FROM investments WHERE id = ? LIMIT 1`,
    [id],
  );
  const row = rows[0];
  if (row === undefined) return null;
  const [marks] = await pool.query<Row>(
    "SELECT price_cents, marked_at FROM investment_marks WHERE investment_id = ? ORDER BY id ASC",
    [id],
  );
  return {
    ...mapInvestment(row),
    marks: marks.map((mark) => ({
      at: toIso(mark["marked_at"]),
      priceCents: Number(mark["price_cents"]),
    })),
  };
}

function mapInvestment(row: Row): InvestmentView {
  const position: Position = {
    symbol: String(row["symbol"]),
    name: String(row["name"]),
    unitsMicro: Number(row["units_micro"]),
    costCents: Number(row["cost_cents"]),
    priceCents: Number(row["price_cents"]),
  };
  const value = positionValueCents(position);
  return {
    id: String(row["id"]),
    symbol: position.symbol,
    name: position.name,
    units: position.unitsMicro / 1_000_000,
    costCents: position.costCents,
    priceCents: position.priceCents,
    valueCents: value,
    openedAt: toIso(row["opened_at"]),
    gainCents: value - position.costCents,
    priorCloseCents: nullableCents(row["prior_close_cents"]),
    closeSession: nullableDate(row["close_session"]),
    priorSession: nullableDate(row["prior_session"]),
    dayChangeBps: dayMove(nullableCents(row["prior_close_cents"]), position.priceCents),
  };
}

function nullableCents(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const cents = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(cents) || cents <= 0) return null;
  return cents;
}

function nullableDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const day = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

function dayMove(priorCents: number | null, latestCents: number): number | null {
  if (priorCents === null) return null;
  return dayChangeBps(priorCents, latestCents);
}

export async function seedCrew(pool: Db, password: string): Promise<void> {
  const [existing] = await pool.query<Row>("SELECT id FROM members LIMIT 1");
  if (existing.length > 0) return;
  const crew = [
    { name: "Kakai", email: "kakai@hackstreet.local" },
    { name: "Alvin", email: "alvin@hackstreet.local" },
    { name: "Amina", email: "amina@hackstreet.local" },
    { name: "Brian", email: "brian@hackstreet.local" },
  ];
  const members: Member[] = [];
  for (const person of crew) {
    members.push(await createMember(pool, { ...person, password }));
  }
  const byName = new Map(members.map((member) => [member.name, member.id]));
  const kakai = byName.get("Kakai");
  const alvin = byName.get("Alvin");
  const amina = byName.get("Amina");
  const brian = byName.get("Brian");
  if (!kakai || !alvin || !amina || !brian) return;
  const day = (iso: string): Date => new Date(iso);
  await appendEntry(pool, "deposit", { memberId: kakai, amountCents: 2_000_000 }, day("2026-02-02T08:00:00.000Z"));
  await appendEntry(pool, "deposit", { memberId: alvin, amountCents: 1_500_000 }, day("2026-02-03T08:00:00.000Z"));
  await appendEntry(pool, "deposit", { memberId: amina, amountCents: 1_000_000 }, day("2026-02-04T08:00:00.000Z"));
  await appendEntry(pool, "deposit", { memberId: brian, amountCents: 800_000 }, day("2026-02-05T08:00:00.000Z"));
  await appendEntry(
    pool,
    "transfer",
    { memberId: kakai, counterpartyId: alvin, amountCents: 50_000 },
    day("2026-02-12T15:10:00.000Z"),
  );
  const scom = randomBytes(16).toString("hex");
  const kcb = randomBytes(16).toString("hex");
  await appendEntry(
    pool,
    "invest",
    {
      investmentId: scom,
      memberId: kakai,
      symbol: "SCOM",
      name: "Safaricom",
      unitsMicro: 200_000_000,
      priceCents: 1_850,
    },
    day("2026-03-02T09:00:00.000Z"),
  );
  await appendEntry(
    pool,
    "invest",
    {
      investmentId: kcb,
      memberId: kakai,
      symbol: "KCB",
      name: "KCB Group",
      unitsMicro: 100_000_000,
      priceCents: 4_200,
    },
    day("2026-03-04T09:00:00.000Z"),
  );
  const scomMarks = [1_920, 1_880, 2_010, 2_140, 2_090, 2_260];
  const kcbMarks = [4_150, 4_080, 4_220, 4_050, 3_980, 4_010];
  for (let i = 0; i < scomMarks.length; i += 1) {
    const price = scomMarks[i];
    const kcbPrice = kcbMarks[i];
    if (price === undefined || kcbPrice === undefined) continue;
    const at = new Date(Date.UTC(2026, 3, 2 + i * 12, 10, 0, 0));
    await appendEntry(pool, "mark", { investmentId: scom, priceCents: price }, at);
    await appendEntry(pool, "mark", { investmentId: kcb, priceCents: kcbPrice }, new Date(at.getTime() + 60_000));
  }
}

export function newCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    if (value.endsWith("Z") || value.includes("T")) return new Date(value).toISOString();
    return new Date(`${value.replace(" ", "T")}Z`).toISOString();
  }
  return new Date(Number(value)).toISOString();
}
