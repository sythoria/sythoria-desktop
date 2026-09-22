import { X } from "lucide-react";
import type { Attachment } from "../types";
import { formatFileSize } from "../utils/attachments";
import { useTranslation } from "../utils/i18n";

interface AttachmentCardProps {
  attachment: Attachment;
  onPreview: () => void;
  onRemove?: () => void;
}

/** The same attachment tile is used in drafts and above sent message bubbles. */
export function AttachmentCard({ attachment, onPreview, onRemove }: AttachmentCardProps) {
  const { t } = useTranslation();
  const isImage = attachment.kind === "image" && !!attachment.dataUrl;
  const extension = attachment.name.split(".").pop();
  const fileType =
    attachment.name.includes(".") && extension ? extension.toUpperCase() : attachment.kind === "image" ? "IMG" : "TXT";
  const title = `${attachment.name} (${formatFileSize(attachment.size)})`;
  const surface =
    "h-full w-full overflow-hidden rounded-[14px] border border-border bg-chat transition-colors group-hover/attachment:border-text-muted group-focus-within/attachment:border-text-muted";

  return (
    <div className="group/attachment relative h-32 w-32 max-w-full shrink-0 select-none" title={title}>
      {isImage ? (
        <button
          type="button"
          onClick={onPreview}
          aria-label={`Preview ${attachment.name}`}
          className={`${surface} block cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-input`}
        >
          <img src={attachment.dataUrl} alt="" className="h-full w-full object-cover" />
        </button>
      ) : (
        <div className={`${surface} flex flex-col items-start justify-between gap-3 p-3`}>
          <span
            title={attachment.name}
            className="line-clamp-3 w-full break-words text-left text-[13px] leading-[1.4] text-text-primary [overflow-wrap:anywhere]"
          >
            {attachment.name}
          </span>
          <span className="max-w-full truncate rounded-md bg-hover px-1.5 py-0.5 text-[10px] font-medium leading-4 text-text-secondary">
            {fileType}
          </span>
        </div>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          title={t("chat.removeAttachment")}
          aria-label={`${t("chat.removeAttachment")}: ${attachment.name}`}
          className="pointer-events-none absolute -right-1 -top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full border-2 border-input bg-white text-neutral-800 shadow-sm opacity-0 transition-[opacity,background-color] group-hover/attachment:pointer-events-auto group-hover/attachment:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X size={10} strokeWidth={2} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
