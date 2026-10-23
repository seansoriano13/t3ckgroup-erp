import { Check } from "lucide-react";

import { STATE, STATE_CLASS } from "@/components/record/statePalette";
import { cn } from "@/lib/utils";

/** The round mark before a step in a record's rail: a tick once done, else a ring in the state's colour. */
export default function StepMark({ state }) {
  const s = state ?? STATE.WAITING;
  if (s === STATE.DONE) {
    return (
      <span aria-hidden="true" className={cn("flex size-5 shrink-0 items-center justify-center rounded-full", STATE_CLASS[s].dot)}>
        <Check size={12} className="text-white" />
      </span>
    );
  }
  return <span aria-hidden="true" className={cn("size-5 shrink-0 rounded-full border-2 bg-card", STATE_CLASS[s].ring)} />;
}
