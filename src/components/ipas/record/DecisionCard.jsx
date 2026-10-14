// The decider: "Your move" answers what this person can do here, and says what
// happens next for whoever is up. The moves are the ones `movesFor` allows, and
// each one carries its consequence. A card move asks first (the restatement
// comes from the same digest as the section row), and so does the drawer footer. Below the wide breakpoint the chain sits behind a toggle;
// above it the chain is always shown beside the moves.

import { useId, useState } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";
import IpasChain from "./IpasChain";
import MoveButton from "./MoveButton";
import { nowGate, waitingSections } from "./gates";
import { COSTS_WAITING } from "./moveCopy";
import { CHROME } from "./sectionChrome";
import { movesFor } from "./moves";
import { useMoveConfirm } from "./useMoveConfirm";

/** The wide breakpoint (Tailwind xl): the card sits beside the sections and shows its chain. */
const WIDE = "(min-width: 1280px)";

/** One line under "Your move": what the viewer can do, or who the IPAS waits on. */
function statusLine(digest, gates, offered) {
  if (digest.filed) return "Filed. Nothing left to do.";
  if (digest.cancelled) return "Cancelled. Nothing to do.";
  // No gate is Now only while LC Odoo Done waits for Purchasing's encoding (gates.js).
  const now = nowGate(gates);
  if (!now) return offered.length === 0 ? `Nothing needs you right now. ${COSTS_WAITING}` : COSTS_WAITING;
  if (offered.length === 0) {
    const waiting = waitingSections(gates);
    return waiting ? `Nothing needs you right now. Waiting on ${waiting}.` : "Nothing needs you right now.";
  }
  const mine = now.moveKeys.some((key) => offered.some((move) => move.key === key));
  return `Next: ${mine ? "Waiting for you" : `Waiting for ${now.waitsOn}`}`;
}

/** A group of moves, each with its label and its one-line consequence under it. */
function MoveGroup({ items, origin, className, ...rest }) {
  return (
    <ul className={cn("space-y-3", className)}>
      {items.map((item) => (
        <MoveButton key={item.key} move={item} origin={origin} {...rest} />
      ))}
    </ul>
  );
}

export default function DecisionCard({ ctx, digest, onReview, next }) {
  const { busy, failure, viewer } = ctx;
  const wide = useMediaQuery(WIDE);
  const movesId = useId();
  const [chainOpen, setChainOpen] = useState(false);
  // Below the wide breakpoint the card is its heading and status line; the moves open on request.
  const [movesOpen, setMovesOpen] = useState(false);
  const { moves, costs, returns } = movesFor(ctx, digest);
  const offered = [...moves, ...costs, ...returns];
  const { gates } = digest;
  const doneCount = gates.filter((gate) => gate.done).length;
  const busyNow = busy.signoff || busy.give;

  // A card move asks first, unless it asks in its own dialog (the filing dialog, the reason of a return).
  const { run: runFromCard, dialog: confirmDialog } = useMoveConfirm({ digest, viewer, origin: CHROME.CARD });
  const rest = { disabled: busyNow, busy: busyNow, failure, onRun: runFromCard, onReview };

  return (
    <section
      id="your-move"
      tabIndex={-1}
      aria-labelledby="your-move-heading"
      className="overflow-hidden rounded-2xl border border-border bg-card outline-none"
    >
      <div className="space-y-4 p-5">
        <h2 id="your-move-heading" className="text-base font-semibold text-foreground">
          Your move
        </h2>
        <p className="text-sm text-foreground">{statusLine(digest, gates, offered)}</p>
        {next && (
          <p className="text-sm">
            <Link
              to={`/purchasing/ipas/${next.ipasId}`}
              className="font-semibold text-foreground underline underline-offset-4"
            >
              Next IPAS waiting for me: {next.number}
            </Link>
          </p>
        )}

        {!wide && offered.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            aria-expanded={movesOpen}
            aria-controls={movesId}
            onClick={() => setMovesOpen((open) => !open)}
          >
            {movesOpen ? "Hide my moves" : `Show my moves · ${offered.length}`}
          </Button>
        )}
        {(wide || movesOpen) && (
          <div id={movesId} className="space-y-4">
            {moves.length > 0 && <MoveGroup items={moves} origin={CHROME.CARD} {...rest} />}
            {returns.length > 0 && <MoveGroup items={returns} origin={CHROME.CARD} {...rest} />}
            {costs.length > 0 && (
              <MoveGroup items={costs} origin={CHROME.CARD} className="border-t border-border pt-4" {...rest} />
            )}
          </div>
        )}
      </div>

      {!wide && (
        <div className="border-t border-border px-5 py-3">
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={chainOpen}
            aria-controls={chainOpen ? "your-move-chain" : undefined}
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

      {confirmDialog}
    </section>
  );
}
