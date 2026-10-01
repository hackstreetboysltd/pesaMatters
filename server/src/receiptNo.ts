/** First 12 hex digits of a ledger block hash, grouped so it can be read aloud. */
export function receiptNumberFromHash(hash: string): string | null {
  const hex = hash.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) return null;
  const head = hex.slice(0, 12).toUpperCase();
  return `${head.slice(0, 4)}-${head.slice(4, 8)}-${head.slice(8, 12)}`;
}

/** Local mock and in-pot send codes. A real Daraja token is kept. */
export function shownMpesaReceipt(value: string | null): string | null {
  if (value === null) return null;
  if (/^MOCK[0-9A-F]{6}$/.test(value) || /^POT[0-9A-F]{8}$/.test(value)) return null;
  return value;
}
