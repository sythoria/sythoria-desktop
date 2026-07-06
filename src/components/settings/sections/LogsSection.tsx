import { useState, useCallback } from "react";
import { motion } from "motion/react";
import { Search, Filter, Copy, X, Check, ChevronDown } from "lucide-react";
import { springs, motionTokens } from "../../../lib/motion-tokens";
import { LogEntry, LogSource } from "../../../types/log";
import { clearLogs } from "../../../utils/logger";
import { useTranslation } from "../../../utils/i18n";

const LOG_SOURCE_OPTIONS: { value: LogSource | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "chat", label: "Chat" },
  { value: "model", label: "Models" },
  { value: "search", label: "Search" },
  { value: "mcp", label: "MCP" },
  { value: "storage", label: "Storage" },
  { value: "stream", label: "Stream" },
  { value: "git", label: "Git" },
  { value: "appshots", label: "Appshots" },
  { value: "general", label: "General" },
];

const LOG_LEVEL_OPTIONS = [
  { value: "all" as const, label: "All" },
  { value: "error" as const, label: "Errors" },
  { value: "warn" as const, label: "Warnings" },
  { value: "info" as const, label: "Info" },
];

const LEVEL_COLORS: Record<string, string> = {
  error: "text-red-600 dark:text-red-500",
  warn: "text-amber-600 dark:text-yellow-500",
  info: "text-blue-600 dark:text-blue-400",
  debug: "text-text-muted",
};

const SOURCE_BADGE_COLORS: Record<string, string> = {
  chat: "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20",
  model: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
  search: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-cyan-500/20",
  mcp: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20",
  storage: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20",
  stream: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-500/20",
  git: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  appshots: "bg-pink-500/10 text-pink-700 dark:text-pink-400 border-pink-500/20",
  general: "bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20",
};

interface LogsSectionProps {
  logBuffer: LogEntry[];
  logFilterSource: LogSource | "all";
  logFilterLevel: "all" | "info" | "warn" | "error";
  setLogFilterSource: (source: LogSource | "all") => void;
  setLogFilterLevel: (level: "all" | "info" | "warn" | "error") => void;
}

