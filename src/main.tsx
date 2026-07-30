import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppMotionConfig } from "./components/AppMotionConfig";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";

const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

if (prefersDark) {
  document.documentElement.classList.add("dark");
} else {
  document.documentElement.classList.remove("dark");
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppMotionConfig>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </AppMotionConfig>
  </React.StrictMode>,
);
