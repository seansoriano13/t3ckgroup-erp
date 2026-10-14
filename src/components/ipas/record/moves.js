import { Check, CornerUpLeft, FileCheck2, PenLine } from "lucide-react";

import { IPAS_COMPUTATION_STATUS, IPAS_SIGNOFF_ROLE, ipasSectionLabel } from "@/constants/ipas";
import { hintFor } from "./moveCopy";

/**
 * One move: its key (which gate it passes, see gates.js), how it looks, its
 * label, its consequence hint, and what it does.
 *   kind  "approve" (green) | "prepare" or "neutral" (outline) | "return" (pale red)
 */
function move(key, kind, icon, label, run, digest) {
  return { key, kind, icon, label, run, hint: hintFor(key, digest) };
}

/**
 * Everything the signed-in person may do on this IPAS right now, in three groups:
 *   moves    the sign-offs: Approve and Prepare for sections 1 and 2, then the
 *            section 4 steps they may give
 *   costs    Mark costs complete, its own group below the sign-offs
 *   returns  the send-backs, in pale red
 * Only what the rights say the person may do is offered, so nothing is shown
 * that the database would refuse. Reopen is not a move: it lives in the filed
 * banner, for a Super Admin only.
 */
export function movesFor(ctx, digest) {
  const { rights, can, on } = ctx;
  const moves = [];

  for (const section of [1, 3]) {
    const mine = rights[section];
    const label = ipasSectionLabel(section);
    if (mine.canApprove) {
      moves.push(move(`approve-${section}`, "approve", Check, `Approve section ${label}`, () => on.approve(section), digest));
    }
    if (mine.canPrepare) {
      moves.push(move(`prepare-${section}`, "prepare", PenLine, `Prepare section ${label}`, () => on.prepare(section), digest));
    }
  }

  const filing = ipasSectionLabel(7);
  const steps = [
    [IPAS_SIGNOFF_ROLE.RECEIVED, "receive", Check, `Receive section ${filing}`],
    [IPAS_SIGNOFF_ROLE.NOTED, "note", Check, `Note section ${filing}`],
    [IPAS_SIGNOFF_ROLE.CHECKED, "check", Check, `Check section ${filing}`],
    [IPAS_SIGNOFF_ROLE.APPROVED, "file", FileCheck2, "Approve and file"],
  ];
  for (const [role, key, icon, label] of steps) {
    if (rights[7][role]?.canGive) moves.push(move(key, "approve", icon, label, () => on.give(role), digest));
  }

  const costs = [];
  if (can.change && !digest.costsComplete) {
    costs.push(
      move(
        "costs",
        "neutral",
        Check,
        "Mark costs complete",
        () => on.setComputationStatus(IPAS_COMPUTATION_STATUS.COSTS_COMPLETE),
        digest,
      ),
    );
  }

  const returns = [];
  for (const section of [1, 3]) {
    if (rights[section].canSendBack) {
      returns.push(
        move(`return-${section}`, "return", CornerUpLeft, `Send section ${ipasSectionLabel(section)} back`, () => on.sendBack(section), digest),
      );
    }
  }
  if (rights.sendBack7) {
    returns.push(move("return-7", "return", CornerUpLeft, `Send section ${filing} back`, () => on.sendBack(7), digest));
  }

  return { moves, costs, returns };
}
