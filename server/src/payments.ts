import { randomBytes } from "node:crypto";
import type { Db, Row } from "./db.ts";
import { isUniqueViolation } from "./db.ts";
import { MoneyError } from "./money.ts";
import type { Rails } from "./mpesa/client.ts";
import { stkOutcome } from "./mpesa/daraja.ts";
import { receiptNumberFromHash, shownMpesaReceipt } from "./receiptNo.ts";
import { receiptPdf } from "./receiptPdf.ts";
import { settleLoanOut } from "./loans/settle.ts";
import { realNowIso } from "./realTime.ts";
import { appendEntry } from "./store.ts";

export class PaymentError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "PaymentError";
    this.status = status;
    this.code = code;
  }
}

export type PaymentKind = "deposit" | "withdraw" | "transfer" | "loan_out";

type PaymentStatus = "pending" | "settling" | "succeeded" | "failed";

type PaymentRow = {
  id: string;
  memberId: string;
  kind: PaymentKind;
  amountCents: number;
  counterpartyId: string | null;
  status: PaymentStatus;
  checkoutRequestId: string | null;
  merchantRequestId: string | null;
  mpesaReceipt: string | null;
  resultCode: string | null;
  blockId: number | null;
  blockHash: string | null;
  createdAt: string;
  actorName: string;
  counterpartyName: string | null;
};

export type ReceiptView = {
  id: string;
  kind: PaymentKind;
  status: PaymentStatus;
  amountCents: number;
  createdAt: string;
  mpesaReceipt: string | null;
  blockId: number | null;
  blockHash: string | null;
  receiptNumber: string | null;
  actorName: string;
  counterpartyName: string | null;
  awaitingApproval: boolean;
};

const MAX_MPESA_CENTS = 250_000 * 100;

type StartInput = {
  memberId: string;
  kind: PaymentKind;
  amountCents: number;
  idempotencyKey: string;
  phone: string | null;
  toMemberId: string | null;
};

function asKind(value: string): PaymentKind {
  if (value === "deposit" || value === "withdraw" || value === "transfer" || value === "loan_out") return value;
  throw new PaymentError(500, "server_error", "Something went wrong. Try again.");
}

function asStatus(value: string): PaymentStatus {
  if (value === "pending" || value === "settling" || value === "succeeded" || value === "failed") return value;
  throw new PaymentError(500, "server_error", "Something went wrong. Try again.");
}

function isoFromDb(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "string") return new Date(Number(value)).toISOString();
  if (value.endsWith("Z") || value.includes("T")) return new Date(value).toISOString();
  return `${value.replace(" ", "T")}Z`;
}

type Joined = Row & {
  id: string;
  member_id: string;
  kind: string;
  amount_cents: number;
  counterparty_id: string | null;
  status: string;
  checkout_request_id: string | null;
  merchant_request_id: string | null;
  mpesa_receipt: string | null;
  result_code: string | null;
  block_id: number | null;
  block_hash: string | null;
  created_at: string;
  actor_name: string;
  counterparty_name: string | null;
};

function fromJoined(row: Joined): PaymentRow {
  return {
    id: row.id,
    memberId: row.member_id,
    kind: asKind(row.kind),
    amountCents: Number(row.amount_cents),
    counterpartyId: row.counterparty_id,
    status: asStatus(row.status),
    checkoutRequestId: row.checkout_request_id,
    merchantRequestId: row.merchant_request_id,
    mpesaReceipt: row.mpesa_receipt,
    resultCode: row.result_code,
    blockId: row.block_id === null ? null : Number(row.block_id),
    blockHash: typeof row.block_hash === "string" ? row.block_hash : null,
    createdAt: isoFromDb(row.created_at),
    actorName: row.actor_name,
    counterpartyName: row.counterparty_name,
  };
}

const SELECT_JOIN = `
  SELECT p.id, p.member_id, p.kind, p.amount_cents, p.counterparty_id, p.status,
         p.checkout_request_id, p.merchant_request_id, p.mpesa_receipt, p.result_code,
         p.block_id, b.hash AS block_hash, p.created_at, actor.name AS actor_name, other.name AS counterparty_name
  FROM payments p
  JOIN members actor ON actor.id = p.member_id
  LEFT JOIN members other ON other.id = p.counterparty_id
  LEFT JOIN blocks b ON b.id = p.block_id
`;

async function byId(pool: Db, id: string): Promise<PaymentRow | null> {
  const [rows] = await pool.query<Joined>(`${SELECT_JOIN} WHERE p.id = ?`, [id]);
  const row = rows[0];
  return row === undefined ? null : fromJoined(row);
}

