import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, RefreshCw } from "lucide-react";
import { openExternalUrl } from "../../../utils/externalUrl";

export interface ComputerUseSetupStatus {
  ready: boolean;
  busy: boolean;
}

interface SetupReport {
  platform: string;
  ready: boolean;
  checks: { label: string; passed: boolean; message: string }[];
}

export function ComputerUseSetup({
  onStatus,
  disabled,
}: {
  onStatus: (status: ComputerUseSetupStatus) => void;
  disabled: boolean;
}) {
  const [report, setReport] = useState<SetupReport | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    onStatus({ ready: false, busy: true });
    void invoke<SetupReport>("computer_use_check_setup", { prepare: false })
      .then((result) => {
        if (active) setReport(result);
      })
      .catch(() => {
        if (active) setError("Could not check this computer. Reopen Sythoria and try again.");
      })
      .finally(() => {
        if (active) {
          setBusy(false);
          onStatus({ ready: false, busy: false });
        }
      });
    return () => {
      active = false;
    };
  }, [onStatus]);

  // Results from a closed setup must never authorize a later modal.
  const lifetime = useRef(false);
  useEffect(() => {
    lifetime.current = true;
    return () => {
      lifetime.current = false;
    };
  }, [lifetime]);

  const prepare = async () => {
    setBusy(true);
    setError(null);
    onStatus({ ready: false, busy: true });
    try {
      const result = await invoke<SetupReport>("computer_use_check_setup", { prepare: true });
      if (!lifetime.current) return;
      setReport(result);
      onStatus({ ready: result.ready, busy: false });
    } catch {
      if (!lifetime.current) return;
      setError("Setup could not finish. Check your internet connection, then try again.");
      onStatus({ ready: false, busy: false });
    } finally {
      if (lifetime.current) setBusy(false);
    }
  };

  return (
    <div className="space-y-4 text-xs">
      <p className="text-text-secondary">
        Computer Use can read and control your desktop apps. App text and screenshots may be sent to your selected AI
        provider. Use a model with image input for screenshot tasks.
      </p>
      <ol className="list-decimal pl-4 space-y-2 text-text-secondary">
        <li>
          Install Node.js 18 or later with npm included, then reopen Sythoria.{" "}
          <button
            type="button"
            onClick={() => void openExternalUrl("https://nodejs.org/en/download")}
            className="text-accent hover:underline"
          >
            Download Node.js
          </button>
        </li>
        <li>Set up &amp; check downloads Open Computer Use 0.3.6 through npm. No account or API key is needed.</li>
        <li>
          {report?.platform === "macos"
            ? "Requires macOS 14+. In the Open Computer Use setup window, allow Accessibility and Screen Recording for Open Computer Use in System Settings → Privacy & Security. If macOS asks, quit and reopen Open Computer Use, then check again."
            : report?.platform === "linux"
              ? "Use a signed-in desktop with Python 3, PyGObject, AT-SPI2, D-Bus, and GTK 3. On Ubuntu/Debian: sudo apt install python3-gi gir1.2-atspi-2.0 gir1.2-gtk-3.0 at-spi2-core. Enable desktop accessibility. Screenshots and coordinate actions may be limited on Wayland."
              : report?.platform === "windows"
                ? "Use a signed-in Windows desktop with Windows PowerShell and UI Automation. Apps running as administrator may be inaccessible; use ordinary app windows."
                : "macOS requires version 14+ and Accessibility / Screen Recording permissions. Windows and Linux require a signed-in desktop session."}
        </li>
        <li>
          When checks pass, connect and add Computer Use from the composer tools menu to the chat you want it to
          control.
        </li>
      </ol>
      {report && (
        <ul aria-label="Computer Use setup checks" className="space-y-2">
          {report.checks.map((check) => (
            <li key={check.label} className="flex items-start gap-2">
              {check.passed ? (
                <Check size={14} className="text-emerald-500 shrink-0" />
              ) : (
                <span className="text-rose-500 shrink-0">!</span>
              )}
              <div>
                <span className="font-medium text-text-primary">{check.label}</span>
                <p className={check.passed ? "text-text-muted" : "text-rose-500"}>{check.message}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-rose-500">
          {error}
        </p>
      )}
      {report?.ready && (
        <p role="status" className="text-emerald-500">
          Setup checks passed. You can connect Computer Use.
        </p>
      )}
      <button
        type="button"
        onClick={() => void prepare()}
        disabled={busy || disabled}
        className="w-full py-2 rounded-lg border border-border text-text-primary hover:bg-hover disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {busy && <RefreshCw size={14} className="animate-spin" />}
        {busy ? "Checking setup…" : "Set up & check"}
      </button>
      <p className="text-text-muted">
        Once connected, Computer Use reconnects automatically when Sythoria restarts. Each connection checks setup
        again.
      </p>
      <button
        type="button"
        onClick={() => void openExternalUrl("https://github.com/ifuryst/open-codex-computer-use")}
        className="text-accent hover:underline"
      >
        Setup documentation
      </button>
    </div>
  );
}
