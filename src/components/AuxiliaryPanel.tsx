import { invoke } from "@tauri-apps/api/core";
import { normalizeExternalUrl, openExternalUrl } from "../utils/externalUrl";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity,
  AlertCircle,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  ClipboardCheck,
  Code2,
  File,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  HardDrive,
  Link2,
  Loader2,
  Maximize2,
  Paperclip,
  Minimize2,
  PinOff,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Square,
  TerminalSquare,
  Trash2,
  X,
} from "lucide-react";
import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { motionTokens } from "../lib/motion-tokens";
import { useChatStore } from "../store/useChatStore";
import { GitStatus } from "../store/useGitStore";
import { useProjectStore } from "../store/useProjectStore";
import { AuxiliaryTab, useUIStore } from "../store/useUIStore";
import type { Conversation, Project } from "../types";
import { DiffFile, fileNameFromPath, joinProjectPath, languageFromPath, parseGitDiff } from "./auxiliaryPanelUtils";

interface TerminalEntry {
  id: number;
  command: string;
  output: string;
  status: "running" | "success" | "error";
}

interface FileTreeEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface NumberedDiffLine {
  line: string;
  oldLine: number | "";
  newLine: number | "";
  kind: "added" | "deleted" | "hunk" | "meta" | "context";
}

const tabs: Array<{ id: AuxiliaryTab; label: string; icon: typeof ClipboardCheck }> = [
  { id: "review", label: "Review", icon: ClipboardCheck },
  { id: "files", label: "Files", icon: FileCode2 },
  { id: "terminals", label: "Terminal", icon: TerminalSquare },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "artifacts", label: "Preview", icon: Code2 },
];

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Something went wrong.";
}

function EmptyState({ icon: Icon, title, detail }: { icon: typeof ClipboardCheck; title: string; detail: string }) {
  return (
    <div className="m-auto flex max-w-[300px] flex-col items-center px-6 py-10 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-border/50 bg-hover/40 text-text-muted">
        <Icon size={18} />
      </div>
      <p className="text-sm font-medium text-text-primary">{title}</p>
      <p className="mt-1.5 text-xs leading-5 text-text-muted">{detail}</p>
    </div>
  );
}

function PanelSpinner({ label }: { label: string }) {
  return (
    <div className="m-auto flex items-center gap-2 text-xs text-text-muted">
      <Loader2 size={14} className="animate-spin text-accent" />
      {label}
    </div>
  );
}

function numberDiffLines(lines: string[]): NumberedDiffLine[] {
  let oldLine = 0;
  let newLine = 0;

  return lines.map((line) => {
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
    }

    const isMeta =
      line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ");
    const isAdded = line.startsWith("+") && !line.startsWith("+++");
    const isDeleted = line.startsWith("-") && !line.startsWith("---");
    const isHunk = line.startsWith("@@");
    const numberedLine: NumberedDiffLine = {
      line,
      oldLine: isAdded || isMeta || isHunk ? "" : oldLine || "",
      newLine: isDeleted || isMeta || isHunk ? "" : newLine || "",
      kind: isAdded ? "added" : isDeleted ? "deleted" : isHunk ? "hunk" : isMeta ? "meta" : "context",
    };

    if (!isAdded && !isMeta && !isHunk) oldLine += 1;
    if (!isDeleted && !isMeta && !isHunk) newLine += 1;
    return numberedLine;
  });
}

function DiffView({ file }: { file: DiffFile }) {
  return (
    <div className="min-w-max font-mono text-[11px] leading-[19px]">
      {numberDiffLines(file.lines).map(({ line, oldLine, newLine, kind }, index) => {
        const isAdded = kind === "added";
        const isDeleted = kind === "deleted";
        return (
          <div
            key={`${index}-${line}`}
            className={`flex min-h-[19px] select-text ${
              kind === "added"
                ? "bg-emerald-500/10 text-emerald-300"
                : kind === "deleted"
                  ? "bg-red-500/10 text-red-300"
                  : kind === "hunk"
                    ? "bg-accent/10 text-accent"
                    : kind === "meta"
                      ? "text-text-muted"
                      : "text-text-secondary"
            }`}
          >
            <span className="w-10 shrink-0 border-r border-border/20 pr-2 text-right text-text-muted/45">
              {oldLine}
            </span>
            <span className="w-10 shrink-0 border-r border-border/20 pr-2 text-right text-text-muted/45">
              {newLine}
            </span>
            <span className="w-5 shrink-0 text-center text-text-muted/60">{isAdded ? "+" : isDeleted ? "-" : ""}</span>
            <span className="whitespace-pre pr-5">{isAdded || isDeleted ? line.slice(1) : line}</span>
          </div>
        );
      })}
    </div>
  );
}

