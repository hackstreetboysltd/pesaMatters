import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Appearance = "system" | "kiln" | "after-hours" | "coast" | "fare" | "brew";
export type ResolvedTheme = Exclude<Appearance, "system">;

const KEY = "hackstreet-appearance";

const APPEARANCES: Appearance[] = ["system", "kiln", "after-hours", "coast", "fare", "brew"];

export type ThemeCard = {
  id: Appearance;
  name: string;
  note: string;
  stage: {
    bg: string;
    bar: string;
    ink: string;
    mute: string;
    accent: string;
    dock: string;
  };
};

/** Miniatures and the live shell share these values. CSS in styles.css mirrors them. */
export const THEMES: ThemeCard[] = [
  {
    id: "system",
    name: "Phone",
    note: "Follows this phone.",
    stage: {
      bg: "linear-gradient(90deg, #e4d2bc 0 50%, #12100e 50% 100%)",
      bar: "#3c2e26",
      ink: "#1c1612",
      mute: "#9a8f84",
      accent: "#ff5c1a",
      dock: "#241c17",
    },
  },
  {
    id: "kiln",
    name: "Kiln",
    note: "Clay ground, ember mark.",
    stage: {
      bg: "#e4d2bc",
      bar: "#3c2e26",
      ink: "#1c1612",
      mute: "#9a8f84",
      accent: "#ff5c1a",
      dock: "#fbf6ef",
    },
  },
  {
    id: "after-hours",
    name: "After hours",
    note: "Same fire, darker room.",
    stage: {
      bg: "#12100e",
      bar: "#2a2420",
      ink: "#f6f0e8",
      mute: "#9a8f84",
      accent: "#ff5c1a",
      dock: "#1c1814",
    },
  },
  {
    id: "coast",
    name: "Coast",
    note: "Sea glass on stone.",
    stage: {
      bg: "#c5dbd3",
      bar: "#1a3d36",
      ink: "#0f2a24",
      mute: "#2f4f47",
      accent: "#0c7a68",
      dock: "#fbf6ef",
    },
  },
  {
    id: "fare",
    name: "Fare",
    note: "Route yellow on night glass.",
    stage: {
      bg: "#12151c",
      bar: "#2a2e38",
      ink: "#f5f0e6",
      mute: "#8a8578",
      accent: "#e6b325",
      dock: "#1c2028",
    },
  },
  {
    id: "brew",
    name: "Brew",
    note: "Milk slip on brewed clay.",
    stage: {
      bg: "#2c1a12",
      bar: "#1a100c",
      ink: "#f5ede4",
      mute: "#a89080",
      accent: "#e07a2f",
      dock: "#f7efe6",
    },
  },
];

const THEME_COLORS: Record<ResolvedTheme, string> = {
  kiln: "#E4D2BC",
  "after-hours": "#12100E",
  coast: "#C5DBD3",
  fare: "#12151C",
  brew: "#2C1A12",
};

type ThemeContextValue = {
  appearance: Appearance;
  setAppearance: (next: Appearance) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isAppearance(value: string): value is Appearance {
  return APPEARANCES.includes(value as Appearance);
}

function migrate(stored: string): Appearance {
  if (stored === "light") return "kiln";
  if (stored === "dark") return "after-hours";
  if (isAppearance(stored)) return stored;
  return "system";
}

function resolve(appearance: Appearance): ResolvedTheme {
  if (appearance !== "system") return appearance;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "after-hours" : "kiln";
}

function apply(appearance: Appearance): void {
  const theme = resolve(appearance);
  document.documentElement.setAttribute("data-appearance", appearance);
  document.documentElement.setAttribute("data-theme", theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
}

function readAppearance(): Appearance {
  const stored = localStorage.getItem(KEY);
  if (stored === null) return "system";
  return migrate(stored);
}

export function ThemeProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [appearance, setAppearanceState] = useState<Appearance>(() => readAppearance());

  useEffect(() => {
    apply(appearance);
    if (appearance !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => {
      apply("system");
    };
    media.addEventListener("change", onChange);
    return () => {
      media.removeEventListener("change", onChange);
    };
  }, [appearance]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      appearance,
      setAppearance: (next) => {
        localStorage.setItem(KEY, next);
        setAppearanceState(next);
      },
    }),
    [appearance],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value === null) throw new Error("ThemeProvider is missing");
  return value;
}
