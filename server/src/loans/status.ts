export const OPEN_STATUSES = [
  "awaiting_guarantors",
  "under_appraisal",
  "awaiting_approval",
  "approved",
] as const;

export type ApplicationStatus =
  | (typeof OPEN_STATUSES)[number]
  | "rejected"
  | "cancelled"
  | "disbursed";

export function gate(
  action: "appraise" | "decide" | "disburse",
  status: string,
  guaranteesMet: boolean,
): "not_ready" | null {
  if (action === "appraise") {
    if (status !== "under_appraisal" || !guaranteesMet) return "not_ready";
    return null;
  }
  if (action === "decide") {
    return status === "awaiting_approval" ? null : "not_ready";
  }
  return status === "approved" ? null : "not_ready";
}

export function statusAfterSubmit(input: { invites: number; guaranteesMet: boolean }): ApplicationStatus {
  if (input.invites > 0 || !input.guaranteesMet) return "awaiting_guarantors";
  return "under_appraisal";
}

export function guaranteesMet(input: {
  minimumGuarantors: number;
  coveragePercent: number;
  requestedCents: number;
  acceptedCount: number;
  acceptedCents: number;
}): boolean {
  if (input.acceptedCount < input.minimumGuarantors) return false;
  const required = Math.ceil((input.requestedCents * input.coveragePercent) / 100);
  return input.acceptedCents >= required;
}
