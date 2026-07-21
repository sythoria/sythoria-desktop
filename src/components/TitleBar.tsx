import { useState, useRef, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import { useKeybindStore } from "../store/useKeybindStore";
import { useChatStore } from "../store/useChatStore";
import { useUIStore } from "../store/useUIStore";
import { generateId } from "../utils/generateId";
import { uiToast } from "../store/helpers";

type MenuType = "sythoria" | "file" | "view" | "window" | null;

const MenuButton = ({
  id,
  label,
  activeMenu,
  handleMenuClick,
}: {
  id: MenuType;
  label: string;
  activeMenu: MenuType;
  handleMenuClick: (menu: MenuType) => void;
}) => (
  <button
    onClick={() => handleMenuClick(id)}
    className={`px-2 py-1 rounded-md transition-colors ${
      activeMenu === id ? "bg-hover text-text-primary" : "hover:bg-hover hover:text-text-primary"
    }`}
  >
    {label}
  </button>
);

const DropdownItem = ({
  label,
  shortcut,
  onClick,
  setActiveMenu,
}: {
  label: string;
  shortcut?: string;
  onClick?: () => void;
  setActiveMenu: (menu: MenuType) => void;
}) => (
  <button
    onClick={() => {
      onClick?.();
      setActiveMenu(null);
    }}
    className="w-full text-left px-3 py-1.5 text-sm hover:bg-hover text-text-secondary hover:text-text-primary transition-colors flex justify-between items-center"
  >
    <span>{label}</span>
    {shortcut && <span className="text-text-muted text-xs ml-4">{shortcut}</span>}
  </button>
);

export function TitleBar() {
  const isMac = typeof window !== "undefined" && window.navigator.userAgent.includes("Mac");

  const appWindow = getCurrentWindow();
  const [activeMenu, setActiveMenu] = useState<MenuType>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const { zoomIn, zoomOut, zoomReset } = useKeybindStore();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setActiveMenu(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleMenuClick = (menu: MenuType) => {
    setActiveMenu(activeMenu === menu ? null : menu);
  };

  const handleCreateChat = () => {
    const id = generateId();
    useChatStore.getState().setActiveId(id);
    useUIStore.getState().setView("chat");
    setActiveMenu(null);
  };

  if (isMac) return null;

  return (
    <div
      data-tauri-drag-region
      className="h-[32px] w-full flex justify-between items-center select-none shrink-0 border-b border-border/30 bg-surface z-50 relative"
    >
      <div ref={menuRef} className="flex items-center h-full px-2 text-xs font-medium text-text-muted relative">
        <MenuButton id="sythoria" label="Sythoria" activeMenu={activeMenu} handleMenuClick={handleMenuClick} />
        <MenuButton id="file" label="File" activeMenu={activeMenu} handleMenuClick={handleMenuClick} />
        <MenuButton id="view" label="View" activeMenu={activeMenu} handleMenuClick={handleMenuClick} />
        <MenuButton id="window" label="Window" activeMenu={activeMenu} handleMenuClick={handleMenuClick} />

        {activeMenu === "sythoria" && (
          <div className="popup-surface absolute top-[32px] left-2 w-48 border border-border/30 rounded-md shadow-lg py-1 flex flex-col z-50">
            <DropdownItem label="Version 0.3.0" setActiveMenu={setActiveMenu} />
            <DropdownItem
              label="Check for Updates"
              onClick={() => uiToast("You are on the latest version", "success")}
              setActiveMenu={setActiveMenu}
            />
          </div>
        )}

        {activeMenu === "file" && (
          <div className="popup-surface absolute top-[32px] left-[70px] w-56 border border-border/30 rounded-md shadow-lg py-1 flex flex-col z-50">
            <DropdownItem
              label="New Conversation"
              shortcut="Ctrl+Shift+O"
              onClick={handleCreateChat}
              setActiveMenu={setActiveMenu}
            />
            <DropdownItem
              label="Create Project"
              onClick={() => {
                useUIStore.getState().setView("settings");
                useUIStore.getState().setActiveSection("projects");
              }}
              setActiveMenu={setActiveMenu}
            />
            <DropdownItem
              label="Command Palette"
              shortcut="Ctrl+Shift+P"
              onClick={() => useUIStore.getState().toggleCommandPalette()}
              setActiveMenu={setActiveMenu}
            />
          </div>
        )}

        {activeMenu === "view" && (
          <div className="popup-surface absolute top-[32px] left-[110px] w-48 border border-border/30 rounded-md shadow-lg py-1 flex flex-col z-50">
            <DropdownItem label="Zoom In" onClick={zoomIn} setActiveMenu={setActiveMenu} />
            <DropdownItem label="Zoom Out" onClick={zoomOut} setActiveMenu={setActiveMenu} />
            <DropdownItem label="Reset Zoom" onClick={zoomReset} setActiveMenu={setActiveMenu} />
          </div>
        )}

        {activeMenu === "window" && (
          <div className="popup-surface absolute top-[32px] left-[150px] w-48 border border-border/30 rounded-md shadow-lg py-1 flex flex-col z-50">
            <DropdownItem label="Minimize" onClick={() => appWindow.minimize()} setActiveMenu={setActiveMenu} />
            <DropdownItem label="Maximize" onClick={() => appWindow.toggleMaximize()} setActiveMenu={setActiveMenu} />
            <DropdownItem label="Close" onClick={() => appWindow.close()} setActiveMenu={setActiveMenu} />
          </div>
        )}
      </div>

      <div className="flex h-full z-50 relative">
        <button
          onClick={() => appWindow.minimize()}
          className="inline-flex justify-center items-center w-11 h-full hover:bg-hover text-text-muted hover:text-text-primary transition-colors cursor-default"
          tabIndex={-1}
        >
          <Minus size={16} strokeWidth={1.5} />
        </button>
        <button
          onClick={() => appWindow.toggleMaximize()}
          className="inline-flex justify-center items-center w-11 h-full hover:bg-hover text-text-muted hover:text-text-primary transition-colors cursor-default"
          tabIndex={-1}
        >
          <Square size={13} strokeWidth={1.5} />
        </button>
        <button
          onClick={() => appWindow.close()}
          className="inline-flex justify-center items-center w-11 h-full hover:bg-red-500 hover:text-white text-text-muted transition-colors cursor-default"
          tabIndex={-1}
        >
          <X size={16} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}
