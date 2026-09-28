import { useUIStore } from "../../store/ui/useUIStore";
import { en } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { de } from "./de";
import { zh } from "./zh";
import { ja } from "./ja";

export const SUPPORTED_LANGUAGES = [
  { code: "en", name: "English", nativeName: "English" },
  { code: "es", name: "Spanish", nativeName: "Español" },
  { code: "fr", name: "French", nativeName: "Français" },
  { code: "de", name: "German", nativeName: "Deutsch" },
  { code: "zh", name: "Chinese (Simplified)", nativeName: "简体中文" },
  { code: "ja", name: "Japanese", nativeName: "日本語" },
] as const;

export type SupportedLanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["code"];

export const translations: Record<SupportedLanguageCode, Record<string, string>> = {
  en,
  es,
  fr,
  de,
  zh,
  ja,
};

export function useTranslation() {
  const language = (useUIStore((s) => s.language) || "en") as SupportedLanguageCode;

  const t = (key: string, replacements?: Record<string, string>): string => {
    const dict = translations[language] || translations["en"];
    let value = dict?.[key] ?? translations["en"]?.[key] ?? (replacements?.defaultValue || key);

    if (replacements) {
      Object.entries(replacements).forEach(([k, v]) => {
        if (k !== "defaultValue") {
          value = value.replace(new RegExp(`{${k}}`, "g"), String(v));
        }
      });
    }

    return value;
  };

  return {
    t,
    language,
    supportedLanguages: SUPPORTED_LANGUAGES,
  };
}
