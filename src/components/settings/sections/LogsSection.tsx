import { useState, useCallback } from "react";
import { motion } from "motion/react";
import { Search, Filter, Copy, X, Check } from "lucide-react";
import { springs, motionTokens } from "../../../lib/motion-tokens";
import { LogEntry, LogSource } from "../../../types/log";
import { clearLogs } from "../../../utils/logger";

const LOG_SOURCE_OPTIONS: { value: LogSource | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "chat", label: "Chat" },
  { value: "model", label: "Models" },
  { value: "search", label: "Search" },
  { value: "mcp", label: "MCP" },
  { value: "storage", label: "Storage" },
  { value: "stream", label: "Stream" },
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
          <h3 className="text-sm font-semibold text-text-primary mb-1">Activity Log</h3>
          <p className="text-xs text-text-muted">Application events and errors</p>
        </div>{" "}
        <div className="flex items-center gap-2">
          <motion.button
            onClick={handleCopyLogs}
            whileHover={{ scale: motionTokens.scale.pop }}
            whileTap={{ scale: motionTokens.scale.press }}
            transition={springs.snappy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-input text-text-primary hover:bg-hover border border-border text-sm font-medium transition-colors shadow-sm min-h-[44px]"
            aria-label="Copy logs"
          >
            {copiedLogs ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
            <span>{copiedLogs ? "Copied" : "Copy"}</span>
          </motion.button>
          <motion.button
            onClick={() => {
              clearLogs();
            }}
            whileHover={{ scale: motionTokens.scale.pop }}
            whileTap={{ scale: motionTokens.scale.press }}
            transition={springs.snappy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-input text-text-primary hover:bg-hover border border-border text-sm font-medium transition-colors shadow-sm min-h-[44px]"
            aria-label="Clear logs"
          >
            <X size={14} />
            <span>Clear</span>
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
              placeholder="Search logs..."
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-input-border bg-input text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent/30 transition-colors"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Filter size={14} className="text-text-muted" />
            <select
              value={logFilterSource}
              onChange={(e) => setLogFilterSource(e.target.value as LogSource | "all")}
              className="px-2 py-1.5 rounded-lg border border-input-border bg-input text-sm text-text-primary focus:outline-none focus:border-accent/30 transition-colors"
              aria-label="Filter by source"
            >
              {LOG_SOURCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              value={logFilterLevel}
              onChange={(e) => setLogFilterLevel(e.target.value as "all" | "info" | "warn" | "error")}
              className="px-2 py-1.5 rounded-lg border border-input-border bg-input text-sm text-text-primary focus:outline-none focus:border-accent/30 transition-colors"
              aria-label="Filter by level"
            >
              {LOG_LEVEL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="max-h-80 overflow-y-auto">
          {filteredLogs.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-text-muted text-sm">
                {logBuffer.length === 0 ? "No activity logged yet." : "No logs match your filters."}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {filteredLogs.map((log: LogEntry) => (
                <div key={log.id} className="px-3 py-2.5 hover:bg-hover/30 transition-colors">
                  <div className="flex items-start gap-2">
                    <span
                      className={`shrink-0 text-xs font-mono font-semibold mt-0.5 ${LEVEL_COLORS[log.level] || "text-text-muted"}`}
                    >
                      {log.level.toUpperCase().padEnd(5)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium border ${SOURCE_BADGE_COLORS[log.source] || "bg-gray-500/10 text-gray-400 border-gray-500/20"}`}
                        >
                          {log.source}
                        </span>
                        <span className="text-sm text-text-primary break-words">{log.message}</span>
                      </div>
                      {log.details && (
                        <p className="text-xs text-text-muted mt-1 break-words font-mono">{log.details}</p>
                      )}
                      {log.action && log.level !== "info" && (
                        <p className="text-xs text-accent mt-1 break-words">
                          <span className="font-medium">Fix:</span> {log.action}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 text-[10px] text-text-muted font-mono mt-0.5">
                      {(() => {
                        const d = new Date(log.timestamp);
                        return `${d.toISOString().slice(0, 10)} ${d.toTimeString().slice(0, 8)}`;
                      })()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-3 py-2 border-t border-border/50 text-xs text-text-muted">
          {filteredLogs.length} of {logBuffer.length} log entries
        </div>
      </div>
    </>
  );
};
