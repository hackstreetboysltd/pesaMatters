import { useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { formatShillingsTyping } from "../format";
import { shillingsInWords } from "../words";

function resizeAmountControl(el: HTMLTextAreaElement): void {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

type AmountFieldProps = {
  label?: ReactNode;
  value: string;
  onChange: (next: string) => void;
  required?: boolean;
  placeholder?: string;
  /** Growing textarea that wraps long amounts (goal). Default is a single-line input. */
  autoGrow?: boolean;
  /** Optional control to the right of the field (e.g. save check). Field stays centered. */
  accessory?: ReactNode;
  /** Submit the parent form on Enter (useful with textarea). */
  enterSubmits?: boolean;
  className?: string;
  inputRef?: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  "aria-labelledby"?: string;
  /** Calculated figures the member must not edit. */
  readOnly?: boolean;
};

/** Money amount field in KES: live thousand commas and amount-in-words under the control. */
export function AmountField({
  label,
  value,
  onChange,
  required = false,
  placeholder = "0",
  autoGrow = false,
  accessory,
  enterSubmits = false,
  className,
  inputRef,
  "aria-labelledby": ariaLabelledBy,
  readOnly = false,
}: AmountFieldProps): ReactElement {
  const wordsId = useId();
  const labelId = useId();
  const currencyId = useId();
  const controlId = useId();
  const localRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null);
  const controlRef = inputRef ?? localRef;
  const words = shillingsInWords(value);
  const labelledBy = ariaLabelledBy ?? (label !== undefined && label !== null && label !== false ? labelId : undefined);
  const describedBy = [currencyId, words.length > 0 ? wordsId : null].filter(Boolean).join(" ") || undefined;
  const rootClass = className === undefined ? "amount-field" : `amount-field ${className}`;

  useLayoutEffect(() => {
    if (!autoGrow) return;
    const el = controlRef.current;
    if (el instanceof HTMLTextAreaElement) resizeAmountControl(el);
  }, [autoGrow, controlRef, value]);

  function applyValue(raw: string, el?: HTMLTextAreaElement | HTMLInputElement): void {
    onChange(formatShillingsTyping(raw));
    if (el instanceof HTMLTextAreaElement && autoGrow) resizeAmountControl(el);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>): void {
    if (!enterSubmits || event.key !== "Enter") return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  const control = autoGrow ? (
    <textarea
      ref={controlRef as React.RefObject<HTMLTextAreaElement>}
      id={controlId}
      className="amount-control"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      inputMode="decimal"
      placeholder={placeholder}
      rows={1}
      value={value}
      readOnly={readOnly}
      onChange={(event) => applyValue(event.target.value, event.target)}
      onKeyDown={onKeyDown}
      required={required}
    />
  ) : (
    <input
      ref={controlRef as React.RefObject<HTMLInputElement>}
      id={controlId}
      className="amount-control"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      inputMode="decimal"
      placeholder={placeholder}
      value={value}
      readOnly={readOnly}
      onChange={(event) => applyValue(event.target.value, event.target)}
      onKeyDown={onKeyDown}
      required={required}
    />
  );

  const money = (
    <label className="amount-money" htmlFor={controlId}>
      <span className="amount-currency" id={currencyId}>
        KES
      </span>
      <div className="amount-control-wrap">{control}</div>
    </label>
  );

  return (
    <div className={rootClass}>
      {label !== undefined && label !== null && label !== false ? (
        <span className="amount-label" id={labelId}>
          {label}
        </span>
      ) : null}
      {accessory !== undefined ? (
        <div className="amount-compose">
          {money}
          {accessory}
        </div>
      ) : (
        money
      )}
      {words.length > 0 ? (
        <p className="amount-words" id={wordsId} aria-live="polite">
          {words}
        </p>
      ) : null}
    </div>
  );
}
