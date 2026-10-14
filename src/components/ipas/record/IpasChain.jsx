// The IPAS's six gates as one chain, IPAS-only (the Approval Center keeps its
// own ApprovalChain). Each gate: its section and role, its state (done, Now or
// waiting, always in words), who passed it and when. Exactly one is Now; the
// gates and that choice come from gates.js.

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { StateWord } from "./StateMark";
import { STATE, STATE_CLASS } from "./statePalette";

/** The gate's mark: a filled check when done, a ring when it is Now, a hollow dot when waiting. */
function GateMark({ state }) {
  if (state === STATE.DONE) {
    return (
      <span aria-hidden="true" className={cn("flex size-5 shrink-0 items-center justify-center rounded-full", STATE_CLASS[state].dot)}>
        <Check size={12} className="text-white" />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn("mt-0.5 size-4 shrink-0 rounded-full border-2 bg-card", STATE_CLASS[state].ring)}
    />
  );
}

/**
 * The chain of gates. `gates` is `digest.gates`. Each gate is a group named by
 * its accessible name ("Section 2, Purchasing & Finance, Approved, waiting"),
 * so a screen reader hears the section, the role and the state.
 */
export default function IpasChain({ gates }) {
  const done = gates.filter((gate) => gate.done).length;
  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground">
        Where it stands · {done} of {gates.length}
      </h3>
      <ol className="mt-3 space-y-3">
        {gates.map((gate) => (
          <li key={gate.key}>
            <div role="group" aria-label={gate.accessibleName} className="flex items-start gap-3">
              <GateMark state={gate.state} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-semibold text-foreground">{gate.label}</span>
                  <span className="text-sm text-muted-foreground">{gate.role}</span>
                  <StateWord state={gate.state} />
                </div>
                <p className="text-xs text-muted-foreground">{gate.line}</p>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
