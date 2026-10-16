// The IPAS's "Your move": what this person can do here, from the `movesFor`
// rights, and who the IPAS waits on. The card itself is the shared RecordCard.

import RecordCard from "@/components/record/RecordCard";
import { ipasSectionLabel } from "@/constants/ipas";
import { nowGate, waitingSections } from "./gates";
import { COSTS_WAITING } from "./moveCopy";
import { movesFor } from "./moves";

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

export default function DecisionCard({ ctx, digest, onReview, next }) {
  const { busy, failure, viewer } = ctx;
  const { moves, costs, returns } = movesFor(ctx, digest);
  const offered = [...moves, ...costs, ...returns];

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
      viewer={viewer}
      busy={busy.signoff || busy.give}
      failure={failure}
    />
  );
}
