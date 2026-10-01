import type { ReactElement, ReactNode } from "react";

function Mark({ children }: { children: ReactNode }): ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  );
}

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function MarkPot(): ReactElement {
  return (
    <Mark>
      <path d="M7 10.2c-1.6.3-2.5 1.6-2.5 2.6s.9 2.3 2.5 2.6" {...stroke} />
      <path d="M17 10.2c1.6.3 2.5 1.6 2.5 2.6s-.9 2.3-2.5 2.6" {...stroke} />
      <ellipse cx="12" cy="13" rx="5.2" ry="4" {...stroke} />
    </Mark>
  );
}

export function MarkMove(): ReactElement {
  return (
    <Mark>
      <path d="M4 12h14M13 6.5 19.5 12 13 17.5" {...stroke} />
    </Mark>
  );
}

export function MarkPlus(): ReactElement {
  return (
    <Mark>
      <path d="M12 5v14M5 12h14" {...stroke} />
    </Mark>
  );
}

export function MarkLoan(): ReactElement {
  return (
    <Mark>
      <rect x="5.5" y="4.5" width="13" height="15" rx="1.6" {...stroke} />
      <path d="M8.5 9h7M8.5 12.5h7M8.5 16h4" {...stroke} />
    </Mark>
  );
}

export function MarkInvest(): ReactElement {
  return (
    <Mark>
      <path d="M4 16.5 9.2 11l3.1 2.6L20 6.5" {...stroke} />
      <path d="M14.5 6.5H20V12" {...stroke} />
    </Mark>
  );
}

export function MarkYou(): ReactElement {
  return (
    <Mark>
      <circle cx="12" cy="8" r="2.6" {...stroke} />
      <path d="M6.5 18.2c.8-2.8 2.8-4.2 5.5-4.2s4.7 1.4 5.5 4.2" {...stroke} />
    </Mark>
  );
}

export function MarkChain(): ReactElement {
  return (
    <Mark>
      <path d="M9 15.5 6.8 17.7a3.1 3.1 0 0 1-4.4-4.4L4.6 11" {...stroke} />
      <path d="M15 8.5 17.2 6.3a3.1 3.1 0 0 1 4.4 4.4L19.4 13" {...stroke} />
      <path d="m9.5 14.5 5-5" {...stroke} />
    </Mark>
  );
}

export function MarkBook(): ReactElement {
  return (
    <Mark>
      <path d="M4.6 6.6v11.2L12 19.6l7.4-1.8V6.6" {...stroke} />
      <path d="M4.6 6.6 12 8.4 19.4 6.6" {...stroke} />
      <path d="M12 8.4v11.2" {...stroke} />
    </Mark>
  );
}

export function MarkVerify(): ReactElement {
  return (
    <Mark>
      <circle cx="12" cy="12" r="7.25" {...stroke} />
      <path d="m8.2 12.1 2.5 2.5 5.1-5.2" {...stroke} />
    </Mark>
  );
}

export function MarkCheck(): ReactElement {
  return (
    <Mark>
      <path d="m5.5 12.5 4.2 4.2 8.8-9.2" {...stroke} />
    </Mark>
  );
}

export function MarkTrash(): ReactElement {
  return (
    <Mark>
      <path d="M9 4.5h6" {...stroke} />
      <path d="M5.5 7h13" {...stroke} />
      <path d="M8 7v11.5a1.5 1.5 0 0 0 1.5 1.5h5a1.5 1.5 0 0 0 1.5-1.5V7" {...stroke} />
      <path d="M10.5 10.5v5M13.5 10.5v5" {...stroke} />
    </Mark>
  );
}

export function MarkDeposit(): ReactElement {
  return (
    <Mark>
      <path d="M12 5v10.5M8 11.5 12 15.5l4-4" {...stroke} />
      <path d="M5.5 19h13" {...stroke} />
    </Mark>
  );
}

export function MarkWithdraw(): ReactElement {
  return (
    <Mark>
      <path d="M12 19V8.5M8 12.5 12 8.5l4 4" {...stroke} />
      <path d="M5.5 5h13" {...stroke} />
    </Mark>
  );
}

export function MarkPrice(): ReactElement {
  return (
    <Mark>
      <circle cx="12" cy="12" r="7.25" {...stroke} />
      <path d="M12 7.5v9M9.6 9.4c.7-.7 1.6-1 2.4-1s1.8.4 1.8 1.4c0 2-3.8 1.2-3.8 3.4 0 1 .8 1.5 2 1.5s1.7-.3 2.3-1" {...stroke} />
    </Mark>
  );
}

export function MarkPrev(): ReactElement {
  return (
    <Mark>
      <path d="M15 5 8 12l7 7" {...stroke} />
    </Mark>
  );
}

export function MarkNext(): ReactElement {
  return (
    <Mark>
      <path d="m9 5 7 7-7 7" {...stroke} />
    </Mark>
  );
}
