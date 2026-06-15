import { useState, useEffect, memo, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Settings as SettingsIcon,
  Sun,
  Sliders,
  Eye,
  EyeOff,
  Check,
  ArrowLeft,
  Plus,
  Trash2,
  ChevronDown,
  AlertCircle,
  Loader2,
  Search,
  MessageSquareText,
  Cpu,
  Plug,
  PlugZap,
  FileText,
  Copy,
  X,
  Filter,
  Terminal,
  Variable,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { ModelConfig, SearchApiConfig, McpServerConfig } from "../types";
import type { SearchProvider, McpTransport, McpServerStatus, ExecutableCheck } from "../types";
import { MCP_STATUS_COLORS } from "../types";
import { DEFAULT_TITLE_SYSTEM_PROMPT } from "../types";
import { useModelStore } from "../store/useModelStore";
import { useSearchStore } from "../store/useSearchStore";
import { useMcpStore } from "../store/useMcpStore";
import { useUIStore } from "../store/useUIStore";
import { useChatStore } from "../store/useChatStore";
import { PROVIDER_PRESETS } from "../config/providerPresets";
import { SEARCH_PROVIDER_PRESETS } from "../config/searchPresets";
import { MCP_TRANSPORT_PRESETS, MCP_SERVER_PRESETS } from "../config/mcpPresets";
import type { McpServerPreset } from "../config/mcpPresets";
import { MAX_TEMPERATURE, MIN_TEMPERATURE, TEMPERATURE_STEP } from "../config/constants";
import { Switch } from "./ui/Switch";
import { getVersion } from "@tauri-apps/api/app";
import { validateApiUrl, validateApiKey, validateSearchApiKey } from "../utils/validation";
import type { LogEntry, LogSource } from "../types/log";
import { clearLogs } from "../utils/logger";
import { springs, motionTokens } from "../lib/motion-tokens";

interface ModelCardProps {
  model: ModelConfig;
  onUpdate: (id: string, updates: Partial<ModelConfig>) => void;
  onDelete: (id: string) => void;
  showKey: boolean;
  onToggleKey: (id: string) => void;
  connectionStatus: string;
}

const ModelCard = memo(function ModelCard({
  model,
  onUpdate,
  onDelete,
  showKey,
  onToggleKey,
  connectionStatus,
}: ModelCardProps) {
  const urlValidation = validateApiUrl(model.apiBase);
  const keyValidation = validateApiKey(model.apiKey, model.provider);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springs.gentle}
      className={`bg-surface border rounded-xl p-4 space-y-3 shadow-sm relative group ${model.enabled !== false ? "border-border" : "border-border opacity-60"}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">Enabled</p>
          <p className="text-xs text-text-muted mt-0.5">Show in model selector & health check</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            role="switch"
            aria-checked={model.enabled !== false}
            aria-label="Toggle model enabled"
            onClick={() => onUpdate(model.id, { enabled: !(model.enabled !== false) })}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                onUpdate(model.id, { enabled: !(model.enabled !== false) });
              }
            }}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface outline-none ${
              model.enabled !== false ? "bg-accent" : "bg-input-border"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 shadow-sm ${
                model.enabled !== false ? "translate-x-6" : "translate-x-1"
              }`}
              aria-hidden="true"
            />
          </button>
          <motion.button
            onClick={() => onDelete(model.id)}
            whileHover={{ scale: motionTokens.scale.pop }}
            whileTap={{ scale: motionTokens.scale.press }}
            transition={springs.snappy}
            className="p-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label={`Delete model ${model.name}`}
          >
            <Trash2 size={16} />
          </motion.button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <div
            className={`w-2 h-2 rounded-full ${
              connectionStatus === "connected"
                ? "bg-green-500"
                : connectionStatus === "connecting"
                  ? "bg-yellow-400 animate-pulse"
                  : connectionStatus === "error"
                    ? "bg-red-500"
                    : "bg-gray-400"
            }`}
            aria-label={`Status: ${connectionStatus}`}
          />
          <span className="text-[11px] text-text-muted capitalize">{connectionStatus}</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted" htmlFor={`model-name-${model.id}`}>
              Name
            </label>
            <input
              id={`model-name-${model.id}`}
              type="text"
              value={model.name}
              onChange={(e) => onUpdate(model.id, { name: e.target.value })}
              placeholder="e.g. My Llama 3"
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
              className="w-full px-3 py-2 rounded-lg border border-input-border bg-input text-sm text-text-primary placeholder-text-muted focus:border-accent/50 focus:outline-none transition-colors"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted" htmlFor={`model-provider-${model.id}`}>
              Provider Preset
            </label>
            <div className="relative">
              <select
                id={`model-provider-${model.id}`}
                value={model.provider || "Custom"}
                onChange={(e) => {
                  const preset = PROVIDER_PRESETS.find((p) => p.label === e.target.value);
                  if (preset) {
                    onUpdate(model.id, {
                      provider: preset.label,
                      apiBase: preset.apiBase || model.apiBase,
                      modelId: preset.defaultModel || model.modelId,
                      name: model.name === "New Model" ? preset.label : model.name,
                    });
                  } else {
                    onUpdate(model.id, { provider: e.target.value });
                  }
                }}
                className="w-full px-3 py-2 appearance-none rounded-lg border border-input-border bg-input text-sm text-text-primary focus:border-accent/50 focus:outline-none transition-colors"
                aria-label="Provider preset"
              >
                {PROVIDER_PRESETS.map((p) => (
                  <option key={p.label} value={p.label}>
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

        <div className="space-y-1">
          <label className="text-xs font-medium text-text-muted" htmlFor={`model-api-${model.id}`}>
            API Base URL
          </label>
          <input
            id={`model-api-${model.id}`}
            type="url"
            value={model.apiBase}
            onChange={(e) => onUpdate(model.id, { apiBase: e.target.value })}
            placeholder="https://api.openai.com/v1/chat/completions"
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
            aria-invalid={!urlValidation.valid}
            aria-describedby={!urlValidation.valid ? `url-error-${model.id}` : undefined}
            className={`w-full px-3 py-2 rounded-lg border bg-input text-sm text-text-primary placeholder-text-muted font-mono text-xs focus:outline-none transition-colors ${
              !urlValidation.valid
                ? "border-red-500/50 focus:border-red-500"
                : "border-input-border focus:border-accent/50"
            }`}
          />
          {!urlValidation.valid && model.apiBase && (
            <p
              id={`url-error-${model.id}`}
              className="flex items-center gap-1 text-[11px] text-red-400 mt-0.5"
              role="alert"
            >
              <AlertCircle size={11} />
              {urlValidation.error}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted" htmlFor={`model-id-${model.id}`}>
              Model ID
            </label>
            <input
              id={`model-id-${model.id}`}
              type="text"
              value={model.modelId}
              onChange={(e) => onUpdate(model.id, { modelId: e.target.value })}
              placeholder="e.g. gpt-4o or meta/llama-3.3-70b-instruct"
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
              className="w-full px-3 py-2 rounded-lg border border-input-border bg-input text-sm text-text-primary placeholder-text-muted font-mono text-xs focus:border-accent/50 focus:outline-none transition-colors"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted" htmlFor={`model-key-${model.id}`}>
              API Key
            </label>
            <div className="relative">
              <input
                id={`model-key-${model.id}`}
                type={showKey ? "text" : "password"}
                value={model.apiKey}
                onChange={(e) => onUpdate(model.id, { apiKey: e.target.value })}
                placeholder="API key (optional for local)"
                autoComplete="off"
                autoCorrect="off"
                spellCheck="false"
                aria-invalid={!keyValidation.valid}
                aria-describedby={!keyValidation.valid ? `key-warning-${model.id}` : undefined}
                className={`w-full px-3 py-2 pr-9 rounded-lg border bg-input text-sm text-text-primary placeholder-text-muted focus:outline-none transition-colors ${
                  !keyValidation.valid
                    ? "border-yellow-500/50 focus:border-yellow-500"
                    : "border-input-border focus:border-accent/50"
                }`}
              />
              <button
                onClick={() => onToggleKey(model.id)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors p-1"
                aria-label={showKey ? "Hide API key" : "Show API key"}
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            {!keyValidation.valid && (
              <p
                id={`key-warning-${model.id}`}
                className="flex items-center gap-1 text-[11px] text-yellow-500 mt-0.5"
                role="alert"
              >
                <AlertCircle size={11} />
                {keyValidation.warning}
              </p>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
});

interface SearchApiCardProps {
  config: SearchApiConfig;
  onUpdate: (id: string, updates: Partial<SearchApiConfig>) => void;
  onDelete: (id: string) => void;
  showKey: boolean;
  onToggleKey: (id: string) => void;
}

const SearchApiCard = memo(function SearchApiCard({
  config,
  onUpdate,
  onDelete,
  showKey,
  onToggleKey,
}: SearchApiCardProps) {
  const keyValidation = validateSearchApiKey(config.apiKey, config.provider);

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
          <p className="text-xs text-text-muted mt-0.5">Show in search API selector</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            role="switch"
            aria-checked={config.enabled}
            aria-label="Toggle search API enabled"
            onClick={() => onUpdate(config.id, { enabled: !config.enabled })}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                onUpdate(config.id, { enabled: !config.enabled });
              }
            }}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface outline-none ${
              config.enabled ? "bg-accent" : "bg-input-border"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 shadow-sm ${
                config.enabled ? "translate-x-6" : "translate-x-1"
              }`}
              aria-hidden="true"
            />
          </button>
          <motion.button
            onClick={() => onDelete(config.id)}
            whileHover={{ scale: motionTokens.scale.pop }}
            whileTap={{ scale: motionTokens.scale.press }}
            transition={springs.snappy}
            className="p-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label={`Delete search API ${config.name}`}
          >
            <Trash2 size={16} />
          </motion.button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted" htmlFor={`search-name-${config.id}`}>
              Name
            </label>
            <input
              id={`search-name-${config.id}`}
              type="text"
              value={config.name}
              onChange={(e) => onUpdate(config.id, { name: e.target.value })}
              placeholder="e.g. Google Search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
              className="w-full px-3 py-2 rounded-lg border border-input-border bg-input text-sm text-text-primary placeholder-text-muted focus:border-accent/50 focus:outline-none transition-colors"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted" htmlFor={`search-provider-${config.id}`}>
              Provider
            </label>
            <div className="relative">
              <select
                id={`search-provider-${config.id}`}
                value={config.provider}
                onChange={(e) => {
                  const provider = e.target.value as SearchProvider;
                  const preset = SEARCH_PROVIDER_PRESETS.find((p) => p.provider === provider);
                  if (preset) {
                    onUpdate(config.id, {
                      provider,
                      baseUrl: preset.baseUrl || config.baseUrl,
                      name: config.name === "New Search API" ? preset.label : config.name,
                      maxResults: preset.defaultMaxResults,
                    });
                  } else {
                    onUpdate(config.id, { provider });
                  }
                }}
                className="w-full px-3 py-2 appearance-none rounded-lg border border-input-border bg-input text-sm text-text-primary focus:border-accent/50 focus:outline-none transition-colors"
                aria-label="Search provider"
              >
                {SEARCH_PROVIDER_PRESETS.map((p) => (
                  <option key={p.provider} value={p.provider}>
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

        <div className="space-y-1">
          <label className="text-xs font-medium text-text-muted" htmlFor={`search-base-${config.id}`}>
            Base URL
          </label>
          <input
            id={`search-base-${config.id}`}
            type="url"
            value={config.baseUrl}
            onChange={(e) => onUpdate(config.id, { baseUrl: e.target.value })}
            placeholder={
              config.provider === "google"
                ? "https://www.googleapis.com/customsearch/v1"
                : config.provider === "searxng"
                  ? "http://localhost:8080"
                  : config.provider === "firecrawl"
                    ? "https://api.firecrawl.dev/v1"
                    : "https://example.com/search"
            }
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
            className="w-full px-3 py-2 rounded-lg border border-input-border bg-input text-sm text-text-primary placeholder-text-muted font-mono text-xs focus:border-accent/50 focus:outline-none transition-colors"
          />
        </div>

        {(config.provider === "google" || config.provider === "firecrawl" || config.provider === "custom") && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted" htmlFor={`search-key-${config.id}`}>
              API Key{config.provider === "custom" ? " (optional)" : ""}
            </label>
            <div className="relative">
              <input
                id={`search-key-${config.id}`}
                type={showKey ? "text" : "password"}
                value={config.apiKey || ""}
                onChange={(e) => onUpdate(config.id, { apiKey: e.target.value })}
                placeholder={
                  config.provider === "google"
                    ? "Google API Key"
                    : config.provider === "custom"
                      ? "API Key (optional)"
                      : "API Key"
                }
                autoComplete="off"
                autoCorrect="off"
                spellCheck="false"
                className={`w-full px-3 py-2 pr-9 rounded-lg border bg-input text-sm text-text-primary placeholder-text-muted focus:outline-none transition-colors ${
                  !keyValidation.valid
                    ? "border-yellow-500/50 focus:border-yellow-500"
                    : "border-input-border focus:border-accent/50"
                }`}
              />
              <button
                onClick={() => onToggleKey(config.id)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors p-1"
                aria-label={showKey ? "Hide API key" : "Show API key"}
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            {!keyValidation.valid && (
              <p className="flex items-center gap-1 text-[11px] text-yellow-500 mt-0.5" role="alert">
                <AlertCircle size={11} />
                {keyValidation.warning}
              </p>
            )}
          </div>
        )}

        {config.provider === "google" && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted" htmlFor={`search-cx-${config.id}`}>
              Custom Search Engine ID (CX)
            </label>
            <input
              id={`search-cx-${config.id}`}
              type="text"
              value={config.cx || ""}
              onChange={(e) => onUpdate(config.id, { cx: e.target.value })}
              placeholder="e.g. a1b2c3d4e5f6g7h8i"
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
              className="w-full px-3 py-2 rounded-lg border border-input-border bg-input text-sm text-text-primary placeholder-text-muted font-mono text-xs focus:border-accent/50 focus:outline-none transition-colors"
            />
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs font-medium text-text-muted" htmlFor={`search-results-${config.id}`}>
            Max Results
          </label>
          <input
            id={`search-results-${config.id}`}
            type="number"
            min={1}
            max={20}
            value={config.maxResults}
            onChange={(e) => onUpdate(config.id, { maxResults: parseInt(e.target.value) || 5 })}
            className="w-full px-3 py-2 rounded-lg border border-input-border bg-input text-sm text-text-primary focus:border-accent/50 focus:outline-none transition-colors"
          />
        </div>
      </div>
    </motion.div>
  );
});

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

const MCP_STATUS_LABELS: Record<McpServerStatus, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting\u2026",
  connected: "Connected",
  error: "Error",
};

interface EnvVarsEditorProps {
  envVars: Record<string, string>;
  onChange: (vars: Record<string, string>) => void;
}

/** Reusable key/value editor for MCP environment variables. Shared by all transports. */
const EnvVarsEditor = memo(function EnvVarsEditor({ envVars, onChange }: EnvVarsEditorProps) {
  const [envExpanded, setEnvExpanded] = useState(false);
  const [newEnvKey, setNewEnvKey] = useState("");
  const [newEnvValue, setNewEnvValue] = useState("");
  const [showEnvValues, setShowEnvValues] = useState<Record<string, boolean>>({});

  const addEnvVar = () => {
    const key = newEnvKey.trim();
    if (!key) return;
    onChange({ ...envVars, [key]: newEnvValue });
    setNewEnvKey("");
    setNewEnvValue("");
  };

  const removeEnvVar = (key: string) => {
    const updated = { ...envVars };
    delete updated[key];
    onChange(updated);
  };

  const updateEnvValue = (key: string, value: string) => {
    onChange({ ...envVars, [key]: value });
  };

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => setEnvExpanded(!envExpanded)}
        className="flex items-center gap-1.5 text-xs font-medium text-text-muted hover:text-text-secondary transition-colors"
        aria-expanded={envExpanded}
        aria-label="Toggle environment variables"
      >
        <Variable size={12} />
        Environment Variables
        {Object.keys(envVars).length > 0 && (
          <span className="px-1.5 py-0.5 rounded-full bg-accent/10 text-accent text-[10px] font-medium">
            {Object.keys(envVars).length}
          </span>
        )}
        <ChevronDown size={12} className={`transition-transform ${envExpanded ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence>
        {envExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={springs.gentle}
            className="overflow-hidden"
          >
            <div className="p-2.5 rounded-lg bg-input border border-input-border space-y-2">
              {Object.entries(envVars).map(([key, value]) => (
                <div key={key} className="flex items-center gap-1.5">
                  <span className="text-xs font-mono font-medium text-text-primary bg-surface px-2 py-1 rounded border border-border min-w-[80px] truncate">
                    {key}
                  </span>
                  <div className="flex-1 relative">
                    <input
                      type={showEnvValues[key] ? "text" : "password"}
                      value={value}
                      onChange={(e) => updateEnvValue(key, e.target.value)}
                      className="w-full px-2.5 py-1 rounded border border-input-border bg-surface text-xs text-text-primary font-mono focus:border-accent/50 focus:outline-none transition-colors"
                      aria-label={`Value for ${key}`}
                    />
                    <button
                      onClick={() => setShowEnvValues((prev) => ({ ...prev, [key]: !prev[key] }))}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-muted/50 hover:text-text-muted transition-colors"
                      aria-label={showEnvValues[key] ? "Hide value" : "Show value"}
                    >
                      {showEnvValues[key] ? <EyeOff size={11} /> : <Eye size={11} />}
                    </button>
                  </div>
                  <button
                    onClick={() => removeEnvVar(key)}
                    className="p-1 rounded text-text-muted/50 hover:text-red-500 hover:bg-red-500/10 transition-colors shrink-0"
                    aria-label={`Remove ${key}`}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}

              <div className="flex items-center gap-1.5 pt-1 border-t border-border/30">
                <input
                  type="text"
                  value={newEnvKey}
                  onChange={(e) => setNewEnvKey(e.target.value)}
                  placeholder="KEY"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck="false"
                  className="flex-1 min-w-[80px] px-2.5 py-1 rounded border border-input-border bg-surface text-xs text-text-primary placeholder-text-muted/40 font-mono focus:border-accent/50 focus:outline-none transition-colors"
                  aria-label="New env var key"
                />
                <input
                  type="text"
                  value={newEnvValue}
                  onChange={(e) => setNewEnvValue(e.target.value)}
                  placeholder="value"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck="false"
                  className="flex-[2] px-2.5 py-1 rounded border border-input-border bg-surface text-xs text-text-primary placeholder-text-muted/40 font-mono focus:border-accent/50 focus:outline-none transition-colors"
                  aria-label="New env var value"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addEnvVar();
                  }}
                />
                <button
                  onClick={addEnvVar}
                  disabled={!newEnvKey.trim()}
                  className="p-1 rounded text-accent hover:bg-accent/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                  aria-label="Add environment variable"
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

const McpServerCard = memo(function McpServerCard({
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

  // Debounced executable check whenever the command changes.
  useEffect(() => {
    if (config.transport !== "stdio") return;
    const trimmed = commandValue.trim();

    if (checkTimer.current) clearTimeout(checkTimer.current);

    if (!trimmed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing stale status when the command field empties is intentional render-sync.
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
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 shadow-sm ${config.enabled ? "translate-x-6" : "translate-x-1"}`}
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
            <label className="text-xs font-medium text-text-muted flex items-center gap-1.5">
              <Terminal size={11} />
              Template
            </label>
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
                  className={`flex items-start gap-1 text-[11px] mt-0.5 ${exeCheck.found ? "text-green-500" : "text-red-400"}`}
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
              transition={springs.gentle}
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

type SectionId = "appearance" | "ai" | "title" | "models" | "search" | "mcp" | "logs";

const SECTIONS: { id: SectionId; label: string; icon: typeof Sun }[] = [
  { id: "appearance", label: "Appearance", icon: Sun },
  { id: "ai", label: "AI Configuration", icon: Sliders },
  { id: "title", label: "Title Generation", icon: MessageSquareText },
  { id: "models", label: "Model Endpoints", icon: SettingsIcon },
  { id: "search", label: "Web Search", icon: Search },
  { id: "mcp", label: "MCP Servers", icon: Cpu },
  { id: "logs", label: "Activity Log", icon: FileText },
];

export default function Settings() {
  const models = useModelStore((s) => s.models);
  const selectedModel = useModelStore((s) => s.selectedModel);
  const temperature = useModelStore((s) => s.temperature);
  const modelStatuses = useModelStore((s) => s.modelStatuses);
  const titleConfig = useModelStore((s) => s.titleConfig);
  const setSelectedModel = useModelStore((s) => s.setSelectedModel);
  const setTemperature = useModelStore((s) => s.setTemperature);
  const updateModel = useModelStore((s) => s.updateModel);
  const deleteModel = useModelStore((s) => s.deleteModel);
  const addModel = useModelStore((s) => s.addModel);
  const checkModelConnections = useModelStore((s) => s.checkModelConnections);
  const setTitleConfig = useModelStore((s) => s.setTitleConfig);

  const searchConfigs = useSearchStore((s) => s.searchConfigs);
  const activeSearchId = useSearchStore((s) => s.activeSearchId);
  const setActiveSearchId = useSearchStore((s) => s.setActiveSearchId);
  const updateSearchConfig = useSearchStore((s) => s.updateSearchConfig);
  const deleteSearchConfig = useSearchStore((s) => s.deleteSearchConfig);
  const addSearchConfig = useSearchStore((s) => s.addSearchConfig);

  const mcpConfigs = useMcpStore((s) => s.mcpConfigs);
  const serverStatuses = useMcpStore((s) => s.serverStatuses);
  const availableTools = useMcpStore((s) => s.availableTools);
  const envSecrets = useMcpStore((s) => s.envSecrets);
  const addMcpConfig = useMcpStore((s) => s.addMcpConfig);
  const updateMcpConfig = useMcpStore((s) => s.updateMcpConfig);
  const deleteMcpConfig = useMcpStore((s) => s.deleteMcpConfig);
  const connectServer = useMcpStore((s) => s.connectServer);
  const disconnectServer = useMcpStore((s) => s.disconnectServer);
  const setEnvSecrets = useMcpStore((s) => s.setEnvSecrets);
  const checkCommand = useMcpStore((s) => s.checkCommand);

  const handleApplyPreset = useCallback(
    (preset: McpServerPreset, currentConfig: McpServerConfig) => {
      const isPristine =
        (currentConfig.command ?? "").trim() === "" &&
        (currentConfig.args ?? []).length === 0 &&
        currentConfig.name === "New MCP Server";
      if (!isPristine) {
        const ok = window.confirm(
          `Apply the "${preset.name}" template? This will replace the current command, arguments, and environment variables.`,
        );
        if (!ok) return;
      }
      // Apply preset fields to the existing config in place.
      updateMcpConfig(currentConfig.id, {
        name: preset.name,
        transport: "stdio",
        command: preset.command,
        args: [...preset.args],
      });
      if (preset.envKeys && preset.envKeys.length > 0) {
        const existing = envSecrets[currentConfig.id] ?? {};
        const merged = { ...existing };
        for (const k of preset.envKeys) {
          if (!(k in merged)) merged[k] = "";
        }
        setEnvSecrets(currentConfig.id, merged);
      }
      useUIStore.getState().addToast(`Applied "${preset.name}" template`, "info");
    },
    [envSecrets, updateMcpConfig, setEnvSecrets],
  );

  const theme = useUIStore((s) => s.theme);
  const loading = useUIStore((s) => s.loading);
  const setTheme = useUIStore((s) => s.setTheme);
  const setView = useUIStore((s) => s.setView);
  const addToast = useUIStore((s) => s.addToast);

  const newChat = useChatStore((s) => s.newChat);

  const [appVersion, setAppVersion] = useState<string>("");
  const [activeSection, setActiveSection] = useState<SectionId>("appearance");
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [searchProviderDropdownOpen, setSearchProviderDropdownOpen] = useState(false);
  const [titleModelDropdownOpen, setTitleModelDropdownOpen] = useState(false);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [showSearchKeys, setShowSearchKeys] = useState<Record<string, boolean>>({});
  const [showMcpKeys, setShowMcpKeys] = useState<Record<string, boolean>>({});
  const tempToastRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentModel = models.find((m) => m.id === selectedModel);
  const enabledModels = models.filter((m) => m.enabled !== false);

  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion("0.1.0"));
  }, []);

  useEffect(() => {
    if (!currentModel && enabledModels.length > 0) {
      setSelectedModel(enabledModels[0].id);
    }
  }, [currentModel, enabledModels, setSelectedModel]);

  const effectiveModel = currentModel ?? models[0];
  const enabledSearchConfigs = searchConfigs.filter((c) => c.enabled);
  const activeSearchConfig = enabledSearchConfigs.find((c) => c.id === activeSearchId);

  const handleTemperatureChange = useCallback(
    (value: string) => {
      const t = parseFloat(value);
      setTemperature(t);
      if (tempToastRef.current) clearTimeout(tempToastRef.current);
      tempToastRef.current = setTimeout(() => {
        addToast(`Temperature set to ${t.toFixed(1)}`, "info");
      }, 800);
    },
    [setTemperature, addToast],
  );

  useEffect(() => {
    return () => {
      if (tempToastRef.current) clearTimeout(tempToastRef.current);
    };
  }, []);

  const toggleKeyVisibility = (id: string) => {
    setShowKeys((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleSearchKeyVisibility = (id: string) => {
    setShowSearchKeys((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleMcpKeyVisibility = (id: string) => {
    setShowMcpKeys((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const logBuffer = useUIStore((s) => s.logBuffer);
  const logFilterSource = useUIStore((s) => s.logFilterSource);
  const logFilterLevel = useUIStore((s) => s.logFilterLevel);
  const setLogFilterSource = useUIStore((s) => s.setLogFilterSource);
  const setLogFilterLevel = useUIStore((s) => s.setLogFilterLevel);
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
    error: "text-red-500",
    warn: "text-yellow-500",
    info: "text-blue-400",
    debug: "text-text-muted",
  };

  const SOURCE_BADGE_COLORS: Record<string, string> = {
    chat: "bg-purple-500/10 text-purple-400 border-purple-500/20",
    model: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    search: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
    mcp: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    storage: "bg-green-500/10 text-green-400 border-green-500/20",
    stream: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
    general: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  };

  const handleBack = () => setView("chat");

  const handleCreateChat = () => {
    const id = newChat();
    setView("chat");
    return id;
  };

  const handleRefreshConnections = () => {
    checkModelConnections(undefined, true);
  };

  const tempPercent = ((temperature - MIN_TEMPERATURE) / (MAX_TEMPERATURE - MIN_TEMPERATURE)) * 100;

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden" role="region" aria-label="Settings">
      <header className="shrink-0 flex items-center justify-between px-4 py-3 md:px-6 border-b border-border/50">
        <div className="flex items-center gap-3">
          <motion.button
            onClick={handleBack}
            whileHover={{ scale: motionTokens.scale.pop }}
            whileTap={{ scale: motionTokens.scale.press }}
            transition={springs.snappy}
            className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-hover transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Back to Chat"
          >
            <ArrowLeft size={18} />
          </motion.button>
          <SettingsIcon size={18} className="text-text-muted" aria-hidden="true" />
          <h2 className="text-sm font-medium text-text-secondary">Settings</h2>
        </div>
        <motion.button
          onClick={handleCreateChat}
          whileHover={{ scale: motionTokens.scale.pop }}
          whileTap={{ scale: motionTokens.scale.press }}
          transition={springs.snappy}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent/10 text-accent hover:bg-accent/20 border border-accent/30 text-sm font-medium transition-all min-h-[44px]"
          aria-label="Create New Chat"
        >
          <Plus size={16} />
          <span className="hidden sm:inline">New Chat</span>
        </motion.button>
      </header>

      <div className="flex-1 flex min-w-0 overflow-hidden">
        <nav
          className="w-52 shrink-0 border-r border-border overflow-y-auto p-3 space-y-0.5 hidden md:block"
          aria-label="Settings sections"
        >
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            const isActive = activeSection === section.id;
            return (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                  isActive
                    ? "bg-active text-text-primary font-medium"
                    : "text-text-secondary hover:bg-hover hover:text-text-primary"
                }`}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon size={15} className="shrink-0" />
                <span className="truncate">{section.label}</span>
              </button>
            );
          })}
          <div className="pt-3 mt-3 border-t border-border">
            <p className="text-xs text-text-muted px-3">Sythoria {appVersion || "\u2026"}</p>
          </div>
        </nav>
        <div className="md:hidden border-b border-border p-3 w-full">
          <div className="relative">
            <select
              value={activeSection}
              onChange={(e) => setActiveSection(e.target.value as SectionId)}
              className="w-full px-3 py-2 rounded-lg border border-input-border bg-input text-sm text-text-primary focus:border-text-muted focus:outline-none transition-colors appearance-none pr-8"
              aria-label="Settings section"
            >
              {SECTIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
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
        <div className="flex-1 overflow-y-auto">
          <motion.div
            key={activeSection}
            className="max-w-2xl mx-auto px-4 md:px-8 py-8 space-y-6"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={springs.gentle}
          >
            {activeSection === "appearance" && (
              <>
                <div>
                  <h3 className="text-sm font-semibold text-text-primary mb-1">Appearance</h3>
                  <p className="text-xs text-text-muted">Customize how Sythoria looks</p>
                </div>{" "}
                <div className="bg-surface border border-border rounded-xl p-4 space-y-4 shadow-sm">
                  <Switch
                    checked={theme === "dark"}
                    onChange={(checked) => setTheme(checked ? "dark" : "light")}
                    label="Dark Mode"
                    description="Toggle between light and dark themes"
                  />
                </div>
              </>
            )}

            {activeSection === "ai" && (
              <>
                <div>
                  <h3 className="text-sm font-semibold text-text-primary mb-1">AI Configuration</h3>
                  <p className="text-xs text-text-muted">Defaults and generation behavior</p>
                </div>{" "}
                <div className="bg-surface border border-border rounded-xl p-4 space-y-4 shadow-sm">
                  <div className="space-y-2">
                    <label htmlFor="default-model-select" className="text-sm font-medium text-text-primary block">
                      Default AI Model
                    </label>
                    <p className="text-xs text-text-muted mb-2">Choose the model for new conversations</p>
                    <div className="relative">
                      <button
                        id="default-model-select"
                        onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                        className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-input-border bg-input text-sm text-text-primary hover:border-accent/30 transition-colors min-h-[44px]"
                        aria-expanded={modelDropdownOpen}
                        aria-haspopup="listbox"
                      >
                        <span>{effectiveModel?.name || "No Model"}</span>
                        <ChevronDown
                          size={16}
                          className={`text-text-muted transition-transform ${modelDropdownOpen ? "rotate-180" : ""}`}
                          aria-hidden="true"
                        />
                      </button>
                      {modelDropdownOpen && (
                        <>
                          <div
                            className="fixed inset-0 z-10"
                            onClick={() => setModelDropdownOpen(false)}
                            aria-hidden="true"
                          />
                          <motion.div
                            initial={{ opacity: 0, y: -4, scale: 0.97 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -4, scale: 0.97 }}
                            transition={springs.snappy}
                            className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-xl shadow-lg z-20 overflow-hidden max-h-64 overflow-y-auto"
                            role="listbox"
                            aria-label="Available models"
                          >
                            {enabledModels.map((model) => (
                              <button
                                key={model.id}
                                onClick={() => {
                                  setSelectedModel(model.id);
                                  setModelDropdownOpen(false);
                                }}
                                className={`w-full flex items-center justify-between px-3 py-2.5 text-sm transition-colors min-h-[44px] ${
                                  selectedModel === model.id
                                    ? "bg-accent-soft text-accent"
                                    : "text-text-secondary hover:bg-hover hover:text-text-primary"
                                }`}
                                role="option"
                                aria-selected={selectedModel === model.id}
                              >
                                <div className="flex flex-col items-start">
                                  <span className="font-medium">{model.name}</span>
                                  <span className="text-[10px] text-text-muted">{model.modelId}</span>
                                </div>
                                {selectedModel === model.id && (
                                  <Check size={14} className="text-accent shrink-0" aria-hidden="true" />
                                )}
                              </button>
                            ))}
                          </motion.div>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2 pt-2">
                    <label htmlFor="default-search-provider" className="text-sm font-medium text-text-primary block">
                      Default Search Provider
                    </label>
                    <p className="text-xs text-text-muted mb-2">
                      Choose the search API used when web search is enabled
                    </p>
                    <div className="relative">
                      <button
                        id="default-search-provider"
                        onClick={() => setSearchProviderDropdownOpen(!searchProviderDropdownOpen)}
                        disabled={enabledSearchConfigs.length === 0}
                        className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-input-border bg-input text-sm text-text-primary hover:border-accent/30 transition-colors min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-expanded={searchProviderDropdownOpen}
                        aria-haspopup="listbox"
                      >
                        <span>
                          {activeSearchConfig?.name ||
                            (enabledSearchConfigs.length === 0 ? "No search APIs configured" : "Select provider")}
                        </span>
                        <ChevronDown
                          size={16}
                          className={`text-text-muted transition-transform ${searchProviderDropdownOpen ? "rotate-180" : ""}`}
                          aria-hidden="true"
                        />
                      </button>
                      {searchProviderDropdownOpen && enabledSearchConfigs.length > 0 && (
                        <>
                          <div
                            className="fixed inset-0 z-10"
                            onClick={() => setSearchProviderDropdownOpen(false)}
                            aria-hidden="true"
                          />
                          <motion.div
                            initial={{ opacity: 0, y: -4, scale: 0.97 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -4, scale: 0.97 }}
                            transition={springs.snappy}
                            className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-xl shadow-lg z-20 overflow-hidden max-h-64 overflow-y-auto"
                            role="listbox"
                            aria-label="Available search providers"
                          >
                            {enabledSearchConfigs.map((config) => (
                              <button
                                key={config.id}
                                onClick={() => {
                                  setActiveSearchId(config.id);
                                  setSearchProviderDropdownOpen(false);
                                }}
                                className={`w-full flex items-center justify-between px-3 py-2.5 text-sm transition-colors min-h-[44px] ${
                                  activeSearchId === config.id
                                    ? "bg-accent-soft text-accent"
                                    : "text-text-secondary hover:bg-hover hover:text-text-primary"
                                }`}
                                role="option"
                                aria-selected={activeSearchId === config.id}
                              >
                                <div className="flex flex-col items-start">
                                  <span className="font-medium">{config.name}</span>
                                  <span className="text-[10px] text-text-muted">{config.provider}</span>
                                </div>
                                {activeSearchId === config.id && (
                                  <Check size={14} className="text-accent shrink-0" aria-hidden="true" />
                                )}
                              </button>
                            ))}
                          </motion.div>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="space-y-3 pt-2 border-t border-border/50">
                    <div className="flex items-center justify-between">
                      <label htmlFor="temperature-slider" className="text-sm font-medium text-text-primary">
                        Temperature
                      </label>
                      <span className="text-xs text-text-muted bg-input border border-input-border rounded px-2 py-0.5 font-mono">
                        {temperature.toFixed(1)}
                      </span>
                    </div>
                    <p className="text-xs text-text-muted">
                      Adjust creativity: lower values produce more focused responses, higher values more creative ones
                    </p>
                    <div className="flex items-center gap-4">
                      <span className="text-xs text-text-muted whitespace-nowrap">{MIN_TEMPERATURE.toFixed(1)}</span>
                      <div className="relative flex-1 h-1.5 bg-input-border rounded-full">
                        <div
                          className="absolute h-full bg-accent rounded-full transition-all duration-150"
                          style={{ width: `${tempPercent}%` }}
                        />
                        <input
                          id="temperature-slider"
                          type="range"
                          min={MIN_TEMPERATURE}
                          max={MAX_TEMPERATURE}
                          step={TEMPERATURE_STEP}
                          value={temperature}
                          onChange={(e) => handleTemperatureChange(e.target.value)}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                          aria-label="Temperature"
                        />
                        <div
                          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-accent rounded-full border-2 border-white shadow-sm pointer-events-none transition-all duration-150"
                          style={{ left: `calc(${tempPercent}% - 6px)` }}
                          aria-hidden="true"
                        />
                      </div>
                      <span className="text-xs text-text-muted whitespace-nowrap">{MAX_TEMPERATURE.toFixed(1)}</span>
                    </div>
                    <div className="flex justify-between text-[10px] text-text-muted pt-1">
                      <span>Precise</span>
                      <span>Balanced</span>
                      <span>Creative</span>
                    </div>
                  </div>
                </div>
              </>
            )}

            {activeSection === "title" && (
              <>
                <div>
                  <h3 className="text-sm font-semibold text-text-primary mb-1">Title Generation</h3>
                  <p className="text-xs text-text-muted">Automatically name conversations</p>
                </div>{" "}
                <div className="bg-surface border border-border rounded-xl p-4 space-y-4 shadow-sm">
                  <Switch
                    checked={titleConfig.enabled}
                    onChange={(checked) => setTitleConfig({ enabled: checked })}
                    label="AI Title Generation"
                    description="Automatically generate conversation titles using AI"
                  />

                  <AnimatePresence>
                    {titleConfig.enabled && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={springs.gentle}
                        className="overflow-hidden"
                      >
                        <div className="space-y-2">
                          <label htmlFor="title-model-select" className="text-sm font-medium text-text-primary block">
                            Title Model
                          </label>
                          <p className="text-xs text-text-muted mb-2">
                            Choose the model used to generate titles, or use the same model as the conversation
                          </p>
                          <div className="relative">
                            <button
                              id="title-model-select"
                              onClick={() => setTitleModelDropdownOpen(!titleModelDropdownOpen)}
                              className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-input-border bg-input text-sm text-text-primary hover:border-accent/30 transition-colors min-h-[44px]"
                              aria-expanded={titleModelDropdownOpen}
                              aria-haspopup="listbox"
                            >
                              <span>
                                {titleConfig.modelId === "__same__"
                                  ? "Same as selected model"
                                  : (models.find((m) => m.id === titleConfig.modelId)?.name ??
                                    "Same as selected model")}
                              </span>
                              <ChevronDown
                                size={16}
                                className={`text-text-muted transition-transform ${titleModelDropdownOpen ? "rotate-180" : ""}`}
                                aria-hidden="true"
                              />
                            </button>
                            {titleModelDropdownOpen && (
                              <>
                                <div
                                  className="fixed inset-0 z-10"
                                  onClick={() => setTitleModelDropdownOpen(false)}
                                  aria-hidden="true"
                                />
                                <motion.div
                                  initial={{ opacity: 0, y: -4, scale: 0.97 }}
                                  animate={{ opacity: 1, y: 0, scale: 1 }}
                                  exit={{ opacity: 0, y: -4, scale: 0.97 }}
                                  transition={springs.snappy}
                                  className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-xl shadow-lg z-20 overflow-hidden max-h-64 overflow-y-auto"
                                  role="listbox"
                                  aria-label="Title generation models"
                                >
                                  <button
                                    onClick={() => {
                                      setTitleConfig({ modelId: "__same__" });
                                      setTitleModelDropdownOpen(false);
                                    }}
                                    className={`w-full flex items-center justify-between px-3 py-2.5 text-sm transition-colors min-h-[44px] ${
                                      titleConfig.modelId === "__same__"
                                        ? "bg-accent-soft text-accent"
                                        : "text-text-secondary hover:bg-hover hover:text-text-primary"
                                    }`}
                                    role="option"
                                    aria-selected={titleConfig.modelId === "__same__"}
                                  >
                                    <div className="flex flex-col items-start">
                                      <span className="font-medium">Same as selected model</span>
                                      <span className="text-[10px] text-text-muted">Uses the active chat model</span>
                                    </div>
                                    {titleConfig.modelId === "__same__" && (
                                      <Check size={14} className="text-accent shrink-0" aria-hidden="true" />
                                    )}
                                  </button>
                                  {enabledModels.map((model) => (
                                    <button
                                      key={model.id}
                                      onClick={() => {
                                        setTitleConfig({ modelId: model.id });
                                        setTitleModelDropdownOpen(false);
                                      }}
                                      className={`w-full flex items-center justify-between px-3 py-2.5 text-sm transition-colors min-h-[44px] ${
                                        titleConfig.modelId === model.id
                                          ? "bg-accent-soft text-accent"
                                          : "text-text-secondary hover:bg-hover hover:text-text-primary"
                                      }`}
                                      role="option"
                                      aria-selected={titleConfig.modelId === model.id}
                                    >
                                      <div className="flex flex-col items-start">
                                        <span className="font-medium">{model.name}</span>
                                        <span className="text-[10px] text-text-muted">{model.modelId}</span>
                                      </div>
                                      {titleConfig.modelId === model.id && (
                                        <Check size={14} className="text-accent shrink-0" aria-hidden="true" />
                                      )}
                                    </button>
                                  ))}
                                </motion.div>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label htmlFor="title-system-prompt" className="text-sm font-medium text-text-primary block">
                            System Prompt
                          </label>
                          <p className="text-xs text-text-muted mb-2">
                            Customize the prompt used for title generation. Use{" "}
                            <code className="text-accent text-[11px]">{"{{userMessage}}"}</code> as a placeholder for
                            the user&apos;s message
                          </p>
                          <textarea
                            id="title-system-prompt"
                            value={titleConfig.systemPrompt}
                            onChange={(e) => setTitleConfig({ systemPrompt: e.target.value })}
                            rows={4}
                            placeholder={DEFAULT_TITLE_SYSTEM_PROMPT}
                            className="w-full px-3 py-2 rounded-lg border border-input-border bg-input text-sm text-text-primary placeholder-text-muted focus:border-accent/50 focus:outline-none transition-colors resize-y min-h-[80px]"
                          />
                          {titleConfig.systemPrompt !== DEFAULT_TITLE_SYSTEM_PROMPT && (
                            <button
                              onClick={() => setTitleConfig({ systemPrompt: DEFAULT_TITLE_SYSTEM_PROMPT })}
                              className="text-xs text-accent hover:text-accent-hover transition-colors"
                            >
                              Reset to default
                            </button>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </>
            )}

            {activeSection === "models" && (
              <>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-text-primary mb-1">Model Endpoints</h3>
                    <p className="text-xs text-text-muted">Configure AI model connections</p>
                  </div>{" "}
                  <div className="flex items-center gap-2">
                    <motion.button
                      onClick={handleRefreshConnections}
                      disabled={loading.checkConnection}
                      whileHover={{ scale: motionTokens.scale.pop }}
                      whileTap={{ scale: motionTokens.scale.press }}
                      transition={springs.snappy}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-hover border border-border text-xs transition-colors min-h-[44px]"
                      aria-label="Refresh connection status"
                    >
                      {loading.checkConnection ? <Loader2 size={14} className="animate-spin" /> : null}
                      Refresh
                    </motion.button>
                    <motion.button
                      onClick={addModel}
                      whileHover={{ scale: motionTokens.scale.pop }}
                      whileTap={{ scale: motionTokens.scale.press }}
                      transition={springs.snappy}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-input text-text-primary hover:bg-hover border border-border text-sm font-medium transition-colors shadow-sm min-h-[44px]"
                      aria-label="Add new model"
                    >
                      <Plus size={14} />
                      <span>Add Model</span>
                    </motion.button>
                  </div>
                </div>

                <div className="space-y-4">
                  {models.map((model) => (
                    <ModelCard
                      key={model.id}
                      model={model}
                      onUpdate={updateModel}
                      onDelete={deleteModel}
                      showKey={!!showKeys[model.id]}
                      onToggleKey={toggleKeyVisibility}
                      connectionStatus={modelStatuses[model.id] ?? "disconnected"}
                    />
                  ))}
                  {models.length === 0 && (
                    <div className="text-center py-8 bg-surface border border-border border-dashed rounded-xl">
                      <p className="text-text-muted text-sm">No models configured.</p>
                      <button
                        onClick={addModel}
                        className="mt-2 text-accent hover:text-accent-hover text-sm font-medium min-h-[44px]"
                      >
                        Add your first model
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}

            {activeSection === "search" && (
              <>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-text-primary mb-1">Web Search APIs</h3>
                    <p className="text-xs text-text-muted">Configure search providers</p>
                  </div>{" "}
                  <motion.button
                    onClick={addSearchConfig}
                    whileHover={{ scale: motionTokens.scale.pop }}
                    whileTap={{ scale: motionTokens.scale.press }}
                    transition={springs.snappy}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-input text-text-primary hover:bg-hover border border-border text-sm font-medium transition-colors shadow-sm min-h-[44px]"
                    aria-label="Add new search API"
                  >
                    <Plus size={14} />
                    <span>Add Search API</span>
                  </motion.button>
                </div>

                <div className="space-y-4">
                  {searchConfigs.map((config) => (
                    <SearchApiCard
                      key={config.id}
                      config={config}
                      onUpdate={updateSearchConfig}
                      onDelete={deleteSearchConfig}
                      showKey={!!showSearchKeys[config.id]}
                      onToggleKey={toggleSearchKeyVisibility}
                    />
                  ))}
                  {searchConfigs.length === 0 && (
                    <div className="text-center py-8 bg-surface border border-border border-dashed rounded-xl">
                      <p className="text-text-muted text-sm">No search APIs configured.</p>
                      <p className="text-text-muted text-xs mt-1">Add a search API to enable web search in chat.</p>
                      <button
                        onClick={addSearchConfig}
                        className="mt-2 text-accent hover:text-accent-hover text-sm font-medium min-h-[44px]"
                      >
                        Add your first search API
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}

            {activeSection === "mcp" && (
              <>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-text-primary mb-1">MCP Servers</h3>
                    <p className="text-xs text-text-muted">Extend AI with external tools</p>
                  </div>{" "}
                  <motion.button
                    onClick={addMcpConfig}
                    whileHover={{ scale: motionTokens.scale.pop }}
                    whileTap={{ scale: motionTokens.scale.press }}
                    transition={springs.snappy}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-input text-text-primary hover:bg-hover border border-border text-sm font-medium transition-colors shadow-sm min-h-[44px]"
                    aria-label="Add MCP server"
                  >
                    <Plus size={14} />
                    <span>Add Server</span>
                  </motion.button>
                </div>

                <div className="space-y-4">
                  {mcpConfigs.map((mcpConfig) => (
                    <McpServerCard
                      key={mcpConfig.id}
                      config={mcpConfig}
                      status={serverStatuses[mcpConfig.id] ?? "disconnected"}
                      tools={availableTools
                        .filter((t) => t.serverId === mcpConfig.id)
                        .map((t) => ({ name: t.name, description: t.description }))}
                      envVars={envSecrets[mcpConfig.id] ?? {}}
                      onUpdate={updateMcpConfig}
                      onDelete={deleteMcpConfig}
                      onConnect={connectServer}
                      onDisconnect={disconnectServer}
                      onSetEnvVars={setEnvSecrets}
                      onCheckCommand={checkCommand}
                      onApplyPreset={handleApplyPreset}
                      showKey={!!showMcpKeys[mcpConfig.id]}
                      onToggleKey={toggleMcpKeyVisibility}
                    />
                  ))}
                  {mcpConfigs.length === 0 && (
                    <div className="text-center py-8 bg-surface border border-border border-dashed rounded-xl">
                      <p className="text-text-muted text-sm">No MCP servers configured.</p>
                      <p className="text-text-muted text-xs mt-1">
                        Add an MCP server to extend AI capabilities with external tools.
                      </p>
                      <button
                        onClick={addMcpConfig}
                        className="mt-2 text-accent hover:text-accent-hover text-sm font-medium min-h-[44px]"
                      >
                        Add your first MCP server
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}

            {activeSection === "logs" && (
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
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
