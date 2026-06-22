import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { GitBranch, RefreshCw, Undo2, AlertCircle } from "lucide-react";
import { Switch } from "../../ui/Switch";
import { Spinner } from "../../ui/Spinner";
import { springs, motionTokens } from "../../../lib/motion-tokens";
import { useGitStore } from "../../../store/useGitStore";
import { useUIStore } from "../../../store/useUIStore";

export function GitSection() {
  const { config, status, loading, error, init, updateConfig, verifyPath, undoLastCommit } = useGitStore();
  const addToast = useUIStore((s) => s.addToast);
  const [inputPath, setInputPath] = useState(config.repoPath);
  const [prevPath, setPrevPath] = useState(config.repoPath);

  if (config.repoPath !== prevPath) {
    setPrevPath(config.repoPath);
    setInputPath(config.repoPath);
  }

  useEffect(() => {
    init();
  }, [init]);

  const handleVerify = async () => {
    if (!inputPath.trim()) {
      addToast("Please enter a path to verify", "info");
      return;
    }
    const isOk = await verifyPath(inputPath.trim());
    if (isOk) {
      addToast("Git repository verified successfully", "success");
    } else {
      addToast("No git repository detected at this path", "error");
    }
  };

  const handleUndoCommit = async () => {
    const ok = window.confirm(
      "Are you sure you want to undo the last AI commit? This will perform a soft reset, keeping your changes staged.",
    );
    if (ok) {
      await undoLastCommit();
      addToast("Last commit undone (changes kept staged)", "success");
    }
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/20 pb-4">
        <div>
          <h3 className="text-sm font-semibold text-text-primary mb-1">Git Version Control</h3>
          <p className="text-xs text-text-muted">Manage tracking, branch states, and automatic agent checkpoints.</p>
        </div>
        {status?.isRepo ? (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 shadow-sm self-start sm:self-center">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Active Repository
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-500 border border-amber-500/20 shadow-sm self-start sm:self-center">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            Inactive
          </span>
        )}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl p-3 text-xs flex items-start gap-2.5 shadow-sm">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold block mb-0.5">Git Integration Error</span>
            <span className="opacity-90">{error}</span>
          </div>
        </div>
      )}

      {/* Card 1: Repository Location */}
      <div className="bg-surface border border-border rounded-xl p-4 space-y-4 shadow-sm relative overflow-hidden">
        <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider">Repository Workspace</h4>
        <div className="flex gap-2">
          <input
            type="text"
            value={inputPath}
            onChange={(e) => setInputPath(e.target.value)}
            className="flex-1 px-3 py-1.5 rounded-lg bg-input border border-border text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
            placeholder="/absolute/path/to/your/repo"
          />
          <motion.button
            whileHover={{ scale: motionTokens.scale.pop }}
            whileTap={{ scale: motionTokens.scale.press }}
            className="px-4 py-1.5 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent-hover transition-colors shadow-sm flex items-center justify-center min-w-[76px]"
            onClick={handleVerify}
            disabled={loading}
          >
            {loading ? <Spinner size="sm" /> : "Verify"}
          </motion.button>
        </div>

        {status?.isRepo && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={springs.gentle}
            className="pt-3.5 border-t border-border/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-text-muted"
          >
            <div className="flex items-center gap-1.5 bg-input/40 px-2.5 py-1 rounded-lg border border-border/20 shadow-inner">
              <GitBranch size={13} className="text-accent" />
              <span>
                Branch: <strong className="text-text-primary font-medium">{status.branch}</strong>
              </span>
            </div>
            <div className="flex gap-4">
              <span className="flex items-center gap-1">
                Staged: <strong className="text-emerald-500 font-semibold">{status.stagedFiles.length}</strong>
              </span>
              <span className="flex items-center gap-1">
                Unstaged: <strong className="text-amber-500 font-semibold">{status.unstagedFiles.length}</strong>
              </span>
              {status.ahead + status.behind > 0 && (
                <span className="text-text-secondary">
                  (Ahead: {status.ahead} / Behind: {status.behind})
                </span>
              )}
            </div>
          </motion.div>
        )}
      </div>

      {/* Card 2: AI Commit Behavior */}
      <div className="bg-surface border border-border rounded-xl p-4 space-y-4 shadow-sm">
        <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider">AI Checkpoint Behavior</h4>
        <div className="space-y-4 pt-1">
          <Switch
            checked={config.isAutoCommitEnabled}
            onChange={(val) => updateConfig({ isAutoCommitEnabled: val })}
            label="Auto-Commit on Edits"
            description="Automatically run git commit when the agent saves file changes"
          />
          <Switch
            checked={config.isAiCommitMsgEnabled}
            onChange={(val) => updateConfig({ isAiCommitMsgEnabled: val })}
            label="Generate Commit Messages"
            description="Use LLM diff summary to write atomic Conventional Commit messages"
          />
          <Switch
            checked={config.isPreCommitEnabled}
            onChange={(val) => updateConfig({ isPreCommitEnabled: val })}
            label="Validate Pre-Commit Hooks"
            description="Verify project linters and formatters pass before sealing commits"
          />
        </div>
      </div>

      {/* Card 3: Identity Configuration */}
      <div className="bg-surface border border-border rounded-xl p-4 space-y-4 shadow-sm">
        <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider">Commit Author overrides</h4>
        <Switch
          checked={config.overrideIdentity}
          onChange={(val) => updateConfig({ overrideIdentity: val })}
          label="Override Git Identity"
          description="Identify AI edits distinctly in repository logs and blame"
        />

        <AnimatePresence initial={false}>
          {config.overrideIdentity && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={springs.gentle}
              className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 overflow-hidden"
            >
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                  Author Name
                </label>
                <input
                  type="text"
                  value={config.gitName}
                  onChange={(e) => updateConfig({ gitName: e.target.value })}
                  className="w-full px-3 py-1.5 rounded-lg bg-input border border-border text-sm text-text-primary focus:outline-none focus:border-accent"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                  Author Email
                </label>
                <input
                  type="email"
                  value={config.gitEmail}
                  onChange={(e) => updateConfig({ gitEmail: e.target.value })}
                  className="w-full px-3 py-1.5 rounded-lg bg-input border border-border text-sm text-text-primary focus:outline-none focus:border-accent"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Quick Actions (e.g. Undo Last AI Commit) */}
      {status?.isRepo && (
        <div className="flex flex-wrap gap-2 pt-2">
          <motion.button
            whileHover={{ scale: motionTokens.scale.pop }}
            whileTap={{ scale: motionTokens.scale.press }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-500/30 text-red-500 bg-red-500/5 hover:bg-red-500/10 text-xs font-semibold transition-colors shadow-sm min-h-[36px]"
            onClick={handleUndoCommit}
            disabled={loading}
          >
            <Undo2 size={13} />
            <span>Undo Last AI Commit</span>
          </motion.button>
          <motion.button
            whileHover={{ scale: motionTokens.scale.pop }}
            whileTap={{ scale: motionTokens.scale.press }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-text-secondary bg-input hover:bg-hover text-xs font-semibold transition-colors shadow-sm min-h-[36px]"
            onClick={() => verifyPath(config.repoPath)}
            disabled={loading}
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            <span>Refresh Status</span>
          </motion.button>
        </div>
      )}
    </div>
  );
}
export default GitSection;
