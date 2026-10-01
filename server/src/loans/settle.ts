import type { Db } from "../db.ts";

/** Marks the loan paid out. Does not touch claims — the payout is not a deposit. */
export async function settleLoanOut(pool: Db, paymentId: string): Promise<void> {
  const at = new Date().toISOString().slice(0, 23).replace("T", " ");
  await pool.query(
    "UPDATE loans SET status = 'active', disbursed_at = ? WHERE payment_id = ? AND status = 'pending'",
    [at, paymentId],
  );
  await pool.query(
    `UPDATE loan_applications a
     JOIN loans l ON l.application_id = a.id
     SET a.status = 'disbursed', a.updated_at = ?
     WHERE l.payment_id = ? AND a.status = 'approved'`,
    [at, paymentId],
  );
}
