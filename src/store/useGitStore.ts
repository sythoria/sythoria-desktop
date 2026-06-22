import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { loadGitConfig, saveGitConfig, GitConfig } from "../utils/storage";
import { logInfo, logError } from "../utils/logger";

export interface GitStatus {
  isRepo: boolean;
  path: string;
  branch: string;
  isDirty: boolean;
  stagedFiles: string[];
  unstagedFiles: string[];
  ahead: number;
  behind: number;
}

interface GitStore {
  config: GitConfig;
  status: GitStatus | null;
  loading: boolean;
  error: string | null;

  init: () => Promise<void>;
  updateConfig: (updates: Partial<GitConfig>) => Promise<void>;
  verifyPath: (path: string) => Promise<boolean>;
  commitChanges: (message: string, files?: string[]) => Promise<string>;
  undoLastCommit: () => Promise<void>;
  checkoutBranch: (branch: string) => Promise<void>;
  getDiff: () => Promise<string>;
}

export const useGitStore = create<GitStore>((set, get) => ({
  config: {
    repoPath: "",
    isAutoCommitEnabled: false,
    isAiCommitMsgEnabled: true,
    isPreCommitEnabled: true,
    overrideIdentity: false,
    gitName: "Sythoria AI",
    gitEmail: "assistant@sythoria.local",
  },
  status: null,
  loading: false,
  error: null,

  init: async () => {
    set({ loading: true, error: null });
    try {
      const config = await loadGitConfig();
      set({ config, loading: false });
      if (config.repoPath) {
        await get().verifyPath(config.repoPath);
      }
    } catch (e: any) {
      logError("git", "Failed to initialize Git store", { error: e });
      set({ error: e.message || String(e), loading: false });
    }
  },

  updateConfig: async (updates) => {
    const newConfig = { ...get().config, ...updates };
    set({ config: newConfig });
    await saveGitConfig(newConfig);
    logInfo("git", "Updated Git config settings", { details: JSON.stringify(updates) });
  },

  verifyPath: async (path) => {
    set({ loading: true, error: null });
    try {
      // 1. Detect if it is a repo
      const detected = await invoke<string | null>("git_detect_repo", { startPath: path });
      if (!detected) {
        set({
          status: {
            isRepo: false,
            path,
            branch: "",
            isDirty: false,
            stagedFiles: [],
            unstagedFiles: [],
            ahead: 0,
            behind: 0,
          },
          loading: false,
        });
        return false;
      }

      // 2. Fetch repo status
      const status = await invoke<GitStatus>("git_get_status", { repoPath: detected });
      set({ status, loading: false });

      // Auto save path if changed and validated
      if (detected !== get().config.repoPath) {
        await get().updateConfig({ repoPath: detected });
      }

      return true;
    } catch (e: any) {
      logError("git", `Failed to verify repository path: ${path}`, { error: e });
      set({ error: e.message || String(e), loading: false });
      return false;
    }
  },

  commitChanges: async (message, files) => {
    set({ loading: true, error: null });
    const { repoPath, overrideIdentity, gitName, gitEmail, isPreCommitEnabled } = get().config;
    if (!repoPath) {
      const err = "No repository path configured";
      set({ error: err, loading: false });
      throw new Error(err);
    }
    try {
      const result = await invoke<string>("git_create_commit", {
        repoPath,
        message,
        files: files || null,
        authorName: overrideIdentity ? gitName : null,
        authorEmail: overrideIdentity ? gitEmail : null,
        bypassHooks: !isPreCommitEnabled,
      });
      logInfo("git", `Created Git commit in repo: ${repoPath}`, { details: result });
      await get().verifyPath(repoPath);
      return result;
    } catch (e: any) {
      logError("git", `Failed to commit changes in: ${repoPath}`, { error: e });
      set({ error: e.message || String(e), loading: false });
      throw e;
    }
  },

  undoLastCommit: async () => {
    set({ loading: true, error: null });
    const { repoPath } = get().config;
    if (!repoPath) return;
    try {
      await invoke("git_undo_last_commit", { repoPath });
      logInfo("git", `Soft reset last commit in: ${repoPath}`);
      await get().verifyPath(repoPath);
    } catch (e: any) {
      logError("git", `Failed to undo last commit in: ${repoPath}`, { error: e });
      set({ error: e.message || String(e), loading: false });
    }
  },

  checkoutBranch: async (branch) => {
    set({ loading: true, error: null });
    const { repoPath } = get().config;
    if (!repoPath) return;
    try {
      await invoke("git_checkout_branch", { repoPath, branch });
      logInfo("git", `Checked out branch ${branch} in: ${repoPath}`);
      await get().verifyPath(repoPath);
    } catch (e: any) {
      logError("git", `Failed to checkout branch ${branch} in: ${repoPath}`, { error: e });
      set({ error: e.message || String(e), loading: false });
    }
  },

  getDiff: async () => {
    const { repoPath } = get().config;
    if (!repoPath) return "";
    try {
      return await invoke<string>("git_diff_changes", { repoPath });
    } catch (e: any) {
      logError("git", "Failed to retrieve diff from repository", { error: e });
      return "";
    }
  },
}));
