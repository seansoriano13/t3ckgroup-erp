import { useId, useState } from "react";
import { ChevronRight } from "lucide-react";

import { STATE } from "@/components/record/statePalette";
import { StateWord } from "@/components/record/StateMark";
import StepMark from "@/components/record/StepMark";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import Reveal from "./Reveal";

/** The steps that need the viewer, as one string so an effect can tell when the set changes. */
const needsKey = (steps) => steps.filter((step) => step.needsMe).map((step) => step.key).join("|");

function Step({ step, open, onToggle }) {
  const panelId = useId();
  return (
    <li>
      <Button
        type="button"
        variant="ghost"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className="h-auto w-full min-w-0 justify-start gap-3 rounded-xl px-3 py-2 text-left font-normal whitespace-normal"
      >
        <StepMark state={step.state} />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-bold text-foreground">{step.title}</span>
          {step.summary && <span className="block truncate text-xs text-muted-foreground">{step.summary}</span>}
        </span>
        <StateWord state={step.state ?? STATE.WAITING} className="shrink-0 text-xs" />
        <ChevronRight
          size={16}
          aria-hidden="true"
          className={cn("shrink-0 text-muted-foreground transition-transform duration-200 ease-out-expo", open && "rotate-90")}
        />
      </Button>
      <Reveal open={open} id={panelId} className="space-y-4 px-3 pt-2 pb-3">
        {step.body}
        {step.moves}
      </Reveal>
    </li>
  );
}

/**
 * The shared "Your move" card, in a fixed order: the heading, what is next, a
 * signed count, the step list, and, inside each open step, its work and its
 * green button. Steps open in place like liner rows, several at once; a step
 * with `needsMe` opens on arrival. It sits in the right rail from the wide
 * breakpoint, and under the record below it.
 *
 * `status`: the one line saying what is next. `next`: an optional node under it
 * (a link to the next record waiting). `lead`: moves that belong to the record
 * itself rather than a step (Submit on a draft), drawn after the signed count.
 * `steps`: `[{ key, title, summary, state: "done" | "current" | "waiting",
 * needsMe?, body, moves }]`; `body` is the step's work and `moves` its buttons
 * (green `APPROVE_CLASS` for the main one).
 */
export default function YourMoveCard({ status, next, lead, steps, className }) {
  const headingId = useId();
  const [openKeys, setOpenKeys] = useState(() => new Set(steps.filter((step) => step.needsMe).map((step) => step.key)));
  const needing = needsKey(steps);

  // When a step starts needing the viewer (the one before it was just signed), it opens too.
  const [seenNeeding, setSeenNeeding] = useState(needing);
  if (needing !== seenNeeding) {
    setSeenNeeding(needing);
    if (needing) setOpenKeys((prev) => new Set([...prev, ...needing.split("|")]));
  }

  const toggle = (key) =>
    setOpenKeys((prev) => {
      const nextSet = new Set(prev);
      if (nextSet.has(key)) nextSet.delete(key);
      else nextSet.add(key);
      return nextSet;
    });

  const signed = steps.filter((step) => step.state === STATE.DONE).length;

  return (
    <section aria-labelledby={headingId} className={cn("overflow-hidden rounded-2xl border border-border bg-card", className)}>
      <div className="space-y-3 p-4">
        <h2 id={headingId} className="text-label font-bold uppercase tracking-wider text-muted-foreground">Your move</h2>
        <p className="text-[15px] font-bold leading-snug text-foreground">{status}</p>
        {next}
        {steps.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {signed} of {steps.length} signed
          </p>
        )}
        {lead}
      </div>
      {steps.length > 0 && (
        <ol className="border-t border-border p-1.5">
          {steps.map((step) => (
            <Step key={step.key} step={step} open={openKeys.has(step.key)} onToggle={() => toggle(step.key)} />
          ))}
        </ol>
      )}
    </section>
  );
}
