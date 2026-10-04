/**
 * Keeps the native Windows backdrop (Acrylic/Mica) in the same light/dark
 * appearance as the app theme. DWM tints the system backdrop from the window's
 * immersive dark-mode attribute, so without this a dark app theme sits on a
 * light-gray Acrylic sheet whenever Windows itself is in light mode.
 *
 * macOS is intentionally untouched: its NSVisualEffectView already follows the
 * WebView appearance.
 */
let lastAppliedDark: boolean | null = null;

function isWindowsTauriRuntime(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return "__TAURI_INTERNALS__" in window && navigator.userAgent.includes("Windows");
}

export function syncNativeWindowTheme(isDark: boolean): void {
  if (!isWindowsTauriRuntime() || lastAppliedDark === isDark) return;
  lastAppliedDark = isDark;

  void import("@tauri-apps/api/window")
    .then(({ getCurrentWindow }) => getCurrentWindow().setTheme(isDark ? "dark" : "light"))
    .catch((error: unknown) => {
      lastAppliedDark = null;
      console.warn("Could not sync the native Windows backdrop theme", error);
    });
}
