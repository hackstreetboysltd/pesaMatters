/** Rows shown by the shared previous / next control. */
export const PAGE_SIZE = 10;

export type PageWindow = {
  /** Zero-based page, clamped into range. */
  page: number;
  pageCount: number;
  /** Inclusive index of the first row. */
  start: number;
  /** Exclusive end index, for `slice`. */
  end: number;
  /** One-based first row, or 0 when the list is empty. */
  from: number;
  /** One-based last row, or 0 when the list is empty. */
  to: number;
};

/**
 * The slice of a list that belongs on `page`, ten rows unless `size` is passed.
 * A page past either end clamps to the last or first page.
 */
export function pageWindow(total: number, page: number, size: number = PAGE_SIZE): PageWindow {
  if (!Number.isInteger(total) || total < 0) {
    throw new RangeError("total must be a non-negative integer");
  }
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError("page size must be a positive integer");
  }
  const pageCount = Math.max(1, Math.ceil(total / size));
  const requested = Number.isInteger(page) ? page : 0;
  const safe = Math.min(Math.max(0, requested), pageCount - 1);
  const start = safe * size;
  const end = Math.min(start + size, total);
  return {
    page: safe,
    pageCount,
    start,
    end,
    from: total === 0 ? 0 : start + 1,
    to: end,
  };
}

/** The range line under the previous / next buttons. */
export function pageRangeLabel(slice: PageWindow, total: number): string {
  if (total === 0) return "0 of 0";
  return `${slice.from}–${slice.to} of ${total}`;
}
