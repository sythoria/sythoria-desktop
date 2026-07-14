import { useState, useRef, useEffect, useCallback, memo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Plus,
  Paperclip,
  ChevronDown,
  Check,
  Search,
  Square,
  Loader2,
  Cpu,
  X,
  Image as ImageIcon,
  FileText as FileTextIcon,
  ArrowUp,
  Folder,
  FolderPlus,
  ShieldAlert,
  Shield,
  FolderOpen,
  Settings,
  Mic,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useWhisperStore } from "../store/useWhisperStore";
import { WHISPER_PRESETS } from "../config/whisperPresets";
import { STATUS_COLORS, ModelConfig, McpServerConfig, McpServerStatus, Attachment, ProjectPermission } from "../types";
import type { ModelStatuses } from "../types";
import { MAX_INPUT_LENGTH, MAX_TEXTAREA_HEIGHT } from "../config/constants";

import { formatFileSize } from "../utils/attachments";
import { springs, motionTokens } from "../lib/motion-tokens";
import { useAttachments } from "../hooks/useAttachments";
import { useUIStore } from "../store/useUIStore";
import { useModelStore } from "../store/useModelStore";
import { useChatStore } from "../store/useChatStore";
import { useProjectStore } from "../store/useProjectStore";
import { estimateConversationTokens } from "../utils/tokens";
import { ImagePreviewModal } from "./ui/ImagePreviewModal";
import { useTranslation } from "../utils/i18n";

interface InputBarProps {
  models: ModelConfig[];
  onSend: (message: string, attachments?: Attachment[]) => void;
  selectedModel: string;
  onModelChange: (model: string) => void;
  disabled?: boolean;
  modelStatuses: ModelStatuses;
  isSearchEnabled: boolean;
  onToggleSearch: (enabled: boolean) => void;
  mcpServers: McpServerConfig[];
  mcpServerStatuses: Record<string, McpServerStatus>;
  enabledMcpServerIds: Set<string>;
  onToggleMcpServer: (serverId: string) => void;
  isStreaming?: boolean;
  onStop?: () => void;
  centered?: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting\u2026",
  connected: "Connected",
  error: "Connection error",
};

const STATUS_KEYS: Record<string, string> = {
  disconnected: "status.disconnected",
  connecting: "status.connecting",
  connected: "status.connected",
  error: "status.error",
};

