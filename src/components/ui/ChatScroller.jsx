import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import Spinner from "@/components/ui/Spinner";
import { cn } from "@/lib/utils";

const NEAR_BOTTOM_PX = 80;

/**
 * The scrolling body of a Chat that loads older Messages as you reach the top.
 *
 * - First load lands on the newest Message.
 * - Older Messages arriving above keep what you were reading where it was.
 * - A new Message jumps you down if you sent it or were already at the bottom;
 *   otherwise it waits behind a "New messages" pill.
 *
 * `firstKey`/`lastKey` are the ids of the oldest/newest loaded Message.
 */
export default function ChatScroller({
  firstKey,
  lastKey,
  lastIsMine = false,
  hasMore = false,
  isFetchingMore = false,
  onLoadMore,
  className = "",
  scrollClassName = "px-4 py-3",
  scrollStyle,
  children,
}) {
  const scrollRef = useRef(null);
  const topRef = useRef(null);
  const atBottom = useRef(true);
  const prev = useRef({ firstKey: null, lastKey: null, height: 0 });
  const [showPill, setShowPill] = useState(false);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const before = prev.current;
    if (lastKey != null) {
      if (before.lastKey == null) {
        el.scrollTop = el.scrollHeight;
      } else if (firstKey !== before.firstKey && lastKey === before.lastKey) {
        el.scrollTop += el.scrollHeight - before.height;
      } else if (lastKey !== before.lastKey) {
        if (lastIsMine || atBottom.current) {
          el.scrollTop = el.scrollHeight;
          // eslint-disable-next-line react-hooks/set-state-in-effect -- layout-time scroll position decides the pill
          setShowPill(false);
        } else {
          setShowPill(true);
        }
      }
    }
    prev.current = { firstKey, lastKey, height: el.scrollHeight };
  }, [firstKey, lastKey, lastIsMine]);

  useEffect(() => {
    const root = scrollRef.current;
    const top = topRef.current;
    if (!root || !top || !hasMore || isFetchingMore || !onLoadMore) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onLoadMore();
      },
      { root, rootMargin: "120px 0px 0px 0px" },
    );
    observer.observe(top);
    return () => observer.disconnect();
  }, [hasMore, isFetchingMore, onLoadMore, firstKey]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (atBottom.current) setShowPill(false);
  };

  const jumpToNewest = () => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  return (
    <div className={cn("relative flex min-h-0 flex-1 flex-col", className)}>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={scrollStyle}
        className={cn("min-h-0 flex-1 overflow-y-auto custom-scrollbar", scrollClassName)}
      >
        <div ref={topRef} aria-hidden="true" className="h-px" />
        {isFetchingMore && (
          <div className="flex justify-center py-2">
            <Spinner size="sm" />
          </div>
        )}
        {children}
      </div>
      {showPill && (
        <button
          type="button"
          onClick={jumpToNewest}
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-foreground px-3 py-1 text-[11px] font-semibold text-background shadow-md"
        >
          New messages <ArrowDown size={12} />
        </button>
      )}
    </div>
  );
}
