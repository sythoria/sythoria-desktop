let tauriLogChecked = false;
let tauriLogAvailable = false;

async function checkTauriLog(): Promise<boolean> {
  if (tauriLogChecked) return tauriLogAvailable;
  try {
    await import("@tauri-apps/api/log");
    tauriLogAvailable = true;
  } catch {
    tauriLogAvailable = false;
  }
  tauriLogChecked = true;
  return tauriLogAvailable;
}

checkTauriLog();

export async function logError(message: string, error?: unknown): Promise<void> {
  const detail = error ? ` | ${error instanceof Error ? error.message : String(error)}` : "";
  const full = `${message}${detail}`;
  console.error(full);
  if (tauriLogAvailable) {
    try {
      const { log } = await import("@tauri-apps/api/log");
      await log.error(full);
    } catch {}
  }
}

export async function logInfo(message: string): Promise<void> {
  console.info(message);
  if (tauriLogAvailable) {
    try {
      const { log } = await import("@tauri-apps/api/log");
      await log.info(message);
    } catch {}
  }
}

export async function logWarn(message: string): Promise<void> {
  console.warn(message);
  if (tauriLogAvailable) {
    try {
      const { log } = await import("@tauri-apps/api/log");
      await log.warn(message);
    } catch {}
  }
}
