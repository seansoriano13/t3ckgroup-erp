// The visible half of the state palette: a dot beside its state word, and the
// word with its detail. The dot is the shared Dot primitive. Each use carries
// its word in text, so nothing rests on colour.

import Dot from "@/components/ui/Dot";
import { cn } from "@/lib/utils";
import { STATE_CLASS, STATE_WORD } from "./statePalette";

/** The state dot. Decorative: the word beside it says the same. */
export function StateDot({ state, className }) {
  if (!state) return null;
  return <Dot aria-hidden="true" size="size-2" color={STATE_CLASS[state].dot} className={className} />;
}

/** A state as a dot and its word in text, then an optional detail. Used in the section rows, the chain and the drawer header. */
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
