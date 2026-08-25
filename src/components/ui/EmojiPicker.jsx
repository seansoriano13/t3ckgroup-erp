import { useEffect, useRef, useState } from "react";
import { Smile } from "lucide-react";
import { cn } from "@/lib/utils";

const EMOJI_CATEGORIES = [
  {
    label: "Smileys",
    icon: "😀",
    emojis: ["😀", "😁", "😂", "🤣", "😊", "😇", "🙂", "🙃", "😉", "😍", "🥰", "😘", "😜", "🤪", "😎", "🤩", "🥳", "😏", "😅", "😢", "😭", "😡", "🤯", "😱", "🥺", "😴", "🤔", "🙄", "😬", "😷", "🤗", "🤭"],
  },
  {
    label: "Gestures",
    icon: "👍",
    emojis: ["👍", "👎", "👏", "🙌", "🙏", "💪", "🤝", "👋", "✌️", "🤞", "👌", "🤙", "💯", "🔥", "✨", "🎉", "🎊", "💥", "👀", "🫡"],
  },
  {
    label: "Hearts",
    icon: "❤️",
    emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💕", "💞", "💓", "💗", "💖", "💘", "💝"],
  },
  {
    label: "Animals",
    icon: "🐶",
    emojis: ["🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮", "🐷", "🐸", "🐵", "🐔", "🐧", "🐦", "🐤", "🦄"],
  },
  {
    label: "Food",
    icon: "🍕",
    emojis: ["🍎", "🍊", "🍋", "🍉", "🍇", "🍓", "🍕", "🍔", "🍟", "🌮", "🍣", "🍩", "🍪", "🎂", "☕", "🍺", "🍻", "🥂", "🍫", "🍿"],
  },
  {
    label: "Objects",
    icon: "🎯",
    emojis: ["🎯", "🚀", "⭐", "🌟", "💡", "📌", "📎", "✅", "❌", "⚠️", "🔔", "🎁", "🏆", "📅", "⏰", "💰", "📈", "📉", "🔒", "🔑"],
  },
];

const RECENTS_KEY = "chat_recent_emojis";

/**
 * A small hover/tap emoji picker button + popup grid, in the spirit of
 * Messenger's composer emoji button. `onSelect` receives the raw emoji
 * character; the caller decides how/where to insert it into the message.
 */
export default function EmojiPicker({ onSelect, className, align = "start", disabled }) {
  const [open, setOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState(0);
  const [recents, setRecents] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]");
      return Array.isArray(stored) ? stored : [];
    } catch {
      return [];
    }
  });
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const handleKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const pick = (emoji) => {
    onSelect(emoji);
    setRecents((prev) => {
      const next = [emoji, ...prev.filter((e) => e !== emoji)].slice(0, 16);
      try {
        localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
      } catch {
        // ignore quota errors
      }
      return next;
    });
  };

  return (
    <div className={cn("relative", className)} ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title="Add emoji"
        className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
      >
        <Smile size={16} />
      </button>

      {open && (
        <div
          className={cn(
            "popover-enter absolute bottom-full mb-2 z-[70] w-[264px] rounded-xl border border-border bg-popover shadow-2xl overflow-hidden",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          <div className="flex items-center gap-0.5 border-b border-border p-1.5 overflow-x-auto custom-scrollbar">
            {EMOJI_CATEGORIES.map((cat, i) => (
              <button
                key={cat.label}
                type="button"
                onClick={() => setActiveCategory(i)}
                title={cat.label}
                className={cn(
                  "shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-sm transition-colors",
                  activeCategory === i ? "bg-muted" : "hover:bg-muted/60",
                )}
              >
                {cat.icon}
              </button>
            ))}
          </div>

          <div className="max-h-[180px] overflow-y-auto custom-scrollbar p-2">
            {recents.length > 0 && (
              <div className="mb-2">
                <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider px-1 mb-1">
                  Recent
                </p>
                <div className="grid grid-cols-8 gap-0.5">
                  {recents.map((emoji, i) => (
                    <button
                      key={`recent-${i}`}
                      type="button"
                      onClick={() => pick(emoji)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-lg hover:bg-muted transition-colors"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-8 gap-0.5">
              {EMOJI_CATEGORIES[activeCategory].emojis.map((emoji, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => pick(emoji)}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-lg hover:bg-muted transition-colors"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
