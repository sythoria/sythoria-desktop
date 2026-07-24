export interface CustomThemeConfig {
  preset: string;
  background: string;
  foreground: string;
  accent: string;
}

export interface ThemeConfig {
  mode: "light" | "dark" | "system";
  lightTheme: CustomThemeConfig;
  darkTheme: CustomThemeConfig;
  translucentSidebar: boolean;
}

export const LIGHT_PRESETS: Record<string, CustomThemeConfig> = {
  "Sythoria Light": {
    preset: "Sythoria Light",
    background: "#ffffff",
    foreground: "#09090b",
    accent: "#3b82f6",
  },
  "Default Light": {
    preset: "Default Light",
    background: "#ffffff",
    foreground: "#0f172a",
    accent: "#0f172a",
  },
  Catppuccin: {
    preset: "Catppuccin",
    background: "#eff1f5",
    foreground: "#4c4f69",
    accent: "#1e66f5",
  },
  "One Light": {
    preset: "One Light",
    background: "#fafafa",
    foreground: "#383a42",
    accent: "#4078f2",
  },
  "Solarized Light": {
    preset: "Solarized Light",
    background: "#FAF4E5",
    foreground: "#435155",
    accent: "#CB4B16",
  },
};

export const DARK_PRESETS: Record<string, CustomThemeConfig> = {
  "Sythoria Dark": {
    preset: "Sythoria Dark",
    background: "#09090b",
    foreground: "#fafafa",
    accent: "#3b82f6",
  },
  "Default Dark": {
    preset: "Default Dark",
    background: "#161616",
    foreground: "#f4f4f5",
    accent: "#ffffff",
  },
  Catppuccin: {
    preset: "Catppuccin",
    background: "#1e1e2e",
    foreground: "#cdd6f4",
    accent: "#89b4fa",
  },
  Dracula: {
    preset: "Dracula",
    background: "#282a36",
    foreground: "#f8f8f2",
    accent: "#bd93f9",
  },
  Monokai: {
    preset: "Monokai",
    background: "#272822",
    foreground: "#f8f8f2",
    accent: "#f92672",
  },
  "One Dark Pro": {
    preset: "One Dark Pro",
    background: "#282c34",
    foreground: "#abb2bf",
    accent: "#61afef",
  },
  "Tokyo Night": {
    preset: "Tokyo Night",
    background: "#1A1B26",
    foreground: "#A9B1D6",
    accent: "#7AA2F7",
  },
};

export const DEFAULT_THEME_CONFIG: ThemeConfig = {
  mode: "system",
  lightTheme: { ...LIGHT_PRESETS["Sythoria Light"] },
  darkTheme: { ...DARK_PRESETS["Sythoria Dark"] },
  translucentSidebar: true,
};

