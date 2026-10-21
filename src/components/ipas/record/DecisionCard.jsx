// The IPAS's "Your move": what this person can do here, from the `movesFor`
// rights, and who the IPAS waits on. The card itself is the shared RecordCard.

import RecordCard from "@/components/record/RecordCard";
import { Button } from "@/components/ui/button";
import { ipasPartWord, ipasSectionLabel } from "@/constants/ipas";
import { nowGate } from "./gates";
import { COSTS_WAITING } from "./moveCopy";
import { cardMovesFor } from "./moves";

/** One line under "Your move": what the viewer can do, or who the IPAS waits on. */
function statusLine(digest, gates, offered) {
  if (digest.filed) return "Filed. Nothing left to do.";
  if (digest.cancelled) return "Cancelled. Nothing to do.";
  // No gate is Now only while LC Odoo Done waits for Purchasing's encoding (gates.js).
  const now = nowGate(gates);
  if (!now) return offered.length === 0 ? `Nothing needs you right now. ${COSTS_WAITING}` : COSTS_WAITING;
  const mine = now.moveKeys.some((key) => offered.some((move) => move.key === key));
  // Filing has three steps under one section number, so it names the step too.
  const step = now.part === "filing" ? `${now.label}, ${now.role}` : now.label;
  return mine ? `Waiting for you: ${step}` : `Next: ${step}, waiting on ${now.waitsOn}`;
}

export default function DecisionCard({ ctx, digest, onReview, next }) {
  const { busy, failure, viewer } = ctx;
  const { moves, costs, returns, all, also } = cardMovesFor(ctx, digest);
  // The status line reads every offered move, not just the ones this card shows.
  const offered = [...all, ...costs, ...returns];

  return (
    <RecordCard
      status={statusLine(digest, digest.gates, offered)}
      next={next && { to: `/purchasing/ipas/${next.ipasId}`, label: `Next IPAS waiting for me: ${next.number}` }}
      groups={[
        { items: moves },
        { items: returns },
        { items: costs, className: "border-t border-border pt-4" },
      ]}
      gates={digest.gates}
      restate={(section) => digest.lines[section]}
      reviewText={(section) => `Review section ${ipasSectionLabel(section)}`}
      onReview={onReview}
      footnote={
        also.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Also waiting for you:{" "}
            {also.map((part, index) => (
              <span key={part}>
                {index > 0 && ", "}
                <Button
                  type="button"
                  variant="link"
                  onClick={() => onReview(part)}
                  className="h-auto p-0 text-sm font-semibold text-foreground underline"
                >
                  {ipasPartWord(part)}
                </Button>
              </span>
            ))}
          </p>
        )
      }
      viewer={viewer}
      busy={busy.signoff || busy.give}
      failure={failure}
    />
  );
}
