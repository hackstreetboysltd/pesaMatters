import type { Conn, Db, Row } from "../db.ts";

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

export type ProductInput = {
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

export class ProductError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ProductError";
    this.status = status;
    this.code = code;
  }
}

/** Seed defaults. Runtime catalogue is Postgres `loan_products`. */
export const LOAN_PRODUCTS: readonly LoanProduct[] = [
  {
    code: "MOSH1W",
    name: "1 week · 2%",
    interestPercent: 2,
    termMin: 1,
    termMax: 1,
    termUnit: "weeks",
    minimumCents: 100_000,
    maximumCents: 20_000_000,
    minimumGuarantors: 0,
    coveragePercent: 0,
    feePercent: 0,
  },
  {
    code: "MOSH2W",
    name: "2 weeks · 5%",
    interestPercent: 5,
    termMin: 2,
    termMax: 2,
    termUnit: "weeks",
    minimumCents: 100_000,
    maximumCents: 20_000_000,
    minimumGuarantors: 0,
    coveragePercent: 0,
    feePercent: 0,
  },
  {
    code: "MOSH1M",
    name: "1 month · 7%",
    interestPercent: 7,
    termMin: 1,
    termMax: 1,
    termUnit: "months",
    minimumCents: 100_000,
    maximumCents: 50_000_000,
    minimumGuarantors: 0,
    coveragePercent: 0,
    feePercent: 0,
  },
  {
    code: "INVLOAN",
    name: "Investment · 15%",
    interestPercent: 15,
    termMin: 2,
    termMax: 3,
    termUnit: "months",
    minimumCents: 500_000,
    maximumCents: 200_000_000,
    minimumGuarantors: 2,
    coveragePercent: 100,
    feePercent: 1,
  },
];

/** Sync lookup of seed defaults only — prefer `getProduct` for live catalogue. */
export function productByCode(code: string): LoanProduct | null {
  return LOAN_PRODUCTS.find((product) => product.code === code) ?? null;
}

export function mapProductRow(row: Row): LoanProduct {
  const unit = String(row["term_unit"]);
  return {
    code: String(row["code"]),
    name: String(row["name"]),
    interestPercent: Number(row["interest_percent"]),
    termMin: Number(row["term_min"]),
    termMax: Number(row["term_max"]),
    termUnit: unit === "months" ? "months" : "weeks",
    minimumCents: Number(row["minimum_cents"]),
    maximumCents: Number(row["maximum_cents"]),
    minimumGuarantors: Number(row["minimum_guarantors"]),
    coveragePercent: Number(row["coverage_percent"]),
    feePercent: Number(row["fee_percent"]),
  };
}

export function assertProductShape(input: ProductInput): void {
  if (!/^[A-Z][A-Z0-9]{1,15}$/.test(input.code)) {
    throw new ProductError(422, "bad_code", "Use a short uppercase code, like MOSH1W.");
  }
  if (input.name.trim().length < 2 || input.name.trim().length > 80) {
    throw new ProductError(422, "bad_name", "Give the product a clear name.");
  }
  if (!Number.isInteger(input.interestPercent) || input.interestPercent < 0 || input.interestPercent > 100) {
    throw new ProductError(422, "bad_interest", "Interest is a whole percent from 0 to 100.");
  }
  if (!Number.isInteger(input.termMin) || !Number.isInteger(input.termMax) || input.termMin < 1 || input.termMax > 36) {
    throw new ProductError(422, "bad_term", "Term counts run from 1 to 36.");
  }
  if (input.termMin > input.termMax) {
    throw new ProductError(422, "bad_term", "The shortest term cannot be longer than the longest.");
  }
  if (input.termUnit !== "weeks" && input.termUnit !== "months") {
    throw new ProductError(422, "bad_term", "Term unit is weeks or months.");
  }
  if (!Number.isInteger(input.minimumCents) || input.minimumCents < 100 || input.minimumCents % 100 !== 0) {
    throw new ProductError(422, "bad_amount", "Minimum is whole shillings, at least KES 1.");
  }
  if (!Number.isInteger(input.maximumCents) || input.maximumCents < input.minimumCents || input.maximumCents % 100 !== 0) {
    throw new ProductError(422, "bad_amount", "Maximum must be at least the minimum, in whole shillings.");
  }
  if (!Number.isInteger(input.minimumGuarantors) || input.minimumGuarantors < 0 || input.minimumGuarantors > 20) {
    throw new ProductError(422, "bad_guarantors", "Guarantors run from 0 to 20.");
  }
  if (!Number.isInteger(input.coveragePercent) || input.coveragePercent < 0 || input.coveragePercent > 100) {
    throw new ProductError(422, "bad_coverage", "Coverage is a whole percent from 0 to 100.");
  }
  if (!Number.isInteger(input.feePercent) || input.feePercent < 0 || input.feePercent > 100) {
    throw new ProductError(422, "bad_fee", "Fee is a whole percent from 0 to 100.");
  }
}

