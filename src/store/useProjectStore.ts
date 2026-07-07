import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Project, ProjectPermission } from "../types";
import {
  loadProjects,
  saveProjects,
  loadProjectsEnabled,
  saveProjectsEnabled,
  loadProjectsDefaultPermission,
  saveProjectsDefaultPermission,
  loadLegacyProjects,
  clearLegacyProjects,
} from "../utils/storage";
import { generateId } from "../utils/generateId";

interface ProjectState {
  projects: Project[];
  activeProjectId: string | null;
  isProjectsEnabled: boolean;
  defaultPermission: ProjectPermission;
  activeWorktreePath: string | null;
  activeWorktreeBranch: string | null;

  init: () => Promise<void>;
  setIsProjectsEnabled: (enabled: boolean) => void;
  setDefaultPermission: (perm: ProjectPermission) => void;
  addProject: (
    name: string,
    path: string,
    permissions: ProjectPermission,
    config?: Omit<Partial<Project>, "id" | "name" | "path" | "permissions">,
  ) => string;
  updateProject: (id: string, updates: Partial<Project>) => void;
  deleteProject: (id: string) => void;
  setActiveProject: (id: string | null) => void;
  setWorktree: (path: string | null, branch: string | null) => Promise<void>;
  persistProjects: () => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  activeProjectId: null,
  isProjectsEnabled: false,
  defaultPermission: "read",
  activeWorktreePath: null,
  activeWorktreeBranch: null,

  init: async () => {
    let loaded = await loadProjects();

    // Migration: If projects.json is empty, check for legacy projects in sythoria-store.json
    if (loaded.length === 0) {
      try {
        const legacyProjects = await loadLegacyProjects();
        if (legacyProjects && legacyProjects.length > 0) {
          loaded = legacyProjects;
          await saveProjects(loaded);
          await clearLegacyProjects();
        }
      } catch (e) {
        console.error("Failed to migrate legacy projects:", e);
      }
    }

    const enabled = await loadProjectsEnabled();
    const defaultPerm = await loadProjectsDefaultPermission();
    set({ projects: loaded, isProjectsEnabled: enabled, defaultPermission: defaultPerm });

    const { activeProjectId } = get();
    try {
      await invoke("set_active_project", { projectId: activeProjectId });
    } catch (e) {
      console.error("Failed to set active project on init:", e);
    }
  },

  setIsProjectsEnabled: (enabled) => {
    set({ isProjectsEnabled: enabled });
    saveProjectsEnabled(enabled);
  },

  setDefaultPermission: (perm) => {
    set({ defaultPermission: perm });
    saveProjectsDefaultPermission(perm);
  },

  addProject: (name, path, permissions, config) => {
    const id = generateId();
    const newProject: Project = { id, name, path, permissions, ...config };
    set((state) => ({ projects: [...state.projects, newProject] }));
    get().persistProjects();
    return id;
  },

  updateProject: (id, updates) => {
    set((state) => ({
      projects: state.projects.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    }));
    get().persistProjects();
  },

  deleteProject: (id) => {
    const wasActive = get().activeProjectId === id;
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
      activeProjectId: state.activeProjectId === id ? null : state.activeProjectId,
    }));
    get().persistProjects();
    if (wasActive) {
      invoke("set_active_project", { projectId: null }).catch((e) => {
        console.error("Failed to clear active project on delete:", e);
      });
    }
    import("./useChatStore")
      .then(({ useChatStore }) => {
        useChatStore.getState().deleteProjectChats(id);
      })
      .catch((e) => {
        console.error("Failed to load useChatStore dynamically during deleteProject:", e);
      });
  },

  setActiveProject: (id) => {
    set({ activeProjectId: id });
    invoke("set_active_project", { projectId: id }).catch((e) => {
      console.error("Failed to set active project:", e);
    });
  },

  setWorktree: async (path, branch) => {
    const { activeProjectId } = get();
    if (activeProjectId) {
      try {
        await invoke("set_project_path_override", {
          projectId: activeProjectId,
          pathOverride: path,
        });
      } catch (e) {
        console.error("Failed to set project path override:", e);
      }
    }
    set({ activeWorktreePath: path, activeWorktreeBranch: branch });
  },

  persistProjects: async () => {
    const { projects } = get();
    await saveProjects(projects);
  },
}));
