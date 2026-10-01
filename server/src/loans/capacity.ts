/** Free deposits are the pot claim, less loans still out and guarantees still pledged. */

export function freeDepositsCents(
  depositsCents: number,
  outstandingPrincipalCents: number,
  pledgedCents: number,
): number {
  for (const value of [depositsCents, outstandingPrincipalCents, pledgedCents]) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error("Collateral figures must be whole cents.");
    }
  }
  const free = depositsCents - outstandingPrincipalCents - pledgedCents;
  return free > 0 ? free : 0;
}

export type BorrowLimit = {
  amountCents: number;
  freeCents: number;
  minimumCents: number;
  maximumCents: number;
};

/** Null when the amount is allowed. Otherwise a stable reason code. */
export function refuseBorrow(input: BorrowLimit): "below_minimum" | "above_free" | "above_product" | null {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) return "below_minimum";
  if (input.amountCents < input.minimumCents) return "below_minimum";
  if (input.amountCents > input.freeCents) return "above_free";
  if (input.amountCents > input.maximumCents) return "above_product";
  return null;
}

export function refuseGuarantee(input: {
  borrowerId: string;
  guarantorId: string;
  amountCents: number;
  guarantorFreeCents: number;
}): "bad_amount" | "above_free" | null {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) return "bad_amount";
  if (input.amountCents > input.guarantorFreeCents) return "above_free";
  return null;
}

/** Guarantees have to add up to the loan, including the borrower's own share. */
export function coverMismatch(loanCents: number, parts: readonly number[]): "short" | "over" | null {
  if (!Number.isInteger(loanCents) || loanCents <= 0) return "short";
  let sum = 0;
  for (const part of parts) {
    if (!Number.isInteger(part) || part <= 0) return "short";
    sum += part;
  }
  if (sum < loanCents) return "short";
  if (sum > loanCents) return "over";
  return null;
}

/** Fee is taken in whole shillings. Net is what M-Pesa sends. */
export function payoutCents(
  principalCents: number,
  feePercent: number,
): { feeCents: number; netCents: number } | null {
  if (!Number.isInteger(principalCents) || principalCents <= 0) return null;
  if (!Number.isInteger(feePercent) || feePercent < 0 || feePercent > 100) return null;
  const rawFee = Math.round((principalCents * feePercent) / 100);
  let net = principalCents - rawFee;
  const remainder = net % 100;
  if (remainder !== 0) net -= remainder;
  if (net <= 0) return null;
  return { feeCents: principalCents - net, netCents: net };
}
