export type ReceiptDocument = {
  kind: string;
  amount: string;
  from: string;
  to: string | null;
  when: string;
  receiptNumber: string;
  blockId: number | null;
  blockHash: string;
  mpesaReceipt: string | null;
};

const PAGE_W = 595;
const PAGE_H = 842;
const SLIP = "0.984 0.965 0.937";
const INK = "0.110 0.086 0.071";
const ASH = "0.431 0.396 0.361";
const EMBER = "1.000 0.361 0.102";
const SEAL = "0.118 0.420 0.271";
const TINT = "0.996 0.933 0.890";

const HELV: Record<string, number> = {
  " ": 278,
  ",": 278,
  ".": 278,
  "-": 333,
  "0": 556,
  "1": 556,
  "2": 556,
  "3": 556,
  "4": 556,
  "5": 556,
  "6": 556,
  "7": 556,
  "8": 556,
  "9": 556,
  A: 667,
  B: 667,
  C: 722,
  D: 722,
  E: 667,
  F: 611,
  G: 778,
  H: 722,
  I: 278,
  J: 500,
  K: 667,
  L: 556,
  M: 833,
  N: 722,
  O: 778,
  P: 667,
  Q: 778,
  R: 722,
  S: 667,
  T: 611,
  U: 722,
  V: 667,
  W: 944,
  X: 667,
  Y: 667,
  Z: 611,
  a: 556,
  b: 556,
  c: 500,
  d: 556,
  e: 556,
  f: 278,
  g: 556,
  h: 556,
  i: 222,
  j: 222,
  k: 500,
  l: 222,
  m: 833,
  n: 556,
  o: 556,
  p: 556,
  q: 556,
  r: 333,
  s: 500,
  t: 278,
  u: 556,
  v: 500,
  w: 722,
  x: 500,
  y: 500,
  z: 500,
};

function ascii(value: string): string {
  return value.replace(/[^\x20-\x7E]/g, "?").slice(0, 64);
}

function pdfEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function textWidth(value: string, size: number, mono: boolean): number {
  if (mono) return value.length * size * 0.6;
  let units = 0;
  for (const ch of value) units += HELV[ch] ?? 520;
  return (units / 1000) * size;
}

function centerX(value: string, size: number, mono = false): number {
  return (PAGE_W - textWidth(value, size, mono)) / 2;
}

function paintText(font: string, size: number, color: string, x: number, y: number, value: string): string {
  const safe = pdfEscape(ascii(value));
  return `${color} rg\nBT\n/${font} ${size} Tf\n1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm\n(${safe}) Tj\nET`;
}

/** One-page slip. Standard fonts only, so the file stays a plain text stream. */
export function receiptPdf(doc: ReceiptDocument): Buffer {
  const kind = ascii(doc.kind);
  const amount = ascii(doc.amount);
  const from = ascii(doc.from);
  const to = doc.to === null ? null : ascii(doc.to);
  const when = ascii(doc.when);
  const number = ascii(doc.receiptNumber);
  const hash = ascii(doc.blockHash).toLowerCase();
  const mpesa = doc.mpesaReceipt === null ? null : ascii(doc.mpesaReceipt);
  const block = doc.blockId === null ? "—" : String(doc.blockId);

  const commands: string[] = [
    `${SLIP} rg`,
    `0 0 ${PAGE_W} ${PAGE_H} re f`,
    `${EMBER} rg`,
    `0 770 ${PAGE_W} 72 re f`,
    paintText("F2", 18, INK, 48, 808, "PesaMatters"),
    paintText("F1", 10, INK, 48, 788, "Transaction receipt"),
    paintText("F1", 11, ASH, centerX(kind, 11), 718, kind),
    paintText("F2", 28, INK, centerX(amount, 28, false), 676, amount),
    `${ASH} RG`,
    "0.8 w",
    "[1.5 2.5] 0 d",
    "48 648 m",
    "547 648 l",
    "S",
    "[] 0 d",
  ];

  const facts: [string, string][] = [
    ["From", from],
    ...(to === null ? [] : ([["To", to]] as [string, string][])),
    ["When", when],
    ["Block", block],
    ...(mpesa === null ? [] : ([["M-Pesa", mpesa]] as [string, string][])),
  ];
  let y = 616;
  for (const [label, value] of facts) {
    commands.push(paintText("F1", 10, ASH, 48, y, label));
    commands.push(paintText("F2", 11, INK, 547 - textWidth(value, 11, false), y, value));
    y -= 26;
  }

  const boxY = 300;
  commands.push(
    `${TINT} rg`,
    `48 ${boxY} 499 118 re f`,
    `${EMBER} RG`,
    "1.4 w",
    `48 ${boxY} 499 118 re S`,
    paintText("F1", 9, ASH, centerX("RECEIPT", 9), boxY + 86, "RECEIPT"),
    paintText("F4", 18, INK, centerX(number, 18, true), boxY + 52, number),
    paintText("F1", 9, SEAL, centerX("Taken from the ledger hash", 9), boxY + 22, "Taken from the ledger hash"),
  );

  const hashTop = 258;
  commands.push(
    paintText("F1", 9, ASH, 48, hashTop, "Ledger hash"),
    paintText("F3", 9, INK, 48, hashTop - 18, hash.slice(0, 32)),
    paintText("F3", 9, INK, 48, hashTop - 32, hash.slice(32)),
    paintText("F1", 9, ASH, 48, 72, "Keep this with your activity."),
  );

  const stream = commands.join("\n");
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
    "2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj\n",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R /F4 8 0 R >> >> >> endobj\n",
    `4 0 obj << /Length ${Buffer.byteLength(stream)} >> stream\n${stream}\nendstream\nendobj\n`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
    "6 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> endobj\n",
    "7 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Courier >> endobj\n",
    "8 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >> endobj\n",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body));
    body += object;
  }
  const xrefAt = Buffer.byteLength(body);
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    xref += `${String(offsets[index] ?? 0).padStart(10, "0")} 00000 n \n`;
  }
  body += xref;
  body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return Buffer.from(body, "utf8");
}
