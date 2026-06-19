import { memo, useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Trash2,
  ChevronDown,
  AlertCircle,
  Loader2,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  PlugZap,
  Plug,
  X,
  Plus,
} from "lucide-react";
import {
  McpServerConfig,
  McpServerStatus,
  ExecutableCheck,
  McpTransport,
  MCP_STATUS_COLORS,
  MCP_STATUS_LABELS,
} from "../../../types";
import { MCP_TRANSPORT_PRESETS, MCP_SERVER_PRESETS, McpServerPreset } from "../../../config/mcpPresets";
import { springs, motionTokens } from "../../../lib/motion-tokens";
import { EnvVarsEditor } from "./EnvVarsEditor";

interface McpServerCardProps {
  config: McpServerConfig;
  status: McpServerStatus;
  tools: { name: string; description: string }[];
  envVars: Record<string, string>;
  onUpdate: (id: string, updates: Partial<McpServerConfig>) => void;
  onDelete: (id: string) => void;
  onConnect: (id: string) => void;
  onDisconnect: (id: string) => void;
  onSetEnvVars: (id: string, vars: Record<string, string>) => void;
  onCheckCommand: (command: string) => Promise<ExecutableCheck>;
  onApplyPreset: (preset: McpServerPreset, currentConfig: McpServerConfig) => void;
  showKey: boolean;
  onToggleKey: (id: string) => void;
}

