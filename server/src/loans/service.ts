import { createHash, randomBytes } from "node:crypto";
import type { Conn, Db, Row } from "../db.ts";
import type { Rails } from "../mpesa/client.ts";
import { completeLoanOut, PaymentError, startLoanPayout } from "../payments.ts";
import { hashPassword, verifyPassword } from "../passwords.ts";
import { coverMismatch, freeDepositsCents, payoutCents, refuseBorrow, refuseGuarantee } from "./capacity.ts";
import { LOAN_PRODUCTS, productByCode, type LoanProduct } from "./products.ts";
import { gate, guaranteesMet, OPEN_STATUSES, statusAfterSubmit } from "./status.ts";

export class LoanError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "LoanError";
    this.status = status;
    this.code = code;
  }
}

const MAX_PAYOUT_CENTS = 250_000 * 100;

export type Capacity = {
  depositsCents: number;
  outstandingCents: number;
  pledgedCents: number;
  freeCents: number;
};

export type GuarantorView = {
  id: string;
  memberId: string;
  name: string;
  amountCents: number;
  status: string;
};

export type LoanView = {
  status: string;
  principalCents: number;
  feeCents: number;
  netCents: number;
};

export type ApplicationView = {
  id: string;
  memberId: string;
  memberName: string;
  productCode: string;
  productName: string;
  amountCents: number;
  termCount: number;
  termUnit: string;
  purpose: string;
  phone: string;
  status: string;
  recommendedCents: number | null;
  approvedCents: number | null;
  approvedTerm: number | null;
  riskRating: string | null;
  appraisalNotes: string | null;
  decisionNotes: string | null;
  createdAt: string;
  guarantors: GuarantorView[];
  coverage: {
    acceptedCents: number;
    requiredCents: number;
    acceptedCount: number;
    minimumGuarantors: number;
    met: boolean;
  };
  loan: LoanView | null;
};

export type IncomingGuarantee = {
  id: string;
  applicationId: string;
  borrowerName: string;
  amountCents: number;
  productName: string;
};

type AppRow = Row & {
  id: string;
  member_id: string;
  member_name: string;
  product_code: string;
  amount_cents: number;
  term_count: number;
  purpose: string;
  phone: string;
  status: string;
  recommended_cents: number | null;
  approved_cents: number | null;
  approved_term: number | null;
  risk_rating: string | null;
  appraisal_notes: string | null;
  decision_notes: string | null;
  created_at: string;
};

function stamp(date = new Date()): string {
  return date.toISOString();
}

function toIsoStamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    if (value.endsWith("Z") || value.includes("T")) return new Date(value).toISOString();
    return new Date(`${value.replace(" ", "T")}Z`).toISOString();
  }
  return new Date(Number(value)).toISOString();
}

function cents(value: unknown): number {
  const n = typeof value === "bigint" ? Number(value) : Number(value ?? 0);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new LoanError(500, "server_error", "Something went wrong. Try again.");
  }
  return n;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

