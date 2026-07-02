import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ShieldCheck, ShieldAlert, FileText, Trash2, Camera, Network } from "lucide-react";
import { Switch } from "../../ui/Switch";
import { ConfirmModal } from "../../ui/Modal";
import { useUIStore } from "../../../store/useUIStore";
import { useAppshotStore } from "../../../store/useAppshotStore";
import { clearLogs } from "../../../utils/logger";
import { clearStoreData } from "../../../utils/storage";
import { invoke } from "@tauri-apps/api/core";
import { springs, motionTokens } from "../../../lib/motion-tokens";

export function PrivacySection() {
  const isLoggingEnabled = useUIStore((s) => s.isLoggingEnabled);
  const setIsLoggingEnabled = useUIStore((s) => s.setIsLoggingEnabled);
  const logBuffer = useUIStore((s) => s.logBuffer);
  const addToast = useUIStore((s) => s.addToast);

  const disableBgActivity = useUIStore((s) => s.disableBgActivity);
  const setDisableBgActivity = useUIStore((s) => s.setDisableBgActivity);
  const strictSsl = useUIStore((s) => s.strictSsl);
  const setStrictSsl = useUIStore((s) => s.setStrictSsl);
  const blockedHosts = useUIStore((s) => s.blockedHosts);
  const setBlockedHosts = useUIStore((s) => s.setBlockedHosts);
  const offlineMode = useUIStore((s) => s.offlineMode);
  const setOfflineMode = useUIStore((s) => s.setOfflineMode);

  const [blockedHostsText, setBlockedHostsText] = useState(() => blockedHosts.join("\n"));

  useEffect(() => {
    if (document.activeElement?.tagName !== "TEXTAREA") {
      const handle = requestAnimationFrame(() => {
        setBlockedHostsText(blockedHosts.join("\n"));
      });
      return () => cancelAnimationFrame(handle);
    }
  }, [blockedHosts]);

  const handleBlockedHostsChange = (val: string) => {
    setBlockedHostsText(val);
    const list = val
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (JSON.stringify(list) !== JSON.stringify(blockedHosts)) {
      setBlockedHosts(list);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === " ") {
      e.preventDefault();
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const val = target.value;
      const newVal = val.substring(0, start) + "\n" + val.substring(end);

      setBlockedHostsText(newVal);
      const list = newVal
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      if (JSON.stringify(list) !== JSON.stringify(blockedHosts)) {
        setBlockedHosts(list);
      }

      setTimeout(() => {
        target.selectionStart = target.selectionEnd = start + 1;
      }, 0);
    }
  };

  const {
    config: appshotConfig,
    recentAppshots,
    init: initAppshot,
    updateConfig: updateAppshotConfig,
    clearAll: clearAllAppshots,
    hasPermission: hasAppshotPermission,
    requestPermission: requestAppshotPermission,
  } = useAppshotStore();

  const [isConfirmWipe1Open, setIsConfirmWipe1Open] = useState(false);
  const [isConfirmWipe2Open, setIsConfirmWipe2Open] = useState(false);

  useEffect(() => {
    initAppshot();
  }, [initAppshot]);

  const handleClearLogs = () => {
    clearLogs();
    addToast("Local activity logs cleared successfully", "success");
  };

  const handleWipeData = async () => {
    setIsConfirmWipe2Open(false);

    try {
      // 1. Wipe keyring secrets first (depends on active store server list/indices)
      try {
        await invoke("save_api_keys_cmd", { keys: {} });
      } catch (e) {
        console.error("Failed to clear API keys keyring:", e);
      }
      try {
        await invoke("save_search_api_keys_cmd", { keys: {} });
      } catch (e) {
        console.error("Failed to clear Search API keys keyring:", e);
      }
      try {
        await invoke("save_mcp_env_secrets_cmd", { secrets: {} });
      } catch (e) {
        console.error("Failed to clear MCP env secrets keyring:", e);
      }

      // 2. Wipe the Tauri plugin store (conversations, theme, config keys, etc.)
      try {
        await clearStoreData();
      } catch (e) {
        console.error("Failed to clear Tauri store data:", e);
      }

      // 3. Delete config files in AppData (config.json, search_config.json, mcp_config.json, sythoria-store.json)
      try {
        await invoke("wipe_config_files");
      } catch (e) {
        console.error("Failed to wipe config files:", e);
      }

      // 4. Wipe localStorage
      localStorage.clear();

      useUIStore.getState().setHasStarted(false);
      window.location.reload();
    } catch (e) {
      console.error(e);
      addToast("Failed to wipe application data", "error");
    }
  };

  return (
    <>
      <div>
        <h3 className="text-sm font-semibold text-text-primary mb-1">Privacy & Security</h3>
        <p className="text-xs text-text-muted">
          Manage credential safety, activity logs, screen recordings, and local data destruction
        </p>
      </div>

      {/* 1. Keychain and Local Storage Status */}
      <div className="bg-surface border border-border rounded-xl p-4 space-y-4 shadow-sm">
        <h4 className="text-xs font-medium text-text-muted uppercase tracking-wider">Data Security</h4>
        <p className="text-xs text-text-secondary leading-relaxed">
          Sythoria stores all configurations and messages locally on your device. It does not run cloud backups,
          telemetry trackers, or send analytics data.
        </p>
        <div className="flex items-start gap-3 p-3 bg-emerald-500/10 dark:bg-emerald-500/5 border border-emerald-500/20 rounded-lg text-emerald-700 dark:text-emerald-400 text-xs">
          <ShieldCheck size={18} className="shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold block mb-0.5">Secure Keychain Protection</span>
            <span className="opacity-90">
              Your API keys, Search keys, and MCP environmental variables are secured inside your OS-level secure
              credential vault (macOS Keychain, Windows Credential Manager, or Linux Secret Service/Keyring) and are
              never written to disk in plaintext.
            </span>
          </div>
        </div>
      </div>

      {/* 2. Event Logging Control */}
      <div className="bg-surface border border-border rounded-xl p-4 space-y-4 shadow-sm">
        <h4 className="text-xs font-medium text-text-muted uppercase tracking-wider">Local Activity Logging</h4>
        <div className="space-y-4 pt-1">
          <Switch
            checked={isLoggingEnabled}
            onChange={setIsLoggingEnabled}
            label="Enable local event logging"
            description="Collects troubleshooting indicators and warnings in memory during active sessions"
          />
          <div className="h-px bg-border/50" />
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-1">
            <div>
              <span className="text-sm font-medium text-text-primary block">Wipe event log history</span>
              <span className="text-xs text-text-muted">
                Clear all troubleshooting events currently stored in memory ({logBuffer.length} entries)
              </span>
            </div>
            <motion.button
              type="button"
              onClick={handleClearLogs}
              whileHover={{ scale: motionTokens.scale.pop }}
              whileTap={{ scale: motionTokens.scale.press }}
              transition={springs.snappy}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-input hover:bg-hover border border-border text-text-primary text-sm font-medium transition-colors shadow-sm min-h-[40px] shrink-0"
            >
              <FileText size={16} />
              <span>Clear Logs</span>
            </motion.button>
          </div>
        </div>
      </div>

      {/* 3. Appshot Privacy Settings */}
      <div className="bg-surface border border-border rounded-xl p-4 space-y-4 shadow-sm">
        <h4 className="text-xs font-medium text-text-muted uppercase tracking-wider">Screen Recording Privacy</h4>
        <div className="space-y-4 pt-1">
          <Switch
            checked={appshotConfig.enabled && hasAppshotPermission}
            onChange={(val) => updateAppshotConfig({ enabled: val })}
            disabled={!hasAppshotPermission}
            label="Enable screen capture utility"
            description="Allows Sythoria to take frame screenshots of your monitors when requested"
          />

          {!hasAppshotPermission && (
            <div className="flex items-start justify-between gap-3 p-3 bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 rounded-lg text-xs">
              <div className="flex gap-2">
                <ShieldAlert size={16} className="shrink-0 mt-0.5" />
                <span>macOS Screen Recording permission is required for appshots. Enable it in System Settings.</span>
              </div>
              <button
                onClick={requestAppshotPermission}
                className="text-amber-700 dark:text-amber-300 font-semibold hover:underline"
              >
                Grant
              </button>
            </div>
          )}

          <div className="h-px bg-border/50" />

          <Switch
            checked={appshotConfig.autoCleanEnabled}
            onChange={(val) => updateAppshotConfig({ autoCleanEnabled: val })}
            label="Automatically prune screen captures"
            description="Prunes capture directories based on count, folder size, or age rules"
          />

          <AnimatePresence initial={false}>
            {appshotConfig.autoCleanEnabled && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={springs.gentle}
                className="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-4 border-l border-border/80 overflow-hidden"
              >
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-text-muted">Pruning Rule</label>
                  <select
                    value={appshotConfig.autoCleanType}
                    onChange={(e) => updateAppshotConfig({ autoCleanType: e.target.value as any })}
                    className="w-full px-3 py-1.5 rounded-lg bg-input border border-border text-sm text-text-primary focus:outline-none focus:border-accent"
                  >
                    <option value="count">Keep Max File Count</option>
                    <option value="size">Limit Folder Size (MB)</option>
                    <option value="age">Limit File Age (Days)</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-text-muted">Limit Value</label>
                  <input
                    type="number"
                    min="1"
                    value={appshotConfig.autoCleanValue}
                    onChange={(e) => updateAppshotConfig({ autoCleanValue: parseInt(e.target.value, 10) || 1 })}
                    className="w-full px-3 py-1.5 rounded-lg bg-input border border-border text-sm text-text-primary focus:outline-none"
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="h-px bg-border/50" />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-1">
            <div>
              <span className="text-sm font-medium text-text-primary block">Wipe screen capture gallery</span>
              <span className="text-xs text-text-muted">
                Delete all screenshots stored in the capture directory ({recentAppshots.length} files found)
              </span>
            </div>
            <motion.button
              type="button"
              onClick={clearAllAppshots}
              disabled={recentAppshots.length === 0}
              whileHover={recentAppshots.length > 0 ? { scale: motionTokens.scale.pop } : undefined}
              whileTap={recentAppshots.length > 0 ? { scale: motionTokens.scale.press } : undefined}
              transition={springs.snappy}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-red-500/20 text-red-500 hover:bg-red-500/5 text-sm font-medium transition-colors shadow-sm min-h-[40px] disabled:opacity-40 disabled:cursor-not-allowed shrink-0 font-medium"
            >
              <Camera size={16} />
              <span>Clear Gallery</span>
            </motion.button>
          </div>
        </div>
      </div>

      {/* Network Settings */}
      <div className="bg-surface border border-border rounded-xl p-4 space-y-4 shadow-sm">
        <div className="flex items-center gap-2">
          <Network size={16} className="text-text-muted" />
          <h4 className="text-xs font-medium text-text-muted uppercase tracking-wider">Network Settings</h4>
        </div>
        <div className="space-y-4 pt-1">
          <Switch
            checked={disableBgActivity}
            onChange={setDisableBgActivity}
            label="Disable background activity"
            description="Stops periodic background connectivity checks and status polling. Hides all network labels and status indicators in the interface."
          />
          <div className="h-px bg-border/50" />
          <Switch
            checked={strictSsl}
            onChange={setStrictSsl}
            label="Strict SSL/TLS Verification"
            description="Enforce valid SSL certificates for all API connections and endpoints. If disabled, certificate validity will not be checked."
          />
          <div className="h-px bg-border/50" />
          <div className="space-y-1">
            <span className="text-sm font-medium text-text-primary block">Blocked IPs / Hostnames</span>
            <span className="text-xs text-text-muted block">
              Specify IP addresses or hostnames that are restricted from network access (one per line).
            </span>
            <textarea
              value={blockedHostsText}
              onChange={(e) => handleBlockedHostsChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g. localhost&#10;127.0.0.1"
              rows={4}
              className="w-full px-3 py-2 mt-1 rounded-lg bg-input border border-border text-sm text-text-primary focus:outline-none focus:border-accent font-mono"
            />
          </div>
          <div className="h-px bg-border/50" />
          <Switch
            checked={offlineMode}
            onChange={setOfflineMode}
            label="Offline Mode"
            description="Force the app to run completely offline. Blocks all outgoing requests."
          />
        </div>
      </div>

      {/* 4. Data destruct */}
      <div className="bg-surface border border-border rounded-xl p-4 space-y-4 shadow-sm border-red-500/20 dark:border-red-500/10">
        <h4 className="text-xs font-medium text-red-500 uppercase tracking-wider">Danger Zone</h4>
        <div className="space-y-4 pt-1">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-1">
            <div>
              <span className="text-sm font-medium text-text-primary block">Wipe all application data</span>
              <span className="text-xs text-text-muted">
                Delete all conversation histories, keychains, and app configurations permanently
              </span>
            </div>
            <motion.button
              type="button"
              onClick={() => setIsConfirmWipe1Open(true)}
              whileHover={{ scale: motionTokens.scale.pop }}
              whileTap={{ scale: motionTokens.scale.press }}
              transition={springs.snappy}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-600 dark:text-red-400 text-sm font-medium transition-colors shadow-sm min-h-[40px] shrink-0 font-medium"
            >
              <Trash2 size={16} />
              <span>Wipe Data</span>
            </motion.button>
          </div>
        </div>
      </div>

      {/* Double Confirmation Modals */}
      <ConfirmModal
        isOpen={isConfirmWipe1Open}
        title="Confirm Reset"
        message="Are you sure you want to clear all application data? This action will log you out, delete local configurations, and clear active configurations."
        confirmText="Proceed"
        cancelText="Cancel"
        onConfirm={() => {
          setIsConfirmWipe1Open(false);
          setIsConfirmWipe2Open(true);
        }}
        onCancel={() => setIsConfirmWipe1Open(false)}
        variant="danger"
      />

      <ConfirmModal
        isOpen={isConfirmWipe2Open}
        title="Final Warning"
        message="This is a permanent, non-reversible action. Your chat history, API keys, and connection credentials will be completely erased from both disk and system keychain. Do you wish to continue?"
        confirmText="Erase All Data"
        cancelText="Keep Data"
        onConfirm={handleWipeData}
        onCancel={() => setIsConfirmWipe2Open(false)}
        variant="danger"
      />
    </>
  );
}

export default PrivacySection;
