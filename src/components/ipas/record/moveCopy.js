// The consequence hint under each move: what it records, what it locks (only
// filing locks anything), and who is next. Copy from the per-move table in the
// spec's copy notes; the "next" part reads the digest, so it stays true as the
// sign-offs move on.

import { ipasSectionLabel } from "@/constants/ipas";

const approversOf = (part) => `the approvers of ${ipasSectionLabel(part)}`;

const MOVE_HINT = {
  "approve-1": (d) =>
    `Confirms section 1 · Purchasing. Nothing locks until filing. Next: ${d.s3.approved ? "Finance receives it for filing." : `${approversOf("finance")}.`}`,
  "approve-3": (d) =>
    `Confirms section 2 · Purchasing & Finance. Nothing locks until filing. Next: ${d.s1.approved ? "Finance receives it for filing." : `${approversOf("purchasing")}.`}`,
  "prepare-1": () => `Marks section 1 · Purchasing ready to approve. Nothing locks. Next: ${approversOf("purchasing")}, told now.`,
  "prepare-3": () => `Marks section 2 · Purchasing & Finance ready to approve. Nothing locks. Next: ${approversOf("finance")}, told now.`,
  costs: () =>
    "Makes Landed Cost final and lets filing go ahead. Undo is offered. Next: filing, once 4 · Filing is received, noted and checked.",
  receive: () => "Starts section 4 · Filing. Next: Noted and Checked, in either order.",
  note: (d) => `Records Noted on section 4 · Filing. Next: ${d.s7.checked ? "the filing approvers" : "whoever checks it"}.`,
  check: (d) => `Records Checked on section 4 · Filing. Next: ${d.s7.noted ? "the filing approvers" : "whoever notes it"}.`,
  file: () => "Files the IPAS and freezes it. Only a Super Admin can reopen it. Next: nobody.",
  "return-1": () => `Clears Prepared and Approved and tells the preparer. Needs a reason. Next: Purchasing prepares it again.`,
  "return-3": () => `Clears Prepared and Approved and tells the preparer. Needs a reason. Next: Purchasing prepares it again.`,
  "return-7": () =>
    "Clears Received, Noted and Checked and tells who gave them. 1 · Purchasing and 2 · Purchasing & Finance stay approved. Needs a reason. Next: Finance receives it again.",
};

/** The one-line consequence hint for a move, from the digest. */
export function hintFor(key, digest) {
  return MOVE_HINT[key]?.(digest) ?? "";
}
