import { useState, useRef, useCallback } from "react";
import { Attachment } from "../types";
import { useUIStore } from "../store/useUIStore";
import { useChatStore } from "../store/useChatStore";
import { validateFile, readFileAsAttachment, isImageFile } from "../utils/attachments";
import { useModelStore } from "../store/useModelStore";

export function useAttachments() {
  const attachments = useChatStore((s) => s.draftAttachments);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const setAttachments = useCallback((updater: Attachment[] | ((prev: Attachment[]) => Attachment[])) => {
    const chatStore = useChatStore.getState();
    if (typeof updater === "function") {
      chatStore.setDraftAttachments(updater(chatStore.draftAttachments));
    } else {
      chatStore.setDraftAttachments(updater);
    }
  }, []);

  const handleAddFiles = useCallback(
    async (files: File[]) => {
      const newAttachments = [...attachments];
      const addToast = useUIStore.getState().addToast;

      const modelStore = useModelStore.getState();
      const currentModel = modelStore.models.find((m) => m.id === modelStore.selectedModel);

      for (const file of files) {
        // Check for duplicate by name and size
        const isDuplicate = newAttachments.some((a) => a.name === file.name && a.size === file.size);
        if (isDuplicate) {
          continue;
        }

        if (isImageFile(file) && currentModel && currentModel.supportsImages === false) {
          addToast(`"${currentModel.name}" does not support image inputs.`, "error");
          continue;
        }

        const valResult = validateFile(file, newAttachments.length);
        if (!valResult.ok) {
          addToast(valResult.reason || "Invalid file", "error");
          continue;
        }

        try {
          const attachment = await readFileAsAttachment(file);
          newAttachments.push(attachment);
        } catch {
          addToast(`Failed to read "${file.name}"`, "error");
        }
      }
      setAttachments(newAttachments);
    },
    [attachments, setAttachments],
  );

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files) return;
      const files = Array.from(e.target.files);
      await handleAddFiles(files);
      e.target.value = ""; // reset input so the same file can be selected again
    },
    [handleAddFiles],
  );

  return {
    attachments,
    setAttachments,
    isDragging,
    setIsDragging,
    fileInputRef,
    handleAddFiles,
    handleFileChange,
  };
}
