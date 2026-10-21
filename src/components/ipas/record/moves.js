import { Check, CornerUpLeft, FileCheck2, PenLine, Undo2 } from "lucide-react";

import {
  IPAS_COMPUTATION_STATUS,
  IPAS_COMPUTATION_STATUS_LABELS,
  IPAS_PART_NO,
  IPAS_SECTION_PART,
  IPAS_SIGNOFF_ROLE,
  ipasSectionNo,
} from "@/constants/ipas";
import { hintFor } from "./moveCopy";

/**
 * One move: its key (which gate it passes, see gates.js), the section it
 * belongs to (the drawer's footer and "Review section" use it), how it looks,
 * its label, its consequence hint, and what it does.
 *   kind     "approve" (green) | "prepare" or "neutral" (outline) | "return" (pale red)
 *   confirm  the card and the drawer footer ask first, with the restatement
 *   run(from)  `from` is { key, origin } where the move was started; the page
 *            passes it to the mutation so a failure shows at its origin
 */
function move(key, section, { kind, icon, label, verb, confirm = true, run }, digest) {
  return { key, section, kind, icon, label, verb, confirm, run, hint: hintFor(key, digest) };
}

const FILING = ipasSectionNo(7);
const PART = IPAS_SECTION_PART;
// The stored sections whose Submit and Approve the card offers: 1, 3 and 6 (shown as 1, 2 and 3).
const SIGN_SECTIONS = [1, 3, 6];
// The ones with a Return and an Undo approval; section 6's join them with #591.
const RETURN_SECTIONS = [1, 3];
// The filing section: its sign-offs are steps, not Prepare and Approve.
const FILING_SECTION = 7;

/**
 * Everything the signed-in person may do on this IPAS right now, in three groups:
 *   moves    the sign-offs: Approve and Prepare for sections 1, 2 and 3, then the
 *            section 4 steps they may give
 *   costs    The next LC step, its own group below the sign-offs
 *   returns  the Return, in pale red: one button whose dialog picks the section
 *   bySection  the per-section Return / Undo approval moves, for the drawer footer
 * Only what the rights say the person may do is offered, so nothing is shown
 * that the database would refuse. Reopen is not a move: it lives in the filed
 * banner, for a Super Admin only.
 */
export function movesFor(ctx, digest) {
  const { rights, can, on } = ctx;
  const moves = [];

  for (const section of SIGN_SECTIONS) {
    const mine = rights[section];
    const label = ipasSectionNo(section);
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
          label: `Submit section ${label}`,
          verb: "Submit",
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
    if (!rights[FILING_SECTION][role]?.canGive) continue;
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
  // Offered only on the costs gate's own turn (gates.js), so the card's status
  // line, which says what it waits on until then, and this move never disagree.
  // One step at a time: LC GS Done after Encoded, LC Odoo Done after that.
  const costsGate = digest.gates.find((gate) => gate.key === "costs");
  if (can.change && !digest.costsComplete && costsGate?.prereqMet) {
    const next =
      digest.computationStatus === IPAS_COMPUTATION_STATUS.ENCODED
        ? IPAS_COMPUTATION_STATUS.LC_GS_DONE
        : IPAS_COMPUTATION_STATUS.LC_ODOO_DONE;
    const nextLabel = IPAS_COMPUTATION_STATUS_LABELS[next];
    costs.push(
      move("costs", "costing", {
        kind: "neutral",
        icon: Check,
        label: `Mark ${nextLabel}`,
        verb: "Mark done",
        // Undoable from its toast, so no question first (and no "You sign as" line).
        confirm: false,
        run: (from) => on.setComputationStatus(next, from),
      }, digest),
    );
  }

  // Returns and undos, one entry each per section. The card shows them as the one
  // "Return…" button (below); the drawer's footer shows its own section's.
  const bySection = [];
  for (const section of RETURN_SECTIONS) {
    const mode = rights[section].returnMode;
    if (!mode) continue;
    const label = ipasSectionNo(section);
    const undo = mode === "undo";
    bySection.push(
      move(`${undo ? "undo" : "return"}-${section}`, PART[section], {
        kind: "return",
        icon: undo ? Undo2 : CornerUpLeft,
        label: undo ? `Undo approval of section ${label}` : `Return section ${label}`,
        verb: undo ? "Undo approval" : "Return",
        confirm: false,
        // Both ask in their own dialog (reason, and what else it clears).
        run: (from) => on.openReturn(section, from),
      }, digest),
    );
  }
  if (rights.sendBack7) {
    bySection.push(
      move("return-7", "filing", {
        kind: "return",
        icon: CornerUpLeft,
        label: `Return section ${FILING}`,
        verb: "Return",
        confirm: false,
        run: (from) => on.openReturn(FILING_SECTION, from),
      }, digest),
    );
  }

  // The card's single button: a dialog picks the section.
  const returns = [];
  if (bySection.length > 0) {
    const allUndo = bySection.every((item) => item.key.startsWith("undo-"));
    returns.push({
      ...move("return", bySection[0].section, {
        kind: "return",
        icon: allUndo ? Undo2 : CornerUpLeft,
        label: allUndo ? "Undo approval…" : "Return…",
        verb: allUndo ? "Undo approval" : "Return",
        confirm: false,
        run: (from) => on.openReturn(null, from),
      }, digest),
      // No single section to review.
      section: null,
    });
  }

  return { moves, costs, returns, bySection };
}

/**
 * What the "Your move" card shows of the sign-off moves: only the earliest
 * section (screen order, by `IPAS_PART_NO`) that has any, with the other
 * sections that have moves listed in `also` (part keys, in screen order) for
 * the card's "Also waiting for you" line. Section 4 is one part, so when it is
 * earliest all its steps (Noted and Checked together) stay. The Return button
 * and the LC step are not sign-offs and stay as they are. `all` is the
 * unfiltered list, for what the status line says.
 */
export function cardMovesFor(ctx, digest) {
  const { moves: all, costs, returns, bySection } = movesFor(ctx, digest);
  const parts = [...new Set(all.map((item) => item.section))].sort((a, b) => IPAS_PART_NO[a] - IPAS_PART_NO[b]);
  const [first, ...also] = parts;
  const moves = all.filter((item) => item.section === first);
  return { moves, costs, returns, bySection, all, also };
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
      return can.change;
    case "sales":
    case "header":
      return can.change;
    default:
      return false;
  }
}

/** The moves a section's drawer footer offers: the same moves as the card, for that section. */
export function footerMovesFor(ctx, digest, sectionKey) {
  const { moves, costs, bySection } = movesFor(ctx, digest);
  return [...moves, ...costs, ...bySection].filter((item) => item.section === sectionKey);
}
