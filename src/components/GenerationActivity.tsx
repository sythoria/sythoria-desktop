import { memo } from "react";
import { Loader2, Search, Globe, Sparkles, MessageSquare, AlertTriangle } from "lucide-react";
import type { ActivityEntry, GenerationState } from "../types";

const STATE_CONFIG: Record<GenerationState, { icon: React.ElementType; colorClass: string; activeColorClass: string }> =
  {
    idle: { icon: MessageSquare, colorClass: "text-text-muted", activeColorClass: "text-text-muted" },
    thinking: { icon: Sparkles, colorClass: "text-purple-500", activeColorClass: "text-purple-400" },
    searching: { icon: Search, colorClass: "text-blue-500", activeColorClass: "text-blue-400" },
    fetching: { icon: Globe, colorClass: "text-cyan-500", activeColorClass: "text-cyan-400" },
    responding: { icon: MessageSquare, colorClass: "text-accent", activeColorClass: "text-accent" },
    error: { icon: AlertTriangle, colorClass: "text-red-500", activeColorClass: "text-red-400" },
  };

function ActivityItem({ entry, isActive }: { entry: ActivityEntry; isActive: boolean }) {
  const config = STATE_CONFIG[entry.state];
  const Icon = config.icon;

  return (
    <div className="flex items-center gap-2 animate-fade-in">
      <div
        className={`shrink-0 w-5 h-5 rounded-md flex items-center justify-center ${
          entry.state === "error" ? "bg-red-500/10" : isActive ? "bg-accent/10" : "bg-surface/50"
        }`}
      >
        {isActive && entry.state !== "error" && entry.state !== "idle" ? (
          <Loader2 size={12} className={`animate-spin ${config.activeColorClass}`} />
        ) : (
          <Icon
            size={12}
            className={
              entry.state === "error" ? config.colorClass : isActive ? config.activeColorClass : "text-text-muted"
            }
          />
        )}
      </div>
      <span
        className={`text-xs font-medium truncate ${
          entry.state === "error"
            ? "text-red-600 dark:text-red-400"
            : isActive
              ? "text-text-primary"
              : "text-text-muted"
        }`}
      >
        {entry.label}
      </span>
      {entry.error && (
        <span className="text-[10px] text-red-400 dark:text-red-500 truncate ml-1" title={entry.error}>
          {entry.error}
        </span>
      )}
    </div>
  );
}

interface GenerationActivityProps {
  activityLog: ActivityEntry[];
  generationState: GenerationState;
}

function GenerationActivity({ activityLog, generationState }: GenerationActivityProps) {
  if (activityLog.length === 0) return null;

  return (
    <div className="px-4 py-2 space-y-1">
      {activityLog.map((entry, i) => (
        <ActivityItem
          key={entry.id}
          entry={entry}
          isActive={i === activityLog.length - 1 && generationState !== "idle"}
        />
      ))}
    </div>
  );
}

export default memo(GenerationActivity);