function ReviewPane({
  projectId,
  worktreePath,
  conversationId,
}: {
  projectId: string | null;
  worktreePath?: string;
  conversationId: string | null;
}) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [files, setFiles] = useState<DiffFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<"apply" | "discard" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const applyPendingWorktree = useChatStore((s) => s.applyPendingWorktree);
  const discardPendingWorktree = useChatStore((s) => s.discardPendingWorktree);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const [nextStatus, diff] = await Promise.all([
        invoke<GitStatus>("git_get_status", { projectId, worktreePath: worktreePath || null }),
        invoke<string>("git_diff_changes", { projectId, worktreePath: worktreePath || null }),
      ]);
      const parsed = parseGitDiff(diff);
      const parsedPaths = new Set(parsed.flatMap((file) => [file.path, file.oldPath]));
      const statusOnlyFiles = [...new Set([...nextStatus.stagedFiles, ...nextStatus.unstagedFiles])]
        .filter((path) => !parsedPaths.has(path))
        .map<DiffFile>((path) => ({
          path,
          oldPath: path,
          status: "modified",
          additions: 0,
          deletions: 0,
          lines: [`diff --git a/${path} b/${path}`, "Diff preview is unavailable for this untracked or binary file."],
        }));
      parsed.push(...statusOnlyFiles);
      setStatus(nextStatus);
      setFiles(parsed);
      setSelectedPath((current) =>
        current && parsed.some((file) => file.path === current) ? current : parsed[0]?.path || null,
      );
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setLoading(false);
    }
  }, [projectId, worktreePath]);

  useEffect(() => {
    queueMicrotask(() => void refresh());
  }, [refresh]);

  const selectedFile = files.find((file) => file.path === selectedPath) || files[0];
  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);

  const resolveWorktree = async (action: "apply" | "discard") => {
    if (!conversationId) return;
    setActionLoading(action);
    try {
      if (action === "apply") await applyPendingWorktree(conversationId);
      else await discardPendingWorktree(conversationId);
      setFiles([]);
      setStatus(null);
    } finally {
      setActionLoading(null);
    }
  };

  if (!projectId) {
    return (
      <EmptyState
        icon={Folder}
        title="No project selected"
        detail="Choose a project from the left sidebar to review workspace changes."
      />
    );
  }
  if (loading && !status) return <PanelSpinner label="Loading workspace changes…" />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border/40 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium text-text-primary">
              <GitBranch size={13} className="text-text-muted" />
              <span className="truncate">{status?.branch || "Workspace changes"}</span>
              {worktreePath && (
                <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent">
                  Isolated
                </span>
              )}
            </div>
            <p className="mt-1 text-[11px] text-text-muted">
              {files.length} {files.length === 1 ? "file" : "files"} changed
              <span className="ml-2 text-emerald-500">+{additions}</span>
              <span className="ml-1.5 text-red-400">−{deletions}</span>
            </p>
          </div>
          <button
            onClick={() => void refresh()}
            disabled={loading}
            className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-hover hover:text-text-primary"
            title="Refresh changes"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
        {worktreePath && conversationId && (
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => void resolveWorktree("discard")}
              disabled={!!actionLoading}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
            >
              {actionLoading === "discard" ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              Discard
            </button>
            <button
              onClick={() => void resolveWorktree("apply")}
              disabled={!!actionLoading}
              className="flex flex-[1.4] items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-accent-active disabled:opacity-50"
            >
              {actionLoading === "apply" ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Apply changes
            </button>
          </div>
        )}
      </div>

      {error ? (
        <EmptyState icon={AlertCircle} title="Couldn’t load changes" detail={error} />
      ) : files.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="Workspace is clean"
          detail="There are no staged or unstaged changes to review."
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="max-h-44 shrink-0 overflow-y-auto border-b border-border/40 md:max-h-none md:w-[38%] md:border-b-0 md:border-r">
            {files.map((file) => (
              <button
                key={file.path}
                onClick={() => setSelectedPath(file.path)}
                className={`flex w-full items-start gap-2 border-b border-border/25 px-3 py-2.5 text-left transition-colors ${selectedFile?.path === file.path ? "bg-accent/10" : "hover:bg-hover/60"}`}
              >
                <FileCode2
                  size={13}
                  className={`mt-0.5 shrink-0 ${file.status === "added" ? "text-emerald-500" : file.status === "deleted" ? "text-red-400" : "text-text-muted"}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[11px] text-text-primary">{file.path}</p>
                  <p className="mt-1 text-[10px] text-text-muted">
                    <span className="text-emerald-500">+{file.additions}</span>
                    <span className="ml-1.5 text-red-400">−{file.deletions}</span>
                  </p>
                </div>
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-auto bg-chat/45">
            {selectedFile && <DiffView file={selectedFile} />}
          </div>
        </div>
      )}
    </div>
  );
}

function FileTreeRow({
  entry,
  depth,
  projectId,
  worktreePath,
  expanded,
  onToggle,
  onSelect,
  selectedPath,
}: {
  entry: FileTreeEntry;
  depth: number;
  projectId: string;
  worktreePath?: string;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  selectedPath: string | null;
}) {
  const [children, setChildren] = useState<FileTreeEntry[] | null>(null);
  const isOpen = expanded.has(entry.path);
  const loading = entry.isDirectory && isOpen && children === null;

  useEffect(() => {
    if (!entry.isDirectory || !isOpen || children) return;
    invoke<string[]>("project_list_dir", { projectId, path: entry.path, worktreePath: worktreePath || null })
      .then((items) =>
        setChildren(
          items.map((name) => ({
            name: name.replace(/\/$/, ""),
            path: joinProjectPath(entry.path, name.replace(/\/$/, "")),
            isDirectory: name.endsWith("/"),
          })),
        ),
      )
      .catch(() => setChildren([]));
  }, [children, entry.isDirectory, entry.path, isOpen, projectId, worktreePath]);

  return (
    <>
      <button
        onClick={() => (entry.isDirectory ? onToggle(entry.path) : onSelect(entry.path))}
        className={`flex w-full items-center gap-1.5 py-1 pr-2 text-left text-xs transition-colors hover:bg-hover/70 ${selectedPath === entry.path ? "bg-accent/10 text-text-primary" : "text-text-secondary"}`}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        {entry.isDirectory ? (
          loading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : isOpen ? (
            <ChevronDown size={12} />
          ) : (
            <ChevronRight size={12} />
          )
        ) : (
          <span className="w-3" />
        )}
        {entry.isDirectory ? (
          isOpen ? (
            <FolderOpen size={13} className="shrink-0 text-accent" />
          ) : (
            <Folder size={13} className="shrink-0 text-text-muted" />
          )
        ) : (
          <File size={13} className="shrink-0 text-text-muted" />
        )}
        <span className="truncate">{entry.name}</span>
      </button>
      {entry.isDirectory &&
        isOpen &&
        children?.map((child) => (
          <FileTreeRow
            key={child.path}
            entry={child}
            depth={depth + 1}
            projectId={projectId}
            worktreePath={worktreePath}
            expanded={expanded}
            onToggle={onToggle}
            onSelect={onSelect}
            selectedPath={selectedPath}
          />
        ))}
    </>
  );
}

function FilesPane({ projectId, worktreePath }: { projectId: string | null; worktreePath?: string }) {
  const [entries, setEntries] = useState<FileTreeEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRoot = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const items = await invoke<string[]>("project_list_dir", {
        projectId,
        path: ".",
        worktreePath: worktreePath || null,
      });
      setEntries(
        items.map((name) => ({
          name: name.replace(/\/$/, ""),
          path: name.replace(/\/$/, ""),
          isDirectory: name.endsWith("/"),
        })),
      );
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setLoading(false);
    }
  }, [projectId, worktreePath]);

  useEffect(() => {
    queueMicrotask(() => {
      setExpanded(new Set());
      setSelectedPath(null);
      setContent("");
      void loadRoot();
    });
  }, [loadRoot]);

  const selectFile = async (path: string) => {
    if (!projectId) return;
    setSelectedPath(path);
    setContent("");
    setLoading(true);
    try {
      setContent(
        await invoke<string>("project_read", {
          projectId,
          path,
          offset: 1,
          limit: 2000,
          worktreePath: worktreePath || null,
        }),
      );
    } catch (nextError) {
      setContent(`Unable to open this file.\n\n${errorMessage(nextError)}`);
    } finally {
      setLoading(false);
    }
  };

  if (!projectId)
    return (
      <EmptyState
        icon={Folder}
        title="No project selected"
        detail="Choose a project to browse its files in this panel."
      />
    );
  const filteredEntries = entries.filter((entry) => !query || entry.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border/50 bg-input/40 px-2.5 py-1.5 focus-within:border-accent/60">
          <Search size={12} className="text-text-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter files"
            className="min-w-0 flex-1 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-muted"
          />
          {query && (
            <button onClick={() => setQuery("")} className="text-text-muted hover:text-text-primary">
              <X size={11} />
            </button>
          )}
        </div>
        <button
          onClick={() => void loadRoot()}
          className="rounded-md p-1.5 text-text-muted hover:bg-hover hover:text-text-primary"
          title="Refresh files"
        >
          <RefreshCw size={13} />
        </button>
      </div>
      {error ? (
        <EmptyState icon={AlertCircle} title="Couldn’t browse project" detail={error} />
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="w-[38%] min-w-[145px] overflow-y-auto border-r border-border/40 py-1">
            {loading && entries.length === 0 ? (
              <PanelSpinner label="Loading files…" />
            ) : (
              filteredEntries.map((entry) => (
                <FileTreeRow
                  key={entry.path}
                  entry={entry}
                  depth={0}
                  projectId={projectId}
                  worktreePath={worktreePath}
                  expanded={expanded}
                  onToggle={(path) =>
                    setExpanded((current) => {
                      const next = new Set(current);
                      if (next.has(path)) next.delete(path);
                      else next.add(path);
                      return next;
                    })
                  }
                  onSelect={(path) => void selectFile(path)}
                  selectedPath={selectedPath}
                />
              ))
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col bg-chat/40">
            {selectedPath ? (
              <>
                <div className="flex shrink-0 items-center justify-between border-b border-border/40 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText size={12} className="text-text-muted" />
                    <span className="truncate font-mono text-[11px] text-text-primary">
                      {fileNameFromPath(selectedPath)}
                    </span>
                  </div>
                  <span className="text-[9px] font-medium uppercase tracking-wider text-text-muted">
                    {languageFromPath(selectedPath)}
                  </span>
                </div>
                <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[11px] leading-5 text-text-secondary selection:bg-accent/30">
                  <code>{loading && !content ? "Loading…" : content}</code>
                </pre>
              </>
            ) : (
              <EmptyState
                icon={FileText}
                title="Open a file"
                detail="Select a file from the project tree to inspect its contents."
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function TerminalPane({
  projectId,
  projectPath,
  worktreePath,
  canExecute,
}: {
  projectId: string | null;
  projectPath?: string;
  worktreePath?: string;
  canExecute: boolean;
}) {
  const [command, setCommand] = useState("");
  const [entries, setEntries] = useState<TerminalEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const endRef = useRef<HTMLDivElement | null>(null);
  const nextId = useRef(0);
  const running = entries.some((entry) => entry.status === "running");
  const cwd = worktreePath || projectPath;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries]);

  const runCommand = async (event: FormEvent) => {
    event.preventDefault();
    const nextCommand = command.trim();
    if (!nextCommand || !projectId || !cwd || running) return;
    const id = ++nextId.current;
    setCommand("");
    setHistoryIndex(-1);
    setEntries((current) => [
      ...current,
      { id, command: nextCommand, output: "Waiting for confirmation…", status: "running" },
    ]);
    try {
      const output = await invoke<string>("project_bash", {
        projectId,
        command: nextCommand,
        cwd,
        timeout: 120000,
        runInBackground: false,
        worktreePath: worktreePath || null,
      });
      setEntries((current) =>
        current.map((entry) =>
          entry.id === id
            ? { ...entry, output: output || "Command completed with no output.", status: "success" }
            : entry,
        ),
      );
    } catch (nextError) {
      setEntries((current) =>
        current.map((entry) =>
          entry.id === id ? { ...entry, output: errorMessage(nextError), status: "error" } : entry,
        ),
      );
    }
  };

  const commandHistory = entries.map((entry) => entry.command);
  const handleCommandKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    if (event.key === "ArrowUp" && commandHistory.length) {
      const next = historyIndex < 0 ? commandHistory.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(next);
      setCommand(commandHistory[next]);
    } else if (event.key === "ArrowDown" && historyIndex >= 0) {
      const next = historyIndex + 1;
      setHistoryIndex(next >= commandHistory.length ? -1 : next);
      setCommand(next >= commandHistory.length ? "" : commandHistory[next]);
    }
  };

  if (!projectId || !cwd)
    return (
      <EmptyState
        icon={TerminalSquare}
        title="No project terminal"
        detail="Select a project to run commands in its workspace."
      />
    );

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0b0d10] text-gray-200">
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-3 py-2 font-mono text-[10px] text-gray-500">
        <div className="flex min-w-0 items-center gap-2">
          <Circle size={7} className="fill-emerald-500 text-emerald-500" />
          <span className="truncate">{cwd}</span>
        </div>
        <button
          onClick={() => setEntries([])}
          className="rounded p-1 text-gray-500 hover:bg-white/10 hover:text-gray-200"
          title="Clear terminal"
        >
          <Trash2 size={12} />
        </button>
      </div>
      {!canExecute && (
        <div className="border-b border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
          This project needs Full permission before terminal commands can run.
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-3 font-mono text-[11px] leading-5 selection:bg-blue-500/30">
        {entries.length === 0 && (
          <div className="text-gray-600">
            Sythoria workspace terminal
            <br />
            Commands require confirmation before execution.
          </div>
        )}
        {entries.map((entry) => (
          <div key={entry.id} className="mb-4">
            <div className="flex gap-2 text-gray-200">
              <span className="select-none text-emerald-400">❯</span>
              <span className="whitespace-pre-wrap">{entry.command}</span>
            </div>
            <pre
              className={`mt-1 whitespace-pre-wrap break-words ${entry.status === "error" ? "text-red-400" : entry.status === "running" ? "text-amber-300" : "text-gray-400"}`}
            >
              {entry.output}
            </pre>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form
        onSubmit={(event) => void runCommand(event)}
        className="flex shrink-0 items-center gap-2 border-t border-white/10 bg-white/[0.025] px-3 py-2 font-mono"
      >
        <span className="text-sm text-emerald-400">❯</span>
        <input
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={handleCommandKeyDown}
          disabled={!canExecute || running}
          spellCheck={false}
          autoCapitalize="off"
          placeholder={canExecute ? "Run a command…" : "Full project permission required"}
          className="min-w-0 flex-1 bg-transparent text-xs text-gray-100 outline-none placeholder:text-gray-600 disabled:cursor-not-allowed"
        />
        <button
          type="submit"
          disabled={!command.trim() || !canExecute || running}
          className="rounded-md bg-white/10 p-1.5 text-gray-300 transition-colors hover:bg-white/15 disabled:opacity-30"
          title="Run command"
        >
          {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
        </button>
      </form>
    </div>
  );
}

function ActivityPane({ activeId }: { activeId: string | null }) {
  const conversations = useChatStore((s) => s.conversations);
  const stopStreaming = useChatStore((s) => s.stopStreaming);
  const setActiveSubagentId = useUIStore((s) => s.setActiveSubagentId);
  const tasks = useUIStore((s) => s.backgroundTasks);
  const clearTasks = useUIStore((s) => s.clearTasks);
  const subagents = conversations.filter(
    (conversation) => conversation.isSubagent && conversation.parentId === activeId,
  );

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">Agents</h3>
        <span className="text-[10px] text-text-muted">{subagents.length}</span>
      </div>
      <div className="space-y-2">
        {subagents.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/50 px-4 py-6 text-center text-xs text-text-muted">
            No subagents in this task.
          </div>
        ) : (
          subagents.map((agent) => (
            <div
              key={agent.id}
              onClick={() => setActiveSubagentId(agent.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setActiveSubagentId(agent.id);
                }
              }}
              role="button"
              tabIndex={0}
              className="flex w-full items-center gap-3 rounded-xl border border-border/40 bg-surface/40 p-3 text-left transition-colors hover:bg-hover/60"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <Bot size={15} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-text-primary">{agent.role || agent.title}</p>
                <p className="mt-0.5 text-[10px] capitalize text-text-muted">{agent.status || "idle"}</p>
              </div>
              {agent.status === "running" ? (
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    stopStreaming(agent.id);
                  }}
                  className="rounded p-1.5 text-red-400 hover:bg-red-500/10"
                  title="Stop agent"
                >
                  <Square size={11} />
                </button>
              ) : agent.status === "error" ? (
                <AlertCircle size={14} className="text-red-400" />
              ) : (
                <CheckCircle2 size={14} className="text-emerald-500" />
              )}
            </div>
          ))
        )}
      </div>
      <div className="mb-3 mt-6 flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">Task history</h3>
        {tasks.length > 0 && (
          <button onClick={clearTasks} className="text-[10px] text-text-muted hover:text-text-primary">
            Clear
          </button>
        )}
      </div>
      <div className="space-y-1.5">
        {tasks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/50 px-4 py-6 text-center text-xs text-text-muted">
            No background activity yet.
          </div>
        ) : (
          tasks.map((task) => (
            <div key={task.id} className="flex items-center gap-2.5 rounded-lg border border-border/30 px-3 py-2.5">
              <span
                className={`h-1.5 w-1.5 rounded-full ${task.status === "running" ? "animate-pulse bg-accent" : task.status === "error" ? "bg-red-500" : "bg-emerald-500"}`}
              />
              <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">{task.title}</span>
              <span className="text-[9px] capitalize text-text-muted">{task.status}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ArtifactPane() {
  const artifact = useUIStore((s) => s.activeArtifact);
  const setArtifact = useUIStore((s) => s.setActiveArtifact);
  const [allowNetwork, setAllowNetwork] = useState(false);
  if (!artifact)
    return (
      <EmptyState
        icon={Sparkles}
        title="Nothing to preview"
        detail="HTML, SVG, and generated artifacts can be opened here without leaving the task."
      />
    );
  const csp = allowNetwork
    ? "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: http: https:; connect-src http: https: ws: wss:;"
    : "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:;";
  const srcDoc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}"><style>body{margin:0;padding:16px;font-family:system-ui;background:#fff;color:#111}</style></head><body>${artifact.content}</body></html>`;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/40 px-3 py-2">
        <span className="truncate text-xs font-medium text-text-primary">{artifact.title}</span>
        <div className="flex items-center gap-2">
          {artifact.type !== "mermaid" && (
            <label className="flex items-center gap-1.5 text-[10px] text-text-muted">
              <input
                type="checkbox"
                checked={allowNetwork}
                onChange={(event) => setAllowNetwork(event.target.checked)}
                className="accent-accent"
              />
              Network
            </label>
          )}
          <button
            onClick={() => setArtifact(null)}
            className="rounded p-1 text-text-muted hover:bg-hover hover:text-text-primary"
          >
            <X size={12} />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 bg-[#111318] p-2">
        {artifact.type === "html" || artifact.type === "svg" ? (
          <iframe
            title={artifact.title}
            srcDoc={srcDoc}
            sandbox="allow-scripts"
            className="h-full w-full rounded-lg border-0 bg-white"
          />
        ) : (
          <pre className="h-full overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 p-3 font-mono text-xs text-gray-300">
            {artifact.content}
          </pre>
        )}
      </div>
    </div>
  );
}

function PinnedSummary({
  projectId,
  project,
  worktreePath,
  conversation,
}: {
  projectId: string | null;
  project?: Project;
  worktreePath?: string;
  conversation?: Conversation;
}) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [diffFiles, setDiffFiles] = useState<DiffFile[]>([]);
  const [loading, setLoading] = useState(false);
  const tasks = useUIStore((s) => s.backgroundTasks);
  const setActiveTab = useUIStore((s) => s.setActiveAuxTab);
  const setPinned = useUIStore((s) => s.setAuxSummaryPinned);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setStatus(null);
      setDiffFiles([]);
      return;
    }
    setLoading(true);
    try {
      const [nextStatus, diff] = await Promise.all([
        invoke<GitStatus>("git_get_status", { projectId, worktreePath: worktreePath || null }),
        invoke<string>("git_diff_changes", { projectId, worktreePath: worktreePath || null }),
      ]);
      setStatus(nextStatus);
      setDiffFiles(parseGitDiff(diff));
    } catch {
      setStatus(null);
      setDiffFiles([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, worktreePath]);

  useEffect(() => {
    queueMicrotask(() => void refresh());
  }, [refresh]);

  const additions = diffFiles.reduce((total, file) => total + file.additions, 0);
  const deletions = diffFiles.reduce((total, file) => total + file.deletions, 0);
  const changedFiles = new Set([
    ...diffFiles.map((file) => file.path),
    ...(status?.stagedFiles || []),
    ...(status?.unstagedFiles || []),
  ]).size;
  const branch = conversation?.pendingWorktree?.branch || status?.branch || "No branch";
  const recentTasks = tasks.slice(0, 3);

  const sourceMap = new Map<string, { title: string; url?: string; isAttachment: boolean }>();
  for (const message of conversation?.messages || []) {
    for (const source of message.sources || []) {
      sourceMap.set(source.url, { title: source.title, url: source.url, isAttachment: false });
    }
    for (const attachment of message.attachments || []) {
      sourceMap.set(`attachment:${attachment.id}`, { title: attachment.name, isAttachment: true });
    }
  }
  const sources = [...sourceMap.values()].slice(-3).reverse();

  return (
    <motion.aside
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: motionTokens.duration.fast }}
      className="shrink-0 overflow-hidden border-b border-border/40 bg-chat/35"
      aria-label="Pinned workspace summary"
    >
      <div className="max-h-[360px] overflow-y-auto p-3">
        <div className="rounded-2xl border border-border/50 bg-surface/80 px-3.5 py-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-medium text-text-muted">Environment</span>
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => void refresh()}
                disabled={loading}
                className="rounded-md p-1.5 text-text-muted hover:bg-hover hover:text-text-primary disabled:opacity-50"
                title="Refresh summary"
              >
                <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
              </button>
              <button
                onClick={() => setPinned(false)}
                className="rounded-md p-1.5 text-text-muted hover:bg-hover hover:text-text-primary"
                title="Unpin summary"
              >
                <PinOff size={12} />
              </button>
            </div>
          </div>

          <button
            onClick={() => setActiveTab("review")}
            className="flex w-full items-center gap-2.5 rounded-lg px-1 py-1.5 text-left text-xs text-text-secondary hover:bg-hover/60"
          >
            <ClipboardCheck size={13} className="shrink-0 text-text-muted" />
            <span className="min-w-0 flex-1">Changes</span>
            <span className="font-mono text-[11px]">
              <span className="text-emerald-500">+{additions}</span>
              <span className="ml-1.5 text-red-400">−{deletions}</span>
            </span>
          </button>
          <div className="flex items-center gap-2.5 px-1 py-1.5 text-xs text-text-secondary">
            <HardDrive size={13} className="shrink-0 text-text-muted" />
            <span className="min-w-0 flex-1 truncate">{project?.name || "No local project"}</span>
            {changedFiles > 0 && <span className="text-[10px] text-text-muted">{changedFiles} files</span>}
          </div>
          <div className="flex items-center gap-2.5 px-1 py-1.5 text-xs text-text-secondary">
            <GitBranch size={13} className="shrink-0 text-text-muted" />
            <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{branch}</span>
            {worktreePath && (
              <span className="rounded-full bg-accent/10 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-accent">
                Isolated
              </span>
            )}
          </div>
          <div className="flex items-center gap-2.5 px-1 py-1.5 text-xs text-text-secondary">
            <GitCommitHorizontal size={13} className="shrink-0 text-text-muted" />
            <span className="min-w-0 flex-1">Workspace permission</span>
            <span className="text-[10px] capitalize text-text-muted">{project?.permissions || "none"}</span>
          </div>

          <div className="my-3 border-t border-border/40" />
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-medium text-text-muted">Background processes</span>
            <button
              onClick={() => setActiveTab("activity")}
              className="rounded p-1 text-text-muted hover:bg-hover hover:text-text-primary"
              title="Open activity"
            >
              <Activity size={11} />
            </button>
          </div>
          {recentTasks.length === 0 ? (
            <p className="px-1 py-1 text-[11px] text-text-muted/70">No recent processes</p>
          ) : (
            <div className="space-y-0.5">
              {recentTasks.map((task) => (
                <button
                  key={task.id}
                  onClick={() => setActiveTab("activity")}
                  className="flex w-full items-center gap-2.5 rounded-md px-1 py-1.5 text-left text-[11px] text-text-secondary hover:bg-hover/60"
                >
                  <TerminalSquare size={12} className="shrink-0 text-text-muted" />
                  <span className="min-w-0 flex-1 truncate font-mono">{task.title}</span>
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      task.status === "running"
                        ? "animate-pulse bg-accent"
                        : task.status === "error"
                          ? "bg-red-500"
                          : "bg-emerald-500"
                    }`}
                  />
                </button>
              ))}
            </div>
          )}

          <div className="my-3 border-t border-border/40" />
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-medium text-text-muted">Sources</span>
            <span className="text-[10px] text-text-muted">{sourceMap.size}</span>
          </div>
          {sources.length === 0 ? (
            <p className="px-1 py-1 text-[11px] text-text-muted/70">No sources attached</p>
          ) : (
            <div className="space-y-0.5">
              {sources.map((source) =>
                source.url ? (
                  <a
                    key={source.url}
                    href={normalizeExternalUrl(source.url)?.href}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => {
                      event.preventDefault();
                      void openExternalUrl(source.url!, { confirmInsecure: true });
                    }}
                    className="flex items-center gap-2.5 rounded-md px-1 py-1.5 text-[11px] text-text-secondary hover:bg-hover/60 hover:text-text-primary"
                  >
                    <Link2 size={12} className="shrink-0 text-text-muted" />
                    <span className="truncate">{source.title}</span>
                  </a>
                ) : (
                  <div
                    key={source.title}
                    className="flex items-center gap-2.5 rounded-md px-1 py-1.5 text-[11px] text-text-secondary"
                  >
                    <Paperclip size={12} className="shrink-0 text-text-muted" />
                    <span className="truncate">{source.title}</span>
                  </div>
                ),
              )}
            </div>
          )}
        </div>
      </div>
    </motion.aside>
  );
}

export function AuxiliaryPanel() {
  const activeTab = useUIStore((s) => s.activeAuxTab);
  const setActiveTab = useUIStore((s) => s.setActiveAuxTab);
  const setOpen = useUIStore((s) => s.setAuxPanelOpen);
  const isPanelExpanded = useUIStore((s) => s.isAuxPanelExpanded);
  const setPanelExpanded = useUIStore((s) => s.setAuxPanelExpanded);
  const isSummaryPinned = useUIStore((s) => s.isAuxSummaryPinned);
  const activeArtifact = useUIStore((s) => s.activeArtifact);
  const activeId = useChatStore((s) => s.activeId);
  const activeConversation = useChatStore((s) =>
    s.conversations.find((conversation) => conversation.id === s.activeId),
  );
  const { activeProjectId, projects, activeWorktreePath } = useProjectStore();
  const projectId = activeConversation?.projectId || activeProjectId;
  const project = projects.find((item) => item.id === projectId);
  const worktreePath = activeConversation?.pendingWorktree?.path || activeWorktreePath || undefined;

  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [setOpen]);

  return (
    <section className="flex h-full min-h-0 flex-col bg-surface" aria-label="Workspace sidebar">
      <header className="shrink-0 border-b border-border/50">
        <div className="flex h-11 items-center justify-between gap-3 px-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/10 text-accent">
              <Code2 size={13} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-text-primary">Workspace</p>
              <p className="truncate text-[9px] text-text-muted">
                {project?.name || "No project"}
                {worktreePath ? " - isolated" : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPanelExpanded(!isPanelExpanded)}
              className="rounded-md p-1.5 text-text-muted hover:bg-hover hover:text-text-primary"
              title={isPanelExpanded ? "Minimize workspace sidebar" : "Expand workspace sidebar"}
              aria-label={isPanelExpanded ? "Minimize workspace sidebar" : "Expand workspace sidebar"}
            >
              {isPanelExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
          </div>
        </div>
        <nav className="flex items-center gap-0.5 overflow-x-auto px-2" aria-label="Workspace views">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`relative flex shrink-0 items-center gap-1.5 px-2.5 py-2 text-[11px] font-medium transition-colors ${activeTab === id ? "text-text-primary" : "text-text-muted hover:text-text-secondary"}`}
              aria-current={activeTab === id ? "page" : undefined}
            >
              <Icon size={12} />
              <span>{label}</span>
              {id === "artifacts" && activeArtifact && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
              {activeTab === id && <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-accent" />}
            </button>
          ))}
        </nav>
      </header>
      <AnimatePresence initial={false}>
        {isSummaryPinned && (
          <PinnedSummary
            projectId={projectId}
            project={project}
            worktreePath={worktreePath}
            conversation={activeConversation}
          />
        )}
      </AnimatePresence>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeTab}
            className="absolute inset-0 flex flex-col"
            initial={{ opacity: 0, x: 5 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -5 }}
            transition={{ duration: motionTokens.duration.fast }}
          >
            {activeTab === "review" && (
              <ReviewPane projectId={projectId} worktreePath={worktreePath} conversationId={activeId} />
            )}
            {activeTab === "files" && <FilesPane projectId={projectId} worktreePath={worktreePath} />}
            {activeTab === "terminals" && (
              <TerminalPane
                projectId={projectId}
                projectPath={project?.path}
                worktreePath={worktreePath}
                canExecute={project?.permissions === "full"}
              />
            )}
            {activeTab === "activity" && <ActivityPane activeId={activeId} />}
            {activeTab === "artifacts" && <ArtifactPane />}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
