// The decider: "Your move" answers what this person can do here, and says what
// happens next for whoever is up. The moves are the ones `movesFor` allows, and
// each one carries its consequence. Below the wide breakpoint the chain sits
// behind a toggle; above it the chain is always shown beside the moves.

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";
import { APPROVE_CLASS } from "@/pages/approvals/_components/approvalUi";
import IpasChain from "./IpasChain";
import { nowGate, waitingSections } from "./gates";
import { movesFor } from "./moves";

/** The wide breakpoint (Tailwind xl): the card sits beside the sections and shows its chain. */
const WIDE = "(min-width: 1280px)";

const LOOK = {
  approve: { variant: "default", className: APPROVE_CLASS },
  prepare: { variant: "outline", className: "" },
  neutral: { variant: "outline", className: "" },
  return: { variant: "destructive", className: "" },
};

/** One line under "Your move": what the viewer can do, or who the IPAS waits on. */
function statusLine(digest, gates, offered) {
  if (digest.filed) return "Filed. Nothing left to do.";
  if (digest.cancelled) return "Cancelled. Nothing to do.";
  if (offered.length === 0) {
    const waiting = waitingSections(gates);
    return waiting ? `Nothing needs you right now. Waiting on ${waiting}.` : "Nothing needs you right now.";
  }
  const now = nowGate(gates);
  if (!now) return "";
  const mine = now.moveKeys.some((key) => offered.some((move) => move.key === key));
  return `Next: ${mine ? "Waiting for you" : `Waiting for ${now.waitsOn}`}`;
}

/** A group of moves, each with its label and its one-line consequence under it. */
function MoveGroup({ items, disabled, className }) {
  return (
    <ul className={cn("space-y-3", className)}>
      {items.map(({ key, kind, icon: Icon, label, hint, run }) => (
        <li key={key} className="space-y-1.5">
          <Button
            size="lg"
            variant={LOOK[kind].variant}
            disabled={disabled}
            onClick={run}
            aria-describedby={`your-move-hint-${key}`}
            className={cn("w-full justify-center gap-2 font-semibold", LOOK[kind].className)}
          >
            <Icon size={16} aria-hidden="true" />
            {label}
          </Button>
          <p id={`your-move-hint-${key}`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        </li>
      ))}
    </ul>
  );
}

export default function DecisionCard({ ctx, digest }) {
  const { busy } = ctx;
  const wide = useMediaQuery(WIDE);
  const [chainOpen, setChainOpen] = useState(false);
  const { moves, costs, returns } = movesFor(ctx, digest);
  const offered = [...moves, ...costs, ...returns];
  const { gates } = digest;
  const doneCount = gates.filter((gate) => gate.done).length;
  const busyNow = busy.signoff || busy.give;

  return (
    <section
      id="your-move"
      aria-labelledby="your-move-heading"
      className="overflow-hidden rounded-2xl border border-border bg-card"
    >
      <div className="space-y-4 p-5">
        <h2 id="your-move-heading" className="text-base font-semibold text-foreground">
          Your move
        </h2>
        <p className="text-sm text-foreground">{statusLine(digest, gates, offered)}</p>

        {moves.length > 0 && <MoveGroup items={moves} disabled={busyNow} />}
        {returns.length > 0 && <MoveGroup items={returns} disabled={busyNow} />}
        {costs.length > 0 && <MoveGroup items={costs} disabled={busyNow} className="border-t border-border pt-4" />}
      </div>

      {!wide && (
        <div className="border-t border-border px-5 py-3">
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={chainOpen}
            aria-controls="your-move-chain"
            onClick={() => setChainOpen((open) => !open)}
          >
            {chainOpen ? "Hide where it stands" : `Where it stands · ${doneCount} of ${gates.length}`}
          </Button>
        </div>
      )}
      {(wide || chainOpen) && (
        <div id="your-move-chain" className="border-t border-border p-5">
          <IpasChain gates={gates} />
        </div>
      )}
    </section>
  );
}
