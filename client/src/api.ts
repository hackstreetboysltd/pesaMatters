export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type Member = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
};

export type ActivityLine = {
  id: number;
  at: string;
  text: string;
  amountCents: number | null;
  direction: "in" | "out" | "neutral";
};

export type HomePayload = {
  you: { claimCents: number; economicCents: number; share: number };
  pot: { cashCents: number; investedCostCents: number; marketCents: number; valueCents: number };
  recent: ActivityLine[];
};

export type Investment = {
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

export type CloseQuote = {
  symbol: string;
  name: string;
  closeCents: number;
  closeSession: string;
  priorCloseCents: number | null;
  priorSession: string | null;
  dayChangeBps: number | null;
  listedCloseCents: number | null;
  fxKesPerUsd: number | null;
};

export type ListedShare = {
  symbol: string;
  name: string;
};

export type InvestmentDetail = Investment & {
  marks: { at: string; priceCents: number }[];
};

export type Receipt = {
  id: string;
  kind: "deposit" | "withdraw" | "transfer";
  status: "pending" | "settling" | "succeeded" | "failed";
  amountCents: number;
  createdAt: string;
  mpesaReceipt: string | null;
  blockId: number | null;
  blockHash: string | null;
  receiptNumber: string | null;
  actorName: string;
  counterpartyName: string | null;
};

export type LoanProduct = {
  code: string;
  name: string;
  interestPercent: number;
  termMin: number;
  termMax: number;
  termUnit: "weeks" | "months";
  minimumCents: number;
  maximumCents: number;
  minimumGuarantors: number;
  coveragePercent: number;
  feePercent: number;
};

export type LoanGuarantor = {
  id: string;
  memberId: string;
  name: string;
  amountCents: number;
  status: string;
};

export type LoanApplication = {
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
  guarantors: LoanGuarantor[];
  coverage: {
    acceptedCents: number;
    requiredCents: number;
    acceptedCount: number;
    minimumGuarantors: number;
    met: boolean;
  };
  loan: { status: string; principalCents: number; feeCents: number; netCents: number } | null;
};

export type LoanMine = {
  capacity: { depositsCents: number; outstandingCents: number; pledgedCents: number; freeCents: number };
  products: LoanProduct[];
  application: LoanApplication | null;
  incoming: { id: string; applicationId: string; borrowerName: string; amountCents: number; productName: string }[];
};

export type LoanMember = { id: string; name: string; freeCents: number };

export type LedgerBlock = {
  id: number;
  prevHash: string;
  hash: string;
  entryType: string;
  payload: Record<string, string | number | null>;
  createdAt: string;
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
  if (!response.ok) {
    throw new ApiError(response.status, "csrf", "Could not start a secure session.");
  }
  const token = readCookie("hs_csrf");
  if (token === null) {
    throw new ApiError(500, "csrf", "Could not start a secure session.");
  }
  return token;
}

type UnauthenticatedHandler = () => void;

let onUnauthenticated: UnauthenticatedHandler | null = null;

/** SessionProvider registers a hard redirect so pages never paint a 401 as UI. */
export function setUnauthenticatedHandler(handler: UnauthenticatedHandler | null): void {
  onUnauthenticated = handler;
}

async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? "GET";
  const headers = new Headers();
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  if (method !== "GET" && method !== "HEAD") {
    headers.set("X-CSRF-Token", await ensureCsrf());
  }
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "include",
      headers,
      body: init.body === undefined ? null : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError(0, "network", "The crew pot is unreachable. Check that the app is running.");
  }
  if (response.status === 401) {
    // /api/me is the session probe — let SessionProvider decide. Everything else forces login.
    if (path !== "/api/me" && path !== "/api/auth/logout") {
      onUnauthenticated?.();
    }
    throw new ApiError(401, "unauthenticated", "Sign in to continue.");
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      data !== null &&
      typeof data === "object" &&
      "error" in data &&
      typeof (data as { error?: { message?: unknown } }).error?.message === "string"
        ? (data as { error: { message: string; code?: string } }).error.message
        : "That did not work.";
    const code =
      data !== null &&
      typeof data === "object" &&
      "error" in data &&
      typeof (data as { error?: { code?: unknown } }).error?.code === "string"
        ? (data as { error: { code: string } }).error.code
        : "request_failed";
    throw new ApiError(response.status, code, message);
  }
  return data as T;
}

export type GoogleClientConfig = {
  enabled: boolean;
  clientId?: string;
  redirectUri?: string;
};

export const api = {
  me: () => request<{ member: Member; claimCents: number }>("/api/me"),
  googleConfig: () => request<GoogleClientConfig>("/api/auth/google"),
  googleCallback: (body: { code: string; verifier: string }) =>
    request<{ member: Member }>("/api/auth/google/callback", { method: "POST", body }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST", body: {} }),
  home: () => request<HomePayload>("/api/home"),
  members: () => request<{ members: Member[] }>("/api/members"),
  activity: (scope: "me" | "all") => request<{ lines: ActivityLine[] }>(`/api/activity?scope=${scope}`),
  ledger: () => request<{ blocks: LedgerBlock[] }>("/api/ledger"),
  startPayment: (body: {
    kind: "deposit" | "withdraw" | "transfer";
    amountCents: number;
    idempotencyKey: string;
    phone?: string;
    toMemberId?: string;
  }) => request<Receipt>("/api/payments", { method: "POST", body }),
  checkPayment: (id: string) => request<Receipt>(`/api/payments/${id}/check`, { method: "POST", body: {} }),
  payment: (id: string) => request<Receipt>(`/api/payments/${id}`),
  investments: () => request<{ investments: Investment[] }>("/api/investments"),
  investment: (id: string) =>
    request<{ investment: InvestmentDetail; brokerage: { venue: string; mode: string; note: string } }>(
      `/api/investments/${id}`,
    ),
  symbols: () => request<{ symbols: ListedShare[] }>("/api/symbols"),
  quote: (symbol: string) => request<CloseQuote>(`/api/quotes/${encodeURIComponent(symbol)}`),
  buy: (input: { symbol: string; name: string; units: number }) =>
    request<{ id: string }>("/api/investments", { method: "POST", body: input }),
  loans: {
    mine: () => request<LoanMine>("/api/loans/mine"),
    members: (q: string) => request<{ members: LoanMember[] }>(`/api/loans/members?q=${encodeURIComponent(q)}`),
    apply: (body: {
      productCode: string;
      amountCents: number;
      termCount: number;
      purpose: string;
      phone: string;
      guarantors: { memberId: string; amountCents: number }[];
    }) => request<{ application: LoanApplication }>("/api/loans/applications", { method: "POST", body }),
    invite: (id: string, body: { memberId: string; amountCents: number }) =>
      request<{ application: LoanApplication }>(`/api/loans/applications/${id}/guarantors`, { method: "POST", body }),
    respond: (id: string, accept: boolean) =>
      request<LoanMine>(`/api/loans/guarantors/${id}/respond`, { method: "POST", body: { accept } }),
  },
};
