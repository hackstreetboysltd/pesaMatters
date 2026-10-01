import { useEffect, useId, type ReactNode } from "react";
import { animated, useSpring } from "@react-spring/web";
import { useReducedMotion } from "../motion";

type PotProps = {
  share?: number;
  idle?: boolean;
  /** When false, the fill snaps to `share` with no spring or breathing. */
  animate?: boolean;
  className?: string;
  children?: ReactNode;
};

const money = new Intl.NumberFormat("en-KE", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function surfaceY(level: number): number {
  return 176 - level * 72;
}

/** Clay bowl. `share` is the liquid (0–1). `idle` breathes until sign-in is ready. */
export function Pot({
  share = 0.55,
  idle = false,
  animate = true,
  className,
  children,
}: PotProps): React.ReactElement {
  const reduced = useReducedMotion();
  const rawId = useId();
  const clipId = `bowl${rawId.replace(/:/g, "")}`;
  const clamped = Math.min(1, Math.max(0, share));
  const [springs, api] = useSpring(() => ({
    level: animate ? (reduced ? (idle ? 0.4 : clamped) : 0.18) : clamped,
    immediate: !animate,
  }));

  useEffect(() => {
    if (!animate) {
      api.set({ level: clamped });
      return;
    }
    if (reduced) {
      api.set({ level: idle ? 0.4 : clamped });
      return;
    }
    if (idle) {
      void api.start({
        from: { level: 0.22 },
        to: async (next) => {
          while (true) {
            await next({ level: 0.5, config: { tension: 14, friction: 12 } });
            await next({ level: 0.22, config: { tension: 14, friction: 12 } });
          }
        },
      });
      return () => {
        api.stop();
      };
    }
    api.stop();
    void api.start({
      level: clamped,
      config: { tension: 90, friction: 18 },
    });
    return () => {
      api.stop();
    };
  }, [animate, api, clamped, idle, reduced]);

  const surface = springs.level.to((level) => surfaceY(level));

  return (
    <div className={className === undefined ? "pot" : `pot ${className}`}>
      <svg className="pot-svg" viewBox="0 0 200 210" aria-hidden="true">
        <defs>
          <clipPath id={clipId}>
            <path d="M48 100c0 0-8 28-2 48 6 18 22 28 54 30 32-2 48-12 54-30 6-20-2-48-2-48-16 14-88 14-104 0z" />
          </clipPath>
        </defs>
        <path
          d="M46 104c-16 1-24 10-24 18s8 16 24 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <path
          d="M154 104c16 1 24 10 24 18s-8 16-24 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <path
          d="M48 100c0 0-8 28-2 48 6 18 22 28 54 30 32-2 48-12 54-30 6-20-2-48-2-48-16 14-88 14-104 0z"
          fill="var(--bowl)"
        />
        <g clipPath={`url(#${clipId})`}>
          {clamped <= 0 ? null : animate ? (
            <>
              <animated.rect x="16" y={surface} width="168" height="130" fill="var(--ember)" />
              <animated.ellipse cx="100" cy={surface} rx="56" ry="7" fill="var(--ember)" />
            </>
          ) : (
            <>
              <rect x="16" y={surfaceY(clamped)} width="168" height="130" fill="var(--ember)" />
              <ellipse cx="100" cy={surfaceY(clamped)} rx="56" ry="7" fill="var(--ember)" />
            </>
          )}
        </g>
        <ellipse cx="100" cy="100" rx="64" ry="18" fill="var(--bowl)" stroke="currentColor" strokeWidth="3" />
        <ellipse cx="100" cy="100" rx="52" ry="12" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.45" />
      </svg>
      {children !== undefined ? <div className="pot-face">{children}</div> : null}
    </div>
  );
}

/** Name on the bowl. Pesa sits above Matters. */
export function PotWordmark({ as: Tag = "p" }: { as?: "h1" | "p" }): React.ReactElement {
  return (
    <Tag className="pot-stamp">
      <span className="pot-stamp-name">Pesa</span>
      <span className="pot-stamp-line">Matters</span>
    </Tag>
  );
}

export function SpringAmount({ value }: { value: number }): React.ReactElement {
  const reduced = useReducedMotion();
  const { n } = useSpring({
    from: { n: reduced ? value : 0 },
    to: { n: value },
    immediate: reduced,
    config: { tension: 80, friction: 18 },
  });

  return <animated.span className="claim-figure">{n.to((current) => money.format(current))}</animated.span>;
}

/** Claim figure with no count-up — use on Pot and Move. */
export function StaticAmount({ value }: { value: number }): React.ReactElement {
  return <span className="claim-figure">{money.format(value)}</span>;
}
