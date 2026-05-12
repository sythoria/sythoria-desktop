import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";

interface UIContextType {
  view: "chat" | "settings" | "auth";
  sidebarOpen: boolean;
  theme: "light" | "dark";
  setView: (view: "chat" | "settings" | "auth") => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setTheme: (theme: "light" | "dark") => void;
}

const UIContext = createContext<UIContextType | undefined>(undefined);

export function UIProvider({ children }: { children: ReactNode }) {
  const [view, setViewState] = useState<"chat" | "settings" | "auth">("chat");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setThemeState] = useState<"light" | "dark">("dark");

  useEffect(() => {
    const savedTheme = localStorage.getItem("sythoria-theme") as "light" | "dark" | null;
    if (savedTheme) {
      setThemeState(savedTheme);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("sythoria-theme", theme);
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const setView = useCallback((newView: "chat" | "settings" | "auth") => {
    setViewState(newView);
  }, []);

  const setTheme = useCallback((newTheme: "light" | "dark") => {
    setThemeState(newTheme);
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  return (
    <UIContext.Provider
      value={{
        view,
        sidebarOpen,
        theme,
        setView,
        setSidebarOpen,
        toggleSidebar,
        setTheme,
      }}
    >
      {children}
    </UIContext.Provider>
  );
}

export function useUI() {
  const context = useContext(UIContext);
  if (context === undefined) {
    throw new Error("useUI must be used within a UIProvider");
  }
  return context;
}
