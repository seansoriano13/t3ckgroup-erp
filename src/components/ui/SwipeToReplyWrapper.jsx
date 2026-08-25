import { useState } from "react";
// eslint-disable-next-line no-unused-vars
import { motion } from "framer-motion";
import { Reply } from "lucide-react";
import { cn } from "@/lib/utils";

const THRESHOLD = 56;

/**
 * Wraps a single message bubble with:
 *  - swipe-left-to-reply on touch devices (Messenger-style), and
 *  - a hover-revealed reply button on desktop (click to reply).
 *
 * Only wraps the bubble itself (not the whole row/avatar), so the reveal
 * icon and hover button stay anchored to the message, not the row.
 */
export default function SwipeToReplyWrapper({ children, onReply, isMe, className }) {
  const [dragX, setDragX] = useState(0);

  return (
    <div className={cn("relative group/bubble", className)}>
      {/* Swipe reveal indicator (mobile only) — sits behind the bubble,
          uncovered as the bubble slides left. */}
      <div
        className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none md:hidden"
        style={{ opacity: Math.min(Math.abs(dragX) / THRESHOLD, 1) }}
      >
        <div className="w-7 h-7 rounded-full bg-primary/15 text-primary flex items-center justify-center">
          <Reply size={14} />
        </div>
      </div>

      <motion.div
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: -(THRESHOLD + 24), right: 0 }}
        dragElastic={0.15}
        onDrag={(_, info) => setDragX(info.offset.x)}
        onDragEnd={(_, info) => {
          if (info.offset.x <= -THRESHOLD) onReply();
          setDragX(0);
        }}
        className="touch-pan-y"
      >
        {children}
      </motion.div>

      {/* Desktop hover-to-reply button, anchored to the corner of the bubble
          on the side away from the avatar. */}
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