export default memo(function InputBar({
  models,
  onSend,
  selectedModel,
  onModelChange,
  disabled,
  modelStatuses,
  isSearchEnabled,
  onToggleSearch,
  mcpServers,
  mcpServerStatuses,
  enabledMcpServerIds,
  onToggleMcpServer,
  isStreaming,
  onStop,
  centered = false,
}: InputBarProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [modelOpen, setModelOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const plusDropdownRef = useRef<HTMLDivElement>(null);
  const projectDropdownRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const { projects, activeProjectId, setActiveProject, updateProject, isProjectsEnabled } = useProjectStore();
  const openProjectConfigModal = useUIStore((s) => s.openProjectConfigModal);
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);
  const activeProject = projects.find((p) => p.id === activeProjectId);

  const { attachments, setAttachments, isDragging, setIsDragging, fileInputRef, handleAddFiles, handleFileChange } =
    useAttachments();

  const [previewImageIndex, setPreviewImageIndex] = useState<number | null>(null);
  const imageAttachments = attachments.filter((a) => a.kind === "image" && a.dataUrl);
  const [voiceDraft, setVoiceDraft] = useState<string>("");
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRecordingActiveRef = useRef<boolean>(false);
  const initialValueRef = useRef<string>("");
  const recognitionRef = useRef<any>(null);

  const sendMessageShortcut = useUIStore((s) => s.sendMessageShortcut);
  const clearInputOnEscape = useUIStore((s) => s.clearInputOnEscape);
  const baseTextSize = useUIStore((s) => s.baseTextSize);
  const showContextWindow = useUIStore((s) => s.showContextWindow);
  const disableBgActivity = useUIStore((s) => s.disableBgActivity);

  const activeConversationId = useChatStore((s) => s.activeId);
  const conversation = useChatStore((s) => s.conversations.find((c) => c.id === activeConversationId));
  const setConversationProject = useChatStore((s) => s.setConversationProject);
  const systemPrompt = useModelStore((s) => s.systemPrompt);

  const {
    isVoiceEnabled,
    selectedModelId,
    customModelPath,
    language,
    isRecording,
    isTranscribing,
    setIsRecording,
    setIsTranscribing,
    init: initWhisper,
    downloadedFiles,
    sttProvider,
    cloudApiKey,
    cloudApiUrl,
    cloudModel,
    refinementModelId,
  } = useWhisperStore();

  useEffect(() => {
    initWhisper();
    return () => {
      if (recordingTimeoutRef.current) {
        clearTimeout(recordingTimeoutRef.current);
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  const handleToggleVoice = async () => {
    // Check if Whisper model is ready (chosen, downloaded, or loaded)
    let isModelReady = false;
    let modelPath = "";
    if (selectedModelId === "custom" && customModelPath) {
      isModelReady = true;
      modelPath = customModelPath;
    } else {
      const preset = WHISPER_PRESETS.find((p) => p.id === selectedModelId);
      if (preset) {
        modelPath = preset.fileName;
        if (downloadedFiles.includes(preset.fileName)) {
          isModelReady = true;
        }
      }
    }

    if (sttProvider === "local") {
      if (!selectedModelId || !modelPath || !isModelReady) {
        useUIStore.getState().addToast(
          <span>
            Voice input model is not loaded, visit{" "}
            <button
              onClick={() => {
                useUIStore.getState().setView("settings");
                useUIStore.getState().setActiveSection("whisper");
              }}
              className="text-red-200 underline font-medium hover:text-white transition-colors cursor-pointer"
            >
              settings/voiceinput
            </button>{" "}
            for more details.
          </span>,
          "error",
        );
        return;
      }
    } else if (sttProvider === "cloud") {
      if (!cloudApiKey || !cloudApiUrl) {
        useUIStore.getState().addToast("Cloud STT API Key or URL is not configured.", "error");
        return;
      }
    }

    if (isRecording) {
      isRecordingActiveRef.current = false;
      if (recordingTimeoutRef.current) {
        clearTimeout(recordingTimeoutRef.current);
        recordingTimeoutRef.current = null;
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {
          console.warn("Speech recognition stop error:", e);
        }
        recognitionRef.current = null;
      }
      setIsRecording(false);
      setIsTranscribing(true);

      try {
        await invoke("stop_recording");

        let transcription = "";
        if (sttProvider === "cloud") {
          transcription = await invoke<string>("transcribe_audio_cloud", {
            apiUrl: cloudApiUrl,
            apiKey: cloudApiKey,
            model: cloudModel,
            language,
          });
        } else {
          transcription = await invoke<string>("transcribe_audio", {
            modelPath,
            audioData: [],
            language,
          });
        }

        const rawText = transcription.trim();
        if (rawText) {
          const combinedRaw = initialValueRef.current ? `${initialValueRef.current} ${rawText}` : rawText;
          setValue(combinedRaw);
          setVoiceDraft(combinedRaw);

          useUIStore.getState().addToast("Refining speech...", "info");

          const streamId = "refine-" + Math.random().toString().slice(2, 10);
          let accumulated = "";

          const { listen } = await import("@tauri-apps/api/event");

          const unlistenChunk = await listen<{ streamId: string; content: string }>("chat-stream-chunk", (event) => {
            if (event.payload.streamId === streamId) {
              accumulated += event.payload.content;
              const combinedRefined = initialValueRef.current
                ? `${initialValueRef.current} ${accumulated}`
                : accumulated;
              setValue(combinedRefined);
            }
          });

          const modelStore = useModelStore.getState();
          const targetModelId = refinementModelId || modelStore.selectedModel || modelStore.models[0]?.id;
          const currentModel = modelStore.models.find((m) => m.id === targetModelId) || modelStore.models[0];

          if (currentModel) {
            setValue(initialValueRef.current);

            await invoke<string>("chat_stream", {
              configId: currentModel.id,
              messages: [
                {
                  role: "system",
                  content:
                    "Clean filler words (uh, um, then, like) and speech bugs from this transcript. Output ONLY refined sentences. Do not add intro/outro.",
                },
                { role: "user", content: combinedRaw },
              ],
              temperature: 0.1,
              streamId,
              maxTokens: 500,
            });

            unlistenChunk();
          }
        }
      } catch (err: any) {
        useUIStore.getState().addToast(`Voice transcription failed: ${err.message || err}`, "error");
      } finally {
        setIsTranscribing(false);
        setVoiceDraft("");
      }
    } else {
      try {
        initialValueRef.current = value;
        await invoke("start_recording");
        setIsRecording(true);

        isRecordingActiveRef.current = true;
        const pollTranscription = async () => {
          if (!isRecordingActiveRef.current) return;
          try {
            if (isRecordingActiveRef.current) {
              let transcription = "";
              if (sttProvider === "cloud") {
                transcription = await invoke<string>("transcribe_audio_cloud", {
                  apiUrl: cloudApiUrl,
                  apiKey: cloudApiKey,
                  model: cloudModel,
                  language,
                });
              } else {
                transcription = await invoke<string>("transcribe_audio", {
                  modelPath,
                  audioData: [],
                  language,
                });
              }

              if (isRecordingActiveRef.current && transcription.trim()) {
                const combined = initialValueRef.current
                  ? `${initialValueRef.current} ${transcription.trim()}`
                  : transcription.trim();
                setValue(combined);
                setVoiceDraft(combined);
              }
            }
          } catch (e) {
            console.warn("Live transcription error:", e);
          }
          if (isRecordingActiveRef.current) {
            recordingTimeoutRef.current = setTimeout(pollTranscription, 1200) as any;
          }
        };

        recordingTimeoutRef.current = setTimeout(pollTranscription, 1200) as any;
      } catch (err: any) {
        useUIStore.getState().addToast(`Could not access microphone: ${err.message || err}`, "error");
      }
    }
  };

  const textSizeClass =
    {
      small: "text-xs",
      medium: "text-sm",
      large: "text-base",
      xlarge: "text-lg",
    }[baseTextSize] || "text-sm";

  const anyToolActive = isSearchEnabled || enabledMcpServerIds.size > 0;
  const connectedMcpServers = mcpServers.filter((s) => (mcpServerStatuses[s.id] ?? "disconnected") === "connected");
  const enabledServers = mcpServers.filter((s) => enabledMcpServerIds.has(s.id));

  const isOverLimit = value.length > MAX_INPUT_LENGTH;
  const trimmed = value.trim();
  const canSend = (trimmed.length > 0 || attachments.length > 0) && !isOverLimit && !disabled && !isStreaming;
  const enabledModels = models.filter((m) => m.enabled !== false);

  useEffect(() => {
    if (isStreaming && textareaRef.current) {
      textareaRef.current.blur();
    }
  }, [isStreaming]);

  const adjustHeight = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      const scrollHeight = textareaRef.current.scrollHeight;
      const newHeight = Math.max(20, Math.min(scrollHeight, MAX_TEXTAREA_HEIGHT));
      textareaRef.current.style.height = newHeight + "px";
      textareaRef.current.style.overflowY = scrollHeight > MAX_TEXTAREA_HEIGHT ? "auto" : "hidden";
    }
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  useEffect(() => {
    window.addEventListener("resize", adjustHeight);
    let resizeObserver: ResizeObserver | null = null;

    if (textareaRef.current) {
      resizeObserver = new ResizeObserver(() => {
        adjustHeight();
      });
      resizeObserver.observe(textareaRef.current);
    }

    return () => {
      window.removeEventListener("resize", adjustHeight);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [adjustHeight]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setModelOpen(false);
        setFocusedIndex(-1);
      }
      if (plusDropdownRef.current && !plusDropdownRef.current.contains(e.target as Node)) {
        setPlusOpen(false);
      }
      if (projectDropdownRef.current && !projectDropdownRef.current.contains(e.target as Node)) {
        setProjectDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleToggleProjectPermission = (perm: ProjectPermission) => {
    if (!activeProject) return;
    if (perm === "full" && activeProject.permissions !== "full") {
      const confirmed = window.confirm(
        "WARNING: Enabling Full Shell gives the AI complete access to run arbitrary shell commands on your system. Only enable this for trusted tasks and projects. Continue?",
      );
      if (!confirmed) return;
    }
    updateProject(activeProject.id, { permissions: perm });
    setProjectDropdownOpen(false);
  };

  const handleSubmit = useCallback(() => {
    if (!canSend) return;
    if (attachments.length > 0) {
      onSend(trimmed, attachments);
    } else {
      onSend(trimmed);
    }
    setValue("");
    setAttachments([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [canSend, trimmed, attachments, onSend, setAttachments]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (modelOpen || plusOpen) {
        if (e.key === "Escape") {
          setModelOpen(false);
          setPlusOpen(false);
          setFocusedIndex(-1);
        }
        if (modelOpen) {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setFocusedIndex((i) => Math.min(i + 1, enabledModels.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setFocusedIndex((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && focusedIndex >= 0) {
            e.preventDefault();
            onModelChange(enabledModels[focusedIndex].id);
            setModelOpen(false);
            setFocusedIndex(-1);
          }
        }
        return;
      }

      if (clearInputOnEscape && e.key === "Escape") {
        setValue("");
        return;
      }

      if (e.key === "Enter") {
        if (sendMessageShortcut === "ctrl-enter") {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            handleSubmit();
          }
        } else {
          if (!e.shiftKey) {
            e.preventDefault();
            handleSubmit();
          }
        }
      }
    },
    [
      modelOpen,
      plusOpen,
      focusedIndex,
      enabledModels,
      onModelChange,
      handleSubmit,
      sendMessageShortcut,
      clearInputOnEscape,
    ],
  );

  useEffect(() => {
    if (focusedIndex >= 0 && itemRefs.current[focusedIndex]) {
      itemRefs.current[focusedIndex]?.focus();
    }
  }, [focusedIndex]);

  const handleClipboardPaste = useCallback(
    async (clipboardData: DataTransfer | null) => {
      const files: File[] = [];

      // 1. Try to extract images from files
      if (clipboardData && clipboardData.files && clipboardData.files.length > 0) {
        for (let i = 0; i < clipboardData.files.length; i++) {
          const file = clipboardData.files[i];
          if (file.type && file.type.startsWith("image/")) {
            files.push(file);
          }
        }
      }

      // 2. Fall back to items (handles screenshots, copied browser images, Linux clipboard placeholders)
      if (files.length === 0 && clipboardData && clipboardData.items && clipboardData.items.length > 0) {
        for (let i = 0; i < clipboardData.items.length; i++) {
          const item = clipboardData.items[i];
          if (item.type && item.type.startsWith("image/")) {
            const file = item.getAsFile();
            if (file) {
              files.push(file);
            }
          }
        }
      }

      // 3. Fall back to direct Navigator Clipboard API if event-based data is restricted/empty (WebKit2GTK/Linux edge cases)
      if (
        files.length === 0 &&
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        typeof navigator.clipboard.read === "function"
      ) {
        try {
          const clipboardItems = await navigator.clipboard.read();
          for (const item of clipboardItems) {
            for (const type of item.types) {
              if (type.startsWith("image/")) {
                const blob = await item.getType(type);
                const file = new File([blob], "image.png", { type });
                files.push(file);
              }
            }
          }
        } catch (err) {
          console.warn("Navigator clipboard read failed:", err);
        }
      }

      if (files.length > 0) {
        await handleAddFiles(files);
        return true;
      }
      return false;
    },
    [handleAddFiles],
  );

  useEffect(() => {
    const handleGlobalPaste = async (e: ClipboardEvent) => {
      const target = e.target as HTMLElement;
      const isInputOrTextarea = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
      if (isInputOrTextarea && target.id !== "chat-input") {
        return;
      }

      if (disabled || isStreaming) return;

      const clipboardData = e.clipboardData;
      if (!clipboardData) return;

      // Check synchronously to call preventDefault
      const types = clipboardData.types;
      const isFileOrImage = types && (types.includes("Files") || Array.from(types).some((t) => t.startsWith("image/")));

      if (isFileOrImage) {
        e.preventDefault();
        await handleClipboardPaste(clipboardData);
        textareaRef.current?.focus();
      }
    };

    document.addEventListener("paste", handleGlobalPaste);
    return () => {
      document.removeEventListener("paste", handleGlobalPaste);
    };
  }, [disabled, isStreaming, handleClipboardPaste]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    if (val.length <= MAX_INPUT_LENGTH + 100) {
      setValue(val);
      if (voiceDraft && val.trim() !== voiceDraft.trim()) {
        setVoiceDraft("");
      }
    }
  };

  const currentModel =
    models.find((m) => m.id === selectedModel && m.enabled !== false) ??
    models.find((m) => m.enabled !== false) ??
    models[0];
  const currentStatus = modelStatuses[selectedModel] ?? "disconnected";

  const activeSystemPrompt =
    currentModel?.systemPromptOverride && currentModel.systemPromptOverride.trim()
      ? currentModel.systemPromptOverride
      : systemPrompt;
  const tokenBreakdown = estimateConversationTokens(conversation?.messages || [], activeSystemPrompt);
  const estimatedTokens = tokenBreakdown.total;
  const contextSize = currentModel?.contextSize;
  const contextSizeSet = typeof contextSize === "number" && contextSize > 0;
  const limit = contextSizeSet ? contextSize : 128000;
  const percentage = Math.min((estimatedTokens / limit) * 100, 100);

  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <div
      className={`transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
        centered
          ? "flex-1 flex flex-col items-center translate-y-[-7vh] pt-4"
          : "px-4 pb-[env(safe-area-inset-bottom,16px)] pt-2 md:px-0 md:pb-4"
      }`}
    >
      <div className={`w-full max-w-3xl mx-auto px-6 ${centered ? "" : "pb-4 md:pb-6 pt-2"}`}>
        <label htmlFor="chat-input" className="sr-only">
          Message
        </label>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled && !isStreaming) {
              setIsDragging(true);
            }
          }}
          onDragLeave={() => {
            setIsDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
          }}
          className={`flex flex-col items-stretch bg-input border border-input-border rounded-3xl px-4 py-2.5 transition-all focus-within:ring-2 focus-within:ring-accent/20 focus-within:border-accent/30 ${
            isOverLimit ? "ring-red-500/50 border-red-500/30" : ""
          } ${isStreaming ? "dark:animate-border-glow animate-border-glow-light" : ""} ${
            isDragging ? "ring-accent border-accent bg-active/40 scale-[1.01]" : ""
          }`}
        >
          {/* Hidden input element */}
          <input
            id="file-input-element"
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            multiple
            accept="image/*,.txt,.md,.json,.csv,.xml,.yaml,.yml,.js,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.java,.c,.h,.cpp,.hpp,.cs,.php,.swift,.kt,.scala,.sh,.bash,.zsh,.sql,.html,.css,.scss,.toml,.ini,.cfg,.log,.env"
            className="hidden"
          />

          {/* Attachments strip */}
          <AnimatePresence>
            {attachments.length > 0 && (
              <motion.div
                layout
                initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                animate={{ opacity: 1, height: "auto", marginBottom: 8 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                transition={springs.gentle}
                className="w-full overflow-hidden"
              >
                <div className="flex flex-wrap gap-3 w-full pb-3 border-b border-border/40">
                  {attachments.map((a) => {
                    const isImg = a.kind === "image" && a.dataUrl;
                    if (isImg) {
                      return (
                        <motion.div
                          layout
                          key={a.id}
                          initial={{ opacity: 0, scale: motionTokens.scale.subtle }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: motionTokens.scale.subtle }}
                          transition={springs.gentle}
                          onClick={() => {
                            const imgIdx = imageAttachments.findIndex((img) => img.id === a.id);
                            if (imgIdx !== -1) {
                              setPreviewImageIndex(imgIdx);
                            }
                          }}
                          className="relative group w-20 h-20 rounded-xl overflow-hidden border border-border bg-surface shadow-sm cursor-pointer select-none shrink-0"
                          title={`View ${a.name}`}
                        >
                          <img
                            src={a.dataUrl}
                            alt={a.name}
                            className="w-full h-full object-cover select-none transition-transform duration-300 group-hover:scale-105"
                          />
                          <span className="sr-only">{a.name}</span>
                          <div className="absolute inset-0 bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setAttachments((prev) => prev.filter((item) => item.id !== a.id));
                            }}
                            className="absolute top-1.5 right-1.5 p-1 rounded-full bg-surface border border-border shadow-sm text-text-muted hover:text-text-primary hover:bg-input transition-all duration-200 image-close-btn z-10"
                            title={t("chat.removeAttachment") || "Remove attachment"}
                          >
                            <X size={12} />
                          </button>
                        </motion.div>
                      );
                    }

                    return (
                      <motion.div
                        layout
                        key={a.id}
                        initial={{ opacity: 0, scale: motionTokens.scale.subtle }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: motionTokens.scale.subtle }}
                        transition={springs.gentle}
                        className="relative group flex items-center gap-1.5 rounded-lg border border-border bg-surface pl-2 pr-7 py-1 text-xs text-text-secondary select-none"
                      >
                        {a.kind === "image" ? (
                          <ImageIcon size={13} className="text-text-muted shrink-0" />
                        ) : (
                          <FileTextIcon size={13} className="text-text-muted shrink-0" />
                        )}
                        <span className="max-w-[120px] truncate font-medium" title={a.name}>
                          {a.name}
                        </span>
                        <span className="text-[10px] text-text-muted shrink-0">({formatFileSize(a.size)})</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setAttachments((prev) => prev.filter((item) => item.id !== a.id));
                          }}
                          className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded-full text-text-muted hover:text-text-primary hover:bg-hover transition-all duration-200 md:opacity-0 md:group-hover:opacity-100"
                          title={t("chat.removeAttachment") || "Remove attachment"}
                        >
                          <X size={12} />
                        </button>
                      </motion.div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-center gap-2 w-full">
            {/* Plus / tools button */}
            <div ref={plusDropdownRef} className="relative shrink-0">
              <button
                onClick={() => setPlusOpen(!plusOpen)}
                className={`p-1.5 rounded-full transition-colors flex items-center justify-center ${
                  anyToolActive
                    ? "text-text-primary bg-active"
                    : "text-text-muted hover:text-text-secondary hover:bg-hover"
                }`}
                aria-label={t("tooltip.attachOrSearch") || "Attach or search"}
                title={t("tooltip.attachOrSearch") || "Attach or search"}
                aria-expanded={plusOpen}
                aria-haspopup="menu"
              >
                <Plus size={20} />
              </button>

              <AnimatePresence>
                {plusOpen && (
                  <motion.div
                    className="absolute bottom-full left-0 mb-2 w-56 bg-surface border border-border rounded-xl p-1 z-50"
                    style={{ boxShadow: "var(--shadow-xl)" }}
                    role="menu"
                    aria-label="Attachment and search options"
                    initial={{ opacity: 0, y: 8, scale: motionTokens.scale.subtle }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: motionTokens.scale.subtle }}
                    transition={springs.gentle}
                  >
                    <button
                      onClick={() => {
                        setPlusOpen(false);
                        fileInputRef.current?.click();
                      }}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-text-secondary hover:bg-hover hover:text-text-primary transition-colors"
                      role="menuitem"
                    >
                      <Paperclip size={15} className="text-text-muted" />
                      <span>{t("chat.addFile") || "Add File"}</span>
                    </button>
                    <button
                      onClick={() => {
                        onToggleSearch(!isSearchEnabled);
                        setPlusOpen(false);
                      }}
                      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors ${
                        isSearchEnabled
                          ? "text-text-primary bg-active"
                          : "text-text-secondary hover:bg-hover hover:text-text-primary"
                      }`}
                      role="menuitemcheckbox"
                      aria-checked={isSearchEnabled}
                    >
                      <Search size={15} className={isSearchEnabled ? "text-text-primary" : "text-text-muted"} />
                      <span>{t("chat.webSearch") || "Web Search"}</span>
                      {isSearchEnabled && <Check size={14} className="text-text-primary ml-auto" />}
                    </button>
                    {connectedMcpServers.length > 0 && (
                      <>
                        <div className="border-t border-border my-1 -mx-1" />
                        {connectedMcpServers.map((server) => {
                          const isEnabled = enabledMcpServerIds.has(server.id);
                          return (
                            <button
                              key={server.id}
                              onClick={() => {
                                onToggleMcpServer(server.id);
                              }}
                              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors ${
                                isEnabled
                                  ? "text-text-primary bg-active"
                                  : "text-text-secondary hover:bg-hover hover:text-text-primary"
                              }`}
                              role="menuitemcheckbox"
                              aria-checked={isEnabled}
                            >
                              <Cpu size={15} className={isEnabled ? "text-text-primary" : "text-text-muted"} />
                              <span className="truncate flex-1 text-left">{server.name}</span>
                              {isEnabled && <Check size={14} className="text-text-primary ml-1 shrink-0" />}
                            </button>
                          );
                        })}
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <textarea
              id="chat-input"
              ref={textareaRef}
              value={value}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onPaste={(e) => {
                if (disabled || isStreaming) return;
                const clipboardData = e.clipboardData;
                const types = clipboardData.types;
                const isFileOrImage =
                  types && (types.includes("Files") || Array.from(types).some((t) => t.startsWith("image/")));

                if (isFileOrImage) {
                  e.preventDefault();
                  handleClipboardPaste(clipboardData);
                }
              }}
              placeholder={t("chat.placeholder") || "Ask for follow-up changes..."}
              rows={1}
              disabled={disabled}
              aria-describedby={isOverLimit ? "input-limit-error" : "input-hint"}
              aria-invalid={isOverLimit}
              className={`flex-1 min-w-0 bg-transparent ${textSizeClass} text-text-primary placeholder-text-muted resize-none outline-none leading-relaxed overflow-y-hidden ${isOverLimit ? "text-red-600 dark:text-red-400" : ""} ${
                voiceDraft && value.trim() === voiceDraft.trim() ? "opacity-60 italic text-text-muted" : ""
              }`}
            />

            {/* Context Window Radial Indicator */}
            {showContextWindow && currentModel && (
              <div className="relative group shrink-0 flex items-center justify-center">
                <button
                  type="button"
                  className="p-1.5 rounded-lg hover:bg-hover text-text-muted hover:text-text-primary transition-colors flex items-center justify-center cursor-help min-w-[32px] min-h-[32px]"
                  aria-label="Context Window Usage"
                >
                  <svg className="w-5 h-5 -rotate-90" viewBox="0 0 20 20">
                    <circle
                      className="text-border/60"
                      strokeWidth="2"
                      stroke="currentColor"
                      fill="transparent"
                      r={radius}
                      cx="10"
                      cy="10"
                    />
                    <circle
                      className={percentage > 90 ? "text-red-500" : percentage > 75 ? "text-amber-500" : "text-accent"}
                      strokeWidth="2"
                      strokeDasharray={circumference}
                      strokeDashoffset={strokeDashoffset}
                      strokeLinecap="round"
                      stroke="currentColor"
                      fill="transparent"
                      r={radius}
                      cx="10"
                      cy="10"
                    />
                  </svg>
                </button>

                {/* Hover Details Card */}
                <div className="absolute bottom-full right-0 mb-2 w-64 p-3.5 bg-surface border border-border rounded-xl shadow-xl opacity-0 scale-95 translate-y-1 group-hover:opacity-100 group-hover:scale-100 group-hover:translate-y-0 pointer-events-none transition-all duration-200 origin-bottom-right z-50">
                  <div className="font-semibold text-text-primary mb-1 flex justify-between items-center text-xs">
                    <span>Context Window</span>
                    <span
                      className={percentage > 90 ? "text-red-500" : percentage > 75 ? "text-amber-500" : "text-accent"}
                    >
                      {percentage.toFixed(0)}%
                    </span>
                  </div>
                  <div className="w-full bg-border/40 h-1 rounded-full overflow-hidden mb-3">
                    <div
                      className={`h-full ${percentage > 90 ? "bg-red-500" : percentage > 75 ? "bg-amber-500" : "bg-accent"}`}
                      style={{ width: `${Math.min(percentage, 100)}%` }}
                    />
                  </div>
                  <div className="space-y-1.5 text-[11px] text-text-secondary">
                    <div className="flex justify-between">
                      <span>Usage:</span>
                      <span className="font-semibold font-mono text-text-primary">
                        {estimatedTokens.toLocaleString()} / {contextSizeSet ? contextSize.toLocaleString() : "128,000"}{" "}
                        tokens
                      </span>
                    </div>
                    {contextSizeSet ? (
                      <>
                        <div className="h-px bg-border/40 my-1" />
                        <div className="flex justify-between">
                          <span>System Prompt:</span>
                          <span className="font-mono text-text-primary">
                            {tokenBreakdown.systemPromptTokens.toLocaleString()}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Messages:</span>
                          <span className="font-mono text-text-primary">
                            {tokenBreakdown.messagesTokens.toLocaleString()}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Attachments:</span>
                          <span className="font-mono text-text-primary">
                            {tokenBreakdown.attachmentsTokens.toLocaleString()}
                          </span>
                        </div>
                        <div className="flex justify-between border-t border-border/40 pt-1 mt-1">
                          <span>Remaining:</span>
                          <span className="font-semibold font-mono text-text-primary">
                            {Math.max(0, contextSize - estimatedTokens).toLocaleString()}
                          </span>
                        </div>
                      </>
                    ) : (
                      <p className="text-amber-500 mt-1 italic leading-normal text-[10px]">
                        No context limit configured for this model. Click Settings &gt; Models to configure it.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Model selector */}
            <div ref={dropdownRef} className="relative shrink-0">
              <button
                id="model-selector-button"
                onClick={() => {
                  setModelOpen(!modelOpen);
                  setFocusedIndex(-1);
                }}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-hover transition-colors max-w-[140px]"
                aria-label={`Select model: currently ${currentModel?.name ?? "None"}`}
                aria-expanded={modelOpen}
                aria-haspopup="listbox"
              >
                {!disableBgActivity && (
                  <div
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_COLORS[currentStatus]}`}
                    title={t(STATUS_KEYS[currentStatus]) || STATUS_LABELS[currentStatus] || currentStatus}
                    aria-hidden="true"
                  />
                )}
                <span className="truncate">{currentModel?.name || "No Model Configured"}</span>
                <ChevronDown
                  size={14}
                  className={`shrink-0 transition-transform duration-200 ${modelOpen ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </button>

              <AnimatePresence>
                {modelOpen && (
                  <motion.div
                    className="absolute bottom-full right-0 mb-2 w-64 bg-surface border border-border rounded-xl p-1 z-50 max-h-72 overflow-y-auto overflow-x-hidden"
                    style={{ boxShadow: "var(--shadow-xl)" }}
                    role="listbox"
                    aria-label="Available models"
                    initial={{ opacity: 0, y: 8, scale: motionTokens.scale.subtle }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: motionTokens.scale.subtle }}
                    transition={springs.gentle}
                  >
                    {enabledModels.length === 0 ? (
                      <div className="px-3 py-4 text-center text-xs text-text-muted">
                        No models configured. Go to Settings &gt; Models to configure one.
                      </div>
                    ) : (
                      enabledModels.map((model, idx) => {
                        const status = modelStatuses[model.id] ?? "disconnected";
                        const isSelected = selectedModel === model.id;
                        return (
                          <button
                            key={model.id}
                            ref={(el) => {
                              itemRefs.current[idx] = el;
                            }}
                            onClick={() => {
                              onModelChange(model.id);
                              setModelOpen(false);
                              setFocusedIndex(-1);
                            }}
                            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors text-left ${
                              isSelected
                                ? "bg-active text-text-primary"
                                : "text-text-secondary hover:bg-hover hover:text-text-primary"
                            }`}
                            role="option"
                            aria-selected={isSelected}
                          >
                            {!disableBgActivity && (
                              <div
                                className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_COLORS[status]}`}
                                title={t(STATUS_KEYS[status]) || STATUS_LABELS[status] || status}
                                aria-label={t(STATUS_KEYS[status]) || STATUS_LABELS[status] || status}
                              />
                            )}
                            <div className="flex-1 min-w-0">
                              <span className="block font-medium truncate">{model.name}</span>
                              <span className="block text-[10px] text-text-muted truncate" title={model.apiBase}>
                                {model.modelId}
                              </span>
                            </div>
                            {isSelected && (
                              <Check size={14} className="text-text-primary shrink-0" aria-hidden="true" />
                            )}
                          </button>
                        );
                      })
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Voice-to-Text Button */}
            {isVoiceEnabled && (
              <button
                type="button"
                onClick={handleToggleVoice}
                disabled={isTranscribing}
                className={`shrink-0 p-2 rounded-full transition-colors flex items-center justify-center relative cursor-pointer ${
                  isRecording
                    ? "bg-red-500 hover:bg-red-600 text-white animate-pulse"
                    : "bg-surface hover:bg-hover text-text-muted hover:text-text-primary border border-border"
                }`}
                aria-label={isRecording ? t("tooltip.voiceStop") : t("tooltip.voiceStart")}
                title={isRecording ? t("tooltip.voiceStop") : t("tooltip.voiceStart")}
              >
                {isTranscribing ? (
                  <Loader2 size={16} className="animate-spin text-accent" />
                ) : (
                  <Mic size={16} className={isRecording ? "text-white" : ""} />
                )}
              </button>
            )}

            {/* Send / Stop button */}
            <button
              onClick={isStreaming ? onStop : handleSubmit}
              disabled={!isStreaming && !canSend}
              className={`shrink-0 p-2 rounded-full transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center ${
                isStreaming
                  ? "bg-red-500/90 hover:bg-red-600 text-white"
                  : "bg-surface hover:bg-hover text-text-primary border border-border disabled:bg-transparent disabled:border-transparent disabled:text-text-muted"
              }`}
              aria-label={isStreaming ? t("tooltip.stop") : t("tooltip.send")}
              title={isStreaming ? t("tooltip.stop") : t("tooltip.send")}
            >
              {isStreaming ? <Square size={16} className="fill-current" /> : <ArrowUp size={16} strokeWidth={2.5} />}
            </button>
          </div>

          {/* Active Tools and Context Row */}
          {(isProjectsEnabled || isSearchEnabled || enabledServers.length > 0) && (
            <div className="flex flex-wrap items-center gap-2 w-full mt-2 pt-2 border-t border-border/30">
              {/* Project Row */}
              {isProjectsEnabled && (
                <div ref={projectDropdownRef} className="relative">
                  <button
                    onClick={() => setProjectDropdownOpen(!projectDropdownOpen)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                      activeProject
                        ? "text-accent bg-accent-soft/40 hover:bg-accent-soft"
                        : "text-text-secondary hover:bg-hover hover:text-text-primary"
                    }`}
                    aria-label="Project context"
                    aria-expanded={projectDropdownOpen}
                  >
                    {activeProject ? (
                      <>
                        <FolderOpen size={14} className="shrink-0" />
                        <span className="truncate max-w-[120px]">{activeProject.name}</span>
                        {activeProject.permissions === "full" ? (
                          <span
                            title={t("chat.fullShellAccess") || "Full Shell Access"}
                            className="shrink-0 ml-1 flex items-center"
                          >
                            <ShieldAlert size={12} className="text-red-500" />
                          </span>
                        ) : activeProject.permissions === "write" ? (
                          <span
                            title={t("chat.readWriteAccess") || "Read/Write Access"}
                            className="shrink-0 ml-1 flex items-center"
                          >
                            <Shield size={12} className="text-amber-500" />
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <FolderPlus size={14} className="shrink-0" />
                        <span>{t("chat.workInProject") || "Work in a project"}</span>
                      </>
                    )}
                    <ChevronDown
                      size={12}
                      className={`shrink-0 ml-0.5 transition-transform duration-200 ${projectDropdownOpen ? "rotate-180" : ""}`}
                    />
                  </button>

                  <AnimatePresence>
                    {projectDropdownOpen && (
                      <motion.div
                        className="absolute bottom-full left-0 mb-2 w-64 bg-surface border border-border rounded-xl p-1 z-50 overflow-hidden"
                        style={{ boxShadow: "var(--shadow-xl)" }}
                        role="menu"
                        initial={{ opacity: 0, y: 8, scale: motionTokens.scale.subtle }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: motionTokens.scale.subtle }}
                        transition={springs.gentle}
                      >
                        {!activeProject ? (
                          <>
                            <button
                              onClick={() => {
                                setProjectDropdownOpen(false);
                                openProjectConfigModal("create");
                              }}
                              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-accent hover:bg-accent-soft/20 transition-colors text-left font-medium"
                              role="menuitem"
                            >
                              <FolderPlus size={15} className="text-accent" />
                              <span>Add Project Workspace...</span>
                            </button>
                            {projects.length > 0 && (
                              <>
                                <div className="border-t border-border/50 my-1 mx-1" />
                                <div className="px-2.5 py-1 text-[9px] font-medium text-text-muted">
                                  Recent Workspaces
                                </div>
                                <div className="max-h-48 overflow-y-auto py-0.5">
                                  {projects.map((p) => (
                                    <button
                                      key={p.id}
                                      onClick={() => {
                                        setActiveProject(p.id);
                                        if (activeConversationId) {
                                          setConversationProject(activeConversationId, p.id);
                                        }
                                        setProjectDropdownOpen(false);
                                      }}
                                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-text-secondary hover:bg-hover hover:text-text-primary transition-colors text-left"
                                    >
                                      <Folder size={13} className="text-text-muted shrink-0" />
                                      <span className="truncate">{p.name}</span>
                                    </button>
                                  ))}
                                </div>
                              </>
                            )}
                          </>
                        ) : (
                          <>
                            <div className="px-2.5 py-1 text-[9px] font-medium text-text-muted">
                              Active Workspace Info
                            </div>
                            <div className="px-2.5 py-1 text-xs text-text-secondary">
                              <div className="font-semibold truncate">{activeProject.name}</div>
                              <div
                                className="text-[10px] text-text-muted truncate font-mono"
                                title={activeProject.path}
                              >
                                {activeProject.path}
                              </div>
                            </div>
                            <div className="border-t border-border/50 my-1 mx-1" />
                            <div className="px-2.5 py-1 text-[9px] font-medium text-text-muted">Permissions</div>
                            <button
                              onClick={() => handleToggleProjectPermission("read")}
                              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                                activeProject.permissions === "read"
                                  ? "bg-active text-text-primary font-medium"
                                  : "text-text-secondary hover:bg-hover hover:text-text-primary"
                              }`}
                            >
                              <span>Read Only (RO)</span>
                              {activeProject.permissions === "read" && <Check size={12} />}
                            </button>
                            <button
                              onClick={() => handleToggleProjectPermission("write")}
                              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                                activeProject.permissions === "write"
                                  ? "bg-active text-text-primary font-medium"
                                  : "text-text-secondary hover:bg-hover hover:text-text-primary"
                              }`}
                            >
                              <span>Read/Write (RW)</span>
                              {activeProject.permissions === "write" && <Check size={12} />}
                            </button>
                            <button
                              onClick={() => handleToggleProjectPermission("full")}
                              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                                activeProject.permissions === "full"
                                  ? "bg-red-500/10 text-red-500 font-medium"
                                  : "text-text-secondary hover:bg-hover hover:text-red-500"
                              }`}
                            >
                              <div className="flex items-center gap-1.5">
                                <ShieldAlert
                                  size={12}
                                  className={activeProject.permissions === "full" ? "text-red-500" : "text-text-muted"}
                                />
                                <span>Full Shell</span>
                              </div>
                              {activeProject.permissions === "full" && <Check size={12} />}
                            </button>
                            <div className="border-t border-border/50 my-1 mx-1" />
                            <button
                              onClick={() => {
                                setProjectDropdownOpen(false);
                                openProjectConfigModal("edit", activeProject.id);
                              }}
                              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs text-text-secondary hover:bg-hover hover:text-text-primary transition-colors text-left"
                              role="menuitem"
                            >
                              <Settings size={13} className="text-text-muted" />
                              <span>Workspace Settings...</span>
                            </button>
                            <button
                              onClick={() => {
                                setActiveProject(null);
                                if (activeConversationId) {
                                  setConversationProject(activeConversationId, undefined);
                                }
                                setProjectDropdownOpen(false);
                              }}
                              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs text-text-secondary hover:bg-hover hover:text-text-primary transition-colors text-left"
                              role="menuitem"
                            >
                              <X size={13} className="text-text-muted" />
                              <span>Detach Project</span>
                            </button>
                          </>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* Web Search Pill */}
              {isSearchEnabled && (
                <motion.div
                  initial={{ opacity: 0, scale: motionTokens.scale.subtle }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: motionTokens.scale.subtle }}
                  transition={springs.gentle}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-lg border border-accent/20 bg-accent-soft/30 text-xs text-accent font-medium select-none"
                >
                  <Search size={12} className="shrink-0" />
                  <span>Web Search</span>
                  <button
                    onClick={() => onToggleSearch(false)}
                    className="p-0.5 rounded hover:bg-accent-soft/60 text-accent transition-colors"
                    title={t("chat.disableWebSearch") || "Disable Web Search"}
                  >
                    <X size={12} />
                  </button>
                </motion.div>
              )}

              {/* MCP Server Pills */}
              {enabledServers.map((server) => {
                return (
                  <motion.div
                    key={server.id}
                    initial={{ opacity: 0, scale: motionTokens.scale.subtle }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: motionTokens.scale.subtle }}
                    transition={springs.gentle}
                    className="relative group flex items-center gap-1.5 rounded-lg border border-border bg-surface pl-2 pr-7 py-1 text-xs text-text-secondary select-none"
                  >
                    <Cpu size={13} className="text-text-muted shrink-0" />
                    <span className="truncate max-w-[100px] font-medium" title={server.name}>
                      {server.name}
                    </span>
                    <button
                      onClick={() => onToggleMcpServer(server.id)}
                      className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded-full text-text-muted hover:text-text-primary hover:bg-hover transition-all duration-200 md:opacity-0 md:group-hover:opacity-100"
                      title={t("chat.disableMcpServer", { name: server.name }) || `Disable ${server.name}`}
                    >
                      <X size={12} />
                    </button>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>

        <p
          id={isOverLimit ? "input-limit-error" : "input-hint"}
          className="mt-2 text-center text-[11px] text-text-muted"
        >
          {isOverLimit ? (
            <span className="text-red-600 dark:text-red-400" role="alert">
              Message exceeds {MAX_INPUT_LENGTH.toLocaleString()} character limit
            </span>
          ) : isStreaming ? (
            <span className="flex items-center justify-center gap-2 text-text-secondary font-medium animate-generating-pulse">
              <span>Generating response</span>
              <span className="generating-dots">
                <span />
                <span />
                <span />
              </span>
            </span>
          ) : isSearchEnabled ? (
            <span className="flex items-center justify-center gap-1.5">
              <Search size={11} className="text-text-secondary" />
              Web Search enabled
            </span>
          ) : enabledMcpServerIds.size > 0 ? (
            <span className="flex items-center justify-center gap-1.5">
              <Cpu size={11} className="text-text-secondary" />
              {t("chat.mcp_servers_enabled", { count: String(enabledMcpServerIds.size) })}
            </span>
          ) : (
            t("chat.disclaimer") || "Sythoria can make mistakes. Consider checking important information."
          )}
        </p>
      </div>

      {previewImageIndex !== null && imageAttachments.length > 0 && (
        <ImagePreviewModal
          isOpen={previewImageIndex !== null}
          onClose={() => setPreviewImageIndex(null)}
          images={imageAttachments.map((a) => ({ url: a.dataUrl!, name: a.name, size: a.size }))}
          activeIndex={previewImageIndex}
          onChangeActiveIndex={(idx) => setPreviewImageIndex(idx)}
        />
      )}
    </div>
  );
});
