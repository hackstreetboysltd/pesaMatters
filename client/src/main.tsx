import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { ThemeProvider } from "./theme";
import "@fontsource/syne/latin-500.css";
import "@fontsource/syne/latin-700.css";
import "@fontsource/fragment-mono/latin-400.css";
import "./styles.css";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Missing root");
}

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);
