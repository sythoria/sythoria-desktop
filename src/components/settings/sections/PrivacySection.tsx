import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ShieldCheck, ShieldAlert, FileText, Trash2, Camera, Network, ChevronDown } from "lucide-react";
import { Switch } from "../../ui/Switch";
import { ConfirmModal } from "../../ui/Modal";
import { useUIStore } from "../../../store/useUIStore";
import { useAppshotStore } from "../../../store/useAppshotStore";
import { clearLogs } from "../../../utils/logger";
import { clearStoreData, DEFAULT_BLOCKED_HOSTS } from "../../../utils/storage";
import { invoke } from "@tauri-apps/api/core";
import { springs, motionTokens } from "../../../lib/motion-tokens";
import { useTranslation } from "../../../utils/i18n";

export function PrivacySection() {
  const { t } = useTranslation();
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
    addToast(t("settings.privacy.clearLogsSuccess"), "success");
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
      addToast(t("settings.privacy.wipeDataFailed"), "error");
    }
  };

  return (
    <>
      <div>
        <h3 className="text-sm font-semibold text-text-primary mb-1">{t("settings.privacy.title")}</h3>
        <p className="text-xs text-text-muted">{t("settings.privacy.subtitle")}</p>
      </div>

      {/* 1. Keychain and Local Storage Status */}
      <div className="bg-surface border border-border rounded-xl p-4 space-y-4 shadow-sm">
        <h4 className="text-xs font-medium text-text-muted uppercase tracking-wider">
          {t("settings.privacy.dataSecurity")}
        </h4>
        <p className="text-xs text-text-secondary leading-relaxed">{t("settings.privacy.dataSecurityDesc")}</p>
        <div className="flex items-start gap-3 p-3 bg-emerald-500/10 dark:bg-emerald-500/5 border border-emerald-500/20 rounded-lg text-emerald-700 dark:text-emerald-400 text-xs">
          <ShieldCheck size={18} className="shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold block mb-0.5">{t("settings.privacy.keychainTitle")}</span>
            <span className="opacity-90">{t("settings.privacy.keychainDesc")}</span>
          </div>
        </div>
      </div>

      {/* 2. Event Logging Control */}
      <div className="bg-surface border border-border rounded-xl p-4 space-y-4 shadow-sm">
        <h4 className="text-xs font-medium text-text-muted uppercase tracking-wider">
          {t("settings.privacy.loggingTitle")}
        </h4>
        <div className="space-y-4 pt-1">
          <Switch
            checked={isLoggingEnabled}
            onChange={setIsLoggingEnabled}
            label={t("settings.privacy.enableLogging")}
            description={t("settings.privacy.enableLoggingDesc")}
          />
          <div className="h-px bg-border/50" />
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-1">
            <div>
              <span className="text-sm font-medium text-text-primary block">{t("settings.privacy.wipeLogTitle")}</span>
              <span className="text-xs text-text-muted">
                {t("settings.privacy.wipeLogDesc", { count: String(logBuffer.length) })}
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
              <span>{t("settings.privacy.clearLogsBtn")}</span>
            </motion.button>
          </div>
        </div>
      </div>

      {/* 3. Appshot Privacy Settings */}
      <div className="bg-surface border border-border rounded-xl p-4 space-y-4 shadow-sm">
        <h4 className="text-xs font-medium text-text-muted uppercase tracking-wider">
          {t("settings.privacy.screenTitle")}
        </h4>
        <div className="space-y-4 pt-1">
          <Switch
            checked={appshotConfig.enabled && hasAppshotPermission}
            onChange={(val) => updateAppshotConfig({ enabled: val })}
            disabled={!hasAppshotPermission}
            label={t("settings.privacy.enableScreen")}
            description={t("settings.privacy.enableScreenDesc")}
          />

          {!hasAppshotPermission && (
            <div className="bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 rounded-xl p-4 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm">
              <div className="flex items-start gap-2.5">
                <ShieldAlert size={18} className="shrink-0 mt-0.5 text-amber-500" />
                <div>
                  <span className="font-semibold block mb-0.5 text-sm text-amber-700 dark:text-amber-300">
                    {t("settings.privacy.screenPermRequired")}
                  </span>
                  <span className="opacity-90 leading-relaxed block">{t("settings.privacy.screenPermDesc")}</span>
                  <span className="opacity-75 leading-relaxed block mt-1.5 font-medium">
                    {t("settings.privacy.screenPermNote")}
                  </span>
                </div>
              </div>
              <motion.button
                whileHover={{ scale: motionTokens.scale.pop }}
                whileTap={{ scale: motionTokens.scale.press }}
                transition={springs.snappy}
                className="px-4 py-2 rounded-lg bg-amber-500 text-white font-medium hover:bg-amber-600 transition-colors shadow-sm self-stretch sm:self-center text-center shrink-0"
                onClick={async () => {
                  const ok = await requestAppshotPermission();
                  if (ok) {
                    addToast(t("settings.privacy.permGranted"), "success");
                  } else {
                    addToast(t("settings.privacy.permDenied"), "info");
                  }
                }}
              >
                {t("settings.privacy.grantPermissionBtn")}
              </motion.button>
            </div>
          )}

          <div className="h-px bg-border/50" />

          <div>
            <Switch
              checked={appshotConfig.autoCleanEnabled}
              onChange={(val) => updateAppshotConfig({ autoCleanEnabled: val })}
              label={t("settings.privacy.pruneScreen")}
              description={t("settings.privacy.pruneScreenDesc")}
            />

            <AnimatePresence initial={false}>
              {appshotConfig.autoCleanEnabled && (
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-4 border-l border-border/80 pt-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-medium text-text-muted">
                        {t("settings.privacy.pruningRule")}
                      </label>
                      <div className="relative w-full">
                        <select
                          value={appshotConfig.autoCleanType}
                          onChange={(e) => updateAppshotConfig({ autoCleanType: e.target.value as any })}
                          className="w-full px-3 py-1.5 pr-8 appearance-none rounded-lg border border-input-border bg-input text-sm text-text-primary focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none transition-colors"
                        >
                          <option value="count">{t("settings.privacy.keepMaxCount")}</option>
                          <option value="size">{t("settings.privacy.limitFolderSize")}</option>
                          <option value="age">{t("settings.privacy.limitFileAge")}</option>
                        </select>
                        <ChevronDown
                          size={14}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
                          aria-hidden="true"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-medium text-text-muted">
                        {t("settings.privacy.limitValue")}
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={appshotConfig.autoCleanValue}
                        onChange={(e) => updateAppshotConfig({ autoCleanValue: parseInt(e.target.value, 10) || 1 })}
                        className="w-full px-3 py-1.5 rounded-lg border border-input-border bg-input text-sm text-text-primary focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none transition-colors"
                      />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="h-px bg-border/50" />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-1">
            <div>
              <span className="text-sm font-medium text-text-primary block">
                {t("settings.privacy.wipeGalleryTitle")}
              </span>
              <span className="text-xs text-text-muted">
                {t("settings.privacy.wipeGalleryDesc", { count: String(recentAppshots.length) })}
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
              <span>{t("settings.privacy.clearGalleryBtn")}</span>
            </motion.button>
          </div>
        </div>
      </div>

      {/* Network Settings */}
      <div className="bg-surface border border-border rounded-xl p-4 space-y-4 shadow-sm">
        <div className="flex items-center gap-2">
          <Network size={16} className="text-text-muted" />
          <h4 className="text-xs font-medium text-text-muted uppercase tracking-wider">
            {t("settings.privacy.networkTitle")}
          </h4>
        </div>
        <div className="space-y-4 pt-1">
          <Switch
            checked={disableBgActivity}
            onChange={setDisableBgActivity}
            label={t("settings.privacy.disableBg")}
            description={t("settings.privacy.disableBgDesc")}
          />
          <div className="h-px bg-border/50" />
          <Switch
            checked={strictSsl}
            onChange={setStrictSsl}
            label={t("settings.privacy.strictSsl")}
            description={t("settings.privacy.strictSslDesc")}
          />
          <div className="h-px bg-border/50" />
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-text-primary block">{t("settings.privacy.blockedHosts")}</span>
              <button
                type="button"
                onClick={() => handleBlockedHostsChange(DEFAULT_BLOCKED_HOSTS.join("\n"))}
                className="text-xs text-accent hover:text-accent-hover font-semibold transition-colors flex items-center gap-1 cursor-pointer select-none"
              >
                {t("settings.privacy.resetBlockedHostsBtn") || "Reset to Defaults"}
              </button>
            </div>
            <span className="text-xs text-text-muted block">{t("settings.privacy.blockedHostsDesc")}</span>
            <textarea
              value={blockedHostsText}
              onChange={(e) => handleBlockedHostsChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("settings.privacy.blockedHostsPlaceholder")}
              rows={4}
              className="w-full px-3 py-2 mt-1 rounded-lg border border-input-border bg-input text-sm text-text-primary focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none transition-colors font-mono"
            />
          </div>
          <div className="h-px bg-border/50" />
          <Switch
            checked={offlineMode}
            onChange={setOfflineMode}
            label={t("settings.privacy.offlineMode")}
            description={t("settings.privacy.offlineModeDesc")}
          />
        </div>
      </div>

      {/* 4. Data destruct */}
      <div className="bg-surface border border-border rounded-xl p-4 space-y-4 shadow-sm border-red-500/20 dark:border-red-500/10">
        <h4 className="text-xs font-medium text-red-500 uppercase tracking-wider">
          {t("settings.privacy.dangerZone")}
        </h4>
        <div className="space-y-4 pt-1">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-1">
            <div>
              <span className="text-sm font-medium text-text-primary block">{t("settings.privacy.wipeAllData")}</span>
              <span className="text-xs text-text-muted">{t("settings.privacy.wipeAllDataDesc")}</span>
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
              <span>{t("settings.privacy.wipeDataBtn")}</span>
            </motion.button>
          </div>
        </div>
      </div>

      {/* Double Confirmation Modals */}
      <ConfirmModal
        isOpen={isConfirmWipe1Open}
        title={t("settings.privacy.confirmResetTitle")}
        message={t("settings.privacy.confirmResetMessage")}
        confirmText={t("settings.privacy.proceed")}
        cancelText={t("common.cancel")}
        onConfirm={() => {
          setIsConfirmWipe1Open(false);
          setIsConfirmWipe2Open(true);
        }}
        onCancel={() => setIsConfirmWipe1Open(false)}
        variant="danger"
      />

      <ConfirmModal
        isOpen={isConfirmWipe2Open}
        title={t("settings.privacy.finalWarningTitle")}
        message={t("settings.privacy.finalWarningMessage")}
        confirmText={t("settings.privacy.eraseAllData")}
        cancelText={t("settings.privacy.keepData")}
        onConfirm={handleWipeData}
        onCancel={() => setIsConfirmWipe2Open(false)}
        variant="danger"
      />
    </>
  );
}