async function byCheckout(pool: Db, checkoutOrMerchant: string): Promise<PaymentRow | null> {
  const [rows] = await pool.query<Joined>(
    `${SELECT_JOIN} WHERE p.checkout_request_id = ? OR p.merchant_request_id = ? LIMIT 1`,
    [checkoutOrMerchant, checkoutOrMerchant],
  );
  const row = rows[0];
  return row === undefined ? null : fromJoined(row);
}

function awaitingApproval(row: PaymentRow): boolean {
  return row.kind === "withdraw" && row.status === "pending" && row.checkoutRequestId === null;
}

function viewOf(row: PaymentRow): ReceiptView {
  const blockHash = row.blockHash;
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    amountCents: row.amountCents,
    createdAt: row.createdAt,
    mpesaReceipt: shownMpesaReceipt(row.mpesaReceipt),
    blockId: row.blockId,
    blockHash,
    receiptNumber: blockHash === null ? null : receiptNumberFromHash(blockHash),
    actorName: row.actorName,
    counterpartyName: row.counterpartyName,
    awaitingApproval: awaitingApproval(row),
  };
}

function canSee(row: PaymentRow, memberId: string): boolean {
  return row.memberId === memberId || row.counterpartyId === memberId;
}

async function loadSeen(pool: Db, id: string, memberId: string): Promise<PaymentRow> {
  const row = await byId(pool, id);
  if (row === null || !canSee(row, memberId)) {
    throw new PaymentError(404, "unknown_payment", "That receipt is not on your activity.");
  }
  return row;
}

function sameAttempt(row: PaymentRow, input: StartInput): boolean {
  return (
    row.kind === input.kind &&
    row.amountCents === input.amountCents &&
    (row.counterpartyId ?? "") === (input.toMemberId ?? "")
  );
}

async function existingAttempt(pool: Db, input: StartInput): Promise<PaymentRow | null> {
  const [rows] = await pool.query<Joined>(`${SELECT_JOIN} WHERE p.member_id = ? AND p.idempotency_key = ?`, [
    input.memberId,
    input.idempotencyKey,
  ]);
  const row = rows[0];
  if (row === undefined) return null;
  const payment = fromJoined(row);
  if (!sameAttempt(payment, input)) {
    throw new PaymentError(409, "idempotency", "That attempt was already used for a different move.");
  }
  return payment;
}

async function assertFunds(pool: Db, memberId: string, amountCents: number, needCash: boolean): Promise<void> {
  const [claims] = await pool.query<Row>("SELECT claim_cents FROM claims WHERE member_id = ?", [memberId]);
  const claim = Number(claims[0]?.["claim_cents"] ?? NaN);
  if (!Number.isInteger(claim)) {
    throw new PaymentError(404, "unknown_member", "That member is not in the group.");
  }
  if (claim < amountCents) {
    throw new PaymentError(422, "insufficient_claim", "That is more than you can move.");
  }
  if (!needCash) return;
  const [cashRows] = await pool.query<Row>("SELECT cash_cents FROM treasury WHERE id = 1");
  const cash = Number(cashRows[0]?.["cash_cents"] ?? 0);
  if (cash < amountCents) {
    throw new PaymentError(
      422,
      "insufficient_cash",
      "The pot's cash is tied up in investments. A sale has to happen before this withdrawal.",
    );
  }
}

async function assertCounterparty(pool: Db, memberId: string, toMemberId: string): Promise<void> {
  if (memberId === toMemberId) {
    throw new PaymentError(422, "same_member", "Choose a different member.");
  }
  const [rows] = await pool.query<Row>("SELECT id FROM members WHERE id = ?", [toMemberId]);
  if (rows.length === 0) {
    throw new PaymentError(404, "unknown_member", "That member is not in the group.");
  }
}

function isDuplicate(error: unknown): boolean {
  return isUniqueViolation(error);
}

