import { useState, memo } from "react";
import {
  Settings as SettingsIcon,
  Moon,
  Sun,
  Sliders,
  Eye,
  EyeOff,
  Check,
  ArrowLeft,
  Plus,
  Trash2,
  ChevronDown,
} from "lucide-react";
import { ModelConfig } from "../types";
import { useAppStore } from "../store/useAppStore";
import { PROVIDER_PRESETS } from "../config/providerPresets";
import { MAX_TEMPERATURE, MIN_TEMPERATURE, TEMPERATURE_STEP } from "../config/constants";
import { Switch } from "./ui/Switch";

interface ModelCardProps {
  model: ModelConfig;
  onUpdate: (id: string, updates: Partial<ModelConfig>) => void;
  onDelete: (id: string) => void;
  showKey: boolean;
  onToggleKey: (id: string) => void;
}

const ModelCard = memo(function ModelCard({ model, onUpdate, onDelete, showKey, onToggleKey }: ModelCardProps) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4 space-y-3 shadow-sm relative group">
      <button
        onClick={() => onDelete(model.id)}
        className="absolute top-4 right-4 text-text-muted hover:text-red-500 transition-colors"
        title="Delete model"
      >
        <Trash2 size={16} />
      </button>

      <div className="pr-8 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted">Name</label>
            <input
              type="text"
              value={model.name}
              onChange={(e) => onUpdate(model.id, { name: e.target.value })}
              placeholder="e.g. My Llama 3"
              className="w-full px-3 py-2 rounded-lg border border-input-border bg-input text-sm text-text-primary placeholder-text-muted focus:border-accent/50 focus:outline-none transition-colors"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted">Provider Preset</label>
            <div className="relative">
              <select
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
              />
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-text-muted">API Base URL</label>
          <input
            type="text"
            value={model.apiBase}
            onChange={(e) => onUpdate(model.id, { apiBase: e.target.value })}
            placeholder="https://api.openai.com/v1/chat/completions"
            className="w-full px-3 py-2 rounded-lg border border-input-border bg-input text-sm text-text-primary placeholder-text-muted font-mono text-xs focus:border-accent/50 focus:outline-none transition-colors"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted">Model ID</label>
            <input
              type="text"
              value={model.modelId}
              onChange={(e) => onUpdate(model.id, { modelId: e.target.value })}
              placeholder="e.g. gpt-4o or meta/llama-3.3-70b-instruct"
              className="w-full px-3 py-2 rounded-lg border border-input-border bg-input text-sm text-text-primary placeholder-text-muted font-mono text-xs focus:border-accent/50 focus:outline-none transition-colors"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted">API Key</label>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={model.apiKey}
                onChange={(e) => onUpdate(model.id, { apiKey: e.target.value })}
                placeholder="API key (optional for local)"
                className="w-full px-3 py-2 pr-9 rounded-lg border border-input-border bg-input text-sm text-text-primary placeholder-text-muted focus:border-accent/50 focus:outline-none transition-colors"
              />
              <button
                onClick={() => onToggleKey(model.id)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors"
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

export default function Settings() {
  const models = useAppStore((s) => s.models);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const temperature = useAppStore((s) => s.temperature);
  const theme = useAppStore((s) => s.theme);
  const setSelectedModel = useAppStore((s) => s.setSelectedModel);
  const setTemperature = useAppStore((s) => s.setTemperature);
  const setTheme = useAppStore((s) => s.setTheme);
  const setView = useAppStore((s) => s.setView);
  const updateModel = useAppStore((s) => s.updateModel);
  const deleteModel = useAppStore((s) => s.deleteModel);
  const addModel = useAppStore((s) => s.addModel);
  const newChat = useAppStore((s) => s.newChat);

  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});

  const currentModel = models.find((m) => m.id === selectedModel) ?? models[0];

  const toggleKeyVisibility = (id: string) => {
    setShowKeys((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleBack = () => setView("chat");

  const handleCreateChat = () => {
    const id = newChat();
    setView("chat");
    return id;
  };

  const tempPercent = ((temperature - MIN_TEMPERATURE) / (MAX_TEMPERATURE - MIN_TEMPERATURE)) * 100;

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden animate-slide-up">
      <header className="shrink-0 flex items-center justify-between px-4 py-3 md:px-6 border-b border-border/50">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-hover transition-colors"
            title="Back to Chat"
          >
            <ArrowLeft size={18} />
          </button>
          <SettingsIcon size={18} className="text-text-muted" />
          <h2 className="text-sm font-medium text-text-secondary">Settings</h2>
        </div>
        <button
          onClick={handleCreateChat}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/20 text-primary hover:bg-primary/30 border border-primary/50 text-sm font-medium transition-all"
          title="Create New Chat"
        >
          <Plus size={16} />
          <span className="hidden sm:inline">New Chat</span>
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-md bg-accent-soft">
                {theme === "dark" ? (
                  <Moon size={16} className="text-accent" />
                ) : (
                  <Sun size={16} className="text-accent" />
                )}
              </div>
              <h3 className="text-sm font-semibold text-text-primary">Appearance</h3>
            </div>
            <div className="bg-surface border border-border rounded-xl p-4 space-y-4 shadow-sm">
              <Switch
                checked={theme === "dark"}
                onChange={(checked) => setTheme(checked ? "dark" : "light")}
                label="Dark Mode"
                description="Toggle between light and dark themes"
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-md bg-accent-soft">
                <Sliders size={16} className="text-accent" />
              </div>
              <h3 className="text-sm font-semibold text-text-primary">AI Configuration</h3>
            </div>
            <div className="bg-surface border border-border rounded-xl p-4 space-y-4 shadow-sm">
              <div className="space-y-2">
                <label className="text-sm font-medium text-text-primary block">Default AI Model</label>
                <p className="text-xs text-text-muted mb-2">Choose the model for new conversations</p>
                <div className="relative">
                  <button
                    onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-input-border bg-input text-sm text-text-primary hover:border-accent/30 transition-colors"
                  >
                    <span>{currentModel?.name || "No Model"}</span>
                    <ChevronDown
                      size={16}
                      className={`text-text-muted transition-transform ${modelDropdownOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                  {modelDropdownOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setModelDropdownOpen(false)} />
                      <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-xl shadow-lg z-20 overflow-hidden animate-fade-in max-h-64 overflow-y-auto">
                        {models.map((model) => (
                          <button
                            key={model.id}
                            onClick={() => {
                              setSelectedModel(model.id);
                              setModelDropdownOpen(false);
                            }}
                            className={`w-full flex items-center justify-between px-3 py-2.5 text-sm transition-colors ${
                              selectedModel === model.id
                                ? "bg-accent-soft text-accent"
                                : "text-text-secondary hover:bg-hover hover:text-text-primary"
                            }`}
                          >
                            <div className="flex flex-col items-start">
                              <span className="font-medium">{model.name}</span>
                              <span className="text-[10px] text-text-muted">{model.apiBase.split("/")[2]}</span>
                            </div>
                            {selectedModel === model.id && <Check size={14} className="text-accent shrink-0" />}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="space-y-3 pt-2 border-t border-border/50">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-text-primary">Temperature</label>
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
                      type="range"
                      min={MIN_TEMPERATURE}
                      max={MAX_TEMPERATURE}
                      step={TEMPERATURE_STEP}
                      value={temperature}
                      onChange={(e) => setTemperature(parseFloat(e.target.value))}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <div
                      className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-accent rounded-full border-2 border-white shadow-sm pointer-events-none transition-all duration-150"
                      style={{ left: `calc(${tempPercent}% - 6px)` }}
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
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-md bg-accent-soft">
                  <SettingsIcon size={16} className="text-accent" />
                </div>
                <h3 className="text-sm font-semibold text-text-primary">Model Endpoints</h3>
              </div>
              <button
                onClick={addModel}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-input text-text-primary hover:bg-hover border border-border text-sm font-medium transition-colors shadow-sm"
              >
                <Plus size={14} />
                <span>Add Model</span>
              </button>
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
                />
              ))}
              {models.length === 0 && (
                <div className="text-center py-8 bg-surface border border-border border-dashed rounded-xl">
                  <p className="text-text-muted text-sm">No models configured.</p>
                  <button onClick={addModel} className="mt-2 text-accent hover:text-accent-hover text-sm font-medium">
                    Add your first model
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="bg-surface border border-border rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-text-primary">Sythoria</p>
                <p className="text-xs text-text-muted mt-0.5">Version 1.0.0</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted">{currentModel?.name || "N/A"}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
