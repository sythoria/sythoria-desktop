import { getCurrentWindow } from "@tauri-apps/api/window";

export function FakeTrafficLights() {
  const handleClose = async () => {
    try {
      const win = getCurrentWindow();
      await win.close();
    } catch (e) {
      console.error("Failed to close window:", e);
    }
  };

  const handleMinimize = async () => {
    try {
      const win = getCurrentWindow();
      await win.minimize();
    } catch (e) {
      console.error("Failed to minimize window:", e);
    }
  };

  const handleMaximize = async () => {
    try {
      const win = getCurrentWindow();
      const maximized = await win.isMaximized();
      if (maximized) {
        await win.unmaximize();
      } else {
        await win.maximize();
      }
    } catch (e) {
      console.error("Failed to toggle maximize:", e);
    }
  };

  return (
    <div className="flex items-center gap-[8px] absolute left-[8px] top-[18px] z-50 select-none group">
      {/* Close button (Red) */}
      <button
        onClick={handleClose}
        className="w-[14px] h-[14px] rounded-full bg-[#ff5f56] hover:bg-[#ff5f56]/90 border border-[#e0443e]/40 flex items-center justify-center transition-colors focus:outline-none relative"
        aria-label="Close Window"
        title="Close"
      >
        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-[#4c0002] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none select-none pb-[1.5px]">
          ×
        </span>
      </button>

      {/* Minimize button (Yellow) */}
      <button
        onClick={handleMinimize}
        className="w-[14px] h-[14px] rounded-full bg-[#ffbd2e] hover:bg-[#ffbd2e]/90 border border-[#dca018]/40 flex items-center justify-center transition-colors focus:outline-none relative"
        aria-label="Minimize Window"
        title="Minimize"
      >
        <span className="absolute inset-0 flex items-center justify-center text-[12px] font-bold text-[#5c3e00] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none select-none pb-[2px]">
          -
        </span>
      </button>

      {/* Maximize button (Green) */}
      <button
        onClick={handleMaximize}
        className="w-[14px] h-[14px] rounded-full bg-[#27c93f] hover:bg-[#27c93f]/90 border border-[#1aab29]/40 flex items-center justify-center transition-colors focus:outline-none relative"
        aria-label="Maximize Window"
        title="Maximize"
      >
        <span className="absolute inset-0 flex items-center justify-center text-[7px] font-bold text-[#024d06] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none select-none">
          ↕
        </span>
      </button>
    </div>
  );
}