export const LogsSection = ({
  logBuffer,
  logFilterSource,
  logFilterLevel,
  setLogFilterSource,
  setLogFilterLevel,
}: LogsSectionProps) => {
  const { t } = useTranslation();

  const getSourceLabel = (value: string) => {
    switch (value) {
      case "all":
        return t("settings.logs.sourceAll");
      case "chat":
        return t("settings.logs.sourceChat");
      case "model":
        return t("settings.logs.sourceModels");
      case "search":
        return t("settings.logs.sourceSearch");
      case "mcp":
        return t("settings.logs.sourceMcp");
      case "storage":
        return t("settings.logs.sourceStorage");
      case "stream":
        return t("settings.logs.sourceStream");
      case "git":
        return t("settings.logs.sourceGit");
      case "appshots":
        return t("settings.logs.sourceAppshots");
      case "general":
        return t("settings.logs.sourceGeneral");
      default:
        return value;
    }
  };

  const getLevelLabel = (value: string) => {
    switch (value) {
      case "all":
        return t("settings.logs.levelAll");
      case "error":
        return t("settings.logs.levelErrors");
      case "warn":
        return t("settings.logs.levelWarnings");
      case "info":
        return t("settings.logs.levelInfo");
      default:
        return value;
    }
  };

  const [logSearch, setLogSearch] = useState("");
  const [copiedLogs, setCopiedLogs] = useState(false);

  const filteredLogs = logBuffer
    .filter((l: LogEntry) => logFilterSource === "all" || l.source === logFilterSource)
    .filter((l: LogEntry) => logFilterLevel === "all" || l.level === logFilterLevel)
    .filter(
      (l: LogEntry) =>
        !logSearch ||
        l.message.toLowerCase().includes(logSearch.toLowerCase()) ||
        (l.details && l.details.toLowerCase().includes(logSearch.toLowerCase())) ||
        (l.action && l.action.toLowerCase().includes(logSearch.toLowerCase())),
    );

  const handleCopyLogs = useCallback(() => {
    const text = filteredLogs
      .map((l: LogEntry) => {
        const d = new Date(l.timestamp);
        const date = d.toISOString().slice(0, 10);
        const time = d.toTimeString().slice(0, 8);
        let line = `[${date}][${time}][sythoria][${l.level.toUpperCase()}] [${l.source}] ${l.message}`;
        if (l.details) line += `\n  Details: ${l.details}`;
        if (l.action) line += `\n  Fix: ${l.action}`;
        return line;
      })
      .join("\n\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopiedLogs(true);
      setTimeout(() => setCopiedLogs(false), 2000);
    });
  }, [filteredLogs]);

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-text-primary mb-1">{t("settings.logs.title")}</h3>
          <p className="text-xs text-text-muted">{t("settings.logs.subtitle")}</p>
        </div>{" "}
        <div className="flex items-center gap-2">
          <motion.button
            onClick={handleCopyLogs}
            whileHover={{ scale: motionTokens.scale.pop }}
            whileTap={{ scale: motionTokens.scale.press }}
            transition={springs.snappy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-input text-text-primary hover:bg-hover border border-border text-sm font-medium transition-colors shadow-sm min-h-[44px]"
            aria-label={t("settings.logs.copy")}
          >
            {copiedLogs ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
            <span>{copiedLogs ? t("settings.logs.copied") : t("settings.logs.copy")}</span>
          </motion.button>
          <motion.button
            onClick={() => {
              clearLogs();
            }}
            whileHover={{ scale: motionTokens.scale.pop }}
            whileTap={{ scale: motionTokens.scale.press }}
            transition={springs.snappy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-input text-text-primary hover:bg-hover border border-border text-sm font-medium transition-colors shadow-sm min-h-[44px]"
            aria-label={t("settings.logs.clear")}
          >
            <X size={14} />
            <span>{t("settings.logs.clear")}</span>
          </motion.button>
        </div>
      </div>

      <div className="bg-surface border border-border rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 p-3 border-b border-border/50 flex-wrap">
          <div className="relative flex-1 min-w-[140px]">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={logSearch}
              onChange={(e) => setLogSearch(e.target.value)}
              placeholder={t("settings.logs.search")}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-input-border bg-input text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent/30 transition-colors"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Filter size={14} className="text-text-muted" />
            <div className="relative">
              <select
                value={logFilterSource}
                onChange={(e) => setLogFilterSource(e.target.value as LogSource | "all")}
                className="pl-2 pr-7 py-1.5 appearance-none rounded-lg border border-input-border bg-input text-xs text-text-primary focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                aria-label={t("settings.logs.filterSource")}
              >
                {LOG_SOURCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {getSourceLabel(o.value)}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={12}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
                aria-hidden="true"
              />
            </div>
            <div className="relative">
              <select
                value={logFilterLevel}
                onChange={(e) => setLogFilterLevel(e.target.value as "all" | "info" | "warn" | "error")}
                className="pl-2 pr-7 py-1.5 appearance-none rounded-lg border border-input-border bg-input text-xs text-text-primary focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                aria-label={t("settings.logs.filterLevel")}
              >
                {LOG_LEVEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {getLevelLabel(o.value)}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={12}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
                aria-hidden="true"
              />
            </div>
          </div>
        </div>

        <div className="max-h-80 overflow-y-auto">
          {filteredLogs.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-text-muted text-sm">
                {logBuffer.length === 0 ? t("settings.logs.noLogsDesc") : t("settings.logs.noLogs")}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {/* Grid header */}
              <div className="grid grid-cols-[140px_50px_85px_1fr] gap-2 px-3 py-1.5 bg-surface/50 text-[10px] font-medium text-text-muted uppercase tracking-wider sticky top-0">
                <span>{t("settings.logs.timeHeader", { defaultValue: "Time" })}</span>
                <span>{t("settings.logs.levelHeader", { defaultValue: "Level" })}</span>
                <span>{t("settings.logs.sourceHeader", { defaultValue: "Source" })}</span>
                <span>{t("settings.logs.messageHeader", { defaultValue: "Message" })}</span>
              </div>
              {filteredLogs.map((log: LogEntry) => (
                <div
                  key={log.id}
                  className="grid grid-cols-[140px_50px_85px_1fr] gap-2 px-3 py-2 hover:bg-hover/30 transition-colors items-start"
                >
                  <span className="shrink-0 text-[10px] text-text-muted font-mono pt-0.5">
                    {(() => {
                      const d = new Date(log.timestamp);
                      return `${d.toISOString().slice(0, 10)} ${d.toTimeString().slice(0, 8)}`;
                    })()}
                  </span>
                  <span
                    className={`shrink-0 text-[10px] font-mono font-semibold pt-0.5 ${LEVEL_COLORS[log.level] || "text-text-muted"}`}
                  >
                    {log.level.slice(0, 4).toUpperCase()}
                  </span>
                  <span
                    className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium border self-start ${SOURCE_BADGE_COLORS[log.source] || "bg-gray-500/10 text-gray-400 border-gray-500/20"}`}
                  >
                    {log.source}
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-text-primary break-words">{log.message}</span>
                    {log.details && (
                      <p className="text-[10px] text-text-muted mt-0.5 break-words font-mono">{log.details}</p>
                    )}
                    {log.action && log.level !== "info" && (
                      <p className="text-[10px] text-yellow-600 dark:text-yellow-400 mt-0.5 break-words">
                        <span className="font-medium">{t("settings.logs.fix", { defaultValue: "Fix:" })}</span>{" "}
                        {log.action}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-3 py-2 border-t border-border/50 text-xs text-text-muted">
          {t("settings.logs.entriesCount", { filtered: String(filteredLogs.length), total: String(logBuffer.length) })}
        </div>
      </div>
    </>
  );
};