function hexToRgba(hex: string, alpha: number): string {
  let cleanHex = hex.trim().replace("#", "");
  if (cleanHex.length === 3) {
    cleanHex = cleanHex
      .split("")
      .map((char) => char + char)
      .join("");
  }
  const r = parseInt(cleanHex.slice(0, 2), 16) || 0;
  const g = parseInt(cleanHex.slice(2, 4), 16) || 0;
  const b = parseInt(cleanHex.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function lightenColor(hex: string, percent: number): string {
  let cleanHex = hex.trim().replace("#", "");
  if (cleanHex.length === 3) {
    cleanHex = cleanHex
      .split("")
      .map((char) => char + char)
      .join("");
  }
  const num = parseInt(cleanHex, 16) || 0;
  const amt = Math.round(2.55 * percent);
  const R = (num >> 16) + amt;
  const G = ((num >> 8) & 0x00ff) + amt;
  const B = (num & 0x0000ff) + amt;

  const rClamped = Math.min(255, Math.max(0, R));
  const gClamped = Math.min(255, Math.max(0, G));
  const bClamped = Math.min(255, Math.max(0, B));

  return "#" + (0x1000000 + rClamped * 0x10000 + gClamped * 0x100 + bClamped).toString(16).slice(1);
}

function normalizeHex(color: string, defaultColor: string): string {
  let cleaned = color.trim();
  if (cleaned && !cleaned.startsWith("#")) {
    cleaned = "#" + cleaned;
  }
  const hexPattern = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
  if (hexPattern.test(cleaned)) {
    return cleaned;
  }
  return defaultColor;
}

export function getContrastColor(hex: string): string {
  let cleanHex = hex.trim().replace("#", "");
  if (cleanHex.length === 3) {
    cleanHex = cleanHex
      .split("")
      .map((char) => char + char)
      .join("");
  }
  const r = parseInt(cleanHex.slice(0, 2), 16) || 0;
  const g = parseInt(cleanHex.slice(2, 4), 16) || 0;
  const b = parseInt(cleanHex.slice(4, 6), 16) || 0;
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? "#000000" : "#ffffff";
}

function mixColors(color1: string, color2: string, weight: number): string {
  let c1 = color1.trim().replace("#", "");
  let c2 = color2.trim().replace("#", "");

  if (c1.length === 3) {
    c1 = c1
      .split("")
      .map((char) => char + char)
      .join("");
  } else if (c1.length === 8) {
    c1 = c1.slice(0, 6);
  }

  if (c2.length === 3) {
    c2 = c2
      .split("")
      .map((char) => char + char)
      .join("");
  } else if (c2.length === 8) {
    c2 = c2.slice(0, 6);
  }

  const r1 = parseInt(c1.slice(0, 2), 16) || 0;
  const g1 = parseInt(c1.slice(2, 4), 16) || 0;
  const b1 = parseInt(c1.slice(4, 6), 16) || 0;

  const r2 = parseInt(c2.slice(0, 2), 16) || 0;
  const g2 = parseInt(c2.slice(2, 4), 16) || 0;
  const b2 = parseInt(c2.slice(4, 6), 16) || 0;

  const r = Math.round(r1 * weight + r2 * (1 - weight));
  const g = Math.round(g1 * weight + g2 * (1 - weight));
  const b = Math.round(b1 * weight + b2 * (1 - weight));

  const rClamped = Math.min(255, Math.max(0, r));
  const gClamped = Math.min(255, Math.max(0, g));
  const bClamped = Math.min(255, Math.max(0, b));

  return "#" + (0x1000000 + rClamped * 0x10000 + gClamped * 0x100 + bClamped).toString(16).slice(1);
}

export function applyTheme(config: ThemeConfig) {
  if (typeof document === "undefined") return;

  const systemDark =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false;
  const isDark = config.mode === "dark" || (config.mode === "system" && systemDark);

  document.documentElement.classList.toggle("dark", isDark);

  const colors = isDark ? config.darkTheme : config.lightTheme;
  const bg = normalizeHex(colors.background, isDark ? "#161616" : "#ffffff");
  const fg = normalizeHex(colors.foreground, isDark ? "#f4f4f5" : "#0f172a");
  const accent = normalizeHex(colors.accent, isDark ? "#ffffff" : "#0f172a");
  const style = document.documentElement.style;
  const translucentSidebar = config.translucentSidebar ?? true;

  style.setProperty("--theme-chat", bg);

  const surfaceColor = isDark ? lightenColor(bg, 6) : bg;
  style.setProperty("--theme-surface", surfaceColor);

  // Popups are portaled outside their parent cards, so they need an opaque,
  // palette-derived surface of their own instead of a white/black fallback.
  const popupColor = isDark ? lightenColor(bg, 10) : mixColors(bg, fg, 0.97);
  style.setProperty("--theme-popup", popupColor);

  const sidebarColor = translucentSidebar ? hexToRgba(bg, isDark ? 0.4 : 0.9) : bg;
  style.setProperty("--theme-sidebar", sidebarColor);
  document.documentElement.classList.toggle("sidebar-translucency-disabled", !translucentSidebar);

  const inputColor = isDark ? hexToRgba(fg, 0.06) : hexToRgba(fg, 0.08);
  style.setProperty("--theme-input", inputColor);

  style.setProperty("--theme-input-border", hexToRgba(fg, 0.12));
  style.setProperty("--theme-accent", accent);

  const accentHoverColor = isDark ? lightenColor(accent, 10) : hexToRgba(accent, 0.85);
  style.setProperty("--theme-accent-hover", accentHoverColor);

  const accentSoftColor = hexToRgba(accent, isDark ? 0.15 : 0.08);
  style.setProperty("--theme-accent-soft", accentSoftColor);

  style.setProperty("--theme-accent-foreground", getContrastColor(accent));

  style.setProperty("--theme-text-primary", fg);

  const textSecondaryColor = mixColors(fg, bg, isDark ? 0.75 : 0.8);
  style.setProperty("--theme-text-secondary", textSecondaryColor);

  const textMutedColor = mixColors(fg, bg, isDark ? 0.5 : 0.6);
  style.setProperty("--theme-text-muted", textMutedColor);

  style.setProperty("--theme-user-bubble", isDark ? hexToRgba(fg, 0.06) : hexToRgba(fg, 0.08));
  style.setProperty("--theme-hover", hexToRgba(fg, isDark ? 0.06 : 0.04));
  style.setProperty("--theme-active", hexToRgba(fg, isDark ? 0.1 : 0.07));
  style.setProperty("--theme-border", hexToRgba(fg, 0.12));

  // Keep modal backdrops in the selected palette instead of falling back to
  // the default light/dark overlay colors.
  const overlayBase = isDark ? mixColors(bg, "#000000", 0.55) : fg;
  const overlayColor = hexToRgba(overlayBase, isDark ? 0.68 : 0.15);
  style.setProperty("--theme-overlay", overlayColor);
}
