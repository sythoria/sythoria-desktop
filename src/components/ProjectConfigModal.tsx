import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { Folder, FolderPlus, ShieldAlert, Info, Sliders, Terminal, GitBranch } from "lucide-react";
import { useProjectStore } from "../store/useProjectStore";
import { useUIStore } from "../store/useUIStore";
import { useModelStore } from "../store/useModelStore";
import { useGitStore } from "../store/useGitStore";
import { Modal } from "./ui/Modal";
import { Switch } from "./ui/Switch";
import { Select } from "./ui/Select";
import type { ProjectPermission } from "../types";

interface FormProps {
  id: string | null;
  mode: "create" | "edit";
  onClose: () => void;
}

function ProjectForm({ id, mode, onClose }: FormProps) {
  const addToast = useUIStore((s) => s.addToast);
  const { projects, addProject, updateProject, setActiveProject } = useProjectStore();
  const { models } = useModelStore();
  const gitConfig = useGitStore((s) => s.config);

  const projectToEdit = id ? projects.find((p) => p.id === id) : null;

  // Initialize form state directly on mount
  const [name, setName] = useState(projectToEdit ? projectToEdit.name : "");
  const [path, setPath] = useState(projectToEdit ? projectToEdit.path : "");
  const [permissions, setPermissions] = useState<ProjectPermission>(projectToEdit ? projectToEdit.permissions : "read");
  const [creationMode, setCreationMode] = useState<"documents" | "custom">(mode === "edit" ? "custom" : "documents");
  const [excludePatterns, setExcludePatterns] = useState(
    projectToEdit?.excludePatterns?.join(", ") ?? "node_modules, .git, dist, build, target",
  );
  const [systemPromptOverride, setSystemPromptOverride] = useState(projectToEdit?.systemPromptOverride ?? "");
  const [modelOverride, setModelOverride] = useState(projectToEdit?.modelOverride ?? "");
  const [isAutoCommitEnabled, setIsAutoCommitEnabled] = useState(
    projectToEdit ? (projectToEdit.isAutoCommitEnabled ?? false) : gitConfig.isAutoCommitEnabled,
  );
  const [autoCommitMsgTemplate, setAutoCommitMsgTemplate] = useState(projectToEdit?.autoCommitMsgTemplate ?? "");
  const [activeTab, setActiveTab] = useState<"general" | "ai" | "git">("general");
  const [saving, setSaving] = useState(false);

  const handleBrowseFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Project Directory",
      });
      if (selected && typeof selected === "string") {
        setPath(selected);
        if (!name) {
          const folderName = selected.split(/[\\/]/).pop() || "New Project";
          setName(folderName);
        }
      }
    } catch (e) {
      console.error("Failed to open directory dialog:", e);
      addToast("Failed to select folder", "error");
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      addToast("Project name is required", "error");
      return;
    }
    if (creationMode === "custom" && !path.trim()) {
      addToast("Folder path is required", "error");
      return;
    }

    setSaving(true);
    try {
      const parsedExcludes = excludePatterns
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      const configData = {
        excludePatterns: parsedExcludes,
        systemPromptOverride: systemPromptOverride.trim() || undefined,
        modelOverride: modelOverride || undefined,
        isAutoCommitEnabled,
        autoCommitMsgTemplate: autoCommitMsgTemplate.trim() || undefined,
      };

      if (mode === "create") {
        let finalPath = path;
        if (creationMode === "documents") {
          finalPath = await invoke<string>("create_project_dir", { name: name.trim() });
        }

        const newId = addProject(name.trim(), finalPath, permissions, configData);
        setActiveProject(newId);
        addToast(`Project "${name}" added successfully!`, "success");
      } else if (mode === "edit" && id) {
        updateProject(id, {
          name: name.trim(),
          path,
          permissions,
          ...configData,
        });
        addToast(`Project "${name}" updated!`, "success");
      }
      onClose();
    } catch (err) {
      console.error(err);
      addToast(typeof err === "string" ? err : "Failed to save project directory", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-4">
      {/* Tab Headers */}
      <div className="flex border-b border-border/50 mb-4 p-0.5 bg-active/40 rounded-lg">
        <button
          type="button"
          onClick={() => setActiveTab("general")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
            activeTab === "general"
              ? "bg-surface text-text-primary shadow-sm"
              : "text-text-secondary hover:text-text-primary"
          }`}
        >
          <Sliders size={13} />
          <span>General</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("ai")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
            activeTab === "ai"
              ? "bg-surface text-text-primary shadow-sm"
              : "text-text-secondary hover:text-text-primary"
          }`}
        >
          <Terminal size={13} />
          <span>AI & Context</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("git")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
            activeTab === "git"
              ? "bg-surface text-text-primary shadow-sm"
              : "text-text-secondary hover:text-text-primary"
          }`}
        >
          <GitBranch size={13} />
          <span>Git Settings</span>
        </button>
      </div>

      {/* Tab 1: General Settings */}
      {activeTab === "general" && (
        <div className="space-y-4">
          {/* Creation Mode Tabs (Create mode only) */}
          {mode === "create" && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Location Type</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setCreationMode("documents")}
                  className={`flex flex-col items-center gap-1 p-2.5 rounded-xl border text-center transition-all ${
                    creationMode === "documents"
                      ? "border-accent bg-accent-soft/20 text-text-primary"
                      : "border-border bg-surface hover:bg-hover text-text-secondary"
                  }`}
                >
                  <FolderPlus size={16} className={creationMode === "documents" ? "text-accent" : "text-text-muted"} />
                  <span className="text-xs font-semibold">New in Documents</span>
                  <span className="text-[10px] text-text-muted">Auto-create system folder</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCreationMode("custom")}
                  className={`flex flex-col items-center gap-1 p-2.5 rounded-xl border text-center transition-all ${
                    creationMode === "custom"
                      ? "border-accent bg-accent-soft/20 text-text-primary"
                      : "border-border bg-surface hover:bg-hover text-text-secondary"
                  }`}
                >
                  <Folder size={16} className={creationMode === "custom" ? "text-accent" : "text-text-muted"} />
                  <span className="text-xs font-semibold">Select Local Path</span>
                  <span className="text-[10px] text-text-muted">Choose folder on disk</span>
                </button>
              </div>
            </div>
          )}

          {/* Name Input */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-text-secondary">Project Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. sythoria-desktop"
              className="w-full px-3 py-2 text-sm rounded-lg bg-input border border-input-border text-text-primary focus:outline-none focus:border-accent"
              required
            />
          </div>

          {/* Path Selection */}
          {creationMode === "custom" && (
            <div className="space-y-1">
              <label className="text-xs font-semibold text-text-secondary">Project Folder Path</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="/Users/username/Projects/my-app"
                  className="flex-1 px-3 py-2 text-sm rounded-lg bg-input border border-input-border text-text-primary focus:outline-none focus:border-accent"
                  required={creationMode === "custom"}
                />
                <button
                  type="button"
                  onClick={handleBrowseFolder}
                  className="px-3 py-2 text-xs font-semibold rounded-lg bg-hover border border-border text-text-primary hover:bg-active transition-colors"
                >
                  Browse...
                </button>
              </div>
            </div>
          )}

          {creationMode === "documents" && mode === "create" && (
            <div className="p-2.5 bg-active/40 border border-border/50 rounded-xl flex items-start gap-2 text-xs text-text-muted">
              <Info size={14} className="shrink-0 mt-0.5 text-accent" />
              <span>
                The project will be created in your systems <strong>Documents</strong> folder:{" "}
                <code className="text-accent-hover font-mono break-all">
                  Documents/{name ? name.replace(/[^a-zA-Z0-9\-_ ]/g, "_").trim() : "[ProjectName]"}
                </code>
              </span>
            </div>
          )}

          {/* Permissions */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block">
              Default Permission Level
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setPermissions("read")}
                className={`py-2 px-3 rounded-lg border text-center transition-all flex flex-col items-center gap-1 ${
                  permissions === "read"
                    ? "border-accent bg-accent-soft/20 text-accent font-medium"
                    : "border-border bg-surface text-text-secondary hover:bg-hover"
                }`}
              >
                <span className="text-xs">Read Only</span>
                <span className="text-[9px] opacity-75">RO (Safe)</span>
              </button>
              <button
                type="button"
                onClick={() => setPermissions("write")}
                className={`py-2 px-3 rounded-lg border text-center transition-all flex flex-col items-center gap-1 ${
                  permissions === "write"
                    ? "border-amber-500 bg-amber-500/10 text-amber-500 font-medium"
                    : "border-border bg-surface text-text-secondary hover:bg-hover"
                }`}
              >
                <span className="text-xs">Read/Write</span>
                <span className="text-[9px] opacity-75">RW (Editable)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const confirmed = window.confirm(
                    "WARNING: Enabling Full Shell gives the AI complete access to run arbitrary shell commands on your system. Only enable this for trusted tasks and projects. Continue?",
                  );
                  if (confirmed) setPermissions("full");
                }}
                className={`py-2 px-3 rounded-lg border text-center transition-all flex flex-col items-center gap-1 ${
                  permissions === "full"
                    ? "border-red-500 bg-red-500/10 text-red-500 font-medium"
                    : "border-border bg-surface text-text-secondary hover:bg-hover"
                }`}
              >
                <span className="text-xs">Full Shell</span>
                <span className="text-[9px] opacity-75">Execute commands</span>
              </button>
            </div>

            {permissions === "full" && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-2.5 text-xs text-red-600 dark:text-red-400">
                <ShieldAlert size={16} className="shrink-0 mt-0.5 text-red-500" />
                <div>
                  <span className="font-semibold block mb-0.5">High Risk Permission Level</span>
                  Giving full shell permission allows the AI to perform any actions or commands via shell. Ensure the
                  workspace doesn't contain sensitive system files.
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: AI & Context Settings */}
      {activeTab === "ai" && (
        <div className="space-y-4">
          {/* Model Override */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-text-secondary">Model Override</label>
              <span className="text-[10px] text-text-muted">Force model for this workspace</span>
            </div>
            <Select
              value={modelOverride}
              onChange={setModelOverride}
              options={[
                { value: "", label: "Use System-wide Selected Model" },
                ...models
                  .filter((model) => model.enabled !== false)
                  .map((model) => ({ value: model.id, label: `${model.name} (${model.provider})` })),
              ]}
              aria-label="Model override"
            />
          </div>

          {/* Custom System Prompt */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-text-secondary">Project-Specific Prompt Override</label>
              <span className="text-[10px] text-text-muted">Injected when working in this project</span>
            </div>
            <textarea
              value={systemPromptOverride}
              onChange={(e) => setSystemPromptOverride(e.target.value)}
              placeholder="e.g. This is a Next.js App Router project using TypeScript. Follow strict clean code patterns, avoid writing nested helper callbacks, and write tests for all utils."
              rows={4}
              className="w-full px-3 py-2 text-xs rounded-lg bg-input border border-input-border text-text-primary focus:outline-none focus:border-accent resize-none font-sans"
            />
          </div>

          {/* Exclude Patterns */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-text-secondary">Exclude Patterns</label>
              <span className="text-[10px] text-text-muted">Comma-separated globs the AI will ignore</span>
            </div>
            <input
              type="text"
              value={excludePatterns}
              onChange={(e) => setExcludePatterns(e.target.value)}
              placeholder="node_modules, .git, dist, build, target, *.log"
              className="w-full px-3 py-2 text-xs font-mono rounded-lg bg-input border border-input-border text-text-primary focus:outline-none focus:border-accent"
            />
            <p className="text-[10px] text-text-muted mt-0.5">
              Matches are case-insensitive. Wildcards (*) are supported.
            </p>
          </div>
        </div>
      )}

      {/* Tab 3: Git Settings */}
      {activeTab === "git" && (
        <div className="space-y-4">
          {/* Enable Git Auto commit */}
          <div className="p-3 bg-active/20 rounded-xl border border-border/40">
            <Switch
              checked={isAutoCommitEnabled}
              onChange={setIsAutoCommitEnabled}
              label="Auto-Commit Changes"
              description="Automatically stage and commit changed files on message completions"
            />
          </div>

          {/* Git Auto Commit Message Prompt Template */}
          {isAutoCommitEnabled && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-text-secondary">
                  AI Commit Message System Instructions
                </label>
                <span className="text-[10px] text-text-muted">Controls commit message style</span>
              </div>
              <textarea
                value={autoCommitMsgTemplate}
                onChange={(e) => setAutoCommitMsgTemplate(e.target.value)}
                placeholder="You are a git commit message generator. Based on the following diff, write a concise conventional commit message (e.g. feat: add auth validation). Do not write anything else."
                rows={4}
                className="w-full px-3 py-2 text-xs rounded-lg bg-input border border-input-border text-text-primary focus:outline-none focus:border-accent resize-none font-sans"
              />
            </div>
          )}

          <div className="p-2.5 bg-active/40 border border-border/50 rounded-xl flex items-start gap-2 text-xs text-text-muted">
            <Info size={14} className="shrink-0 mt-0.5 text-accent" />
            <span>
              Make sure the project folder contains a git repository (`.git` folder). If not, you can run `git init` in
              your terminal or grant Full Shell permission to let the AI initialize it.
            </span>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-2.5 justify-end pt-3 border-t border-border/30">
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="px-4 py-2 text-xs font-semibold rounded-lg text-text-secondary hover:bg-hover transition-colors min-h-[36px]"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 text-xs font-semibold rounded-lg bg-accent text-accent-foreground hover:bg-accent-hover transition-colors min-h-[36px] flex items-center justify-center gap-1.5"
        >
          {saving ? (
            <>
              <span className="w-3.5 h-3.5 border-2 border-accent-foreground/30 border-t-accent-foreground rounded-full animate-spin" />
              <span>Saving...</span>
            </>
          ) : (
            <span>{mode === "create" ? "Create Project" : "Save Changes"}</span>
          )}
        </button>
      </div>
    </form>
  );
}

export default function ProjectConfigModal() {
  const isOpen = useUIStore((s) => s.showProjectConfigModal);
  const mode = useUIStore((s) => s.projectConfigModalMode);
  const id = useUIStore((s) => s.projectConfigModalId);
  const close = useUIStore((s) => s.closeProjectConfigModal);

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={mode === "create" ? "Add Project Workspace" : "Project Workspace Settings"}
    >
      <ProjectForm key={isOpen ? `${id || "create"}-${mode}` : "closed"} id={id} mode={mode} onClose={close} />
    </Modal>
  );
}
