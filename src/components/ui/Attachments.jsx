/**
 * Attachment UI — the pending strip shown while composing, the picker button,
 * and the uploaded files as rendered on a saved record. Descriptor shape and
 * limits live in utils/attachments; pick/upload state lives in
 * hooks/useFileAttachments.
 */

import { FileInput } from "./FileInput";
import { useRef } from "react";
import { FileText, Paperclip, X } from "lucide-react";
import {
  formatBytes,
  isImageAttachment,
  toDescriptor,
  ALLOWED_EXTENSIONS_STRING,
} from "../../utils/attachments";
import { cloudinaryThumb } from "../../lib/cloudinaryThumb";

/** Files chosen but not yet uploaded. */
export function AttachmentPreviews({ files, onRemove, disabled }) {
  if (!files.length) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {files.map((f, i) => (
        <div
          key={`${f.file.name}-${i}`}
          className="relative group rounded-lg overflow-hidden border border-border bg-muted/40"
        >
          {f.preview ? (
            <img
              src={f.preview}
              alt={f.file.name}
              className="w-14 h-14 object-cover"
            />
          ) : (
            <div className="w-14 h-14 flex flex-col items-center justify-center gap-0.5 px-1" title={f.file.name}>
              <FileText size={16} className="text-muted-foreground shrink-0" />
              <span className="text-[8px] font-bold text-muted-foreground truncate w-full text-center">
                {f.file.name}
              </span>
            </div>
          )}
          <button
            type="button"
            title={`Remove ${f.file.name}`}
            disabled={disabled}
            onClick={() => onRemove(i)}
            className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity disabled:hidden"
          >
            <X size={14} className="text-white" />
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * Full-width dashed picker with the preview strip above it — for forms, where
 * attaching is a labelled step rather than an icon next to a message box.
 */
export function AttachmentField({
  label = "Attachments",
  hint,
  attachments,
  disabled,
}) {
  const inputRef = useRef(null);
  const { files, addFiles, removeFile, max, maxBytes, anyType } = attachments;
  const isFull = files.length >= max;

  return (
    <div>
      <label className="block text-[11px] font-bold text-muted-foreground mb-1.5 uppercase tracking-wider">
        {label}
      </label>

      <FileInput
        ref={inputRef}
        multiple
        accept={anyType ? undefined : ALLOWED_EXTENSIONS_STRING}
        onFiles={addFiles}
      />

      {files.length > 0 && (
        <div className="mb-2">
          <AttachmentPreviews
            files={files}
            onRemove={removeFile}
            disabled={disabled}
          />
        </div>
      )}

      <button
        type="button"
        disabled={disabled || isFull}
        onClick={() => inputRef.current?.open()}
        className="w-full py-3 border-2 border-dashed border-border rounded-xl flex items-center justify-center gap-2 text-xs font-bold text-muted-foreground hover:border-primary hover:text-primary hover:bg-primary/5 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
      >
        <Paperclip size={14} />
        {isFull ? `Maximum ${max} files attached` : "Attach files"}
      </button>

      <p className="text-[10px] text-muted-foreground/70 mt-1.5">
        {hint ||
          `Optional — up to ${max} files, ${formatBytes(maxBytes)} each. Images, documents, and short videos.`}
      </p>
    </div>
  );
}

/**
 * Uploaded attachments on a saved record. `compact` renders name-only chips for
 * table cells; the default renders image thumbnails inline.
 */
export function AttachmentList({ attachments, className = "", compact = false }) {
  const files = (attachments || []).map(toDescriptor).filter(Boolean);
  if (!files.length) return null;

  if (compact) {
    return (
      <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
        {files.map((f) => (
          <a
            key={f.url}
            href={f.url}
            target="_blank"
            rel="noopener noreferrer"
            title={f.name}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 max-w-[130px] px-1.5 py-0.5 rounded-md border border-border bg-muted/50 hover:bg-muted transition-colors"
          >
            <Paperclip size={10} className="text-muted-foreground shrink-0" />
            <span className="text-[10px] font-bold text-foreground truncate">
              {f.name}
            </span>
          </a>
        ))}
      </div>
    );
  }

  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {files.map((f) =>
        isImageAttachment(f) ? (
          <a
            key={f.url}
            href={f.url}
            target="_blank"
            rel="noopener noreferrer"
            title={f.name}
            className="block rounded-xl overflow-hidden border border-border hover:opacity-90 transition-opacity"
          >
            <img
              src={cloudinaryThumb(f.url, { width: 320 })}
              alt={f.name}
              loading="lazy"
              className="max-w-[160px] max-h-[160px] object-cover"
            />
          </a>
        ) : (
          <a
            key={f.url}
            href={f.url}
            target="_blank"
            rel="noopener noreferrer"
            title={f.name}
            className="inline-flex items-center gap-2 max-w-[240px] px-2.5 py-1.5 rounded-xl border border-border bg-muted/40 hover:bg-muted/70 transition-colors"
          >
            <FileText size={14} className="text-muted-foreground shrink-0" />
            <span className="text-xs font-semibold text-foreground truncate">
              {f.name}
            </span>
            {f.bytes ? (
              <span className="text-[10px] font-bold text-muted-foreground shrink-0">
                {formatBytes(f.bytes)}
              </span>
            ) : null}
          </a>
        ),
      )}
    </div>
  );
}
