import { create } from "zustand";
import type { Project, ProjectPermission } from "../types";
import {
  loadProjects,
  saveProjects,
  loadProjectsEnabled,
  saveProjectsEnabled,
  loadProjectsDefaultPermission,
  saveProjectsDefaultPermission,
} from "../utils/storage";
import { generateId } from "../utils/generateId";

interface ProjectState {
  projects: Project[];
  activeProjectId: string | null;
  isProjectsEnabled: boolean;
  defaultPermission: ProjectPermission;

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
  persistProjects: () => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  activeProjectId: null,
  isProjectsEnabled: false,
  defaultPermission: "read",

  init: async () => {
    const loaded = await loadProjects();
    const enabled = await loadProjectsEnabled();
    const defaultPerm = await loadProjectsDefaultPermission();
    set({ projects: loaded, isProjectsEnabled: enabled, defaultPermission: defaultPerm });
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
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
      activeProjectId: state.activeProjectId === id ? null : state.activeProjectId,
    }));
    get().persistProjects();
  },

  setActiveProject: (id) => {
    set({ activeProjectId: id });
  },

  persistProjects: async () => {
    const { projects } = get();
    await saveProjects(projects);
  },
}));
