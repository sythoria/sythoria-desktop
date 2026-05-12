import { useState, useEffect } from "react";
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

const PROVIDER_PRESETS = [
  { label: "OpenAI", apiBase: "https://api.openai.com/v1/chat/completions", defaultModel: "gpt-4o" },
  { label: "Anthropic", apiBase: "https://api.anthropic.com/v1/messages", defaultModel: "claude-3-5-sonnet-20240620" },
  { label: "Google Gemini", apiBase: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", defaultModel: "gemini-2.5-pro" },
  { label: "Ollama (Local)", apiBase: "http://localhost:11434/v1/chat/completions", defaultModel: "llama3.1" },
  { label: "NVIDIA NIM", apiBase: "https://integrate.api.nvidia.com/v1/chat/completions", defaultModel: "meta/llama-3.3-70b-instruct" },
  { label: "OpenRouter", apiBase: "https://openrouter.ai/api/v1/chat/completions", defaultModel: "anthropic/claude-3.5-sonnet" },
  { label: "Custom", apiBase: "", defaultModel: "" }
];

interface SettingsProps {
  models: ModelConfig[];
  setModels: React.Dispatch<React.SetStateAction<ModelConfig[]>>;
  selectedModel: string;
  onModelChange: (model: string) => void;
  temperature: number;
  onTemperatureChange: (t: number) => void;
  onBack: () => void;
  onCreateChat: () => string;
}

export default function Settings({
  models,
  setModels,
  selectedModel,
  onModelChange,
  temperature,
  onTemperatureChange,
  onBack,
  onCreateChat,
}: SettingsProps) {
  const [darkMode, setDarkMode] = useState(() => {
    return document.documentElement.classList.contains("dark");
  });
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }, [darkMode]);

  const updateModel = (id: string, field: keyof ModelConfig, value: string) => {
    setModels((prev) =>
      prev.map((m) => (m.id === id ? { ...m, [field]: value } : m))
    );
  };

  const deleteModel = (id: string) => {
    setModels((prev) => prev.filter((m) => m.id !== id));
    if (selectedModel === id && models.length > 1) {
       onModelChange(models.find(m => m.id !== id)?.id || "");
    }
  };

  const addModel = () => {
    const newModel: ModelConfig = {
      id: "custom-" + Date.now(),
      name: "New Model",
      apiBase: "https://api.openai.com/v1/chat/completions",
      apiKey: "",
      modelId: "gpt-4o",
      provider: "OpenAI",
    };
    setModels((prev) => [...prev, newModel]);
  };

  const currentModel = models.find((m) => m.id === selectedModel) ?? models[0];

  const toggleKeyVisibility = (id: string) => {
    setShowKeys((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden animate-slide-up">
      <header className="shrink-0 flex items-center justify-between px-4 py-3 md:px-6 border-b border-border/50">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-hover transition-colors"
            title="Back to Chat"
          >
            <ArrowLeft size={18} />
          </button>
          <SettingsIcon size={18} className="text-text-muted" />
          <h2 className="text-sm font-medium text-text-secondary">Settings</h2>
        </div>
        <button
          onClick={onCreateChat}
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
                {darkMode ? (
                  <Moon size={16} className="text-accent" />
                ) : (
                  <Sun size={16} className="text-accent" />
                )}
              </div>
              <h3 className="text-sm font-semibold text-text-primary">Appearance</h3>
            </div>
            <div className="bg-surface border border-border rounded-xl p-4 space-y-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-text-primary">Dark Mode</p>
                  <p className="text-xs text-text-muted mt-0.5">Toggle between light and dark themes</p>
                </div>
                <button
                  onClick={() => setDarkMode(!darkMode)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ${
                    darkMode ? "bg-accent" : "bg-input-border"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ${
                      darkMode ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
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
                              onModelChange(model.id);
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
                              <span className="text-[10px] text-text-muted">{model.apiBase.split('/')[2]}</span>
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
                  <span className="text-xs text-text-muted whitespace-nowrap">0.0</span>
                  <div className="relative flex-1 h-1.5 bg-input-border rounded-full">
                    <div
                      className="absolute h-full bg-accent rounded-full transition-all duration-150"
                      style={{ width: `${(temperature / 2.0) * 100}%` }}
                    />
                    <input
                      type="range"
                      min="0"
                      max="2"
                      step="0.1"
                      value={temperature}
                      onChange={(e) => onTemperatureChange(parseFloat(e.target.value))}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <div
                      className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-accent rounded-full border-2 border-white shadow-sm pointer-events-none transition-all duration-150"
                      style={{ left: `calc(${(temperature / 2.0) * 100}% - 6px)` }}
                    />
                  </div>
                  <span className="text-xs text-text-muted whitespace-nowrap">2.0</span>
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
                <div key={model.id} className="bg-surface border border-border rounded-xl p-4 space-y-3 shadow-sm relative group">
                  <button
                    onClick={() => deleteModel(model.id)}
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
                          onChange={(e) => updateModel(model.id, "name", e.target.value)}
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
                              const preset = PROVIDER_PRESETS.find(p => p.label === e.target.value);
                              if (preset) {
                                setModels((prev) =>
                                  prev.map((m) =>
                                    m.id === model.id
                                      ? {
                                          ...m,
                                          provider: preset.label,
                                          apiBase: preset.apiBase || m.apiBase,
                                          modelId: preset.defaultModel || m.modelId,
                                          name: m.name === "New Model" ? preset.label : m.name
                                        }
                                      : m
                                  )
                                );
                              } else {
                                updateModel(model.id, "provider", e.target.value);
                              }
                            }}
                            className="w-full px-3 py-2 appearance-none rounded-lg border border-input-border bg-input text-sm text-text-primary focus:border-accent/50 focus:outline-none transition-colors"
                          >
                            {PROVIDER_PRESETS.map(p => (
                              <option key={p.label} value={p.label}>{p.label}</option>
                            ))}
                          </select>
                          <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-medium text-text-muted">API Base URL</label>
                      <input
                        type="text"
                        value={model.apiBase}
                        onChange={(e) => updateModel(model.id, "apiBase", e.target.value)}
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
                          onChange={(e) => updateModel(model.id, "modelId", e.target.value)}
                          placeholder="e.g. gpt-4o or meta/llama-3.3-70b-instruct"
                          className="w-full px-3 py-2 rounded-lg border border-input-border bg-input text-sm text-text-primary placeholder-text-muted font-mono text-xs focus:border-accent/50 focus:outline-none transition-colors"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-medium text-text-muted">API Key</label>
                        <div className="relative">
                          <input
                            type={showKeys[model.id] ? "text" : "password"}
                            value={model.apiKey}
                            onChange={(e) => updateModel(model.id, "apiKey", e.target.value)}
                            placeholder="API key (optional for local)"
                            className="w-full px-3 py-2 pr-9 rounded-lg border border-input-border bg-input text-sm text-text-primary placeholder-text-muted focus:border-accent/50 focus:outline-none transition-colors"
                          />
                          <button
                            onClick={() => toggleKeyVisibility(model.id)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors"
                          >
                            {showKeys[model.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {models.length === 0 && (
                <div className="text-center py-8 bg-surface border border-border border-dashed rounded-xl">
                  <p className="text-text-muted text-sm">No models configured.</p>
                  <button
                    onClick={addModel}
                    className="mt-2 text-accent hover:text-accent-hover text-sm font-medium"
                  >
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
