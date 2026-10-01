const ONES = [
  "",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
] as const;

const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"] as const;

/** Short-scale names for each group of three digits, from the right (10^0, 10^3, …). */
const SCALES = [
  "",
  "thousand",
  "million",
  "billion",
  "trillion",
  "quadrillion",
  "quintillion",
  "sextillion",
  "septillion",
  "octillion",
  "nonillion",
  "decillion",
  "undecillion",
  "duodecillion",
  "tredecillion",
  "quattuordecillion",
  "quindecillion",
  "sexdecillion",
  "septendecillion",
  "octodecillion",
  "novemdecillion",
  "vigintillion",
] as const;

function underHundred(n: number): string {
  if (n < 20) return ONES[n] ?? "";
  const ten = Math.floor(n / 10);
  const one = n % 10;
  const tenWord = TENS[ten] ?? "";
  const oneWord = ONES[one] ?? "";
  return one === 0 ? tenWord : `${tenWord}-${oneWord}`;
}

function underThousand(n: number): string {
  if (n === 0) return "";
  if (n < 100) return underHundred(n);
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  const head = `${ONES[hundred]} hundred`;
  return rest === 0 ? head : `${head} ${underHundred(rest)}`;
}

/** Convert a non-negative integer digit string to English words (short scale). */
export function integerDigitsToWords(digits: string): string {
  const cleaned = digits.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (cleaned.length === 0 || cleaned === "0") return "zero";

  const padded = cleaned.length % 3 === 0 ? cleaned : cleaned.padStart(cleaned.length + (3 - (cleaned.length % 3)), "0");
  const groups: number[] = [];
  for (let i = 0; i < padded.length; i += 3) {
    groups.push(Number(padded.slice(i, i + 3)));
  }

  const parts: string[] = [];
  for (let i = 0; i < groups.length; i += 1) {
    const value = groups[i];
    if (value === undefined || value === 0) continue;
    const scaleIndex = groups.length - 1 - i;
    const scale = SCALES[scaleIndex];
    if (scale === undefined) {
      parts.push(`${underThousand(value)} ×10^${scaleIndex * 3}`);
      continue;
    }
    parts.push(scale.length === 0 ? underThousand(value) : `${underThousand(value)} ${scale}`);
  }

  return parts.length === 0 ? "zero" : parts.join(" ");
}

/**
 * Live amount-in-words for a typed shillings field (commas allowed).
 * Empty / incomplete input → empty string so the UI can hide the line.
 */
export function shillingsInWords(raw: string): string {
  const stripped = raw.replace(/,/g, "").trim();
  if (stripped.length === 0 || stripped === ".") return "";

  const dot = stripped.indexOf(".");
  const wholeRaw = (dot === -1 ? stripped : stripped.slice(0, dot)).replace(/\D/g, "");
  const fractionRaw = dot === -1 ? "" : stripped.slice(dot + 1).replace(/\D/g, "").slice(0, 2);

  if (wholeRaw.length === 0 && fractionRaw.length === 0) return "";

  const wholeWords = integerDigitsToWords(wholeRaw.length === 0 ? "0" : wholeRaw);
  if (fractionRaw.length === 0 || /^0+$/.test(fractionRaw)) return wholeWords;

  const cents = Number((fractionRaw + "00").slice(0, 2));
  if (!Number.isFinite(cents) || cents <= 0) return wholeWords;
  const centsWords = integerDigitsToWords(String(cents));
  return `${wholeWords} and ${centsWords} cent${cents === 1 ? "" : "s"}`;
}
