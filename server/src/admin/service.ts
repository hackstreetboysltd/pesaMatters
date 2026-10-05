import type { Db, Row } from "../db.ts";
import { listInvestments, listMembers, verifyStoredChain, type InvestmentView, type Member } from "../store.ts";
import { listQueue, type ApplicationView } from "../loans/service.ts";
import { LOAN_PRODUCTS, type LoanProduct } from "../loans/products.ts";

export type AdminOverview = {
  crewCount: number;
  cashCents: number;
  pendingPayments: number;
  failedPaymentsWeek: number;
  openLoans: number;
  ledger: { ok: true; length: number } | { ok: false; index: number; reason: string };
  health: "live" | "degraded";
};

export type CrewRow = {
  id: string;
  name: string;
  email: string;
  claimCents: number;
  createdAt: string;
};

export type TreasurySnapshot = {
  cashCents: number;
  claims: { memberId: string; name: string; claimCents: number }[];
  claimsTotalCents: number;
};

export type PaymentRow = {
  id: string;
  memberId: string;
  memberName: string;
  kind: string;
  amountCents: number;
  status: string;
  createdAt: string;
};

/** Pure: pick live vs degraded from ledger + payment pressure. */
export function adminHealthOf(input: {
  ledgerOk: boolean;
  pendingPayments: number;
  failedPaymentsWeek: number;
}): "live" | "degraded" {
  if (!input.ledgerOk) return "degraded";
  if (input.failedPaymentsWeek > 0) return "degraded";
  if (input.pendingPayments > 5) return "degraded";
  return "live";
}

export async function loadOverview(pool: Db): Promise<AdminOverview> {
  const [[crew], [cashRows], [pending], [failed], [openLoans], ledger] = await Promise.all([
    pool.query<Row>("SELECT COUNT(*)::int AS n FROM members"),
    pool.query<Row>("SELECT cash_cents FROM treasury WHERE id = 1 LIMIT 1"),
    pool.query<Row>("SELECT COUNT(*)::int AS n FROM payments WHERE status IN ('pending', 'settling')"),
    pool.query<Row>(
      `SELECT COUNT(*)::int AS n FROM payments
       WHERE status = 'failed' AND created_at > NOW() - INTERVAL '7 days'`,
    ),
    pool.query<Row>(
      `SELECT COUNT(*)::int AS n FROM loan_applications
       WHERE status NOT IN ('rejected', 'cancelled', 'disbursed')`,
    ),
    verifyStoredChain(pool),
  ]);
  const crewCount = Number(crew[0]?.["n"] ?? 0);
  const cashCents = Number(cashRows[0]?.["cash_cents"] ?? 0);
  const pendingPayments = Number(pending[0]?.["n"] ?? 0);
  const failedPaymentsWeek = Number(failed[0]?.["n"] ?? 0);
  const open = Number(openLoans[0]?.["n"] ?? 0);
  const ledgerOk = ledger.ok;
  return {
    crewCount,
    cashCents,
    pendingPayments,
    failedPaymentsWeek,
    openLoans: open,
    ledger,
    health: adminHealthOf({ ledgerOk, pendingPayments, failedPaymentsWeek }),
  };
}

export async function loadCrew(pool: Db): Promise<CrewRow[]> {
  const members = await listMembers(pool);
  const [claims] = await pool.query<Row>("SELECT member_id, claim_cents FROM claims");
  const byId = new Map<string, number>();
  for (const row of claims) {
    byId.set(String(row["member_id"]), Number(row["claim_cents"] ?? 0));
  }
  return members.map((member: Member) => ({
    id: member.id,
    name: member.name,
    email: member.email,
    claimCents: byId.get(member.id) ?? 0,
    createdAt: member.createdAt,
  }));
}

export async function loadTreasury(pool: Db): Promise<TreasurySnapshot> {
  const [cashRows] = await pool.query<Row>("SELECT cash_cents FROM treasury WHERE id = 1 LIMIT 1");
  const cashCents = Number(cashRows[0]?.["cash_cents"] ?? 0);
  const [rows] = await pool.query<Row>(
    `SELECT c.member_id, c.claim_cents, m.name
     FROM claims c
     JOIN members m ON m.id = c.member_id
     ORDER BY c.claim_cents DESC, m.name ASC`,
  );
  const claims = rows.map((row) => ({
    memberId: String(row["member_id"]),
    name: String(row["name"]),
    claimCents: Number(row["claim_cents"] ?? 0),
  }));
  return {
    cashCents,
    claims,
    claimsTotalCents: claims.reduce((sum, row) => sum + row.claimCents, 0),
  };
}

export async function loadPayments(pool: Db, limit: number): Promise<PaymentRow[]> {
  const capped = Math.min(Math.max(limit, 1), 100);
  const [rows] = await pool.query<Row>(
    `SELECT p.id, p.member_id, p.kind, p.amount_cents, p.status, p.created_at, m.name AS member_name
     FROM payments p
     JOIN members m ON m.id = p.member_id
     ORDER BY p.created_at DESC
     LIMIT ?`,
    [capped],
  );
  return rows.map((row) => ({
    id: String(row["id"]),
    memberId: String(row["member_id"]),
    memberName: String(row["member_name"]),
    kind: String(row["kind"]),
    amountCents: Number(row["amount_cents"]),
    status: String(row["status"]),
    createdAt: toIso(row["created_at"]),
  }));
}

export async function loadAdminInvestments(pool: Db): Promise<InvestmentView[]> {
  return listInvestments(pool);
}

export async function loadAdminLoans(pool: Db): Promise<ApplicationView[]> {
  return listQueue(pool);
}

export function loadProducts(): readonly LoanProduct[] {
  return LOAN_PRODUCTS;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date(String(value)).toISOString();
}
