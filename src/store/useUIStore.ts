import { create } from "zustand";
import { saveTheme } from "../utils/storage";
import type { Toast } from "../components/ui/Toast";

export type LoadingKey = "init" | "sendMessage" | "checkConnection" | "saveConfig" | "toolExecution";

interface UIState {
  view: "chat" | "settings";
  theme: "light" | "dark";
  sidebarOpen: boolean;
  hasStarted: boolean;
  isConfigLoaded: boolean;
  loading: Record<LoadingKey, boolean>;
  toasts: Toast[];
  showRenameModal: boolean;
  renameId: string | null;
  renameCurrentTitle: string;

  setView: (view: "chat" | "settings") => void;
  setTheme: (theme: "light" | "dark") => void;
  setSidebarOpen: (open: boolean) => void;
  setHasStarted: (started: boolean) => void;
  setConfigLoaded: (loaded: boolean) => void;
  setLoading: (key: LoadingKey, value: boolean) => void;
  addToast: (message: string, variant?: Toast["variant"]) => void;
  dismissToast: (id: string) => void;
  openRenameModal: (id: string, currentTitle: string) => void;
  closeRenameModal: () => void;
}

let toastCounter = 0;

export const useUIStore = create<UIState>((set) => ({
  view: "chat",
  theme: "dark",
  sidebarOpen: false,
  hasStarted: false,
  isConfigLoaded: false,
  loading: { init: true, sendMessage: false, checkConnection: false, saveConfig: false, toolExecution: false },
  toasts: [],
  showRenameModal: false,
  renameId: null,
  renameCurrentTitle: "",

  setView: (view) => set({ view }),
  setTheme: (theme) => {
    set({ theme });
    document.documentElement.classList.toggle("dark", theme === "dark");
    saveTheme(theme);
  },
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setHasStarted: (started) => set({ hasStarted: started }),
  setConfigLoaded: (loaded) => set({ isConfigLoaded: loaded }),
  setLoading: (key, value) => set((s) => ({ loading: { ...s.loading, [key]: value } })),
  addToast: (message, variant = "info") => {
    const id = `toast-${++toastCounter}`;
    set((s) => ({ toasts: [...s.toasts, { id, message, variant }] }));
  },
  dismissToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
  openRenameModal: (id, currentTitle) => {
    set({ renameId: id, renameCurrentTitle: currentTitle, showRenameModal: true });
  },
  closeRenameModal: () => {
    set({ showRenameModal: false, renameId: null, renameCurrentTitle: "" });
  },
}));
