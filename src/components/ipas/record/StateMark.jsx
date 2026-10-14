// The visible half of the state palette: a dot, a state chip, or a dot with its
// word. Each one carries its word in text, so nothing rests on colour.

import { cn } from "@/lib/utils";
import { STATE_CLASS, STATE_WORD } from "./statePalette";

/** The state dot. Decorative: the word beside it says the same. */
export function StateDot({ state, className }) {
  if (!state) return null;
  return <span aria-hidden="true" className={cn("inline-block size-2 shrink-0 rounded-full", STATE_CLASS[state].dot, className)} />;
}

/** A state as a chip: the word on a tinted ground. */
export function StateChip({ state, className }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-xs font-semibold leading-none",
        STATE_CLASS[state].chip,
        className,
      )}
    >
      {STATE_WORD[state]}
    </span>
  );
}

/** A state as a dot and its word in text, then an optional detail. Used in the section rows and the drawer header. */
export function StateWord({ state, detail, className }) {
  if (!state) return null;
  return (
    <span className={cn("inline-flex min-w-0 flex-wrap items-center gap-1.5 text-sm", className)}>
      <StateDot state={state} />
      <span className={cn("font-semibold", STATE_CLASS[state].text)}>{STATE_WORD[state]}</span>
      {detail && (
        <>
          <span aria-hidden="true" className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">{detail}</span>
        </>
      )}
    </span>
  );
}
