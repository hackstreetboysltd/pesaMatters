const KEY = "hackstreet-goal";
const LEGACY_CENTS_KEY = "hackstreet-goal-cents";

/** Normalize typed/saved shillings to digits with optional `.` and up to two decimals. */
export function normalizeGoalShillings(raw: string): string | null {
  const trimmed = raw.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [wholeRaw, fraction] = trimmed.split(".");
  const whole = (wholeRaw ?? "").replace(/^0+(?=\d)/, "") || "0";
  if (whole === "0" && (fraction === undefined || /^0+$/.test(fraction))) return null;
  if (fraction === undefined) return whole;
  const cents = (fraction + "00").slice(0, 2);
  if (cents === "00") return whole;
  return `${whole}.${cents}`;
}

function centsToShillings(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const frac = Math.abs(cents % 100);
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(2, "0")}`;
}

/** Saved personal target in shillings (digit string), or null when none is set. */
export function readGoalShillings(): string | null {
  const raw = localStorage.getItem(KEY);
  if (raw !== null) {
    const normalized = normalizeGoalShillings(raw);
    if (normalized !== null) return normalized;
  }

  const legacy = localStorage.getItem(LEGACY_CENTS_KEY);
  if (legacy === null) return null;
  const cents = Number(legacy);
  if (!Number.isSafeInteger(cents) || cents <= 0) return null;
  const migrated = centsToShillings(cents);
  localStorage.setItem(KEY, migrated);
  localStorage.removeItem(LEGACY_CENTS_KEY);
  return migrated;
}

export function writeGoalShillings(raw: string): void {
  const normalized = normalizeGoalShillings(raw);
  if (normalized === null) {
    throw new Error("Goal must be a positive amount in KES.");
  }
  localStorage.setItem(KEY, normalized);
  localStorage.removeItem(LEGACY_CENTS_KEY);
}

/** How full the pot is toward the goal (0–1). Null when no goal yet. */
export function shareTowardGoal(claimCents: number, goalShillings: string | null): number | null {
  if (goalShillings === null) return null;
  const normalized = normalizeGoalShillings(goalShillings);
  if (normalized === null) return null;

  const [whole, fraction = ""] = normalized.split(".");
  const goalCents = BigInt(whole ?? "0") * 100n + BigInt((fraction + "00").slice(0, 2));
  if (goalCents <= 0n) return null;

  const claim = BigInt(Math.max(0, Math.trunc(claimCents)));
  if (claim >= goalCents) return 1;
  const scaled = (claim * 10_000n) / goalCents;
  return Number(scaled) / 10_000;
}
