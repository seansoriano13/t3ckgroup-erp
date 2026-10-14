// The small pieces the record page shares: a caption, a status pill and a
// section's state dot.

import StatusBadge from "@/components/StatusBadge";
import Dot from "@/components/ui/Dot";
import { CAPTION_BASE } from "@/lib/captionStyle";
import { cn } from "@/lib/utils";

/** The house label: small, bold, uppercase. Names the group the content under it belongs to. */
export function Caption({ children, className }) {
  return <p className={cn(CAPTION_BASE, "tracking-wider text-muted-foreground", className)}>{children}</p>;
}

/** A status pill from a `{ theme, label }` pair, or nothing. */
export function Pill({ badge }) {
  return badge ? <StatusBadge theme={badge.theme} label={badge.label} /> : null;
}

const DOT_TONE = { done: "bg-green-9", waiting: "bg-amber-9", idle: "bg-mauve-7" };
const DOT_WORD = { done: "Done", waiting: "Waiting on someone", idle: "Not started" };

/** A section's state dot: green done, amber waiting on someone, grey not started. Decorative: the state word beside it is the text.*/
export function StateDot({ tone, className }) {
  if (!tone) return null;
  return (
    <Dot
      size="size-2"
      color={DOT_TONE[tone]}
      className={className}
      title={DOT_WORD[tone]}
      aria-hidden="true"
    />
  );
}

/** What the three dot colours mean. */
export const DOT_LEGEND = Object.keys(DOT_TONE).map((tone) => ({ tone, word: DOT_WORD[tone], color: DOT_TONE[tone] }));
