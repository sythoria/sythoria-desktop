import { useEffect, useState } from "react";
import { useWhisperStore } from "../../../store/useWhisperStore";
import { WHISPER_PRESETS } from "../../../config/whisperPresets";
import { open } from "@tauri-apps/plugin-dialog";
import { Download, Trash2, Check, FileCheck, Info, Loader2, Globe, X } from "lucide-react";
import { Switch } from "../../ui/Switch";

export function WhisperSection() {
  const {
    isVoiceEnabled,
    selectedModelId,
    customModelPath,
    language,
    downloadedFiles,
    isDownloading,
    downloadProgress,
    downloadingModelId,
    toggleVoiceEnabled,
    selectModel,
    setCustomModelPath,
    setLanguage,
    downloadModel,
    cancelDownload,
    deleteModel,
    init,
  } = useWhisperStore();

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    init();
  }, [init]);

  const handlePickLocal = async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Whisper GGML Model", extensions: ["bin"] }],
      });
      if (selected && typeof selected === "string") {
        setCustomModelPath(selected);
      }
    } catch {
      setErrorMsg("Failed to open file picker.");
    }
  };

  const activeModelPath = () => {
    if (selectedModelId === "custom" && customModelPath) {
      return customModelPath;
    }
    const preset = WHISPER_PRESETS.find((p) => p.id === selectedModelId);
    return preset ? `whisper_models/${preset.fileName}` : "Not Selected";
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-text-primary mb-1">Local Voice Input (Whisper)</h3>
        <p className="text-xs text-text-muted">
          Transcribe your voice offline using high-performance open-source Whisper models.
        </p>
      </div>

      <div className="bg-surface-elevated border border-border/60 rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-medium text-text-primary block">Enable Voice-to-Text</span>
            <span className="text-[11px] text-text-muted block">Adds a microphone button to your chat input.</span>
          </div>
          <Switch checked={isVoiceEnabled} onChange={toggleVoiceEnabled} />
        </div>

        {isVoiceEnabled && (
          <div className="border-t border-border/40 pt-4 space-y-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-text-secondary flex items-center gap-1.5">
                <Globe size={13} />
                <span>Transcription Language</span>
              </label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full text-xs bg-surface border border-border/85 rounded-lg p-2 text-text-primary outline-none focus:border-accent"
              >
                <option value="en">English (default)</option>
                <option value="es">Spanish</option>
                <option value="fr">French</option>
                <option value="de">German</option>
                <option value="it">Italian</option>
                <option value="ja">Japanese</option>
                <option value="zh">Chinese</option>
                <option value="auto">Auto-Detect</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {isVoiceEnabled && (
        <>
          {/* Active Model Status */}
          <div className="bg-surface-elevated border border-border/60 rounded-xl p-4">
            <h4 className="text-xs font-semibold text-text-secondary mb-2 uppercase tracking-wider">
              Active Configuration
            </h4>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-border/30">
                <span className="text-text-muted">Selected Mode:</span>
                <span className="font-medium text-text-primary">
                  {selectedModelId === "custom"
                    ? "Custom Local File"
                    : WHISPER_PRESETS.find((p) => p.id === selectedModelId)?.name || "None"}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-text-muted">Model Path:</span>
                <span className="font-mono text-text-muted truncate max-w-[320px]" title={activeModelPath()}>
                  {activeModelPath()}
                </span>
              </div>
            </div>
          </div>

          {/* Model Management Lists */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Available Models</h4>
              <button
                onClick={handlePickLocal}
                className="text-xs text-accent hover:underline flex items-center gap-1 font-medium bg-transparent border-0 cursor-pointer"
              >
                <FileCheck size={13} />
                <span>Load local file (.bin)</span>
              </button>
            </div>

            <div className="space-y-2">
              {WHISPER_PRESETS.map((model) => {
                const isDownloaded = downloadedFiles.includes(model.fileName);
                const isSelected = selectedModelId === model.id;
                const isThisDownloading = downloadingModelId === model.id;

                return (
                  <div
                    key={model.id}
                    className={`flex items-center justify-between p-3.5 bg-surface border rounded-xl transition-all ${
                      isSelected ? "border-accent/40 bg-accent-soft/10" : "border-border/60 hover:bg-hover/30"
                    }`}
                  >
                    <div className="space-y-1 pr-4">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-text-primary">{model.name}</span>
                        <span className="text-[10px] px-1.5 py-0.5 font-medium rounded-full bg-surface-elevated border border-border/80 text-text-muted">
                          {model.size}
                        </span>
                      </div>
                      <p className="text-xs text-text-muted leading-relaxed">{model.description}</p>
                    </div>

                    <div className="shrink-0 flex items-center gap-2">
                      {isThisDownloading ? (
                        <div className="flex items-center gap-2">
                          <div className="flex flex-col items-end gap-1.5">
                            <div className="flex items-center gap-1.5 text-xs text-accent font-medium">
                              <Loader2 size={13} className="animate-spin" />
                              <span>Downloading {downloadProgress}%</span>
                            </div>
                            <div className="w-24 bg-chat h-1.5 rounded-full overflow-hidden flex justify-start">
                              <div className="bg-accent h-full" style={{ width: `${downloadProgress}%` }} />
                            </div>
                          </div>
                          <button
                            onClick={() => cancelDownload()}
                            className="p-1.5 rounded-lg border border-border text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                            title="Cancel download"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : isDownloaded ? (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => selectModel(model.id)}
                            disabled={isSelected}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all ${
                              isSelected
                                ? "bg-active text-text-primary border border-accent/30"
                                : "bg-surface border border-border hover:bg-hover hover:text-text-primary cursor-pointer"
                            }`}
                          >
                            {isSelected && <Check size={12} className="text-accent" />}
                            <span>{isSelected ? "Active" : "Select"}</span>
                          </button>
                          <button
                            onClick={() => {
                              if (
                                window.confirm(`Delete ${model.name}? You will need to redownload it to use it again.`)
                              ) {
                                deleteModel(model.fileName);
                              }
                            }}
                            className="p-2 rounded-lg border border-border text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                            title="Delete model file"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => downloadModel(model.id)}
                          disabled={isDownloading}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent text-white hover:bg-accent/80 transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        >
                          <Download size={13} />
                          <span>Download</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {errorMsg && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-xs text-red-500 flex items-start gap-2">
          <Info size={14} className="shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}
    </div>
  );
}
