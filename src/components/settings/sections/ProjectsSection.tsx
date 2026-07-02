import { motion, AnimatePresence } from "motion/react";
import { ShieldAlert } from "lucide-react";
import { Switch } from "../../ui/Switch";
import { springs, motionTokens } from "../../../lib/motion-tokens";
import { useProjectStore } from "../../../store/useProjectStore";
import { useGitStore } from "../../../store/useGitStore";
import type { ProjectPermission } from "../../../types";

export function ProjectsSection() {
  const { isProjectsEnabled, defaultPermission, setIsProjectsEnabled, setDefaultPermission } = useProjectStore();
  const { config: gitConfig, updateConfig: updateGitConfig } = useGitStore();

  const handleToggleDefaultPermission = (perm: ProjectPermission) => {
    if (perm === "full") {
      const confirmed = window.confirm(
        "WARNING: Setting the global default to Full Shell gives the AI complete access to run arbitrary shell commands on your system for all new projects. Continue?",
      );
      if (!confirmed) return;
    }
    setDefaultPermission(perm);
  };

  return (
    <>
      <div>
        <h3 className="text-sm font-semibold text-text-primary mb-1">Project Workspaces</h3>
        <p className="text-xs text-text-muted">
          Configure local workspace management, default folder permissions, and AI code authoring behavior.
        </p>
      </div>

      {/* Card 1: Opt-in Toggle & Default Permission Controls */}
      <div className="bg-surface border border-border rounded-xl p-4 shadow-sm">
        <Switch
          checked={isProjectsEnabled}
          onChange={setIsProjectsEnabled}
          label="Enable Project Workspaces"
          description="Allows grouping chats by projects and grants the AI direct access to read/write local folders."
        />

        <AnimatePresence initial={false}>
          {isProjectsEnabled && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{
                type: "tween",
                ease: motionTokens.easing.smooth,
                duration: motionTokens.duration.normal,
              }}
              className="overflow-hidden"
            >
              <div className="space-y-4 pt-4 border-t border-border/50 mt-4">
                <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider block">
                  Global Default Permission
                </h4>
                <p className="text-xs text-text-muted">
                  The default access level granted to new workspaces when they are added.
                </p>
                <div className="grid grid-cols-3 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleToggleDefaultPermission("read")}
                    className={`py-2 px-3 rounded-lg border text-center transition-all flex flex-col items-center gap-1 ${
                      defaultPermission === "read"
                        ? "border-accent bg-accent-soft/20 text-accent font-medium"
                        : "border-border bg-surface text-text-secondary hover:bg-hover"
                    }`}
                  >
                    <span className="text-xs">Read Only</span>
                    <span className="text-[9px] opacity-75">RO (Safe)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleDefaultPermission("write")}
                    className={`py-2 px-3 rounded-lg border text-center transition-all flex flex-col items-center gap-1 ${
                      defaultPermission === "write"
                        ? "border-amber-500 bg-amber-500/10 text-amber-500 font-medium"
                        : "border-border bg-surface text-text-secondary hover:bg-hover"
                    }`}
                  >
                    <span className="text-xs">Read/Write</span>
                    <span className="text-[9px] opacity-75">RW (Editable)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleDefaultPermission("full")}
                    className={`py-2 px-3 rounded-lg border text-center transition-all flex flex-col items-center gap-1 ${
                      defaultPermission === "full"
                        ? "border-red-500 bg-red-500/10 text-red-500 font-medium"
                        : "border-border bg-surface text-text-secondary hover:bg-hover"
                    }`}
                  >
                    <span className="text-xs">Full Shell</span>
                    <span className="text-[9px] opacity-75">Execute commands</span>
                  </button>
                </div>

                {defaultPermission === "full" && (
                  <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-2.5 text-xs text-red-600 dark:text-red-400">
                    <ShieldAlert size={16} className="shrink-0 mt-0.5 text-red-500" />
                    <div>
                      <span className="font-semibold block mb-0.5">High Risk Permission Level</span>
                      Giving full shell permission by default allows the AI to perform any actions or commands via
                      shell.
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Card 2: Commit Author overrides (preserved from GitSection) */}
      <div className="bg-surface border border-border rounded-xl p-4 space-y-4 shadow-sm">
        <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider">Commit Author overrides</h4>
        <Switch
          checked={gitConfig.overrideIdentity}
          onChange={(val) => updateGitConfig({ overrideIdentity: val })}
          label="Override Git Identity"
          description="Identify AI edits distinctly in repository logs and blame"
        />

        <AnimatePresence initial={false}>
          {gitConfig.overrideIdentity && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={springs.gentle}
              className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 overflow-hidden"
            >
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium text-text-muted">Author Name</label>
                <input
                  type="text"
                  value={gitConfig.gitName}
                  onChange={(e) => updateGitConfig({ gitName: e.target.value })}
                  className="w-full px-3 py-1.5 rounded-lg border border-input-border bg-input text-sm text-text-primary focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none transition-colors"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium text-text-muted">Author Email</label>
                <input
                  type="email"
                  value={gitConfig.gitEmail}
                  onChange={(e) => updateGitConfig({ gitEmail: e.target.value })}
                  className="w-full px-3 py-1.5 rounded-lg border border-input-border bg-input text-sm text-text-primary focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none transition-colors"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}

export default ProjectsSection;
