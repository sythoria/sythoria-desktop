import { useState, useRef, useCallback } from "react";
import { Attachment } from "../types";
import { useUIStore } from "../store/useUIStore";
import { validateFile, readFileAsAttachment } from "../utils/attachments";

export function useAttachments() {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAddFiles = useCallback(
    async (files: File[]) => {
      const newAttachments = [...attachments];
      const addToast = useUIStore.getState().addToast;

      for (const file of files) {
        // Check for duplicate by name and size
        const isDuplicate = newAttachments.some((a) => a.name === file.name && a.size === file.size);
        if (isDuplicate) {
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
    [attachments],
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
