import { useState, useRef, useEffect } from "react";
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from "framer-motion";
import { Reply } from "lucide-react";
import { cn } from "@/lib/utils";

const THRESHOLD = 56;
const QUICK_REACTIONS = ["👍", "❤️", "😆", "😮", "😢", "😡"];

/**
 * Wraps a single message bubble with:
 *  - swipe-left-to-reply on touch devices (Messenger-style)
 *  - long-press to react on touch devices (Messenger-style)
 *  - a hover-revealed reply button on desktop (click to reply).
 */
export default function SwipeToReplyWrapper({ children, onReply, onReact, isMe, className }) {
  const [dragX, setDragX] = useState(0);
  const [showReactions, setShowReactions] = useState(false);
  const timerRef = useRef(null);

  const startLongPress = (e) => {
    if (e.button && e.button !== 0) return; // Only primary clicks
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setShowReactions(true);
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

  // Close reaction picker on outside click/tap
  useEffect(() => {
    if (!showReactions) return;
    const handleClose = () => setShowReactions(false);
    window.addEventListener("pointerdown", handleClose);
    return () => window.removeEventListener("pointerdown", handleClose);
  }, [showReactions]);

  return (
    <div className={cn("relative group/bubble max-w-full min-w-0", className)}>
      <AnimatePresence>
        {showReactions && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className={cn(
              "absolute -top-12 z-[100] flex items-center gap-1 bg-card border border-border shadow-xl rounded-full px-2 py-1.5",
              isMe ? "right-0" : "left-0"
            )}
            onPointerDown={(e) => e.stopPropagation()} // Prevent closing immediately
          >
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="text-lg hover:scale-125 hover:-translate-y-1 transition-transform p-1 leading-none"
                onClick={(e) => {
                  e.stopPropagation();
                  onReact && onReact(emoji);
                  setShowReactions(false);
                }}
              >
                {emoji}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Swipe reveal indicator (mobile only) */}
      <div
        className="absolute inset-y-0 left-0 flex items-center pl-2 pointer-events-none md:hidden"
        style={{ opacity: Math.min(Math.abs(dragX) / THRESHOLD, 1) }}
      >
        <div className="w-7 h-7 rounded-full bg-primary/15 text-primary flex items-center justify-center">
          <Reply size={14} />
        </div>
      </div>

      <motion.div
        drag="x"
        dragDirectionLock
        dragSnapToOrigin={true}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0, right: 0.3 }}
        onDragStart={() => cancelLongPress()}
        onDrag={(_, info) => setDragX(info.offset.x)}
        onDragEnd={(_, info) => {
          if (info.offset.x >= THRESHOLD || info.velocity.x > 500) onReply();
          setDragX(0);
        }}
        onPointerDown={startLongPress}
        onPointerUp={cancelLongPress}
        onPointerCancel={cancelLongPress}
        className="touch-pan-y max-w-full min-w-0"
      >
        {children}
      </motion.div>

      {/* Desktop hover-to-reply button */}
      <button
        type="button"
        onClick={onReply}
        title="Reply"
        className={cn(
          "hidden md:flex absolute -top-2 items-center justify-center w-6 h-6 rounded-full bg-card border border-border text-muted-foreground opacity-0 group-hover/bubble:opacity-100 hover:text-foreground hover:bg-muted hover:border-foreground/30 transition-opacity shadow-sm z-10",
          isMe ? "-left-2" : "-right-2",
        )}
      >
        <Reply size={12} />
      </button>
    </div>
  );
}
