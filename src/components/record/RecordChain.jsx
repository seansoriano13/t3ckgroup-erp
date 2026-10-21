// A record's steps as one chain (the Approval Center keeps its own
// ApprovalChain). Each gate: its label and role, its state (done, Now or
// waiting, always in words), who passed it and when. At most one is Now; the
// gates and that choice come from the form's own gates (IPAS: gates.js).

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
 * The chain of gates. Each gate is a group named by its accessible name
 * ("Section 2, Purchasing & Finance, Approved, waiting"), so a screen reader
 * hears the step, the role and the state.
 */
export default function RecordChain({ gates, label = "Where it stands", compact = false }) {
  const done = gates.filter((gate) => gate.done).length;
  if (compact) return <CompactChain gates={gates} label={label} done={done} />;
  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground">
        {label} · {done} of {gates.length}
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

/**
 * The rail's chain: the gates grouped under their section, one short line each
 * (a dot and the role); a gate that is done or Now adds its line (who and when),
 * a waiting one keeps it in its tooltip. Each gate keeps its accessible name.
 */
function CompactChain({ gates, label, done }) {
  const groups = [];
  for (const gate of gates) {
    const id = gate.part ?? gate.label;
    let group = groups.find((g) => g.id === id);
    if (!group) {
      group = { id, part: gate.part, label: gate.label, gates: [] };
      groups.push(group);
    }
    group.gates.push(gate);
  }
  return (
    <div>
      <h3 className="text-xs font-semibold text-foreground">
        {label} · {done} of {gates.length}
      </h3>
      <ol className="mt-2 space-y-2.5">
        {groups.map((group) => (
          <li key={group.id}>
            <span className="text-xs font-semibold text-foreground">{group.label}</span>
            <ul className="mt-1 space-y-1 pl-0.5">
              {group.gates.map((gate) => (
                <li key={gate.key} role="group" aria-label={gate.accessibleName} title={gate.line} className="flex items-start gap-2 text-xs">
                  <span aria-hidden="true" className={cn("mt-1 size-2 shrink-0 rounded-full", STATE_CLASS[gate.state].dot)} />
                  <span className="min-w-0">
                    <span className={cn(gate.now ? "font-semibold text-foreground" : "text-muted-foreground")}>{gate.role}</span>
                    {gate.state !== STATE.WAITING && <StateWord state={gate.state} className="ml-1.5 inline-flex text-xs" />}
                    {gate.state !== STATE.WAITING && gate.line && (
                      <span className="block text-[11px] leading-snug text-muted-foreground">{gate.line}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
