import { useLayoutEffect, useRef, type ReactElement } from "react";
import { caretIndexForDigitCount, formatNational, nationalDigits } from "../phone";

export function KenyanPhoneField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (digits: string) => void;
  disabled?: boolean;
}): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const caretDigitsRef = useRef<number | null>(null);
  const formatted = formatNational(value);

  useLayoutEffect(() => {
    const el = inputRef.current;
    const digits = caretDigitsRef.current;
    if (!el || digits === null) return;
    const idx = caretIndexForDigitCount(formatted, digits);
    el.setSelectionRange(idx, idx);
    caretDigitsRef.current = null;
  }, [formatted]);

  return (
    <label className="field phone-block">
      <span>M-Pesa number</span>
      <span className="phone-field">
        <span className="phone-prefix" aria-hidden="true">
          +254
        </span>
        <input
          ref={inputRef}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          enterKeyHint="done"
          aria-label="M-Pesa number"
          disabled={disabled === true}
          pattern="[17][0-9]{2} [0-9]{3} [0-9]{3}"
          title="Nine digits after +254, starting with 1 or 7"
          placeholder="712 345 678"
          value={formatted}
          onChange={(event) => {
            const caret = event.target.selectionStart ?? event.target.value.length;
            caretDigitsRef.current = event.target.value.slice(0, caret).replace(/\D/g, "").length;
            onChange(nationalDigits(event.target.value));
          }}
        />
      </span>
    </label>
  );
}
