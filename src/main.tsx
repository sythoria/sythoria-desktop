import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";

const rawTheme = localStorage.getItem("sythoria-theme");
let themeMode: string | null = rawTheme;

// Handle legacy or fallback JSON format safely
if (rawTheme && (rawTheme.startsWith("{") || rawTheme.startsWith("["))) {
  try {
    const parsed = JSON.parse(rawTheme);
    themeMode = parsed?.mode || null;
  } catch {
    themeMode = null;
  }
}

const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
const isDark =
  themeMode === "dark" ||
  (themeMode === "system" && prefersDark) ||
  (!themeMode && prefersDark);

if (isDark) {
  document.documentElement.classList.add("dark");
  document.documentElement.style.backgroundColor = "#000000";
} else {
  document.documentElement.classList.remove("dark");
  document.documentElement.style.backgroundColor = "#ffffff";
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
