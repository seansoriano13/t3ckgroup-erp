import { useState, useRef, useEffect } from "react";
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from "framer-motion";
import { Reply, Copy, Check, MoreHorizontal, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";

const THRESHOLD = 56;
const QUICK_REACTIONS = ["👍", "❤️", "😆", "😮", "😢", "😡"];

const isTouchDevice = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(pointer: coarse)").matches;

/**
 * Wraps a single message bubble with a Messenger-style action popup
 * (emoji reactions, reply, copy text).
 *
 *  - Desktop: hover "more" button opens the popup. Mouse drags are left alone
 *    so the bubble text can be selected and copied natively.
 *  - Touch: swipe-right-to-reply, long-press opens the popup.
 */
export default function SwipeToReplyWrapper({
  children,
  onReply,
  onReact,
  copyText,
  onUnsend,
  isMe,
  className,
}) {
  const [dragX, setDragX] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [touch] = useState(isTouchDevice);
  const timerRef = useRef(null);

  const startLongPress = (e) => {
    if (!touch) return; // never hijack mouse presses: they are text selection
    if (e.button && e.button !== 0) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setMenuOpen(true);
      if (window.navigator && window.navigator.vibrate) {
        window.navigator.vibrate(50);
      }
    }, 500);
  };

  const cancelLongPress = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => () => cancelLongPress(), []);

  // Close popup on outside click/tap or Escape
  useEffect(() => {
    if (!menuOpen) return;
    const handleClose = () => setMenuOpen(false);
    const handleKey = (e) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("pointerdown", handleClose);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("pointerdown", handleClose);
      window.removeEventListener("keydown", handleKey);
    };
  }, [menuOpen]);

  const handleCopy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        setMenuOpen(false);
      }, 700);
    } catch {
      setMenuOpen(false);
    }
  };

  const hasCopy = typeof copyText === "string" && copyText.length > 0;
  const actionClass =
    "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-muted transition-colors";

  return (
    <div className={cn("relative group/bubble max-w-full min-w-0", className)}>
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className={cn(
              "absolute bottom-full mb-1 z-[100] flex flex-col gap-1 min-w-[150px]",
              isMe ? "right-0 items-end" : "left-0 items-start",
            )}
            onPointerDown={(e) => e.stopPropagation()} // Prevent closing immediately
          >
            {onReact && (
              <div className="flex items-center gap-1 bg-card border border-border shadow-xl rounded-full px-2 py-1.5">
                {QUICK_REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="text-lg hover:scale-125 hover:-translate-y-1 transition-transform p-1 leading-none"
                    onClick={(e) => {
                      e.stopPropagation();
                      onReact(emoji);
                      setMenuOpen(false);
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
            <div className="w-full bg-card border border-border shadow-xl rounded-xl p-1">
              {onReply && (
                <button
                  type="button"
                  className={actionClass}
                  onClick={(e) => {
                    e.stopPropagation();
                    onReply();
                    setMenuOpen(false);
                  }}
                >
                  <Reply size={14} /> Reply
                </button>
              )}
              {onUnsend && (
                <button
                  type="button"
                  className={actionClass}
                  onClick={(e) => {
                    e.stopPropagation();
                    onUnsend();
                    setMenuOpen(false);
                  }}
                >
                  <Undo2 size={14} /> Unsend
                </button>
              )}
              {hasCopy && (
                <button type="button" className={actionClass} onClick={handleCopy}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? "Copied" : "Copy text"}
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Swipe reveal indicator (touch only) */}
      <div
        className="absolute inset-y-0 left-0 flex items-center pl-2 pointer-events-none md:hidden"
        style={{ opacity: Math.min(Math.abs(dragX) / THRESHOLD, 1) }}
      >
        <div className="w-7 h-7 rounded-full bg-primary/15 text-primary flex items-center justify-center">
          <Reply size={14} />
        </div>
      </div>

      <motion.div
        drag={touch ? "x" : false}
        dragDirectionLock
        dragSnapToOrigin={true}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0, right: 0.3 }}
        onDragStart={() => cancelLongPress()}
        onDrag={(_, info) => setDragX(info.offset.x)}
        onDragEnd={(_, info) => {
          if (info.offset.x >= THRESHOLD || info.velocity.x > 500) onReply?.();
          setDragX(0);
        }}
        onPointerDown={startLongPress}
        onPointerUp={cancelLongPress}
        onPointerCancel={cancelLongPress}
        className="touch-pan-y max-w-full min-w-0 select-text"
      >
        {children}
      </motion.div>

      {/* Desktop hover button: opens the action popup */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((v) => !v);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        title="More"
        aria-label="Message actions"
        className={cn(
          "hidden md:flex absolute -top-2 items-center justify-center w-6 h-6 rounded-full bg-card border border-border text-muted-foreground opacity-0 group-hover/bubble:opacity-100 focus-visible:opacity-100 hover:text-foreground hover:bg-muted hover:border-foreground/30 transition-opacity shadow-sm z-10",
          isMe ? "-left-2" : "-right-2",
        )}
      >
        <MoreHorizontal size={12} />
      </button>
    </div>
  );
}
