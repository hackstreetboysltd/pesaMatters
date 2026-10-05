import type { LoanApplication } from "../api";

export class AdminError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type AdminUser = { id: string; name: string; email: string };

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

export type InvestmentRow = {
  id: string;
  symbol: string;
  name: string;
  units: number;
  valueCents: number;
  gainCents: number;
};

export type LoanProduct = {
  code: string;
  name: string;
  interestPercent: number;
  termMin: number;
  termMax: number;
  termUnit: string;
  minimumCents: number;
  maximumCents: number;
};

export type AdminCapacity = {
  depositsCents: number;
  outstandingCents: number;
  pledgedCents: number;
  freeCents: number;
};

function readCookie(name: string): string | null {
  const parts = document.cookie.split("; ");
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1));
  }
  return null;
}

async function ensureCsrf(): Promise<string> {
  const existing = readCookie("hs_csrf");
  if (existing !== null) return existing;
  const response = await fetch("/api/auth/csrf", { credentials: "include" });
  if (!response.ok) throw new AdminError(response.status, "csrf", "Could not start a secure session.");
  const token = readCookie("hs_csrf");
  if (token === null) throw new AdminError(500, "csrf", "Could not start a secure session.");
  return token;
}

async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? "GET";
  const headers = new Headers();
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  if (method !== "GET" && method !== "HEAD") headers.set("X-CSRF-Token", await ensureCsrf());
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "include",
      headers,
      body: init.body === undefined ? null : JSON.stringify(init.body),
    });
  } catch {
    throw new AdminError(0, "network", "Admin is unreachable.");
  }
  if (response.status === 401 && path !== "/api/admin/me" && !path.includes("/auth/google")) {
    window.location.assign("/admin/login");
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      data !== null &&
      typeof data === "object" &&
      "error" in data &&
      typeof (data as { error?: { message?: unknown } }).error?.message === "string"
        ? (data as { error: { message: string } }).error.message
        : "That did not work.";
    const code =
      data !== null &&
      typeof data === "object" &&
      "error" in data &&
      typeof (data as { error?: { code?: unknown } }).error?.code === "string"
        ? (data as { error: { code: string } }).error.code
        : "request_failed";
    throw new AdminError(response.status, code, message);
  }
  return data as T;
}

export const adminApi = {
  googleConfig: () =>
    request<{ enabled: boolean; clientId?: string; redirectUri?: string }>("/api/admin/auth/google"),
  googleCallback: (body: { code: string; verifier: string }) =>
    request<{ admin: AdminUser }>("/api/admin/auth/google/callback", { method: "POST", body }),
  me: () => request<{ admin: AdminUser }>("/api/admin/me"),
  logout: () => request<{ ok: boolean }>("/api/admin/logout", { method: "POST", body: {} }),
  overview: () => request<AdminOverview>("/api/admin/overview"),
  crew: () => request<{ crew: CrewRow[] }>("/api/admin/crew"),
  treasury: () => request<TreasurySnapshot>("/api/admin/treasury"),
  payments: () => request<{ payments: PaymentRow[] }>("/api/admin/payments"),
  investments: () => request<{ investments: InvestmentRow[] }>("/api/admin/investments"),
  loans: () => request<{ applications: LoanApplication[] }>("/api/admin/loans"),
  loan: (id: string) =>
    request<{ application: LoanApplication; capacity: AdminCapacity }>(`/api/admin/loans/${id}`),
  appraise: (id: string, body: { recommendedCents: number; notes: string; riskRating?: "low" | "medium" | "high" }) =>
    request<{ application: LoanApplication }>(`/api/admin/loans/${id}/appraise`, { method: "POST", body }),
  decide: (
    id: string,
    body: { decision: "approve" | "reject"; amountCents?: number; termCount?: number; notes: string },
  ) => request<{ application: LoanApplication }>(`/api/admin/loans/${id}/decide`, { method: "POST", body }),
  disburse: (id: string) =>
    request<{ application: LoanApplication }>(`/api/admin/loans/${id}/disburse`, { method: "POST", body: {} }),
  products: () => request<{ products: LoanProduct[] }>("/api/admin/products"),
  ledgerVerify: () =>
    request<{ ok: true; length: number } | { ok: false; index: number; reason: string }>("/api/admin/ledger/verify"),
};
