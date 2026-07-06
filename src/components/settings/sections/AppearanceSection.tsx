import { useCallback, useMemo } from "react";
import { ChevronDown } from "lucide-react";
import { Switch } from "../../ui/Switch";
import { ColorPickerInput } from "../components/ColorPickerInput";
import { LIGHT_PRESETS, DARK_PRESETS, CustomThemeConfig, ThemeConfig } from "../../../config/themePresets";
import { useUIStore } from "../../../store/useUIStore";
import { useTranslation } from "../../../utils/i18n";

interface AppearanceSectionProps {
  theme: ThemeConfig;
  setTheme: (theme: ThemeConfig) => void;
  animationsDisabled: boolean;
  setAnimationsDisabled: (disabled: boolean) => void;
}

const getSelectedPreset = (colors: CustomThemeConfig, presets: Record<string, CustomThemeConfig>): string => {
  if (!colors) return "Custom";
  const match = Object.entries(presets).find(([_, preset]) => {
    return (
      preset.background.toLowerCase() === colors.background.toLowerCase() &&
      preset.foreground.toLowerCase() === colors.foreground.toLowerCase() &&
      preset.accent.toLowerCase() === colors.accent.toLowerCase()
    );
  });
  return match ? match[0] : "Custom";
};

export const AppearanceSection = ({
  theme,
  setTheme,
  animationsDisabled,
  setAnimationsDisabled,
}: AppearanceSectionProps) => {
  const { t } = useTranslation();
  const downloadedThemes = useUIStore((s) => s.downloadedThemes);
  const mergedLightPresets = useMemo(() => ({ ...LIGHT_PRESETS, ...downloadedThemes.light }), [downloadedThemes.light]);
  const mergedDarkPresets = useMemo(() => ({ ...DARK_PRESETS, ...downloadedThemes.dark }), [downloadedThemes.dark]);

  const handlePresetChange = useCallback(
    (themeType: "light" | "dark", presetName: string) => {
      if (presetName === "Custom") return;
      const presets = themeType === "light" ? mergedLightPresets : mergedDarkPresets;
      const presetColors = presets[presetName];
      if (!presetColors) return;

      const newTheme = {
        ...theme,
        [themeType === "light" ? "lightTheme" : "darkTheme"]: {
          ...presetColors,
        },
      };
      setTheme(newTheme);
    },
    [theme, setTheme, mergedLightPresets, mergedDarkPresets],
  );

  const handleColorChange = useCallback(
    (themeType: "light" | "dark", colorKey: "background" | "foreground" | "accent", colorValue: string) => {
      const targetTheme = themeType === "light" ? theme.lightTheme : theme.darkTheme;
      const updatedThemeColors = {
        ...targetTheme,
        [colorKey]: colorValue,
      };

      const presets = themeType === "light" ? mergedLightPresets : mergedDarkPresets;
      const matchedPreset = Object.entries(presets).find(([_, p]) => {
        return (
          p.background.toLowerCase() === updatedThemeColors.background.toLowerCase() &&
          p.foreground.toLowerCase() === updatedThemeColors.foreground.toLowerCase() &&
          p.accent.toLowerCase() === updatedThemeColors.accent.toLowerCase()
        );
      });

      updatedThemeColors.preset = matchedPreset ? matchedPreset[0] : "Custom";

      const newTheme = {
        ...theme,
        [themeType === "light" ? "lightTheme" : "darkTheme"]: updatedThemeColors,
      };
      setTheme(newTheme);
    },
    [theme, setTheme, mergedLightPresets, mergedDarkPresets],
  );

  return (
    <>
      <div>
        <h3 className="text-sm font-semibold text-text-primary mb-1">{t("section.appearance")}</h3>
        <p className="text-xs text-text-muted">{t("settings.appearance.subtitle")}</p>
      </div>{" "}
      <div className="bg-surface border border-border rounded-xl p-4 space-y-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-medium text-text-primary block">{t("section.appearance")}</span>
            <span className="text-xs text-text-muted">{t("settings.appearance.selectMode")}</span>
          </div>
          <div className="relative w-[150px]">
            <select
              value={theme.mode}
              onChange={(e) => {
                const mode = e.target.value as "light" | "dark" | "system";
                setTheme({
                  ...theme,
                  mode,
                });
              }}
              className="w-full px-3 py-1.5 pr-8 appearance-none rounded-lg border border-input-border bg-input text-sm text-text-primary focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none transition-colors"
              aria-label={t("settings.appearance.modeLabel")}
            >
              <option value="light">{t("settings.appearance.light")}</option>
              <option value="dark">{t("settings.appearance.dark")}</option>
              <option value="system">{t("settings.appearance.system")}</option>
            </select>
            <ChevronDown
              size={14}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
              aria-hidden="true"
            />
          </div>
        </div>

        <Switch
          checked={!animationsDisabled}
          onChange={(checked) => setAnimationsDisabled(!checked)}
          label={t("settings.appearance.animations")}
          description={t("settings.appearance.animationsDesc")}
        />
      </div>
      <div className="bg-surface border border-border rounded-xl p-4 space-y-2 shadow-sm">
        <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
          {t("settings.appearance.lightTheme")}
        </h4>

        <div className="flex items-center justify-between py-2 border-b border-border/50">
          <span className="text-sm font-medium text-text-primary">{t("settings.appearance.preset")}</span>
          <div className="relative w-[150px]">
            <select
              value={getSelectedPreset(theme.lightTheme, mergedLightPresets)}
              onChange={(e) => handlePresetChange("light", e.target.value)}
              className="w-full px-3 py-1.5 pr-8 appearance-none rounded-lg border border-input-border bg-input text-sm text-text-primary focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none transition-colors"
              aria-label={t("settings.appearance.preset")}
            >
              {Object.keys(mergedLightPresets).map((pName) => (
                <option key={pName} value={pName}>
                  {pName}
                </option>
              ))}
              {getSelectedPreset(theme.lightTheme, mergedLightPresets) === "Custom" && (
                <option value="Custom">Custom</option>
              )}
            </select>
            <ChevronDown
              size={14}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
              aria-hidden="true"
            />
          </div>
        </div>

        <ColorPickerInput
          label={t("settings.appearance.background")}
          value={theme.lightTheme.background}
          onChange={(val) => handleColorChange("light", "background", val)}
        />

        <ColorPickerInput
          label={t("settings.appearance.foreground")}
          value={theme.lightTheme.foreground}
          onChange={(val) => handleColorChange("light", "foreground", val)}
        />

        <ColorPickerInput
          label={t("settings.appearance.accent")}
          value={theme.lightTheme.accent}
          onChange={(val) => handleColorChange("light", "accent", val)}
        />
      </div>
      <div className="bg-surface border border-border rounded-xl p-4 space-y-2 shadow-sm">
        <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
          {t("settings.appearance.darkTheme")}
        </h4>

        <div className="flex items-center justify-between py-2 border-b border-border/50">
          <span className="text-sm font-medium text-text-primary">{t("settings.appearance.preset")}</span>
          <div className="relative w-[150px]">
            <select
              value={getSelectedPreset(theme.darkTheme, mergedDarkPresets)}
              onChange={(e) => handlePresetChange("dark", e.target.value)}
              className="w-full px-3 py-1.5 pr-8 appearance-none rounded-lg border border-input-border bg-input text-sm text-text-primary focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none transition-colors"
              aria-label={t("settings.appearance.preset")}
            >
              {Object.keys(mergedDarkPresets).map((pName) => (
                <option key={pName} value={pName}>
                  {pName}
                </option>
              ))}
              {getSelectedPreset(theme.darkTheme, mergedDarkPresets) === "Custom" && (
                <option value="Custom">Custom</option>
              )}
            </select>
            <ChevronDown
              size={14}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
              aria-hidden="true"
            />
          </div>
        </div>

        <ColorPickerInput
          label={t("settings.appearance.background")}
          value={theme.darkTheme.background}
          onChange={(val) => handleColorChange("dark", "background", val)}
        />

        <ColorPickerInput
          label={t("settings.appearance.foreground")}
          value={theme.darkTheme.foreground}
          onChange={(val) => handleColorChange("dark", "foreground", val)}
        />

        <ColorPickerInput
          label={t("settings.appearance.accent")}
          value={theme.darkTheme.accent}
          onChange={(val) => handleColorChange("dark", "accent", val)}
        />
      </div>
    </>
  );
};
