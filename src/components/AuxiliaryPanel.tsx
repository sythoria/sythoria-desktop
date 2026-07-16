import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  X,
  Bot,
  Cpu,
  FileText,
  GitCompare,
  Terminal as TerminalIcon,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Trash2,
  FileCode,
  Square,
  Sparkles,
} from "lucide-react";
import { useUIStore } from "../store/useUIStore";
import { useChatStore } from "../store/useChatStore";
import { useGitStore } from "../store/useGitStore";
import ChatAreaBase from "./ChatArea";
import { motionTokens } from "../lib/motion-tokens";

export function AuxiliaryPanel() {
  const isAuxPanelOpen = useUIStore((s) => s.isAuxPanelOpen);
  const setAuxPanelOpen = useUIStore((s) => s.setAuxPanelOpen);
  const activeAuxTab = useUIStore((s) => s.activeAuxTab);
  const setActiveAuxTab = useUIStore((s) => s.setActiveAuxTab);

  const activeArtifact = useUIStore((s) => s.activeArtifact);
  const setActiveArtifact = useUIStore((s) => s.setActiveArtifact);
  const [allowArtifactNetwork, setAllowArtifactNetwork] = useState(false);
  const [showThinking, setShowThinking] = useState(true);

  const activeSubagentId = useUIStore((s) => s.activeSubagentId);
  const setActiveSubagentId = useUIStore((s) => s.setActiveSubagentId);

  const activeId = useChatStore((s) => s.activeId);
  const conversations = useChatStore((s) => s.conversations);
  const generationByConversation = useChatStore((s) => s.generationByConversation);

  const backgroundTasks = useUIStore((s) => s.backgroundTasks);
  const clearTasks = useUIStore((s) => s.clearTasks);
  const logBuffer = useUIStore((s) => s.logBuffer);

  const gitStore = useGitStore();

  const terminalEndRef = useRef<HTMLDivElement | null>(null);

  // Esc key closes panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isAuxPanelOpen) {
        setAuxPanelOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isAuxPanelOpen, setAuxPanelOpen]);

  // Scroll to end of terminals on log update
  useEffect(() => {
    if (activeAuxTab === "terminals") {
      terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logBuffer, activeAuxTab]);

  if (!isAuxPanelOpen) return null;

  // 1. Subagents Logic
  const subagents = conversations.filter((c) => c.isSubagent && c.parentId === activeId);
  const selectedSubagentConv = conversations.find((c) => c.id === activeSubagentId);
  const subagentGenState = activeSubagentId ? generationByConversation[activeSubagentId] : undefined;

  // 2. Files Changed Logic
  const activeConversation = conversations.find((c) => c.id === activeId);
  const diffFiles: string[] = [];
  if (activeConversation?.pendingWorktree) {
    // If there is an active worktree, list files from git status or just render placeholders
    const dirty = gitStore.status
      ? [...gitStore.status.stagedFiles, ...gitStore.status.unstagedFiles]
      : [];
    if (dirty.length > 0) {
      diffFiles.push(...dirty);
    } else {
      diffFiles.push("No changes in isolated worktree.");
    }
  }

  // Helper to render safe iframe document
  const getSafeSrcDoc = (content: string, allowNetwork: boolean) => {
    let csp = "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:;";
    if (allowNetwork) {
      csp = "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: http: https:; connect-src http: https: ws: wss:;";
    }
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta http-equiv="Content-Security-Policy" content="${csp}">
          <style>
            body { margin: 0; padding: 12px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #f3f4f6; background-color: #111827; }
            pre { background-color: #1f2937; padding: 12px; border-radius: 8px; overflow: auto; }
          </style>
        </head>
        <body>
          ${content}
        </body>
      </html>
    `;
  };

  return (
    <div className="flex flex-col h-full bg-surface border-l border-border/40 select-none">
      {/* Header Tabs */}
      <div className="flex items-center justify-between border-b border-border/30 px-3 bg-input/10 shrink-0">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-1">
          {/* Subagents Tab */}
          <button
            onClick={() => setActiveAuxTab("subagents")}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-all cursor-pointer ${
              activeAuxTab === "subagents"
                ? "border-accent text-accent"
                : "border-transparent text-text-muted hover:text-text-secondary"
            }`}
          >
            <Bot size={14} />
            <span>Subagents</span>
            {subagents.filter((s) => s.status === "running").length > 0 && (
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            )}
          </button>

          {/* Tasks Tab */}
          <button
            onClick={() => setActiveAuxTab("tasks")}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-all cursor-pointer ${
              activeAuxTab === "tasks"
                ? "border-accent text-accent"
                : "border-transparent text-text-muted hover:text-text-secondary"
            }`}
          >
            <Cpu size={14} />
            <span>Tasks</span>
            {backgroundTasks.filter((t) => t.status === "running").length > 0 && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            )}
          </button>

          {/* Artifacts Tab */}
          <button
            onClick={() => setActiveAuxTab("artifacts")}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-all cursor-pointer ${
              activeAuxTab === "artifacts"
                ? "border-accent text-accent"
                : "border-transparent text-text-muted hover:text-text-secondary"
            }`}
          >
            <FileText size={14} />
            <span>Artifacts</span>
            {activeArtifact && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
          </button>

          {/* Files Tab */}
          <button
            onClick={() => setActiveAuxTab("files")}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-all cursor-pointer ${
              activeAuxTab === "files"
                ? "border-accent text-accent"
                : "border-transparent text-text-muted hover:text-text-secondary"
            }`}
          >
            <GitCompare size={14} />
            <span>Files</span>
            {diffFiles.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />}
          </button>

          {/* Terminals Tab */}
          <button
            onClick={() => setActiveAuxTab("terminals")}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-all cursor-pointer ${
              activeAuxTab === "terminals"
                ? "border-accent text-accent"
                : "border-transparent text-text-muted hover:text-text-secondary"
            }`}
          >
            <TerminalIcon size={14} />
            <span>Terminal</span>
          </button>
        </div>

        {/* Close Button */}
        <button
          onClick={() => setAuxPanelOpen(false)}
          className="p-1.5 rounded-lg text-text-muted hover:bg-hover hover:text-text-primary transition-colors cursor-pointer shrink-0"
          title="Collapse Panel (Esc)"
        >
          <X size={15} />
        </button>
      </div>

      {/* Pane Content */}
      <div className="flex-1 min-h-0 w-full overflow-hidden relative bg-chat/30">
        <AnimatePresence mode="wait">
          {/* Subagents Pane */}
          {activeAuxTab === "subagents" && (
            <motion.div
              key="subagents-pane"
              className="absolute inset-0 flex flex-col"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: motionTokens.duration.fast }}
            >
              {activeSubagentId && selectedSubagentConv ? (
                // If a subagent is selected, display its conversation
                <div className="flex-1 flex flex-col min-h-0">
                  {/* Subagent Titlebar */}
                  <div className="flex items-center justify-between p-3 border-b border-border/40 bg-input/10 shrink-0">
                    <button
                      onClick={() => setActiveSubagentId(null)}
                      className="text-xs text-accent hover:underline font-medium cursor-pointer"
                    >
                      &larr; Back to list
                    </button>
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="font-semibold text-text-primary truncate max-w-[120px]">
                        {selectedSubagentConv.role || selectedSubagentConv.title}
                      </span>
                      <button
                        onClick={() => setShowThinking(!showThinking)}
                        className={`flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-semibold rounded-full border transition-colors cursor-pointer shrink-0 ${
                          showThinking
                            ? "bg-accent/15 text-accent border-accent/20"
                            : "bg-surface/50 text-text-muted border-border/40 hover:text-text-secondary"
                        }`}
                        title={showThinking ? "Hide Subagent Thinking" : "Show Subagent Thinking"}
                      >
                        <Sparkles size={8} />
                        <span>THINKING: {showThinking ? "ON" : "OFF"}</span>
                      </button>
                      {selectedSubagentConv.status === "running" ? (
                        <div className="flex items-center gap-1.5">
                          <span className="flex items-center gap-1 text-[9px] text-accent/80 font-semibold px-2 py-0.5 bg-accent/10 rounded-full shrink-0">
                            <Loader2 size={8} className="animate-spin" />
                            RUNNING
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              useChatStore.getState().stopStreaming(selectedSubagentConv.id);
                            }}
                            className="flex items-center gap-1 text-[9px] text-red-400 hover:text-red-300 font-semibold px-2 py-0.5 bg-red-500/10 rounded-full border border-red-500/20 cursor-pointer transition-colors"
                            title="Stop Subagent Execution"
                          >
                            <Square size={8} className="fill-red-400" />
                            STOP
                          </button>
                        </div>
                      ) : selectedSubagentConv.status === "stopped" ? (
                        <span className="text-[9px] text-amber-500 font-semibold px-2 py-0.5 bg-amber-500/10 rounded-full shrink-0">
                          STOPPED
                        </span>
                      ) : selectedSubagentConv.status === "error" ? (
                        <span className="text-[9px] text-red-500 font-semibold px-2 py-0.5 bg-red-500/10 rounded-full shrink-0">
                          ERROR
                        </span>
                      ) : (
                        <span className="text-[9px] text-emerald-500 font-semibold px-2 py-0.5 bg-emerald-500/10 rounded-full shrink-0">
                          DONE
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Embedded Chat */}
                  <div className="flex-1 min-h-0 flex flex-col relative bg-chat/30">
                    <ChatAreaBase
                      messages={selectedSubagentConv.messages || []}
                      onRetry={() => {}}
                      generationState={subagentGenState?.state || "idle"}
                      conversationId={selectedSubagentConv.id}
                      autoExpandReasoning={showThinking}
                    />
                  </div>
                </div>
              ) : (
                // Else, show list of subagents
                <div className="flex-1 flex flex-col p-4 overflow-y-auto gap-3">
                  <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider mb-1">
                    Autonomous Collaborators
                  </h3>
                  {subagents.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center border border-dashed border-border/50 rounded-xl bg-surface/40 px-4">
                      <Bot size={28} className="text-text-muted mb-2 opacity-50" />
                      <p className="text-xs text-text-muted">No subagents spawned for this conversation yet.</p>
                      <p className="text-[10px] text-text-muted/70 mt-1 max-w-[260px]">
                        Spawning helper agents allows parallel search, research, and analysis workflows.
                      </p>
                    </div>
                  ) : (
                    subagents.map((sa) => (
                      <div
                        key={sa.id}
                        onClick={() => setActiveSubagentId(sa.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setActiveSubagentId(sa.id);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        className="w-full text-left p-3.5 border border-border/40 hover:border-accent bg-surface/50 hover:bg-hover rounded-xl transition-all flex items-center justify-between gap-4 cursor-pointer group shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        <div className="flex items-center gap-3 overflow-hidden">
                          <div className="p-2 rounded-lg bg-accent/5 text-accent shrink-0 border border-accent/10">
                            <Bot size={16} />
                          </div>
                          <div className="overflow-hidden">
                            <h4 className="text-xs font-semibold text-text-primary truncate">
                              {sa.role || "Helper Agent"}
                            </h4>
                            <p className="text-[10px] text-text-muted truncate mt-0.5 font-mono">
                              ID: {sa.id}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {sa.status === "running" ? (
                            <div className="flex items-center gap-1.5">
                              <span className="flex items-center gap-1 text-[9px] text-accent font-semibold px-2 py-0.5 bg-accent/10 rounded-full">
                                <Loader2 size={8} className="animate-spin" />
                                RUNNING
                              </span>
                              <button
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  useChatStore.getState().stopStreaming(sa.id);
                                }}
                                className="flex items-center gap-1 text-[9px] text-red-400 hover:text-red-300 font-semibold px-2 py-0.5 bg-red-500/10 rounded-full border border-red-500/20 cursor-pointer transition-colors"
                                title="Stop Subagent"
                              >
                                <Square size={8} className="fill-red-400" />
                                STOP
                              </button>
                            </div>
                          ) : sa.status === "stopped" ? (
                            <span className="text-[9px] text-amber-500 font-semibold px-2 py-0.5 bg-amber-500/10 rounded-full">
                              STOPPED
                            </span>
                          ) : sa.status === "error" ? (
                            <span className="text-[9px] text-red-500 font-semibold px-2 py-0.5 bg-red-500/10 rounded-full">
                              ERROR
                            </span>
                          ) : (
                            <span className="text-[9px] text-emerald-500 font-semibold px-2 py-0.5 bg-emerald-500/10 rounded-full">
                              DONE
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </motion.div>
          )}

          {/* Background Tasks Pane */}
          {activeAuxTab === "tasks" && (
            <motion.div
              key="tasks-pane"
              className="absolute inset-0 flex flex-col p-4 overflow-y-auto"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: motionTokens.duration.fast }}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider">
                  Active Tasks Loop
                </h3>
                {backgroundTasks.length > 0 && (
                  <button
                    onClick={clearTasks}
                    className="text-[10px] text-red-400 hover:text-red-300 transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 size={10} />
                    Clear History
                  </button>
                )}
              </div>

              {backgroundTasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center border border-dashed border-border/50 rounded-xl bg-surface/40 px-4">
                  <Cpu size={28} className="text-text-muted mb-2 opacity-50" />
                  <p className="text-xs text-text-muted">No background processes have run recently.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {backgroundTasks.map((task) => (
                    <div
                      key={task.id}
                      className="p-3 border border-border/30 bg-surface/30 rounded-xl flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-2.5 overflow-hidden">
                        {task.status === "running" ? (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Loader2 size={14} className="animate-spin text-accent" />
                            <button
                              onClick={() => useChatStore.getState().stopStreaming(task.convId)}
                              className="p-1 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded border border-red-500/20 cursor-pointer transition-colors"
                              title="Stop Task Process"
                            >
                              <Square size={10} className="fill-red-400" />
                            </button>
                          </div>
                        ) : task.status === "error" ? (
                          <AlertCircle size={14} className="text-red-500 shrink-0" />
                        ) : (
                          <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                        )}
                        <span className="font-medium text-text-primary truncate">{task.title}</span>
                      </div>
                      <span className="text-[10px] text-text-muted shrink-0">
                        {new Date(task.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* Artifacts Pane */}
          {activeAuxTab === "artifacts" && (
            <motion.div
              key="artifacts-pane"
              className="absolute inset-0 flex flex-col"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: motionTokens.duration.fast }}
            >
              {activeArtifact ? (
                <div className="flex-1 flex flex-col min-h-0">
                  {/* Artifact Titlebar */}
                  <div className="flex items-center justify-between p-3 border-b border-border/40 bg-input/10 shrink-0">
                    <span className="text-xs font-semibold text-text-primary truncate max-w-[240px]">
                      {activeArtifact.title}
                    </span>
                    <div className="flex items-center gap-2">
                      {(activeArtifact.type === "html" || activeArtifact.type === "svg") && (
                        <label className="flex items-center gap-1.5 text-[10px] text-text-muted select-none cursor-pointer hover:text-text-secondary transition-colors">
                          <input
                            type="checkbox"
                            checked={allowArtifactNetwork}
                            onChange={(e) => setAllowArtifactNetwork(e.target.checked)}
                            className="rounded border-border bg-input/50 text-accent focus:ring-accent accent-accent w-3.5 h-3.5"
                          />
                          <span>Network Access</span>
                        </label>
                      )}
                      <button
                        onClick={() => setActiveArtifact(null)}
                        className="text-xs text-red-500 hover:text-red-400 font-medium cursor-pointer"
                      >
                        Close
                      </button>
                    </div>
                  </div>

                  {/* Render Area */}
                  <div className="flex-1 min-h-0 w-full overflow-hidden bg-gray-950 p-2">
                    {activeArtifact.type === "html" || activeArtifact.type === "svg" ? (
                      <iframe
                        title={activeArtifact.title}
                        className="w-full h-full border-none bg-white rounded-lg"
                        srcDoc={getSafeSrcDoc(activeArtifact.content, allowArtifactNetwork)}
                        sandbox="allow-scripts"
                      />
                    ) : (
                      <pre className="w-full h-full m-0 p-3 bg-surface/30 border border-border/20 rounded-lg text-xs overflow-auto font-mono text-text-secondary select-text whitespace-pre-wrap">
                        <code>{activeArtifact.content}</code>
                      </pre>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-4 py-12 text-center border border-dashed border-border/50 rounded-xl bg-surface/40 m-4">
                  <FileText size={28} className="text-text-muted mb-2 opacity-50" />
                  <p className="text-xs text-text-muted">No active document artifact preview.</p>
                  <p className="text-[10px] text-text-muted/70 mt-1 max-w-[260px]">
                    Generated files, web mocks, code scripts, or implementation plan documents will appear here.
                  </p>
                </div>
              )}
            </motion.div>
          )}

          {/* Files Changed Pane */}
          {activeAuxTab === "files" && (
            <motion.div
              key="files-pane"
              className="absolute inset-0 flex flex-col p-4 overflow-y-auto"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: motionTokens.duration.fast }}
            >
              <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider mb-4">
                Workspace Modifications
              </h3>

              {diffFiles.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center border border-dashed border-border/50 rounded-xl bg-surface/40 px-4">
                  <GitCompare size={28} className="text-text-muted mb-2 opacity-50" />
                  <p className="text-xs text-text-muted">No files modified in isolation.</p>
                  <p className="text-[10px] text-text-muted/70 mt-1 max-w-[260px]">
                    Modified files inside isolated worktree environments appear here for diff inspect.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {diffFiles.map((file) => (
                    <div
                      key={file}
                      className="p-3 border border-border/30 bg-surface/30 rounded-xl flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-2 overflow-hidden font-mono">
                        <FileCode size={14} className="text-text-muted shrink-0" />
                        <span className="truncate text-text-secondary select-all">{file}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* Terminal Pane */}
          {activeAuxTab === "terminals" && (
            <motion.div
              key="terminals-pane"
              className="absolute inset-0 flex flex-col bg-gray-950 p-4 font-mono text-xs"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: motionTokens.duration.fast }}
            >
              <div className="flex-1 overflow-y-auto select-text scrollbar-thin flex flex-col gap-1 pr-1">
                {logBuffer.length === 0 ? (
                  <div className="text-gray-500 italic">No output logs recorded yet...</div>
                ) : (
                  logBuffer.map((log, idx) => {
                    const levelColors: Record<string, string> = {
                      info: "text-blue-400",
                      warn: "text-amber-400 font-semibold",
                      error: "text-red-400 font-bold",
                    };
                    const color = levelColors[log.level] || "text-gray-300";
                    return (
                      <div key={idx} className="leading-5 break-words select-text">
                        <span className="text-gray-500 select-none">
                          [{new Date(log.timestamp).toLocaleTimeString([], { hour12: false })}]
                        </span>{" "}
                        <span className={`uppercase font-semibold select-none ${color}`}>
                          [{log.level}]
                        </span>{" "}
                        <span className="text-gray-400 select-none">
                          [{log.source}]
                        </span>{" "}
                        <span className="text-gray-200">{log.message}</span>
                      </div>
                    );
                  })
                )}
                <div ref={terminalEndRef} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
