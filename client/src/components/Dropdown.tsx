import { useEffect, useId, useMemo, useRef, useState } from "react";
import { pageRangeLabel, pageWindow } from "../paging";
import { MarkNext, MarkPrev } from "./marks";
const PANEL_GAP = 6;

export type DropdownSide = "up" | "down";

export function placeDropdown(trigger: DOMRect, viewportHeight: number, floor: number): { side: DropdownSide; room: number } {
  const limit = Math.min(viewportHeight, floor);
  const below = Math.max(0, limit - trigger.bottom - PANEL_GAP);
  const above = Math.max(0, trigger.top - PANEL_GAP);
  if (above > below) return { side: "up", room: above };
  return { side: "down", room: below };
}

function viewportFloor(): number {
  const nav = document.querySelector(".nav");
  if (!(nav instanceof HTMLElement)) return window.innerHeight;
  return nav.getBoundingClientRect().top;
}

export type DropdownOption = {
  value: string;
  label: string;
  hint?: string;
};

type Props = {
  options: DropdownOption[] | null;
  value: string;
  onChange: (value: string) => void;
  listLabel: string;
  placeholder?: string;
};

export function Dropdown({ options, value, onChange, listLabel, placeholder }: Props): React.ReactElement {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [placement, setPlacement] = useState<{ side: DropdownSide; room: number }>({ side: "down", room: 0 });

  const filtered = useMemo(() => {
    const list = options ?? [];
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return list;
    return list.filter((option) => {
      const hint = option.hint ?? "";
      return option.label.toLowerCase().includes(needle) || hint.toLowerCase().includes(needle);
    });
  }, [options, query]);

  const slice = pageWindow(filtered.length, page);
  const pageItems = filtered.slice(slice.start, slice.end);
  const selected = (options ?? []).find((option) => option.value === value) ?? null;
  const selectedText = selected === null ? (placeholder ?? "") : selected.label;

  useEffect(() => {
    setPage(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    function onDoc(event: MouseEvent): void {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function refreshPlacement(): void {
    const trigger = wrapRef.current;
    if (trigger === null) return;
    setPlacement(placeDropdown(trigger.getBoundingClientRect(), window.innerHeight, viewportFloor()));
  }

  useEffect(() => {
    if (!open) return;
    refreshPlacement();
    function onReflow(): void {
      refreshPlacement();
    }
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => searchRef.current?.focus());
      return;
    }
    setQuery("");
    setPage(0);
  }, [open]);

  return (
    <div className="dropdown" ref={wrapRef}>
      <button
        type="button"
        className={`dropdown-trigger${open ? " open" : ""}${open && placement.side === "up" ? " up" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={selectedText.length === 0 ? listLabel : selectedText}
        onClick={() => {
          if (!open) refreshPlacement();
          setOpen((current) => !current);
        }}
      >
        <span className="dropdown-balance" aria-hidden="true" />
        <span className={`dropdown-value${selected === null && placeholder !== undefined ? " placeholder" : ""}`}>{selectedText}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 9.5 12 15.5 18 9.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
      {open ? (
        <div
          className={`dropdown-panel${placement.side === "up" ? " up" : ""}`}
          id={listId}
          role="listbox"
          aria-label={listLabel}
          style={{ ["--dropdown-room" as string]: `${placement.room}px` }}
        >
          <div className="dropdown-search">
            <input
              ref={searchRef}
              type="search"
              className="dropdown-search-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label={`Search ${listLabel}`}
            />
          </div>
          <div className="dropdown-options">
            {pageItems.length === 0 ? (
              <p className="dropdown-empty">No matches</p>
            ) : (
              pageItems.map((option) => (
                <button
                  type="button"
                  key={option.value}
                  role="option"
                  aria-selected={option.value === value}
                  className={`dropdown-option${option.value === value ? " selected" : ""}`}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <span className="dropdown-option-label">{option.label}</span>
                  {option.hint !== undefined ? <span className="dropdown-option-hint">{option.hint}</span> : null}
                </button>
              ))
            )}
          </div>
          {filtered.length > 0 ? (
            <div className="dropdown-pager" aria-label={`${listLabel} pagination`}>
              <button
                type="button"
                className="dropdown-page-btn"
                disabled={slice.page <= 0}
                aria-label={`Previous ${listLabel}`}
                onClick={() => setPage(slice.page - 1)}
              >
                <MarkPrev />
              </button>
              <span>{pageRangeLabel(slice, filtered.length)}</span>
              <button
                type="button"
                className="dropdown-page-btn"
                disabled={slice.page >= slice.pageCount - 1}
                aria-label={`Next ${listLabel}`}
                onClick={() => setPage(slice.page + 1)}
              >
                <MarkNext />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
