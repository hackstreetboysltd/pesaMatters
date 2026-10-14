import { useId, type ReactElement } from "react";

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function QuantityField({
  value,
  onChange,
  min = 1,
  max = 1_000_000,
  labelledBy,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  labelledBy?: string;
}): ReactElement {
  const id = useId();
  const qty = clamp(value, min, max);

  function set(next: number): void {
    onChange(clamp(next, min, max));
  }

  return (
    <div className="qty-stepper">
      <button
        type="button"
        className="qty-bump qty-less"
        aria-label="Remove one"
        disabled={qty <= min}
        onClick={() => set(qty - 1)}
      >
        −
      </button>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint="done"
        aria-labelledby={labelledBy}
        value={String(qty)}
        onChange={(event) => {
          const raw = event.target.value.replace(/[^\d.]/g, "");
          if (raw === "" || raw === ".") return;
          const parsed = Number(raw);
          if (!Number.isFinite(parsed)) return;
          set(parsed);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp") {
            event.preventDefault();
            set(qty + 1);
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            set(qty - 1);
          }
        }}
      />
      <button
        type="button"
        className="qty-bump qty-more"
        aria-label="Add one"
        disabled={qty >= max}
        onClick={() => set(qty + 1)}
      >
        +
      </button>
    </div>
  );
}
