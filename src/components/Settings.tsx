import { useState, useEffect } from "react";
import { Settings as SettingsIcon, Moon, Sun, Sliders } from "lucide-react";
import { MODELS } from "../types";

interface SettingsProps {
  selectedModel: string;
  onModelChange: (model: string) => void;
}

export default function Settings({ selectedModel, onModelChange }: SettingsProps) {
  const [darkMode, setDarkMode] = useState(() => {
    return document.documentElement.classList.contains("dark");
  });
  const [temperature, setTemperature] = useState(0.7);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }, [darkMode]);

  const currentModel = MODELS.find((m) => m.id === selectedModel) ?? MODELS[0];

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden animate-slide-up">
      <header className="shrink-0 flex items-center gap-3 px-4 py-3 md:px-6 border-b border-border/50">
        <SettingsIcon size={18} className="text-text-muted" />
        <h2 className="text-sm font-medium text-text-secondary">
          Settings
        </h2>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
          {/* Dark Mode Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-md bg-accent-soft">
                {darkMode ? (
                  <Moon size={16} className="text-accent" />
                ) : (
                  <Sun size={16} className="text-accent" />
                )}
              </div>
              <h3 className="text-sm font-semibold text-text-primary">
                Appearance
              </h3>
            </div>
            <div className="bg-surface border border-border rounded-xl p-4 space-y-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-text-primary">Dark Mode</p>
                  <p className="text-xs text-text-muted mt-0.5">
                    Toggle between light and dark themes
                  </p>
                </div>
                <button
                  onClick={() => setDarkMode(!darkMode)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ${
                    darkMode
                      ? "bg-accent"
                      : "bg-input-border"
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

          {/* AI Model Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-md bg-accent-soft">
                <Sliders size={16} className="text-accent" />
              </div>
              <h3 className="text-sm font-semibold text-text-primary">
                AI Configuration
              </h3>
            </div>
            <div className="bg-surface border border-border rounded-xl p-4 space-y-4 shadow-sm">
              {/* Model Selector */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-text-primary block">
                  AI Model
                </label>
                <p className="text-xs text-text-muted mb-2">
                  Choose the model for new conversations
                </p>
                <div className="relative">
                  <button
                    onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-input-border bg-input text-sm text-text-primary hover:border-accent/30 transition-colors"
                  >
                    <span>{currentModel.name}</span>
                    <svg
                      className={`w-4 h-4 text-text-muted transition-transform ${modelDropdownOpen ? "rotate-180" : ""}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {modelDropdownOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setModelDropdownOpen(false)}
                      />
                      <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-xl shadow-lg z-20 overflow-hidden animate-fade-in">
                        {MODELS.map((model) => (
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
                              <span className="text-[10px] text-text-muted">
                                {model.provider}
                              </span>
                            </div>
                            {selectedModel === model.id && (
                              <svg
                                className="w-4 h-4 text-accent shrink-0"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Temperature Slider */}
              <div className="space-y-3 pt-2 border-t border-border/50">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-text-primary">
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
                      onChange={(e) => setTemperature(parseFloat(e.target.value))}
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

          {/* About Section */}
          <div className="bg-surface border border-border rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-text-primary">Sythoria</p>
                <p className="text-xs text-text-muted mt-0.5">
                  Version 1.0.0
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted">
                  {currentModel.name}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
