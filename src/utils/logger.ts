let tauriLogAvailable = false;

async function checkTauriLog(): Promise<boolean> {
  if (tauriLogAvailable) return true;
  try {
    await import("@tauri-apps/plugin-log");
    tauriLogAvailable = true;
  } catch {
    tauriLogAvailable = false;
  }
  return tauriLogAvailable;
}

checkTauriLog();

export async function logError(message: string, error?: unknown): Promise<void> {
  const detail = error ? ` | ${error instanceof Error ? error.message : String(error)}` : "";
  const full = `${message}${detail}`;
  console.error(full);
  if (tauriLogAvailable) {
    try {
      const { error: logErr } = await import("@tauri-apps/plugin-log");
      await logErr(full);
    } catch {
      /* Tauri log plugin not available */
    }
  }
}

export async function logInfo(message: string): Promise<void> {
  console.info(message);
  if (tauriLogAvailable) {
    try {
      const { info } = await import("@tauri-apps/plugin-log");
      await info(message);
    } catch {
      /* Tauri log plugin not available */
    }
  }
}
