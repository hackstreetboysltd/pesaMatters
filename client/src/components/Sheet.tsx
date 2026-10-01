import { useEffect, useRef, type ReactNode } from "react";
import { animated, useSpring } from "@react-spring/web";
import { useReducedMotion } from "../motion";

type SheetProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
};

export function Sheet({ title, onClose, children }: SheetProps): React.ReactElement {
  const closeRef = useRef<HTMLButtonElement>(null);
  const reduced = useReducedMotion();
  const style = useSpring({
    from: { y: reduced ? 0 : 100 },
    to: { y: 0 },
    immediate: reduced,
    config: { tension: 280, friction: 28 },
  });

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onMouseDown={onClose}>
      <animated.div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        style={{ transform: style.y.to((value) => `translateY(${value}%)`) }}
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="screen-head">
          <h2 id="sheet-title" className="screen-title">
            {title}
          </h2>
          <button ref={closeRef} type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <span aria-hidden="true">×</span>
          </button>
        </div>
        {children}
      </animated.div>
    </div>
  );
}