export async function listProducts(pool: Db): Promise<LoanProduct[]> {
  const [rows] = await pool.query<Row>(
    `SELECT code, name, interest_percent, term_min, term_max, term_unit,
            minimum_cents, maximum_cents, minimum_guarantors, coverage_percent, fee_percent
     FROM loan_products
     ORDER BY name ASC`,
  );
  return rows.map(mapProductRow);
}

export async function getProduct(pool: Conn | Db, code: string): Promise<LoanProduct | null> {
  const [rows] = await pool.query<Row>(
    `SELECT code, name, interest_percent, term_min, term_max, term_unit,
            minimum_cents, maximum_cents, minimum_guarantors, coverage_percent, fee_percent
     FROM loan_products
     WHERE code = ?
     LIMIT 1`,
    [code],
  );
  const row = rows[0];
  return row === undefined ? null : mapProductRow(row);
}

export async function createProduct(pool: Db, input: ProductInput): Promise<LoanProduct> {
  assertProductShape(input);
  const name = input.name.trim();
  try {
    await pool.query(
      `INSERT INTO loan_products
        (code, name, interest_percent, term_min, term_max, term_unit, minimum_cents, maximum_cents,
         minimum_guarantors, coverage_percent, fee_percent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.code,
        name,
        input.interestPercent,
        input.termMin,
        input.termMax,
        input.termUnit,
        input.minimumCents,
        input.maximumCents,
        input.minimumGuarantors,
        input.coveragePercent,
        input.feePercent,
      ],
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ProductError(409, "code_taken", "That product code is already on the books.");
    }
    throw error;
  }
  const saved = await getProduct(pool, input.code);
  if (saved === null) throw new ProductError(500, "server_error", "Something went wrong. Try again.");
  return saved;
}

export async function updateProduct(pool: Db, code: string, input: Omit<ProductInput, "code">): Promise<LoanProduct> {
  assertProductShape({ ...input, code });
  const existing = await getProduct(pool, code);
  if (existing === null) throw new ProductError(404, "unknown_product", "That product is not on the books.");
  const name = input.name.trim();
  await pool.query(
    `UPDATE loan_products
     SET name = ?, interest_percent = ?, term_min = ?, term_max = ?, term_unit = ?,
         minimum_cents = ?, maximum_cents = ?, minimum_guarantors = ?, coverage_percent = ?, fee_percent = ?
     WHERE code = ?`,
    [
      name,
      input.interestPercent,
      input.termMin,
      input.termMax,
      input.termUnit,
      input.minimumCents,
      input.maximumCents,
      input.minimumGuarantors,
      input.coveragePercent,
      input.feePercent,
      code,
    ],
  );
  const saved = await getProduct(pool, code);
  if (saved === null) throw new ProductError(404, "unknown_product", "That product is not on the books.");
  return saved;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}
