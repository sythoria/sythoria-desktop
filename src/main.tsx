import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { SpotlightArea } from "./components/SpotlightArea";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { getCurrentWindow } from "@tauri-apps/api/window";

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
const isDark = themeMode === "dark" || (themeMode === "system" && prefersDark) || (!themeMode && prefersDark);

if (isDark) {
  document.documentElement.classList.add("dark");
} else {
  document.documentElement.classList.remove("dark");
}

// Detect if we're rendering inside the spotlight window or the main app window
const isSpotlight = getCurrentWindow().label === "spotlight";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>{isSpotlight ? <SpotlightArea /> : <App />}</ErrorBoundary>
  </React.StrictMode>,
);
