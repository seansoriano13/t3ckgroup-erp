import { useEffect } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * ModalOverlay — Reusable portal-based modal overlay.
 *
 * Renders children inside a full-screen overlay with a backdrop.
 * Handles Escape key, click-outside (backdrop click), and portal rendering.
 *
 * @param {object}   props
 * @param {boolean}  props.isOpen             - Controls visibility
 * @param {Function} props.onClose            - Called on backdrop click or Escape
 * @param {string}   [props.className]        - Extra classes on the positioning wrapper
 * @param {string}   [props.backdropClassName] - Override backdrop styling
 * @param {string}   [props.zIndex]           - z-index class (default: "z-[9999]")
 * @param {boolean}  [props.center]           - Center children (default: true)
 * @param {React.ReactNode} props.children    - Modal panel content
 */
export default function ModalOverlay({
  isOpen,
  onClose,
  className,
  backdropClassName,
  zIndex = "z-[9999]",
  center = true,
  children,
}) {
  // Escape key handler
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className={cn(
        "fixed inset-0",
        zIndex,
        center && "flex items-center justify-center p-4",
        className,
      )}
    >
      {/* Backdrop */}
      <div
        className={cn(
          "absolute inset-0 bg-black/30 backdrop-blur-sm animate-in fade-in duration-200",
          backdropClassName,
        )}
        onClick={onClose}
      />

      {/* Content — rendered above backdrop via relative z-10.
          `contents` would strip this box entirely, silently nullifying the
          position/z-index set here — omitted deliberately. */}
      <div className="relative z-10">{children}</div>
    </div>,
    document.body,
  );
}
