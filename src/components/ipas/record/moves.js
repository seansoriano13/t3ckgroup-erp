import { Check, CornerUpLeft, FileCheck2, PenLine } from "lucide-react";

import { IPAS_COMPUTATION_STATUS, IPAS_SIGNOFF_ROLE, ipasSectionLabel } from "@/constants/ipas";
import { hintFor } from "./moveCopy";

/**
 * One move: its key (which gate it passes, see gates.js), the section it
 * belongs to (the drawer's footer and "Review section" use it), how it looks,
 * its label, its consequence hint, and what it does.
 *   kind     "approve" (green) | "prepare" or "neutral" (outline) | "return" (pale red)
 *   confirm  the card asks first, with the restatement; the drawer footer signs
 *            straight away, because the evidence is in view
 *   run(from)  `from` is { key, origin } where the move was started; the page
 *            passes it to the mutation so a failure shows at its origin
 */
function move(key, section, { kind, icon, label, verb, confirm = true, run }, digest) {
  return { key, section, kind, icon, label, verb, confirm, run, hint: hintFor(key, digest) };
}

const FILING = ipasSectionLabel(7);
const PART = { 1: "purchasing", 3: "finance", 7: "filing" };

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
      moves.push(
        move(`approve-${section}`, PART[section], {
          kind: "approve",
          icon: Check,
          label: `Approve section ${label}`,
          verb: "Approve",
          run: (from) => on.approve(section, from),
        }, digest),
      );
    }
    if (mine.canPrepare) {
      moves.push(
        move(`prepare-${section}`, PART[section], {
          kind: "prepare",
          icon: PenLine,
          label: `Prepare section ${label}`,
          verb: "Prepare",
          run: (from) => on.prepare(section, from),
        }, digest),
      );
    }
  }

  // Approve and file confirms in the filing dialog (it lists the documents), so its card move does not ask twice.
  const steps = [
    [IPAS_SIGNOFF_ROLE.RECEIVED, "receive", "Receive"],
    [IPAS_SIGNOFF_ROLE.NOTED, "note", "Note"],
    [IPAS_SIGNOFF_ROLE.CHECKED, "check", "Check"],
    [IPAS_SIGNOFF_ROLE.APPROVED, "file", "Approve and file"],
  ];
  for (const [role, key, verb] of steps) {
    if (!rights[7][role]?.canGive) continue;
    const filed = role === IPAS_SIGNOFF_ROLE.APPROVED;
    moves.push(
      move(key, "filing", {
        kind: "approve",
        icon: filed ? FileCheck2 : Check,
        label: filed ? "Approve and file" : `${verb} section ${FILING}`,
        verb,
        confirm: !filed,
        run: (from) => on.give(role, from),
      }, digest),
    );
  }

  const costs = [];
  if (can.change && !digest.costsComplete) {
    costs.push(
      move("costs", "costing", {
        kind: "neutral",
        icon: Check,
        label: "Mark costs complete",
        verb: "Mark complete",
        run: (from) => on.setComputationStatus(IPAS_COMPUTATION_STATUS.COSTS_COMPLETE, from),
      }, digest),
    );
  }

  const returns = [];
  for (const section of [1, 3]) {
    if (rights[section].canSendBack) {
      returns.push(
        move(`return-${section}`, PART[section], {
          kind: "return",
          icon: CornerUpLeft,
          label: `Send section ${ipasSectionLabel(section)} back`,
          verb: "Send back",
          confirm: false,
          run: () => on.sendBack(section),
        }, digest),
      );
    }
  }
  if (rights.sendBack7) {
    returns.push(
      move("return-7", "filing", {
        kind: "return",
        icon: CornerUpLeft,
        label: `Send section ${FILING} back`,
        verb: "Send back",
        confirm: false,
        run: () => on.sendBack(7),
      }, digest),
    );
  }

  return { moves, costs, returns };
}

/**
 * Whether the edit view has edit controls for a section, for this viewer: the
 * same grants its body uses (Purchasing's payments are Purchasing or Finance's;
 * a charge, a document tick or a bank line follows Finance's grants). Section 4
 * has none: its moves are sign-offs only.
 */
export function canEditSection(key, { can }) {
  switch (key) {
    case "purchasing":
      return can.change || can.record;
    case "finance":
      return can.record || can.change || can.tickFinance;
    case "costing":
    case "sales":
    case "header":
      return can.change;
    default:
      return false;
  }
}

/** The moves a section's drawer footer offers: the same moves as the card, for that section. */
export function footerMovesFor(ctx, digest, sectionKey) {
  const { moves, costs, returns } = movesFor(ctx, digest);
  return [...moves, ...costs, ...returns].filter((item) => item.section === sectionKey);
}
