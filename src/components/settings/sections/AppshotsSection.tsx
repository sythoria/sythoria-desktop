import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Image, Trash2, Camera, AlertCircle, Copy, Check } from "lucide-react";
import { Switch } from "../../ui/Switch";
import { Spinner } from "../../ui/Spinner";
import { springs, motionTokens } from "../../../lib/motion-tokens";
import { useAppshotStore } from "../../../store/useAppshotStore";
import { useUIStore } from "../../../store/useUIStore";

export function AppshotsSection() {
  const {
    config,
    recentAppshots,
    isCapturing,
    loading,
    error,
    init,
    updateConfig,
    triggerCapture,
    deleteAppshot,
    clearAll,
  } = useAppshotStore();
  const addToast = useUIStore((s) => s.addToast);
  const [inputFolder, setInputFolder] = useState(config.captureFolder);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [prevFolder, setPrevFolder] = useState(config.captureFolder);

  if (config.captureFolder !== prevFolder) {
    setPrevFolder(config.captureFolder);
    setInputFolder(config.captureFolder);
  }

  useEffect(() => {
    init();
  }, [init]);

  const handleSaveFolder = async () => {
    await updateConfig({ captureFolder: inputFolder.trim() });
    addToast("Appshots capture folder path updated", "success");
  };

  const handleTestCapture = async () => {
    try {
      addToast("Starting screen capture...", "info");
      const path = await triggerCapture("primary");
      addToast(`Screenshot captured! Saved to ${path.slice(-40)}...`, "success");
    } catch (e: any) {
      addToast(`Screen capture failed: ${e.message || String(e)}`, "error");
    }
  };

  const handleCopyPath = (path: string) => {
    navigator.clipboard.writeText(path);
    setCopiedPath(path);
    addToast("File path copied to clipboard", "info");
    setTimeout(() => setCopiedPath(null), 2000);
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/20 pb-4">
        <div>
          <h3 className="text-sm font-semibold text-text-primary mb-1">Appshots Utility</h3>
          <p className="text-xs text-text-muted">
            Capture monitor frames, configure encoders, and manage disk space cleanup.
          </p>
        </div>
        <Switch checked={config.enabled} onChange={(val) => updateConfig({ enabled: val })} label="" description="" />
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl p-3 text-xs flex items-start gap-2.5 shadow-sm">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold block mb-0.5">Appshot Engine Error</span>
            <span className="opacity-90">{error}</span>
          </div>
        </div>
      )}

      {config.enabled && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springs.gentle}
          className="space-y-6"
        >
          {/* Card 1: Storage Options */}
          <div className="bg-surface border border-border rounded-xl p-4 space-y-4 shadow-sm">
            <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider">Save Location</h4>
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={inputFolder}
                  onChange={(e) => setInputFolder(e.target.value)}
                  className="flex-1 px-3 py-1.5 rounded-lg bg-input border border-border text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
                  placeholder="Default (Sythoria app data folder)"
                />
                <motion.button
                  whileHover={{ scale: motionTokens.scale.pop }}
                  whileTap={{ scale: motionTokens.scale.press }}
                  className="px-4 py-1.5 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent-hover transition-colors shadow-sm"
                  onClick={handleSaveFolder}
                >
                  Save
                </motion.button>
              </div>
              <p className="text-[10px] text-text-muted">
                Leave path empty to default to Sythoria's secure local cache folder.
              </p>
            </div>
          </div>

          {/* Card 2: Capture Preferences */}
          <div className="bg-surface border border-border rounded-xl p-4 space-y-4 shadow-sm">
            <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
              Capture & Encoder Preferences
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-1">
              <div className="space-y-2">
                <span className="text-xs font-medium text-text-primary block">Encoder Format</span>
                <div className="flex gap-2 bg-input/40 p-1 rounded-lg border border-border/40 w-fit">
                  {(["png", "jpeg"] as const).map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => updateConfig({ imageFormat: fmt })}
                      className={`px-3 py-1 rounded-md text-xs font-semibold uppercase tracking-wider transition-all ${
                        config.imageFormat === fmt
                          ? "bg-surface text-accent shadow-sm border border-border/50"
                          : "text-text-muted hover:text-text-primary"
                      }`}
                    >
                      {fmt}
                    </button>
                  ))}
                </div>
              </div>

              {config.imageFormat === "jpeg" && (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="font-medium text-text-primary">JPEG Quality</span>
                    <span className="font-semibold text-accent">{config.imageQuality}%</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    value={config.imageQuality}
                    onChange={(e) => updateConfig({ imageQuality: parseInt(e.target.value, 10) })}
                    className="w-full accent-accent bg-input rounded-lg appearance-none h-1.5"
                  />
                </div>
              )}

              <div className="space-y-2">
                <span className="text-xs font-medium text-text-primary block">Delay Timer</span>
                <select
                  value={config.delaySeconds}
                  onChange={(e) => updateConfig({ delaySeconds: parseInt(e.target.value, 10) })}
                  className="px-3 py-1.5 rounded-lg bg-input border border-border text-sm text-text-primary focus:outline-none focus:border-accent w-full"
                >
                  <option value={0}>0s (Instant Capture)</option>
                  <option value={1}>1s Delay</option>
                  <option value={3}>3s Delay</option>
                  <option value={5}>5s Delay</option>
                </select>
              </div>

              <div className="space-y-4 sm:col-span-2 pt-2 border-t border-border/50">
                <Switch
                  checked={config.hideWindowOnCapture}
                  onChange={(val) => updateConfig({ hideWindowOnCapture: val })}
                  label="Minimize App on Capture"
                  description="Auto-minimize Sythoria window during screenshot count-down"
                />
              </div>
            </div>
          </div>

          {/* Card 3: Auto-Clean Rules */}
          <div className="bg-surface border border-border rounded-xl p-4 space-y-4 shadow-sm">
            <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider">Disk Space Auto-Cleanup</h4>
            <Switch
              checked={config.autoCleanEnabled}
              onChange={(val) => updateConfig({ autoCleanEnabled: val })}
              label="Enable Auto-Cleanup"
              description="Automatically manage and prune old screenshot captures"
            />

            <AnimatePresence initial={false}>
              {config.autoCleanEnabled && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={springs.gentle}
                  className="space-y-4 pt-2 border-t border-border/60 overflow-hidden"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                        Pruning Rule
                      </label>
                      <select
                        value={config.autoCleanType}
                        onChange={(e) => updateConfig({ autoCleanType: e.target.value as any })}
                        className="w-full px-3 py-1.5 rounded-lg bg-input border border-border text-sm text-text-primary focus:outline-none focus:border-accent"
                      >
                        <option value="count">Keep Max File Count</option>
                        <option value="size">Limit Folder Size (MB)</option>
                        <option value="age">Limit File Age (Days)</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                        Limit Threshold Value
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={config.autoCleanValue}
                        onChange={(e) => updateConfig({ autoCleanValue: parseInt(e.target.value, 10) || 1 })}
                        className="w-full px-3 py-1.5 rounded-lg bg-input border border-border text-sm text-text-primary focus:outline-none"
                      />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Recent Appshots / Gallery */}
          <div className="bg-surface border border-border rounded-xl p-4 space-y-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider">Captures Gallery</h4>
              <div className="flex gap-2">
                <motion.button
                  whileHover={{ scale: motionTokens.scale.pop }}
                  whileTap={{ scale: motionTokens.scale.press }}
                  onClick={handleTestCapture}
                  disabled={isCapturing}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent text-accent-foreground text-xs font-semibold shadow-sm min-h-[32px]"
                >
                  {isCapturing ? <Spinner size="sm" /> : <Camera size={13} />}
                  <span>Test Capture</span>
                </motion.button>
                {recentAppshots.length > 0 && (
                  <motion.button
                    whileHover={{ scale: motionTokens.scale.pop }}
                    whileTap={{ scale: motionTokens.scale.press }}
                    onClick={clearAll}
                    disabled={loading}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-500/20 text-red-500 hover:bg-red-500/5 text-xs font-semibold min-h-[32px]"
                  >
                    <Trash2 size={13} />
                    <span>Clear All</span>
                  </motion.button>
                )}
              </div>
            </div>

            {recentAppshots.length === 0 ? (
              <div className="border border-dashed border-border/60 rounded-xl p-8 text-center space-y-2">
                <Image size={24} className="mx-auto text-text-muted opacity-40 animate-pulse" />
                <span className="text-xs text-text-muted block">No screenshot records found yet.</span>
              </div>
            ) : (
              <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                {recentAppshots.map((shot) => (
                  <div
                    key={shot.path}
                    className="flex items-center justify-between p-2.5 rounded-lg bg-input/40 border border-border/40 hover:bg-input/60 transition-colors gap-4"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0 shadow-inner">
                        <Image size={15} className="text-accent" />
                      </div>
                      <div className="min-w-0">
                        <span className="text-xs font-medium text-text-primary block truncate max-w-[240px] sm:max-w-[360px]">
                          {shot.name}
                        </span>
                        <span className="text-[10px] text-text-muted flex gap-2">
                          <span>{shot.timestamp}</span>
                          <span>•</span>
                          <span>{formatSize(shot.size)}</span>
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleCopyPath(shot.path)}
                        className="p-1.5 rounded bg-surface hover:bg-hover border border-border text-text-secondary hover:text-text-primary transition-colors"
                        title="Copy absolute path"
                      >
                        {copiedPath === shot.path ? (
                          <Check size={13} className="text-emerald-500" />
                        ) : (
                          <Copy size={13} />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteAppshot(shot.path)}
                        className="p-1.5 rounded bg-surface hover:bg-hover border border-border text-red-500/80 hover:text-red-500 transition-colors"
                        title="Delete image"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </div>
  );
}
export default AppshotsSection;