async function insertPending(pool: Db, input: StartInput, id: string): Promise<void> {
  const created = realNowIso();
  await pool.query(
    `INSERT INTO payments
      (id, member_id, idempotency_key, kind, amount_cents, counterparty_id, phone, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [id, input.memberId, input.idempotencyKey, input.kind, input.amountCents, input.toMemberId, input.phone, created],
  );
}

async function setFailed(pool: Db, id: string, code: string): Promise<void> {
  await pool.query("UPDATE payments SET status = 'failed', result_code = ? WHERE id = ? AND status IN ('pending', 'settling')", [
    code.slice(0, 16),
    id,
  ]);
}

async function payoutPhone(pool: Db, paymentId: string): Promise<string> {
  const [rows] = await pool.query<Row>("SELECT phone FROM payments WHERE id = ?", [paymentId]);
  const phone = rows[0]?.["phone"];
  if (typeof phone !== "string" || phone.length === 0) {
    throw new PaymentError(422, "bad_phone", "That withdrawal has no M-Pesa number on file.");
  }
  return phone;
}

async function sendB2c(
  pool: Db,
  rails: Rails,
  row: { id: string; amountCents: number; phone: string },
  offMessage: string,
): Promise<void> {
  const shillings = row.amountCents / 100;
  try {
    const sent = await rails.b2c({ phone: row.phone, amountKsh: shillings, accountRef: row.id });
    await pool.query("UPDATE payments SET checkout_request_id = ?, merchant_request_id = ? WHERE id = ?", [
      sent.conversationId,
      sent.originatorConversationId,
      row.id,
    ]);
  } catch (error) {
    const code = error instanceof Error && error.message === "mpesa_b2c_unconfigured" ? "b2c_off" : "mpesa";
    await setFailed(pool, row.id, code);
    if (code === "b2c_off") {
      throw new PaymentError(503, "b2c_off", offMessage);
    }
    throw new PaymentError(502, "mpesa", "M-Pesa did not accept that request. Try again.");
  }
}

async function claimPending(pool: Db, id: string): Promise<PaymentRow | null> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<Joined>(`${SELECT_JOIN} WHERE p.id = ? FOR UPDATE OF p`, [id]);
    const row = rows[0];
    if (row === undefined) {
      await conn.commit();
      return null;
    }
    const payment = fromJoined(row);
    if (payment.status !== "pending") {
      await conn.commit();
      return null;
    }
    await conn.query("UPDATE payments SET status = 'settling' WHERE id = ?", [id]);
    await conn.commit();
    return { ...payment, status: "settling" };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function recordLedger(pool: Db, row: PaymentRow, receipt: string | null): Promise<number> {
  const payload = {
    memberId: row.memberId,
    amountCents: row.amountCents,
    paymentId: row.id,
    mpesaReceipt: receipt,
    ...(row.kind === "transfer" && row.counterpartyId !== null ? { counterpartyId: row.counterpartyId } : {}),
  };
  const block = await appendEntry(pool, row.kind, payload);
  return block.id;
}

async function finishPaid(pool: Db, row: PaymentRow, receipt: string | null, resultCode: string): Promise<void> {
  const claimed = await claimPending(pool, row.id);
  if (claimed === null) {
    if (receipt !== null) {
      await pool.query("UPDATE payments SET mpesa_receipt = ? WHERE id = ? AND mpesa_receipt IS NULL", [receipt, row.id]);
    }
    return;
  }
  if (claimed.kind === "loan_out") {
    try {
      await settleLoanOut(pool, claimed.id);
      await pool.query("UPDATE payments SET status = 'succeeded', result_code = ?, mpesa_receipt = ? WHERE id = ?", [
        resultCode.slice(0, 16),
        receipt,
        row.id,
      ]);
    } catch (error) {
      await setFailed(pool, row.id, "ledger");
      throw error;
    }
    return;
  }
  try {
    const blockId = await recordLedger(pool, claimed, receipt);
    await pool.query(
      "UPDATE payments SET status = 'succeeded', result_code = ?, mpesa_receipt = ?, block_id = ? WHERE id = ?",
      [resultCode.slice(0, 16), receipt, blockId, row.id],
    );
  } catch (error) {
    await setFailed(pool, row.id, "ledger");
    if (error instanceof MoneyError) {
      throw new PaymentError(422, error.code, error.message);
    }
    throw error;
  }
}

async function finishFailed(pool: Db, row: PaymentRow, resultCode: string): Promise<void> {
  await setFailed(pool, row.id, resultCode);
}

export async function startPayment(pool: Db, rails: Rails, input: StartInput): Promise<ReceiptView> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new PaymentError(422, "bad_amount", "Enter an amount in shillings.");
  }
  const prior = await existingAttempt(pool, input);
  if (prior !== null) return viewOf(prior);

  if (input.kind === "deposit" || input.kind === "withdraw") {
    if (input.amountCents % 100 !== 0 || input.amountCents > MAX_MPESA_CENTS) {
      throw new PaymentError(422, "bad_amount", "M-Pesa takes whole shillings, up to 250,000.");
    }
    if (input.phone === null) {
      throw new PaymentError(422, "bad_phone", "Enter the nine digits after +254.");
    }
  }
  if (input.kind === "withdraw") await assertFunds(pool, input.memberId, input.amountCents, true);
  if (input.kind === "transfer") {
    if (input.toMemberId === null) throw new PaymentError(422, "bad_member", "Choose who receives it.");
    await assertCounterparty(pool, input.memberId, input.toMemberId);
    await assertFunds(pool, input.memberId, input.amountCents, false);
  }

  const id = randomBytes(16).toString("hex");
  try {
    await insertPending(pool, input, id);
  } catch (error) {
    if (!isDuplicate(error)) throw error;
    const raced = await existingAttempt(pool, input);
    if (raced !== null) return viewOf(raced);
    throw error;
  }

  if (input.kind === "transfer") {
    const row = await byId(pool, id);
    if (row === null) throw new PaymentError(500, "server_error", "Something went wrong. Try again.");
    await finishPaid(pool, row, null, "0");
    const done = await byId(pool, id);
    if (done === null) throw new PaymentError(500, "server_error", "Something went wrong. Try again.");
    return viewOf(done);
  }

  if (input.kind === "deposit") {
    const shillings = input.amountCents / 100;
    const phone = input.phone ?? "";
    try {
      const pushed = await rails.stkPush({ phone, amountKsh: shillings, accountRef: id });
      await pool.query("UPDATE payments SET checkout_request_id = ?, merchant_request_id = ? WHERE id = ?", [
        pushed.checkoutRequestId,
        pushed.merchantRequestId,
        id,
      ]);
    } catch {
      await setFailed(pool, id, "mpesa");
      throw new PaymentError(502, "mpesa", "M-Pesa did not accept that request. Try again.");
    }
  }

  const started = await byId(pool, id);
  if (started === null) throw new PaymentError(500, "server_error", "Something went wrong. Try again.");
  return viewOf(started);
}

export async function checkPayment(pool: Db, rails: Rails, id: string, memberId: string): Promise<ReceiptView> {
  const row = await loadSeen(pool, id, memberId);
  if (row.memberId !== memberId) return viewOf(row);
  if (row.status !== "pending" || row.checkoutRequestId === null) return viewOf(await loadSeen(pool, id, memberId));

  if (row.kind === "deposit") {
    let queried: { resultCode: string };
    try {
      queried = await rails.stkQuery(row.checkoutRequestId);
    } catch {
      return viewOf(row);
    }
    const outcome = stkOutcome(queried.resultCode);
    if (outcome === "paid") {
      await finishPaid(pool, row, null, queried.resultCode);
    } else if (outcome === "failed") {
      await finishFailed(pool, row, queried.resultCode);
    }
  } else if (row.kind === "withdraw" && row.checkoutRequestId !== null && rails.mode === "mock") {
    await finishPaid(pool, row, null, "0");
  }

  return viewOf(await loadSeen(pool, id, memberId));
}

export async function approveWithdraw(pool: Db, rails: Rails, paymentId: string): Promise<ReceiptView> {
  const row = await byId(pool, paymentId);
  if (row === null) {
    throw new PaymentError(404, "unknown_payment", "That payment is not on the books.");
  }
  if (row.kind !== "withdraw") {
    throw new PaymentError(422, "not_withdraw", "Only withdrawals wait for admin approval.");
  }
  if (row.status !== "pending" || row.checkoutRequestId !== null) {
    throw new PaymentError(409, "not_pending", "That withdrawal is no longer waiting for approval.");
  }
  await assertFunds(pool, row.memberId, row.amountCents, true);
  const phone = await payoutPhone(pool, paymentId);
  const reserve = `hold:${randomBytes(8).toString("hex")}`;
  const [claimed] = await pool.query<Row>(
    `UPDATE payments SET checkout_request_id = ?
     WHERE id = ? AND kind = 'withdraw' AND status = 'pending' AND checkout_request_id IS NULL
     RETURNING id`,
    [reserve, paymentId],
  );
  if (claimed.length === 0) {
    throw new PaymentError(409, "not_pending", "That withdrawal is no longer waiting for approval.");
  }
  try {
    await sendB2c(
      pool,
      rails,
      { id: paymentId, amountCents: row.amountCents, phone },
      "Withdrawals need Daraja B2C credentials in the server environment.",
    );
  } catch (error) {
    await pool.query(
      "UPDATE payments SET checkout_request_id = NULL, status = 'pending', result_code = NULL WHERE id = ? AND checkout_request_id = ?",
      [paymentId, reserve],
    );
    throw error;
  }
  const released = await byId(pool, paymentId);
  if (released === null) throw new PaymentError(500, "server_error", "Something went wrong. Try again.");
  if (rails.mode === "mock") {
    await finishPaid(pool, released, null, "0");
    const done = await byId(pool, paymentId);
    if (done === null) throw new PaymentError(500, "server_error", "Something went wrong. Try again.");
    return viewOf(done);
  }
  return viewOf(released);
}

export async function rejectWithdraw(pool: Db, paymentId: string): Promise<ReceiptView> {
  const row = await byId(pool, paymentId);
  if (row === null) {
    throw new PaymentError(404, "unknown_payment", "That payment is not on the books.");
  }
  if (row.kind !== "withdraw") {
    throw new PaymentError(422, "not_withdraw", "Only withdrawals wait for admin approval.");
  }
  if (row.status !== "pending" || row.checkoutRequestId !== null) {
    throw new PaymentError(409, "not_pending", "That withdrawal is no longer waiting for approval.");
  }
  await setFailed(pool, paymentId, "rejected");
  const rejected = await byId(pool, paymentId);
  if (rejected === null) throw new PaymentError(500, "server_error", "Something went wrong. Try again.");
  return viewOf(rejected);
}

export async function applyDarajaResult(
  pool: Db,
  checkoutOrMerchant: string,
  resultCode: number,
  receipt: string | null,
): Promise<void> {
  const row = await byCheckout(pool, checkoutOrMerchant);
  if (row === null || row.kind === "transfer") return;
  const outcome = stkOutcome(String(resultCode));
  if (outcome === "pending") return;
  if (outcome === "paid") {
    await finishPaid(pool, row, receipt, String(resultCode));
    return;
  }
  await finishFailed(pool, row, String(resultCode));
}

export async function startLoanPayout(
  pool: Db,
  rails: Rails,
  input: { memberId: string; amountCents: number; phone: string },
): Promise<{ paymentId: string }> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0 || input.amountCents % 100 !== 0) {
    throw new PaymentError(422, "bad_amount", "M-Pesa takes whole shillings.");
  }
  if (input.amountCents > MAX_MPESA_CENTS) {
    throw new PaymentError(422, "bad_amount", "M-Pesa pays out at most KES 250,000.");
  }
  const id = randomBytes(16).toString("hex");
  const created = realNowIso();
  await pool.query(
    `INSERT INTO payments
      (id, member_id, idempotency_key, kind, amount_cents, counterparty_id, phone, status, created_at)
     VALUES (?, ?, ?, 'loan_out', ?, NULL, ?, 'pending', ?)`,
    [id, input.memberId, id, input.amountCents, input.phone, created],
  );
  await sendB2c(
    pool,
    rails,
    { id, amountCents: input.amountCents, phone: input.phone },
    "Loan payouts need Daraja B2C credentials in the server environment.",
  );
  return { paymentId: id };
}

export async function completeLoanOut(pool: Db, paymentId: string): Promise<void> {
  const row = await byId(pool, paymentId);
  if (row === null || row.kind !== "loan_out") {
    throw new PaymentError(500, "server_error", "Something went wrong. Try again.");
  }
  if (row.status === "succeeded") return;
  await finishPaid(pool, row, null, "0");
}

export async function receiptFor(pool: Db, id: string, memberId: string): Promise<ReceiptView> {
  return viewOf(await loadSeen(pool, id, memberId));
}

function formatReceiptWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-KE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Nairobi",
  }).format(date);
}

export function receiptPdfFor(row: ReceiptView): Buffer {
  if (row.status !== "succeeded" || row.receiptNumber === null || row.blockHash === null) {
    throw new PaymentError(409, "not_ready", "The receipt is ready after the transaction is confirmed.");
  }
  const shillings = (row.amountCents / 100).toLocaleString("en-KE");
  const kind = row.kind === "deposit" ? "Deposit" : row.kind === "withdraw" || row.kind === "loan_out" ? "Draw" : "Send";
  return receiptPdf({
    kind,
    amount: `KES ${shillings}`,
    from: row.actorName,
    to: row.counterpartyName,
    when: formatReceiptWhen(row.createdAt),
    receiptNumber: row.receiptNumber,
    blockId: row.blockId,
    blockHash: row.blockHash,
    mpesaReceipt: row.mpesaReceipt,
  });
}

export async function receiptFile(pool: Db, id: string, memberId: string): Promise<Buffer> {
  const row = await receiptFor(pool, id, memberId);
  return receiptPdfFor(row);
}
