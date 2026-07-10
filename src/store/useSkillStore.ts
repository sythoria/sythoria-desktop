import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { SkillInfo } from "../types";
import { logError } from "../utils/logger";

interface SkillStore {
  skills: SkillInfo[];
  loading: boolean;
  loadSkills: () => Promise<void>;
  createSkill: (id: string, name: string, description: string, body: string) => Promise<void>;
  updateSkill: (id: string, name: string, description: string, body: string) => Promise<void>;
  deleteSkill: (id: string) => Promise<void>;
}

export const useSkillStore = create<SkillStore>((set, get) => ({
  skills: [],
  loading: false,

  loadSkills: async () => {
    set({ loading: true });
    try {
      const skills = await invoke<SkillInfo[]>("list_skills");
      set({ skills });
    } catch (e) {
      logError("skills", "Failed to load skills", { error: e });
    } finally {
      set({ loading: false });
    }
  },

  createSkill: async (id: string, name: string, description: string, body: string) => {
    try {
      await invoke("create_skill", { id, name, description, body });
      await get().loadSkills();
    } catch (e) {
      logError("skills", "Failed to create skill", { error: e });
      throw e;
    }
  },

  updateSkill: async (id: string, name: string, description: string, body: string) => {
    try {
      await invoke("update_skill", { id, name, description, body });
      await get().loadSkills();
    } catch (e) {
      logError("skills", "Failed to update skill", { error: e });
      throw e;
    }
  },

  deleteSkill: async (id: string) => {
    try {
      await invoke("delete_skill", { id });
      await get().loadSkills();
    } catch (e) {
      logError("skills", "Failed to delete skill", { error: e });
      throw e;
    }
  },
}));
