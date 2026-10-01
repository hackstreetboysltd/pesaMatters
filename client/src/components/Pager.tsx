import type { ReactElement } from "react";
import { pageRangeLabel, type PageWindow } from "../paging";
import { MarkNext, MarkPrev } from "./marks";

type PagerProps = {
  /** Accessible name for the navigation landmark. */
  label: string;
  total: number;
  slice: PageWindow;
  onPage: (page: number) => void;
};

/** Previous / next for a list shown ten rows at a time. Same control as the ledger. */
export function Pager({ label, total, slice, onPage }: PagerProps): ReactElement {
  const canPrev = slice.page > 0;
  const canNext = slice.page < slice.pageCount - 1 && total > 0;
  return (
    <nav className="ledger-pager" aria-label={label}>
      <button type="button" className="icon-btn" aria-label="Previous 10" disabled={!canPrev} onClick={() => onPage(slice.page - 1)}>
        <MarkPrev />
      </button>
      <p className="ledger-pager-range" aria-live="polite">
        {pageRangeLabel(slice, total)}
      </p>
      <button type="button" className="icon-btn" aria-label="Next 10" disabled={!canNext} onClick={() => onPage(slice.page + 1)}>
        <MarkNext />
      </button>
    </nav>
  );
}