async function withTx<T>(pool: Db, fn: (conn: Conn) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
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

export async function seedLoanProducts(pool: Db): Promise<void> {
  for (const product of LOAN_PRODUCTS) {
    await pool.query(
      `INSERT INTO loan_products
        (code, name, interest_percent, term_min, term_max, term_unit, minimum_cents, maximum_cents,
         minimum_guarantors, coverage_percent, fee_percent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (code) DO UPDATE SET
         name = EXCLUDED.name,
         interest_percent = EXCLUDED.interest_percent,
         term_min = EXCLUDED.term_min,
         term_max = EXCLUDED.term_max,
         term_unit = EXCLUDED.term_unit,
         minimum_cents = EXCLUDED.minimum_cents,
         maximum_cents = EXCLUDED.maximum_cents,
         minimum_guarantors = EXCLUDED.minimum_guarantors,
         coverage_percent = EXCLUDED.coverage_percent,
         fee_percent = EXCLUDED.fee_percent`,
      [
        product.code,
        product.name,
        product.interestPercent,
        product.termMin,
        product.termMax,
        product.termUnit,
        product.minimumCents,
        product.maximumCents,
        product.minimumGuarantors,
        product.coveragePercent,
        product.feePercent,
      ],
    );
  }
}

export async function ensureDeskAdmin(pool: Db, email: string | null, password: string | null): Promise<void> {
  if (email === null || password === null) return;
  const [existing] = await pool.query<Row>("SELECT id FROM admins LIMIT 1");
  if (existing.length > 0) return;
  const id = randomBytes(16).toString("hex");
  const local = email.split("@")[0] ?? "Desk";
  const name = local.slice(0, 80);
  await pool.query(
    "INSERT INTO admins (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
    [id, name.length > 0 ? name : "Desk", email, await hashPassword(password), stamp()],
  );
}

export async function openDeskSession(pool: Db, email: string, password: string): Promise<{ token: string; admin: { id: string; name: string; email: string } } | null> {
  const [rows] = await pool.query<Row>(
    "SELECT id, name, email, password_hash FROM admins WHERE email = ? LIMIT 1",
    [email],
  );
  const row = rows[0];
  if (row === undefined || typeof row["password_hash"] !== "string") return null;
  const ok = await verifyPassword(password, row["password_hash"]);
  if (!ok) return null;
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const adminId = String(row["id"]);
  await pool.query("INSERT INTO desk_sessions (token_hash, admin_id, expires_at) VALUES (?, ?, ?)", [
    tokenHash,
    adminId,
    stamp(new Date(Date.now() + 1000 * 60 * 60 * 12)),
  ]);
  return {
    token,
    admin: { id: adminId, name: String(row["name"]), email: String(row["email"]) },
  };
}

export async function adminFromToken(pool: Db, token: string): Promise<{ id: string; name: string; email: string } | null> {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const [rows] = await pool.query<Row>(
    `SELECT a.id, a.name, a.email
     FROM desk_sessions s
     JOIN admins a ON a.id = s.admin_id
     WHERE s.token_hash = ? AND s.expires_at > NOW()
     LIMIT 1`,
    [tokenHash],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return { id: String(row["id"]), name: String(row["name"]), email: String(row["email"]) };
}

export async function closeDeskSession(pool: Db, token: string): Promise<void> {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await pool.query("DELETE FROM desk_sessions WHERE token_hash = ?", [tokenHash]);
}

async function depositsOf(conn: Conn | Db, memberId: string, lock: boolean): Promise<number> {
  const [rows] = await conn.query<Row>(
    `SELECT claim_cents FROM claims WHERE member_id = ?${lock ? " FOR UPDATE" : ""}`,
    [memberId],
  );
  return cents(rows[0]?.["claim_cents"] ?? 0);
}

async function outstandingOf(conn: Conn | Db, memberId: string): Promise<number> {
  const [rows] = await conn.query<Row>(
    "SELECT COALESCE(SUM(principal_cents), 0) AS total FROM loans WHERE member_id = ? AND status IN ('pending', 'active')",
    [memberId],
  );
  return cents(rows[0]?.["total"]);
}

async function pledgedOf(conn: Conn | Db, memberId: string, exceptGuarantorId: string | null): Promise<number> {
  const base = `SELECT COALESCE(SUM(g.amount_cents), 0) AS total
     FROM loan_guarantors g
     JOIN loan_applications a ON a.id = g.application_id
     LEFT JOIN loans l ON l.application_id = a.id
     WHERE g.member_id = ?
       AND g.status IN ('invited', 'accepted')
       AND a.status NOT IN ('rejected', 'cancelled')
       AND (l.id IS NULL OR l.status IN ('pending', 'active'))
       AND g.member_id <> a.member_id`;
  const [rows] =
    exceptGuarantorId === null
      ? await conn.query<Row>(base, [memberId])
      : await conn.query<Row>(`${base} AND g.id <> ?`, [memberId, exceptGuarantorId]);
  return cents(rows[0]?.["total"]);
}

export async function capacityFor(pool: Db, memberId: string): Promise<Capacity> {
  const depositsCents = await depositsOf(pool, memberId, false);
  const outstandingCents = await outstandingOf(pool, memberId);
  const pledgedCents = await pledgedOf(pool, memberId, null);
  return {
    depositsCents,
    outstandingCents,
    pledgedCents,
    freeCents: freeDepositsCents(depositsCents, outstandingCents, pledgedCents),
  };
}

async function capacityLocked(conn: Conn, memberId: string, exceptGuarantorId: string | null): Promise<Capacity> {
  const depositsCents = await depositsOf(conn, memberId, true);
  const outstandingCents = await outstandingOf(conn, memberId);
  const pledgedCents = await pledgedOf(conn, memberId, exceptGuarantorId);
  return {
    depositsCents,
    outstandingCents,
    pledgedCents,
    freeCents: freeDepositsCents(depositsCents, outstandingCents, pledgedCents),
  };
}

function requiredCover(_product: LoanProduct, requestedCents: number): number {
  return requestedCents;
}

async function loadGuarantors(conn: Conn | Db, applicationId: string): Promise<GuarantorView[]> {
  const [rows] = await conn.query<Row>(
    `SELECT g.id, g.member_id, g.amount_cents, g.status, m.name
     FROM loan_guarantors g
     JOIN members m ON m.id = g.member_id
     WHERE g.application_id = ?
     ORDER BY g.created_at ASC`,
    [applicationId],
  );
  return rows.map((row) => ({
    id: String(row["id"]),
    memberId: String(row["member_id"]),
    name: String(row["name"]),
    amountCents: cents(row["amount_cents"]),
    status: String(row["status"]),
  }));
}

async function loadLoan(conn: Conn | Db, applicationId: string): Promise<LoanView | null> {
  const [rows] = await conn.query<Row>(
    "SELECT status, principal_cents, fee_cents, net_cents FROM loans WHERE application_id = ? LIMIT 1",
    [applicationId],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    status: String(row["status"]),
    principalCents: cents(row["principal_cents"]),
    feeCents: cents(row["fee_cents"]),
    netCents: cents(row["net_cents"]),
  };
}

function coverageOf(product: LoanProduct, requestedCents: number, guarantors: GuarantorView[]) {
  const accepted = guarantors.filter((row) => row.status === "accepted");
  const acceptedCents = accepted.reduce((sum, row) => sum + row.amountCents, 0);
  const met = guaranteesMet({
    minimumGuarantors: product.minimumGuarantors,
    coveragePercent: 100,
    requestedCents,
    acceptedCount: accepted.length,
    acceptedCents,
  });
  return {
    acceptedCents,
    requiredCents: requiredCover(product, requestedCents),
    acceptedCount: accepted.length,
    minimumGuarantors: product.minimumGuarantors,
    met,
  };
}

async function viewOf(conn: Conn | Db, id: string): Promise<ApplicationView> {
  const [rows] = await conn.query<AppRow>(
    `SELECT a.id, a.member_id, m.name AS member_name, a.product_code, a.amount_cents, a.term_count,
            a.purpose, a.phone, a.status, a.recommended_cents, a.approved_cents, a.approved_term,
            a.risk_rating, a.appraisal_notes, a.decision_notes, a.created_at
     FROM loan_applications a
     JOIN members m ON m.id = a.member_id
     WHERE a.id = ?
     LIMIT 1`,
    [id],
  );
  const row = rows[0];
  if (row === undefined) throw new LoanError(404, "unknown_loan", "That application is not on the books.");
  const product = productByCode(row.product_code);
  if (product === null) throw new LoanError(500, "server_error", "Something went wrong. Try again.");
  const guarantors = await loadGuarantors(conn, row.id);
  const amount = cents(row.amount_cents);
  return {
    id: row.id,
    memberId: row.member_id,
    memberName: row.member_name,
    productCode: product.code,
    productName: product.name,
    amountCents: amount,
    termCount: Number(row.term_count),
    termUnit: product.termUnit,
    purpose: row.purpose,
    phone: row.phone,
    status: row.status,
    recommendedCents: row.recommended_cents === null ? null : cents(row.recommended_cents),
    approvedCents: row.approved_cents === null ? null : cents(row.approved_cents),
    approvedTerm: row.approved_term === null ? null : Number(row.approved_term),
    riskRating: text(row.risk_rating),
    appraisalNotes: text(row.appraisal_notes),
    decisionNotes: text(row.decision_notes),
    createdAt: toIsoStamp(row.created_at),
    guarantors,
    coverage: coverageOf(product, amount, guarantors),
    loan: await loadLoan(conn, row.id),
  };
}

export async function getApplication(pool: Db, id: string): Promise<ApplicationView> {
  return viewOf(pool, id);
}

export async function mine(pool: Db, memberId: string): Promise<{
  capacity: Capacity;
  products: LoanProduct[];
  application: ApplicationView | null;
  incoming: IncomingGuarantee[];
}> {
  const capacity = await capacityFor(pool, memberId);
  const [latest] = await pool.query<Row>(
    "SELECT id FROM loan_applications WHERE member_id = ? ORDER BY created_at DESC LIMIT 1",
    [memberId],
  );
  const application = latest[0] === undefined ? null : await viewOf(pool, String(latest[0]["id"]));
  const [incomingRows] = await pool.query<Row>(
    `SELECT g.id, g.application_id, g.amount_cents, m.name AS borrower_name, a.product_code
     FROM loan_guarantors g
     JOIN loan_applications a ON a.id = g.application_id
     JOIN members m ON m.id = a.member_id
     WHERE g.member_id = ? AND g.status = 'invited'
     ORDER BY g.created_at ASC`,
    [memberId],
  );
  const incoming: IncomingGuarantee[] = incomingRows.map((row) => ({
    id: String(row["id"]),
    applicationId: String(row["application_id"]),
    borrowerName: String(row["borrower_name"]),
    amountCents: cents(row["amount_cents"]),
    productName: productByCode(String(row["product_code"]))?.name ?? String(row["product_code"]),
  }));
  return { capacity, products: [...LOAN_PRODUCTS], application, incoming };
}

export async function searchMembers(pool: Db, memberId: string, query: string): Promise<{ id: string; name: string; freeCents: number }[]> {
  const needle = query.trim();
  if (needle.length > 80) return [];
  const like = needle.length === 0 ? null : `%${needle.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const [rows] = await pool.query<Row>(
    like === null
      ? "SELECT id, name FROM members WHERE id <> ? ORDER BY name LIMIT 50"
      : "SELECT id, name FROM members WHERE id <> ? AND name LIKE ? ESCAPE E'\\\\' ORDER BY name LIMIT 50",
    like === null ? [memberId] : [memberId, like],
  );
  const found: { id: string; name: string; freeCents: number }[] = [];
  for (const row of rows) {
    const id = String(row["id"]);
    const capacity = await capacityFor(pool, id);
    found.push({ id, name: String(row["name"]), freeCents: capacity.freeCents });
  }
  return found;
}

const BORROW: Record<string, string> = {
  below_minimum: "That amount is below the smallest loan for this product.",
  above_free: "You can only borrow the deposits that are not already pledged or borrowed.",
  above_product: "That is above the largest amount for this product.",
};

const GUARANTEE: Record<string, string> = {
  bad_amount: "Enter how much they will guarantee.",
  above_free: "They can only guarantee deposits they have not already pledged or borrowed.",
};

function assertBorrow(amountCents: number, freeCents: number, product: LoanProduct): void {
  const reason = refuseBorrow({
    amountCents,
    freeCents,
    minimumCents: product.minimumCents,
    maximumCents: product.maximumCents,
  });
  if (reason !== null) throw new LoanError(422, reason, BORROW[reason] ?? "That amount does not fit.");
  if (amountCents % 100 !== 0) {
    throw new LoanError(422, "bad_amount", "Enter whole shillings. M-Pesa does not take cents.");
  }
  const payout = payoutCents(amountCents, product.feePercent);
  if (payout === null || payout.netCents > MAX_PAYOUT_CENTS) {
    throw new LoanError(422, "bad_amount", "M-Pesa pays out at most KES 250,000 after the fee.");
  }
}

type Invite = { memberId: string; amountCents: number };

export async function createApplication(
  pool: Db,
  memberId: string,
  input: { productCode: string; amountCents: number; termCount: number; purpose: string; phone: string; guarantors: Invite[] },
): Promise<ApplicationView> {
  const product = productByCode(input.productCode);
  if (product === null) throw new LoanError(422, "unknown_product", "Choose a loan from the list.");
  if (input.termCount < product.termMin || input.termCount > product.termMax) {
    throw new LoanError(422, "bad_term", "That repayment period is not on this loan.");
  }
  const seen = new Set<string>();
  for (const invite of input.guarantors) {
    if (seen.has(invite.memberId)) throw new LoanError(422, "duplicate_guarantor", "Each member can guarantee this loan once.");
    seen.add(invite.memberId);
  }
  if (input.guarantors.length < product.minimumGuarantors) {
    throw new LoanError(422, "need_guarantors", `This loan needs ${product.minimumGuarantors} guarantors.`);
  }
  const mismatch = coverMismatch(
    input.amountCents,
    input.guarantors.map((row) => row.amountCents),
  );
  if (mismatch === "short") throw new LoanError(422, "need_cover", "Guarantees have to add up to the loan.");
  if (mismatch === "over") throw new LoanError(422, "need_cover", "Guarantees are more than the loan.");

  const id = await withTx(pool, async (conn) => {
    const [open] = await conn.query<Row>(
      `SELECT id FROM loan_applications WHERE member_id = ? AND status IN (${OPEN_STATUSES.map(() => "?").join(", ")}) LIMIT 1 FOR UPDATE`,
      [memberId, ...OPEN_STATUSES],
    );
    if (open.length > 0) throw new LoanError(409, "open_loan", "You already have a loan in progress.");
    const borrower = await capacityLocked(conn, memberId, null);
    assertBorrow(input.amountCents, borrower.freeCents, product);
    const ordered = [...input.guarantors].sort((a, b) => a.memberId.localeCompare(b.memberId));
    for (const invite of ordered) {
      const [who] = await conn.query<Row>("SELECT id FROM members WHERE id = ? LIMIT 1", [invite.memberId]);
      if (who.length === 0) throw new LoanError(422, "unknown_member", "That member is not in the crew.");
      const theirs = await capacityLocked(conn, invite.memberId, null);
      const reason = refuseGuarantee({
        borrowerId: memberId,
        guarantorId: invite.memberId,
        amountCents: invite.amountCents,
        guarantorFreeCents: theirs.freeCents,
      });
      if (reason !== null) throw new LoanError(422, reason, GUARANTEE[reason] ?? "That guarantee does not fit.");
      if (invite.amountCents % 100 !== 0) {
        throw new LoanError(422, "bad_amount", "Guarantees are in whole shillings.");
      }
    }
    const self = input.guarantors.find((row) => row.memberId === memberId);
    const others = input.guarantors.filter((row) => row.memberId !== memberId);
    const met = guaranteesMet({
      minimumGuarantors: product.minimumGuarantors,
      coveragePercent: 100,
      requestedCents: input.amountCents,
      acceptedCount: self === undefined ? 0 : 1,
      acceptedCents: self?.amountCents ?? 0,
    });
    const status = statusAfterSubmit({ invites: others.length, guaranteesMet: met && others.length === 0 });
    const applicationId = randomBytes(16).toString("hex");
    const now = stamp();
    await conn.query(
      `INSERT INTO loan_applications
        (id, member_id, product_code, amount_cents, term_count, purpose, phone, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [applicationId, memberId, product.code, input.amountCents, input.termCount, input.purpose, input.phone, status, now, now],
    );
    for (const invite of input.guarantors) {
      const pledge = invite.memberId === memberId ? "accepted" : "invited";
      await conn.query(
        `INSERT INTO loan_guarantors (id, application_id, member_id, amount_cents, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [randomBytes(16).toString("hex"), applicationId, invite.memberId, invite.amountCents, pledge, now],
      );
    }
    return applicationId;
  });
  return viewOf(pool, id);
}

export async function inviteGuarantor(
  pool: Db,
  memberId: string,
  applicationId: string,
  invite: Invite,
): Promise<ApplicationView> {
  await withTx(pool, async (conn) => {
    const [rows] = await conn.query<Row>(
      "SELECT id, member_id, product_code, amount_cents, status FROM loan_applications WHERE id = ? FOR UPDATE",
      [applicationId],
    );
    const row = rows[0];
    if (row === undefined || String(row["member_id"]) !== memberId) {
      throw new LoanError(404, "unknown_loan", "That application is not on the books.");
    }
    if (String(row["status"]) !== "awaiting_guarantors") {
      throw new LoanError(409, "not_ready", "Guarantors can be asked while the loan is waiting on them.");
    }
    const [dup] = await conn.query<Row>(
      "SELECT id FROM loan_guarantors WHERE application_id = ? AND member_id = ? AND status IN ('invited', 'accepted') LIMIT 1",
      [applicationId, invite.memberId],
    );
    if (dup.length > 0) throw new LoanError(409, "duplicate_guarantor", "That member is already on this loan.");
    const [who] = await conn.query<Row>("SELECT id FROM members WHERE id = ? LIMIT 1", [invite.memberId]);
    if (who.length === 0) throw new LoanError(422, "unknown_member", "That member is not in the crew.");
    const theirs = await capacityLocked(conn, invite.memberId, null);
    const reason = refuseGuarantee({
      borrowerId: memberId,
      guarantorId: invite.memberId,
      amountCents: invite.amountCents,
      guarantorFreeCents: theirs.freeCents,
    });
    if (reason !== null) throw new LoanError(422, reason, GUARANTEE[reason] ?? "That guarantee does not fit.");
    if (invite.amountCents % 100 !== 0) throw new LoanError(422, "bad_amount", "Guarantees are in whole shillings.");
    const [held] = await conn.query<Row>(
      "SELECT COALESCE(SUM(amount_cents), 0) AS total FROM loan_guarantors WHERE application_id = ? AND status IN ('invited', 'accepted')",
      [applicationId],
    );
    if (cents(held[0]?.["total"]) + invite.amountCents > cents(row["amount_cents"])) {
      throw new LoanError(422, "need_cover", "Guarantees cannot add up to more than the loan.");
    }
    await conn.query(
      `INSERT INTO loan_guarantors (id, application_id, member_id, amount_cents, status, created_at)
       VALUES (?, ?, ?, ?, 'invited', ?)`,
      [randomBytes(16).toString("hex"), applicationId, invite.memberId, invite.amountCents, stamp()],
    );
  });
  return viewOf(pool, applicationId);
}

async function promoteIfReady(conn: Conn, applicationId: string): Promise<void> {
  const application = await viewOf(conn, applicationId);
  const pending = application.guarantors.some((row) => row.status === "invited");
  if (!pending && application.coverage.met && application.status === "awaiting_guarantors") {
    await conn.query("UPDATE loan_applications SET status = 'under_appraisal', updated_at = ? WHERE id = ?", [
      stamp(),
      applicationId,
    ]);
  }
}

export async function respondToGuarantee(
  pool: Db,
  memberId: string,
  guarantorId: string,
  accept: boolean,
): Promise<void> {
  await withTx(pool, async (conn) => {
    const [rows] = await conn.query<Row>(
      "SELECT id, application_id, member_id, amount_cents, status FROM loan_guarantors WHERE id = ? FOR UPDATE",
      [guarantorId],
    );
    const row = rows[0];
    if (row === undefined || String(row["member_id"]) !== memberId) {
      throw new LoanError(404, "unknown_loan", "That request is not yours.");
    }
    if (String(row["status"]) !== "invited") throw new LoanError(409, "not_ready", "That request has already been answered.");
    const applicationId = String(row["application_id"]);
    if (!accept) {
      await conn.query("UPDATE loan_guarantors SET status = 'declined' WHERE id = ?", [guarantorId]);
      await promoteIfReady(conn, applicationId);
      return;
    }
    const amount = cents(row["amount_cents"]);
    const theirs = await capacityLocked(conn, memberId, guarantorId);
    if (amount > theirs.freeCents) {
      throw new LoanError(422, "above_free", "You can only guarantee deposits you have not already pledged or borrowed.");
    }
    await conn.query("UPDATE loan_guarantors SET status = 'accepted' WHERE id = ?", [guarantorId]);
    await promoteIfReady(conn, applicationId);
  });
}

export async function listQueue(pool: Db): Promise<ApplicationView[]> {
  const [rows] = await pool.query<Row>(
    `SELECT id FROM loan_applications
     WHERE status NOT IN ('rejected', 'cancelled', 'disbursed')
     ORDER BY created_at ASC
     LIMIT 100`,
  );
  const list: ApplicationView[] = [];
  for (const row of rows) list.push(await viewOf(pool, String(row["id"])));
  return list;
}

export async function appraise(
  pool: Db,
  applicationId: string,
  input: { recommendedCents: number; notes: string; riskRating: "low" | "medium" | "high" | null },
): Promise<ApplicationView> {
  await withTx(pool, async (conn) => {
    const [rows] = await conn.query<Row>(
      "SELECT id, amount_cents, status FROM loan_applications WHERE id = ? FOR UPDATE",
      [applicationId],
    );
    const row = rows[0];
    if (row === undefined) throw new LoanError(404, "unknown_loan", "That application is not on the books.");
    const current = await viewOf(conn, applicationId);
    if (gate("appraise", String(row["status"]), current.coverage.met) !== null) {
      throw new LoanError(409, "not_ready", "Appraisal waits until the guarantees are in.");
    }
    const requested = cents(row["amount_cents"]);
    if (input.recommendedCents > requested) {
      throw new LoanError(422, "above_request", "The recommendation cannot be more than they asked for.");
    }
    if (input.recommendedCents % 100 !== 0 || input.recommendedCents <= 0) {
      throw new LoanError(422, "bad_amount", "Enter whole shillings.");
    }
    await conn.query(
      `UPDATE loan_applications
       SET recommended_cents = ?, appraisal_notes = ?, risk_rating = ?, status = 'awaiting_approval', updated_at = ?
       WHERE id = ?`,
      [input.recommendedCents, input.notes, input.riskRating, stamp(), applicationId],
    );
  });
  return viewOf(pool, applicationId);
}

export async function decide(
  pool: Db,
  applicationId: string,
  input: { decision: "approve" | "reject"; amountCents: number | null; termCount: number | null; notes: string },
): Promise<ApplicationView> {
  await withTx(pool, async (conn) => {
    const [rows] = await conn.query<Row>(
      "SELECT * FROM loan_applications WHERE id = ? FOR UPDATE",
      [applicationId],
    );
    const row = rows[0];
    if (row === undefined) throw new LoanError(404, "unknown_loan", "That application is not on the books.");
    const current = await viewOf(conn, applicationId);
    if (gate("decide", String(row["status"]), current.coverage.met) !== null) {
      throw new LoanError(409, "not_ready", "A decision waits until the loan has been appraised.");
    }
    if (input.decision === "reject") {
      await conn.query(
        `UPDATE loan_applications
         SET status = 'rejected', decision_notes = ?, updated_at = ?
         WHERE id = ?`,
        [input.notes, stamp(), applicationId],
      );
      await conn.query(
        "UPDATE loan_guarantors SET status = 'released' WHERE application_id = ? AND status IN ('invited', 'accepted')",
        [applicationId],
      );
      return;
    }
    const product = productByCode(String(row["product_code"]));
    if (product === null || input.amountCents === null) {
      throw new LoanError(422, "bad_amount", "State the approved amount.");
    }
    const term = input.termCount ?? Number(row["term_count"]);
    if (term < product.termMin || term > product.termMax) {
      throw new LoanError(422, "bad_term", "That repayment period is not on this loan.");
    }
    const requested = cents(row["amount_cents"]);
    if (input.amountCents > requested) {
      throw new LoanError(422, "above_request", "Approval cannot be more than they asked for.");
    }
    const borrower = await capacityLocked(conn, String(row["member_id"]), null);
    assertBorrow(input.amountCents, borrower.freeCents, product);
    await conn.query(
      `UPDATE loan_applications
       SET status = 'approved', approved_cents = ?, approved_term = ?, decision_notes = ?, updated_at = ?
       WHERE id = ?`,
      [input.amountCents, term, input.notes, stamp(), applicationId],
    );
  });
  return viewOf(pool, applicationId);
}

async function failPayout(pool: Db, applicationId: string, paymentId: string): Promise<void> {
  await pool.query("UPDATE payments SET status = 'failed', result_code = 'mpesa' WHERE id = ? AND status = 'pending'", [paymentId]);
  await pool.query("UPDATE loans SET status = 'failed' WHERE application_id = ? AND payment_id = ? AND status = 'pending'", [
    applicationId,
    paymentId,
  ]);
}

export async function disburse(pool: Db, rails: Rails, applicationId: string): Promise<ApplicationView> {
  const ready = await viewOf(pool, applicationId);
  if (ready.loan?.status === "active" || ready.status === "disbursed") return viewOf(pool, applicationId);
  if (gate("disburse", ready.status, ready.coverage.met) !== null && ready.loan?.status !== "pending") {
    throw new LoanError(409, "not_ready", "Only an approved loan can be paid out.");
  }
  if (ready.loan?.status === "pending" && ready.loan !== null) {
    if (rails.mode === "mock") {
      const [pay] = await pool.query<Row>("SELECT payment_id FROM loans WHERE application_id = ? LIMIT 1", [applicationId]);
      const paymentId = pay[0]?.["payment_id"];
      if (typeof paymentId === "string") await completeLoanOut(pool, paymentId);
    }
    return viewOf(pool, applicationId);
  }
  const principal = ready.approvedCents;
  const product = productByCode(ready.productCode);
  if (principal === null || product === null) throw new LoanError(409, "not_ready", "Only an approved loan can be paid out.");
  const payout = payoutCents(principal, product.feePercent);
  if (payout === null) throw new LoanError(422, "bad_amount", "Fees would consume the whole loan.");
  let paymentId: string;
  try {
    const started = await startLoanPayout(pool, rails, {
      memberId: ready.memberId,
      amountCents: payout.netCents,
      phone: ready.phone,
    });
    paymentId = started.paymentId;
  } catch (error) {
    if (error instanceof PaymentError) throw new LoanError(error.status, error.code, error.message);
    throw error;
  }
  try {
    if (ready.loan?.status === "failed") {
      await pool.query(
        `UPDATE loans
         SET principal_cents = ?, fee_cents = ?, net_cents = ?, status = 'pending', payment_id = ?, disbursed_at = NULL
         WHERE application_id = ? AND status = 'failed'`,
        [principal, payout.feeCents, payout.netCents, paymentId, applicationId],
      );
    } else {
      await pool.query(
        `INSERT INTO loans
          (id, application_id, member_id, principal_cents, fee_cents, net_cents, status, payment_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        [randomBytes(16).toString("hex"), applicationId, ready.memberId, principal, payout.feeCents, payout.netCents, paymentId, stamp()],
      );
    }
  } catch (error) {
    await failPayout(pool, applicationId, paymentId);
    throw error;
  }
  if (rails.mode === "mock") {
    try {
      await completeLoanOut(pool, paymentId);
    } catch (error) {
      await failPayout(pool, applicationId, paymentId);
      throw error;
    }
  }
  return viewOf(pool, applicationId);
}

export async function claimCents(pool: Db, memberId: string): Promise<number> {
  return depositsOf(pool, memberId, false);
}
