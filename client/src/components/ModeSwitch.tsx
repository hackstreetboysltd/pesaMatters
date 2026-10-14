import { animated, useSpring } from "@react-spring/web";
import { useReducedMotion } from "../motion";

type Option<T extends string> = readonly [T, string];

type ModeSwitchProps<T extends string> = {
  label: string;
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
  /** Tab panels use tablist semantics; transact-style toggles use group + aria-pressed. */
  variant?: "tabs" | "pressed";
  tabId?: (id: T) => string;
  tabPanelId?: (id: T) => string;
};

export function ModeSwitch<T extends string>({
  label,
  value,
  options,
  onChange,
  variant = "pressed",
  tabId = (id) => `tab-${id}`,
  tabPanelId = (id) => `panel-${id}`,
}: ModeSwitchProps<T>): React.ReactElement {
  const index = options.findIndex(([id]) => id === value);
  const reduced = useReducedMotion();
  const pill = useSpring({
    x: index < 0 ? 0 : index,
    immediate: reduced,
    config: { tension: 320, friction: 28 },
  });

  const isTabs = variant === "tabs";

  return (
    <div
      className="modes"
      style={{ ["--mode-count" as string]: String(options.length) }}
      role={isTabs ? "tablist" : "group"}
      aria-label={label}
    >
      <animated.span
        className="mode-pill"
        aria-hidden="true"
        style={{ transform: pill.x.to((x) => `translateX(${x * 100}%)`) }}
      />
      {options.map(([id, name]) => (
        <button
          key={id}
          type="button"
          className="mode"
          {...(isTabs
            ? {
                role: "tab",
                id: tabId(id),
                "aria-selected": value === id,
                "aria-controls": tabPanelId(id),
              }
            : { "aria-pressed": value === id })}
          onClick={() => onChange(id)}
        >
          <span className="mode-name">{name}</span>
        </button>
      ))}
    </div>
  );
}
