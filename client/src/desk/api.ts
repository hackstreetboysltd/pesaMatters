import type { LoanApplication } from "../api";

export class DeskError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type DeskAdmin = { id: string; name: string; email: string };

export type DeskCapacity = {
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
  if (!response.ok) throw new DeskError(response.status, "csrf", "Could not start a secure session.");
  const token = readCookie("hs_csrf");
  if (token === null) throw new DeskError(500, "csrf", "Could not start a secure session.");
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
    throw new DeskError(0, "network", "The desk is unreachable.");
  }
  if (response.status === 401 && path !== "/api/desk/login" && path !== "/api/desk/me") {
    window.location.assign("/desk/login");
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
    throw new DeskError(response.status, code, message);
  }
  return data as T;
}

export const deskApi = {
  me: () => request<{ admin: DeskAdmin }>("/api/desk/me"),
  login: (body: { email: string; password: string }) =>
    request<{ admin: DeskAdmin }>("/api/desk/login", { method: "POST", body }),
  logout: () => request<{ ok: boolean }>("/api/desk/logout", { method: "POST", body: {} }),
  queue: () => request<{ applications: LoanApplication[] }>("/api/desk/loans"),
  loan: (id: string) => request<{ application: LoanApplication; capacity: DeskCapacity }>(`/api/desk/loans/${id}`),
  appraise: (id: string, body: { recommendedCents: number; notes: string; riskRating?: "low" | "medium" | "high" }) =>
    request<{ application: LoanApplication }>(`/api/desk/loans/${id}/appraise`, { method: "POST", body }),
  decide: (id: string, body: { decision: "approve" | "reject"; amountCents?: number; termCount?: number; notes: string }) =>
    request<{ application: LoanApplication }>(`/api/desk/loans/${id}/decide`, { method: "POST", body }),
  disburse: (id: string) => request<{ application: LoanApplication }>(`/api/desk/loans/${id}/disburse`, { method: "POST", body: {} }),
};
