export function formatUsd(cents: number): string {
  const amount = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
  return `USD ${amount}`;
}

export function formatKes(cents: number): string {
  const amount = new Intl.NumberFormat("en-KE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
  return `KES ${amount}`;
}

/** One decimal with a sign. 150 basis points is +1.5%. */
export function formatDayPercent(bps: number): string {
  const tenths = Math.round(Math.abs(bps) / 10);
  const text = `${Math.floor(tenths / 10)}.${tenths % 10}`;
  return `${bps < 0 ? "−" : "+"}${text}%`;
}

export function formatSession(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return new Intl.DateTimeFormat("en-KE", {
    dateStyle: "medium",
    timeZone: "Africa/Nairobi",
  }).format(date);
}

export function formatNairobiDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return formatSession(day);
}

export function formatUnits(units: number): string {
  return new Intl.NumberFormat("en-KE", { maximumFractionDigits: 4 }).format(units);
}

export function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-KE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/** Compact day for a notification row, such as `18 Sept`. */
export function formatNoticeDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
  }).format(date);
}

/** Ledger / API ceiling: 100 million Kenya shillings, stored as integer cents. */
export const MAX_AMOUNT_CENTS = 100_000_000_00;

/** Daraja STK / B2C ceiling: 250,000 Kenya shillings. */
export const MAX_MPESA_CENTS = 250_000_00;

export type ParseShillings =
  | { ok: true; cents: number }
  | { ok: false; reason: "empty" | "format" | "range" };

/**
 * Whole shillings or up to two decimals. Accepts grouping commas.
 * Distinguishes empty / bad format / over the max so the UI can name the real problem.
 */
export function parseShillings(raw: string, maxCents = MAX_AMOUNT_CENTS): ParseShillings {
  const trimmed = raw.trim().replace(/,/g, "");
  if (trimmed.length === 0) return { ok: false, reason: "empty" };
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return { ok: false, reason: "format" };
  const [whole, fraction = ""] = trimmed.split(".");
  if (whole === undefined) return { ok: false, reason: "format" };
  const cents = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > maxCents) {
    return { ok: false, reason: "range" };
  }
  return { ok: true, cents };
}

/** Whole shillings or up to two decimals. Accepts grouping commas. Returns cents, or null when the text is not money. */
export function shillingsToCents(raw: string, maxCents = MAX_AMOUNT_CENTS): number | null {
  const parsed = parseShillings(raw, maxCents);
  return parsed.ok ? parsed.cents : null;
}

/** Member-facing reason when a typed KES amount cannot be used, or null when it is valid. */
export function explainShillings(
  raw: string,
  options: { maxCents?: number; wholeOnly?: boolean } = {},
): string | null {
  const maxCents = options.maxCents ?? MAX_AMOUNT_CENTS;
  const parsed = parseShillings(raw, maxCents);
  if (parsed.ok) {
    if (options.wholeOnly && parsed.cents % 100 !== 0) {
      return maxCents === MAX_MPESA_CENTS
        ? "M-Pesa takes whole shillings, up to KES 250,000."
        : "Enter whole shillings only.";
    }
    return null;
  }
  if (parsed.reason === "empty" || parsed.reason === "format") {
    return "Enter an amount in KES, up to two decimals.";
  }
  if (maxCents === MAX_MPESA_CENTS) {
    return "M-Pesa takes whole shillings, up to KES 250,000.";
  }
  return `Amount can be at most ${formatKes(maxCents)}.`;
}

/** Group a digit string with thousand commas (no Number — works past 1e15). */
export function groupThousands(digits: string): string {
  const trimmed = digits.replace(/^0+(?=\d)/, "");
  if (trimmed.length === 0) return "0";
  return trimmed.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** `KES 1,000,000` from a normalized or typed shillings string (commas optional). */
export function formatKesShillings(raw: string): string {
  const stripped = raw.trim().replace(/,/g, "");
  const dot = stripped.indexOf(".");
  const whole = (dot === -1 ? stripped : stripped.slice(0, dot)).replace(/\D/g, "") || "0";
  const fraction = dot === -1 ? "" : stripped.slice(dot + 1).replace(/\D/g, "").slice(0, 2);
  if (fraction.length === 0) return `KES ${groupThousands(whole)}`;
  return `KES ${groupThousands(whole)}.${fraction}`;
}

/**
 * Live money typing: digits and at most two decimals, with thousand commas.
 * No digit cap — the field may wrap for very large amounts.
 * "1000000" → "1,000,000"; "1000.5" → "1,000.5".
 */
export function formatShillingsTyping(raw: string): string {
  const stripped = raw.replace(/,/g, "").replace(/[^\d.]/g, "");
  if (stripped.length === 0) return "";

  const dot = stripped.indexOf(".");
  const wholeRaw = (dot === -1 ? stripped : stripped.slice(0, dot)).replace(/\D/g, "");
  const fractionRaw = dot === -1 ? null : stripped.slice(dot + 1).replace(/\./g, "").slice(0, 2);

  if (wholeRaw.length === 0 && fractionRaw === null) return "";
  const wholeFormatted = wholeRaw.length === 0 ? "0" : groupThousands(wholeRaw);

  if (fractionRaw === null) return wholeFormatted;
  return `${wholeFormatted}.${fractionRaw}`;
}
