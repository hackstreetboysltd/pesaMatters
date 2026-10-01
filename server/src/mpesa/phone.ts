/** Nine national digits after 254, starting with 1 or 7. */
export function kenyanMsisdn(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  let national = digits;
  if (digits.startsWith("254")) national = digits.slice(3);
  else if (digits.startsWith("0")) national = digits.slice(1);
  if (!/^[17]\d{8}$/.test(national)) return null;
  return `254${national}`;
}
