import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, FileText, X, ZoomIn } from "lucide-react";
import { formatBytes, isImageAttachment, toDescriptor } from "../../utils/attachments";

/**
 * Reference photos on a procurement request — usually a screenshot of what
 * the client asked for. A tight strip of small thumbnails, sized to its own
 * content rather than a track that reserves space nothing fills: with
 * usually 1-3 of these, a 160px gallery or a rail matched to a text column's
 * height both left more empty space around the image than image.
 *
 * Clicking opens the photo in place rather than a new tab — whoever's
 * reading this is mid-form, deciding what to buy, and a new tab drops them
 * out of that. The viewer supports multiple photos with arrow-key/click
 * navigation, since a request can carry more than one.
 */
export function AttachmentEvidence({ attachments, className = "" }) {
  const files = (attachments || []).map(toDescriptor).filter(Boolean);
  const [openAt, setOpenAt] = useState(null);

  if (!files.length) return null;

  const images = files.filter(isImageAttachment);
  const documents = files.filter((f) => !isImageAttachment(f));

  return (
    <>
      <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
        {images.map((f, i) => (
          <button
            key={f.url}
            type="button"
            onClick={() => setOpenAt(i)}
            title={f.name}
            className="group relative size-11 shrink-0 overflow-hidden rounded-lg border border-border bg-muted/40 transition-transform hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-mauve-8"
          >
            <img
              src={f.url}
              alt={f.name}
              loading="lazy"
              className="size-full object-cover"
            />
            <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/35 group-hover:opacity-100">
              <ZoomIn size={13} className="text-white" />
            </span>
          </button>
        ))}

        {documents.map((f) => (
          <a
            key={f.url}
            href={f.url}
            target="_blank"
            rel="noopener noreferrer"
            download={f.name}
            title={f.name}
            className="inline-flex h-11 max-w-[150px] items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 text-foreground transition-colors hover:bg-muted/70"
          >
            <FileText size={13} className="shrink-0 text-muted-foreground" />
            <span className="truncate text-[11px] font-semibold">{f.name}</span>
          </a>
        ))}
      </div>

      {openAt !== null &&
        typeof document !== "undefined" &&
        createPortal(
          <EvidenceViewer
            images={images}
            index={openAt}
            onClose={() => setOpenAt(null)}
            onNavigate={setOpenAt}
          />,
          document.body,
        )}
    </>
  );
}

function EvidenceViewer({ images, index, onClose, onNavigate }) {
  const current = images[index];
  const hasPrev = index > 0;
  const hasNext = index < images.length - 1;

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && hasPrev) onNavigate(index - 1);
      else if (e.key === "ArrowRight" && hasNext) onNavigate(index + 1);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [index, hasPrev, hasNext, onClose, onNavigate]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={current.name}
      onClick={onClose}
      className="fixed inset-0 z-[9999999] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-6 right-6 rounded-full bg-black/50 p-2 text-primary-foreground transition-colors hover:text-destructive"
      >
        <X size={24} />
      </button>

      {hasPrev && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onNavigate(index - 1);
          }}
          aria-label="Previous photo"
          className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2.5 text-primary-foreground transition-colors hover:bg-black/70"
        >
          <ChevronLeft size={20} />
        </button>
      )}
      {hasNext && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onNavigate(index + 1);
          }}
          aria-label="Next photo"
          className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2.5 text-primary-foreground transition-colors hover:bg-black/70"
        >
          <ChevronRight size={20} />
        </button>
      )}

      <figure
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full max-w-full flex-col items-center gap-3"
      >
        <img
          src={current.url}
          alt={current.name}
          className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
        />
        <figcaption className="flex items-center gap-2 text-xs font-medium text-white/70">
          <span className="max-w-[60vw] truncate">{current.name}</span>
          {current.bytes ? <span className="text-white/40">· {formatBytes(current.bytes)}</span> : null}
          {images.length > 1 ? (
            <span className="text-white/40">· {index + 1} / {images.length}</span>
          ) : null}
        </figcaption>
      </figure>
    </div>
  );
}
