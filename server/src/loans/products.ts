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

/** Moshakers catalogue. The 3× savings multiplier is not used; the cap is free deposits. */
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

export function productByCode(code: string): LoanProduct | null {
  return LOAN_PRODUCTS.find((product) => product.code === code) ?? null;
}