export const McpServerCard = memo(function McpServerCard({
  config,
  status,
  tools,
  envVars,
  onUpdate,
  onDelete,
  onConnect,
  onDisconnect,
  onSetEnvVars,
  onCheckCommand,
  onApplyPreset,
  showKey,
  onToggleKey,
}: McpServerCardProps) {
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [exeCheck, setExeCheck] = useState<ExecutableCheck | null>(null);
  const [exeChecking, setExeChecking] = useState(false);
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commandValue = config.command || "";
  const args = config.args ?? [];

  useEffect(() => {
    if (config.transport !== "stdio") return;
    const trimmed = commandValue.trim();

    if (checkTimer.current) clearTimeout(checkTimer.current);

    if (!trimmed) {
      setExeCheck(null);
      setExeChecking(false);
      return;
    }

    setExeChecking(true);
    checkTimer.current = setTimeout(async () => {
      const result = await onCheckCommand(trimmed);
      setExeCheck(result);
      setExeChecking(false);
    }, 450);

    return () => {
      if (checkTimer.current) clearTimeout(checkTimer.current);
    };
  }, [commandValue, config.transport, onCheckCommand]);

  const updateArg = (index: number, value: string) => {
    const next = [...args];
    next[index] = value;
    onUpdate(config.id, { args: next });
  };
  const addArg = () => {
    onUpdate(config.id, { args: [...args, ""] });
  };
  const removeArg = (index: number) => {
    const next = args.filter((_, i) => i !== index);
    onUpdate(config.id, { args: next });
  };
  const commitArgAndAdvance = (index: number, value: string) => {
    updateArg(index, value);
    if (index === args.length - 1 && value.trim()) addArg();
  };

  const commandHasSpace = commandValue.trim().includes(" ");

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springs.gentle}
      className={`bg-surface border rounded-xl p-4 space-y-3 shadow-sm relative group ${config.enabled ? "border-border" : "border-border opacity-60"}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">Enabled</p>
          <p className="text-xs text-text-muted mt-0.5">Auto-connect on startup</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            role="switch"
            aria-checked={config.enabled}
            aria-label="Toggle MCP server enabled"
            onClick={() => onUpdate(config.id, { enabled: !config.enabled })}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                onUpdate(config.id, { enabled: !config.enabled });
              }
            }}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface outline-none ${config.enabled ? "bg-accent" : "bg-input-border"}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full transition duration-200 shadow-sm ${config.enabled ? "translate-x-6" : "translate-x-1"}`}
              style={{
                backgroundColor: config.enabled ? "var(--theme-accent-foreground)" : "#ffffff",
              }}
              aria-hidden="true"
            />
          </button>
          <motion.button
            onClick={() => onDelete(config.id)}
            whileHover={{ scale: motionTokens.scale.pop }}
            whileTap={{ scale: motionTokens.scale.press }}
            transition={springs.snappy}
            className="p-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label={`Delete MCP server ${config.name}`}
          >
            <Trash2 size={16} />
          </motion.button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <div className={`w-2 h-2 rounded-full ${MCP_STATUS_COLORS[status]}`} aria-label={`Status: ${status}`} />
          <span className="text-[11px] text-text-muted capitalize">{MCP_STATUS_LABELS[status]}</span>
          {status === "connected" && <span className="text-[10px] text-text-muted ml-1">({tools.length} tools)</span>}
        </div>

        {config.transport === "stdio" && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted flex items-center gap-1.5">Template</label>
            <div className="relative">
              <select
                value=""
                onChange={(e) => {
                  const presetId = e.target.value;
                  const preset = MCP_SERVER_PRESETS.find((p) => p.id === presetId);
                  if (preset) onApplyPreset(preset, config);
                  e.target.value = "";
                }}
                className="w-full px-3 py-2 appearance-none rounded-lg border border-input-border bg-input text-sm text-text-muted focus:border-accent/50 focus:outline-none transition-colors"
                aria-label="Apply MCP server template"
              >
                <option value="">Choose a template to pre-fill…</option>
                {MCP_SERVER_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.description}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={14}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
                aria-hidden="true"
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted" htmlFor={`mcp-name-${config.id}`}>
              Name
            </label>
            <input
              id={`mcp-name-${config.id}`}
              type="text"
              value={config.name}
              onChange={(e) => onUpdate(config.id, { name: e.target.value })}
              placeholder="e.g. Filesystem"
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
              className="w-full px-3 py-2 rounded-lg border border-input-border bg-input text-sm text-text-primary placeholder-text-muted focus:border-accent/50 focus:outline-none transition-colors"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted" htmlFor={`mcp-transport-${config.id}`}>
              Transport
            </label>
            <div className="relative">
              <select
                id={`mcp-transport-${config.id}`}
                value={config.transport}
                onChange={(e) => {
                  const transport = e.target.value as McpTransport;
                  const preset = MCP_TRANSPORT_PRESETS.find((p) => p.transport === transport);
                  if (preset) {
                    onUpdate(config.id, {
                      transport,
                      name: config.name === "New MCP Server" ? preset.label : config.name,
                    });
                  } else {
                    onUpdate(config.id, { transport });
                  }
                }}
                className="w-full px-3 py-2 appearance-none rounded-lg border border-input-border bg-input text-sm text-text-primary focus:border-accent/50 focus:outline-none transition-colors"
                aria-label="MCP transport type"
              >
                {MCP_TRANSPORT_PRESETS.map((p) => (
                  <option key={p.transport} value={p.transport}>
                    {p.label}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={14}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
                aria-hidden="true"
              />
            </div>
          </div>
        </div>

        {config.transport === "stdio" && (
          <>
            <div className="space-y-1">
              <label
                className="text-xs font-medium text-text-muted flex items-center gap-1"
                htmlFor={`mcp-command-${config.id}`}
              >
                Command
                <span className="text-text-muted/50 font-normal">(program only, e.g. npx)</span>
              </label>
              <input
                id={`mcp-command-${config.id}`}
                type="text"
                value={commandValue}
                onChange={(e) => onUpdate(config.id, { command: e.target.value })}
                placeholder="e.g. npx"
                autoComplete="off"
                autoCorrect="off"
                spellCheck="false"
                className={`w-full px-3 py-2 rounded-lg border bg-input text-sm text-text-primary placeholder-text-muted font-mono text-xs focus:outline-none transition-colors ${
                  commandHasSpace
                    ? "border-yellow-500/50 focus:border-yellow-500"
                    : "border-input-border focus:border-accent/50"
                }`}
              />
              {commandHasSpace && (
                <p className="flex items-center gap-1 text-[11px] text-yellow-500 mt-0.5" role="alert">
                  <AlertCircle size={11} />
                  Put the program name here and move the arguments below.
                </p>
              )}
              {exeChecking && (
                <p className="flex items-center gap-1 text-[11px] text-text-muted mt-0.5">
                  <Loader2 size={11} className="animate-spin" />
                  Checking command…
                </p>
              )}
              {!exeChecking && exeCheck && (
                <p
                  className={`flex items-start gap-1 text-[11px] mt-0.5 ${exeCheck.found ? "text-green-600 dark:text-green-500" : "text-red-600 dark:text-red-400"}`}
                  role="status"
                >
                  {exeCheck.found ? (
                    <CheckCircle2 size={11} className="mt-0.5 shrink-0" />
                  ) : (
                    <XCircle size={11} className="mt-0.5 shrink-0" />
                  )}
                  <span className="break-words">{exeCheck.message}</span>
                </p>
              )}
            </div>

            <div className="space-y-1">
              <label
                className="text-xs font-medium text-text-muted flex items-center gap-1"
                htmlFor={`mcp-args-${config.id}`}
              >
                Arguments
                <span className="text-text-muted/50 font-normal">(one per chip — paths with spaces are safe)</span>
              </label>
              <div
                id={`mcp-args-${config.id}`}
                className="flex flex-wrap gap-1.5 p-2 rounded-lg border border-input-border bg-input min-h-[44px]"
              >
                {args.map((arg, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-0.5 rounded-md border bg-surface pl-2 pr-0.5 py-0.5 ${
                      arg.startsWith("<") && arg.endsWith(">") ? "border-accent/50" : "border-input-border"
                    }`}
                  >
                    <input
                      type="text"
                      value={arg}
                      onChange={(e) => updateArg(i, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitArgAndAdvance(i, (e.target as HTMLInputElement).value);
                        }
                        if (e.key === "Backspace" && arg === "" && args.length > 1) {
                          e.preventDefault();
                          removeArg(i);
                        }
                      }}
                      placeholder="<value>"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck="false"
                      className="w-auto min-w-[60px] max-w-[260px] bg-transparent text-xs text-text-primary placeholder-text-muted/40 font-mono focus:outline-none"
                      aria-label={`Argument ${i + 1}`}
                      size={Math.max(arg.length, 6)}
                    />
                    <button
                      onClick={() => removeArg(i)}
                      className="p-0.5 rounded text-text-muted/50 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                      aria-label={`Remove argument ${i + 1}`}
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={addArg}
                  className="flex items-center gap-0.5 px-2 py-0.5 rounded-md border border-dashed border-input-border text-text-muted hover:text-accent hover:border-accent/50 text-[11px] transition-colors"
                  aria-label="Add argument"
                >
                  <Plus size={11} />
                  Add argument
                </button>
              </div>
              {args.some((a) => a.startsWith("<") && a.endsWith(">")) && (
                <p className="flex items-center gap-1 text-[11px] text-accent/70 mt-0.5">
                  <AlertCircle size={11} />
                  Replace the highlighted placeholders (e.g. <span className="font-mono">&lt;PATH&gt;</span>) with real
                  values.
                </p>
              )}
            </div>

            <EnvVarsEditor envVars={envVars} onChange={(vars) => onSetEnvVars(config.id, vars)} />
          </>
        )}

        {(config.transport === "sse" || config.transport === "streamable-http") && (
          <>
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-muted" htmlFor={`mcp-base-${config.id}`}>
                Base URL
              </label>
              <input
                id={`mcp-base-${config.id}`}
                type="url"
                value={config.baseUrl || ""}
                onChange={(e) => onUpdate(config.id, { baseUrl: e.target.value })}
                placeholder={
                  config.transport === "sse" ? "e.g. http://localhost:3001/sse" : "e.g. http://localhost:3001/mcp"
                }
                autoComplete="off"
                autoCorrect="off"
                spellCheck="false"
                className="w-full px-3 py-2 rounded-lg border border-input-border bg-input text-sm text-text-primary placeholder-text-muted font-mono text-xs focus:border-accent/50 focus:outline-none transition-colors"
              />
              <p className="text-[11px] text-text-muted/60 mt-0.5">
                {config.transport === "sse"
                  ? "SSE endpoint URL (usually ends with /sse)"
                  : "Streamable HTTP endpoint URL (usually ends with /mcp)"}
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-muted" htmlFor={`mcp-key-${config.id}`}>
                API Key (optional)
              </label>
              <div className="relative">
                <input
                  id={`mcp-key-${config.id}`}
                  type={showKey ? "text" : "password"}
                  value={config.apiKey || ""}
                  onChange={(e) => onUpdate(config.id, { apiKey: e.target.value })}
                  placeholder="Bearer token or API key"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck="false"
                  className="w-full px-3 py-2 pr-9 rounded-lg border border-input-border bg-input text-sm text-text-primary placeholder-text-muted focus:outline-none transition-colors"
                />
                <button
                  onClick={() => onToggleKey(config.id)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors p-1"
                  aria-label={showKey ? "Hide API key" : "Show API key"}
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <EnvVarsEditor envVars={envVars} onChange={(vars) => onSetEnvVars(config.id, vars)} />
          </>
        )}

        <div className="flex items-center gap-2 pt-2 flex-wrap">
          {status === "connected" ? (
            <motion.button
              onClick={() => onDisconnect(config.id)}
              whileHover={{ scale: motionTokens.scale.pop }}
              whileTap={{ scale: motionTokens.scale.press }}
              transition={springs.snappy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-500/10 border border-border text-xs transition-colors min-h-[36px]"
              aria-label="Disconnect MCP server"
            >
              <PlugZap size={14} />
              Disconnect
            </motion.button>
          ) : (
            <motion.button
              onClick={() => onConnect(config.id)}
              disabled={
                status === "connecting" ||
                (config.transport === "stdio" && !config.command?.trim()) ||
                ((config.transport === "sse" || config.transport === "streamable-http") && !config.baseUrl?.trim())
              }
              whileHover={status === "connecting" ? undefined : { scale: motionTokens.scale.pop }}
              whileTap={status === "connecting" ? undefined : { scale: motionTokens.scale.press }}
              transition={springs.snappy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-accent hover:bg-accent/10 border border-accent/30 text-xs font-medium transition-colors min-h-[36px] disabled:opacity-50"
              aria-label="Connect MCP server"
            >
              {status === "connecting" ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
              {status === "connecting" ? "Connecting\u2026" : "Connect"}
            </motion.button>
          )}

          {config.transport === "stdio" && !config.command?.trim() && (
            <p className="flex items-center gap-1 text-[11px] text-yellow-500">
              <AlertCircle size={11} />
              Command is required to connect
            </p>
          )}
          {(config.transport === "sse" || config.transport === "streamable-http") && !config.baseUrl?.trim() && (
            <p className="flex items-center gap-1 text-[11px] text-yellow-500">
              <AlertCircle size={11} />
              Base URL is required to connect
            </p>
          )}

          {tools.length > 0 && (
            <motion.button
              onClick={() => setToolsExpanded(!toolsExpanded)}
              whileHover={{ scale: motionTokens.scale.pop }}
              whileTap={{ scale: motionTokens.scale.press }}
              transition={springs.snappy}
              className="text-text-muted hover:text-text-secondary text-xs flex items-center gap-1"
              aria-label={toolsExpanded ? "Hide tools" : "Show tools"}
            >
              <ChevronDown size={12} className={`transition-transform ${toolsExpanded ? "rotate-180" : ""}`} />
              {tools.length} tool{tools.length !== 1 ? "s" : ""}
            </motion.button>
          )}
        </div>

        <AnimatePresence>
          {toolsExpanded && tools.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{
                type: "tween",
                ease: motionTokens.easing.smooth,
                duration: motionTokens.duration.normal,
              }}
              className="overflow-hidden"
            >
              <div className="mt-1 p-2 rounded-lg bg-input border border-input-border max-h-48 overflow-y-auto">
                {tools.map((tool, i) => (
                  <div key={i} className="py-1.5 border-b border-border/30 last:border-0">
                    <p className="text-xs font-medium text-text-primary font-mono">{tool.name}</p>
                    {tool.description && (
                      <p className="text-[11px] text-text-muted mt-0.5 line-clamp-2">{tool.description}</p>
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
});
