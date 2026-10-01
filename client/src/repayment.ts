/**
 * Amount due at the end of the term: principal plus the product's flat interest.
 * The rate is for the whole term, so a longer term on the same product does not
 * multiply it. The disbursement fee is taken from the payout and is not added here.
 */
export function repaymentCents(principalCents: number, interestPercent: number): number | null {
  if (!Number.isInteger(principalCents) || principalCents <= 0) return null;
  if (!Number.isInteger(interestPercent) || interestPercent < 0 || interestPercent > 100) return null;
  const interestCents = Math.round((principalCents * interestPercent) / 100);
  const due = principalCents + interestCents;
  if (!Number.isSafeInteger(due)) return null;
  return due;
}
