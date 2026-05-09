import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Initialize theme from local storage or system preference
const theme = localStorage.getItem("theme");
if (theme === "dark" || (!theme && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
  document.documentElement.classList.add("dark");
} else {
  document.documentElement.classList.remove("dark");
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
