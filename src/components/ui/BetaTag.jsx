import { Tooltip } from "@/components/ui/Tooltip";

export const BETA_HOVER = "Still being built. Keep using group tasks for purchasing.";

/**
 * Beta tag (#946, CONTEXT.md "Beta tag"): a small "Beta" badge on a screen or nav item that is
 * live but not finished. The screen stays usable; the hover says why (a Hover detail).
 */
export default function BetaTag({ className = "" }) {
  return (
    <Tooltip content={BETA_HOVER}>
      <span
        data-testid="beta-tag"
        aria-label={`Beta. ${BETA_HOVER}`}
        className={`inline-flex shrink-0 items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-px text-[9px] font-bold uppercase leading-4 tracking-wide text-amber-700 dark:text-amber-300 ${className}`.trim()}
      >
        Beta
      </span>
    </Tooltip>
  );
}
