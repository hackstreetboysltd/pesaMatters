const NATIONAL = 9;

/** Digits after +254, capped at 9. Accepts 07…, 254…, or +254…. */
export function nationalDigits(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  let national = digits;
  if (digits.startsWith("254")) national = digits.slice(3);
  else if (digits.startsWith("0")) national = digits.slice(1);
  return national.slice(0, NATIONAL);
}

export function formatNational(raw: string): string {
  const digits = nationalDigits(raw);
  return [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 9)].filter((part) => part.length > 0).join(" ");
}

export function isCompleteNational(raw: string): boolean {
  return /^[17]\d{8}$/.test(nationalDigits(raw));
}

export function displayMsisdn(raw: string): string {
  const spaced = formatNational(raw);
  return spaced.length > 0 ? `+254 ${spaced}` : "+254";
}

/** Caret position in a spaced national number after `digitCount` digits. */
export function caretIndexForDigitCount(formatted: string, digitCount: number): number {
  if (digitCount <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i += 1) {
    const ch = formatted.charAt(i);
    if (ch >= "0" && ch <= "9") {
      seen += 1;
      if (seen === digitCount) return i + 1;
    }
  }
  return formatted.length;
}
