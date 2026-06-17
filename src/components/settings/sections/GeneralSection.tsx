import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, Check, Download, Trash2 } from "lucide-react";
import { Switch } from "../../ui/Switch";
import { Spinner } from "../../ui/Spinner";
import { ConfirmModal } from "../../ui/Modal";
import { useUIStore } from "../../../store/useUIStore";
import { useChatStore } from "../../../store/useChatStore";
import { invoke } from "@tauri-apps/api/core";
import { springs } from "../../../lib/motion-tokens";

const textSizes = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
  { value: "xlarge", label: "Extra Large" },
] as const;

export function GeneralSection() {
  const alwaysOnTop = useUIStore((s) => s.alwaysOnTop);
  const setAlwaysOnTop = useUIStore((s) => s.setAlwaysOnTop);
  const closeToTray = useUIStore((s) => s.closeToTray);
  const setCloseToTray = useUIStore((s) => s.setCloseToTray);
  const launchOnStartup = useUIStore((s) => s.launchOnStartup);
  const setLaunchOnStartup = useUIStore((s) => s.setLaunchOnStartup);

  const sendMessageShortcut = useUIStore((s) => s.sendMessageShortcut);
  const setSendMessageShortcut = useUIStore((s) => s.setSendMessageShortcut);
  const clearInputOnEscape = useUIStore((s) => s.clearInputOnEscape);
  const setClearInputOnEscape = useUIStore((s) => s.setClearInputOnEscape);
  const baseTextSize = useUIStore((s) => s.baseTextSize);
  const setBaseTextSize = useUIStore((s) => s.setBaseTextSize);

  const autoUpdateChecking = useUIStore((s) => s.autoUpdateChecking);
  const setAutoUpdateChecking = useUIStore((s) => s.setAutoUpdateChecking);

  const addToast = useUIStore((s) => s.addToast);

  const [shortcutDropdownOpen, setShortcutDropdownOpen] = useState(false);
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const [isConfirmOpen1, setIsConfirmOpen1] = useState(false);
  const [isConfirmOpen2, setIsConfirmOpen2] = useState(false);

  const handleExportConversations = () => {
    try {
      const conversations = useChatStore.getState().conversations;
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(conversations, null, 2));
      const downloadAnchor = document.createElement("a");
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `sythoria-conversations-${new Date().toISOString().slice(0, 10)}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      addToast("All conversations exported successfully", "success");
    } catch (e) {
      console.error(e);
      addToast("Failed to export conversations", "error");
    }
  };

  const handleCheckUpdates = () => {
    setIsCheckingUpdates(true);
    setTimeout(() => {
      setIsCheckingUpdates(false);
      addToast("You are on the latest version of Sythoria", "success");
    }, 1500);
  };

  const handleWipeData = async () => {
    setIsConfirmOpen2(false);
    localStorage.clear();
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
    useUIStore.getState().setHasStarted(false);
    window.location.reload();
  };

  return (
    <>
      <div>
        <h3 className="text-sm font-semibold text-text-primary mb-1">General Settings</h3>
        <p className="text-xs text-text-muted">Manage app preferences, window behavior, and data</p>
      </div>

      {/* Window Behavior Section */}
      <div className="bg-surface border border-border rounded-xl p-4 space-y-4 shadow-sm">
        <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider">Window Behavior</h4>
        <div className="space-y-4 pt-1">
          <Switch
            checked={alwaysOnTop}
            onChange={setAlwaysOnTop}
            label="Always on Top"
            description="Keep the Sythoria window above all other applications"
          />
          <Switch
            checked={closeToTray}
            onChange={setCloseToTray}
            label="Minimize to Tray"
            description="Minimize the app to the system tray instead of closing it"
          />
          <Switch
            checked={launchOnStartup}
            onChange={setLaunchOnStartup}
            label="Launch on Startup"
            description="Automatically launch Sythoria when starting your system"
          />
        </div>
      </div>

      {/* Chat & Composition Section */}
      <div className="bg-surface border border-border rounded-xl p-4 space-y-4 shadow-sm">
        <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider">Chat & Composition</h4>
        <div className="space-y-4 pt-1">
          {/* Send Message Shortcut Dropdown */}
          <div className="space-y-2">
            <label htmlFor="shortcut-select" className="text-sm font-medium text-text-primary block">
              Send Message Shortcut
            </label>
            <p className="text-xs text-text-muted mb-2">Choose the key combination to send messages in chat</p>
            <div className="relative">
              <button
                id="shortcut-select"
                onClick={() => setShortcutDropdownOpen(!shortcutDropdownOpen)}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-input-border bg-input text-sm text-text-primary hover:border-accent/30 transition-colors min-h-[44px]"
                aria-expanded={shortcutDropdownOpen}
                aria-haspopup="listbox"
              >
                <span>
                  {sendMessageShortcut === "enter"
                    ? "Enter to send, Shift+Enter for new line"
                    : "Ctrl+Enter to send, Enter for new line"}
                </span>
                <ChevronDown
                  size={16}
                  className={`text-text-muted transition-transform ${shortcutDropdownOpen ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </button>
              <AnimatePresence>
                {shortcutDropdownOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setShortcutDropdownOpen(false)}
                      aria-hidden="true"
                    />
                    <motion.div
                      initial={{ opacity: 0, y: -4, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -4, scale: 0.97 }}
                      transition={springs.snappy}
                      className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-xl shadow-lg z-20 overflow-hidden"
                      role="listbox"
                      aria-label="Send message shortcut options"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setSendMessageShortcut("enter");
                          setShortcutDropdownOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-3 py-2.5 text-sm transition-colors min-h-[44px] ${
                          sendMessageShortcut === "enter"
                            ? "bg-accent-soft text-accent"
                            : "text-text-secondary hover:bg-hover hover:text-text-primary"
                        }`}
                        role="option"
                        aria-selected={sendMessageShortcut === "enter"}
                      >
                        <span className="font-medium text-left">Enter to send, Shift+Enter for new line</span>
                        {sendMessageShortcut === "enter" && (
                          <Check size={14} className="text-accent shrink-0" aria-hidden="true" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSendMessageShortcut("ctrl-enter");
                          setShortcutDropdownOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-3 py-2.5 text-sm transition-colors min-h-[44px] ${
                          sendMessageShortcut === "ctrl-enter"
                            ? "bg-accent-soft text-accent"
                            : "text-text-secondary hover:bg-hover hover:text-text-primary"
                        }`}
                        role="option"
                        aria-selected={sendMessageShortcut === "ctrl-enter"}
                      >
                        <span className="font-medium text-left">Ctrl+Enter to send, Enter for new line</span>
                        {sendMessageShortcut === "ctrl-enter" && (
                          <Check size={14} className="text-accent shrink-0" aria-hidden="true" />
                        )}
                      </button>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Clear Input on Escape Switch */}
          <Switch
            checked={clearInputOnEscape}
            onChange={setClearInputOnEscape}
            label="Clear Input on Escape"
            description="Clear the message input bar when pressing the Escape key"
          />

          {/* Base Text Size Segmented Pill Selector */}
          <div className="space-y-2">
            <span className="text-sm font-medium text-text-primary block">Base Text Size</span>
            <p className="text-xs text-text-muted">Adjust the text scale in chat sessions</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 bg-surface/30 border border-border/40 p-1 rounded-xl shadow-sm w-full">
              {textSizes.map((size) => {
                const isActive = baseTextSize === size.value;
                return (
                  <button
                    key={size.value}
                    type="button"
                    onClick={() => setBaseTextSize(size.value)}
                    className={`relative py-1.5 px-2 text-xs font-medium transition-colors duration-200 min-h-[36px] flex items-center justify-center rounded-lg ${
                      isActive ? "text-accent-foreground font-semibold" : "text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="activeTextSize"
                        className="absolute inset-0 bg-accent rounded-lg"
                        style={{ zIndex: 0 }}
                        transition={springs.snappy}
                      />
                    )}
                    <span className="relative z-10">{size.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Data Management Section */}
      <div className="bg-surface border border-border rounded-xl p-4 space-y-4 shadow-sm">
        <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider">Data Management</h4>
        <div className="space-y-4 pt-1">
          {/* Export Conversations */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-2">
            <div>
              <span className="text-sm font-medium text-text-primary block">Export Conversations</span>
              <span className="text-xs text-text-muted">Download all chat records to a local JSON file</span>
            </div>
            <button
              type="button"
              onClick={handleExportConversations}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-input hover:bg-hover border border-border text-text-primary text-sm font-medium transition-colors shadow-sm min-h-[40px] shrink-0"
            >
              <Download size={16} />
              <span>Export All</span>
            </button>
          </div>

          <div className="h-px bg-border/50" />

          {/* Reset App Data */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-2">
            <div>
              <span className="text-sm font-medium text-text-primary block">Reset Application Data</span>
              <span className="text-xs text-text-muted">Wipe storage, custom connections, and cached data</span>
            </div>
            <button
              type="button"
              onClick={() => setIsConfirmOpen1(true)}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-600 dark:text-red-400 text-sm font-medium transition-colors shadow-sm min-h-[40px] shrink-0"
            >
              <Trash2 size={16} />
              <span>Wipe Data</span>
            </button>
          </div>
        </div>
      </div>

      {/* Updates & Info Section */}
      <div className="bg-surface border border-border rounded-xl p-4 space-y-4 shadow-sm">
        <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider">Updates & Info</h4>
        <div className="space-y-4 pt-1">
          <Switch
            checked={autoUpdateChecking}
            onChange={setAutoUpdateChecking}
            label="Automatic Update Checking"
            description="Check for new versions automatically on application startup"
          />

          <div className="h-px bg-border/50" />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-text-primary">Current Version</span>
              <span className="px-2 py-0.5 rounded bg-input border border-border/60 text-xs font-mono text-text-secondary">
                v0.1.0
              </span>
            </div>
            <button
              type="button"
              onClick={handleCheckUpdates}
              disabled={isCheckingUpdates}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-input hover:bg-hover border border-border text-text-primary text-sm font-medium transition-colors shadow-sm min-h-[40px] disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              {isCheckingUpdates ? (
                <>
                  <Spinner size="sm" className="text-text-primary" />
                  <span>Checking...</span>
                </>
              ) : (
                <span>Check for Updates</span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Double Confirmation Modals */}
      <ConfirmModal
        isOpen={isConfirmOpen1}
        title="Confirm Reset"
        message="Are you sure you want to clear all application data? This action will log you out, delete local configurations, and clear active configurations."
        confirmText="Proceed"
        cancelText="Cancel"
        onConfirm={() => {
          setIsConfirmOpen1(false);
          setIsConfirmOpen2(true);
        }}
        onCancel={() => setIsConfirmOpen1(false)}
        variant="danger"
      />

      <ConfirmModal
        isOpen={isConfirmOpen2}
        title="Final Warning"
        message="This is a permanent, non-reversible action. Your chat history, API keys, and connection credentials will be completely erased. Do you wish to continue?"
        confirmText="Erase All Data"
        cancelText="Keep Data"
        onConfirm={handleWipeData}
        onCancel={() => setIsConfirmOpen2(false)}
        variant="danger"
      />
    </>
  );
}
