// The consequence hint under each move: what it records, what it locks (only
// filing locks anything), and who is next. Copy from the per-move table in the
// spec's copy notes; the "next" part reads the digest, so it stays true as the
// sign-offs move on. Section names come from the constants, never typed here.

import { ipasSectionLabel } from "@/constants/ipas";

const approversOf = (part) => `the approvers of ${ipasSectionLabel(part)}`;
const sectionOf = (part) => `section ${ipasSectionLabel(part)}`;

/** The card's line while no gate is Now: Costs complete is Purchasing's, and it waits for the encoding. */
export const COSTS_WAITING = "Waiting for Purchasing to finish encoding costs.";

const RETURN_HINT = () =>
  "Clears Prepared and Approved and tells the preparer. Needs a reason. Next: Purchasing prepares it again.";

const MOVE_HINT = {
  "approve-1": (d) =>
    `Confirms ${sectionOf("purchasing")}. Nothing locks until filing. Next: ${d.s3.approved ? "Finance receives it for filing." : `${approversOf("finance")}.`}`,
  "approve-3": (d) =>
    `Confirms ${sectionOf("finance")}. Nothing locks until filing. Next: ${d.s1.approved ? "Finance receives it for filing." : `${approversOf("purchasing")}.`}`,
  "prepare-1": () => `Marks ${sectionOf("purchasing")} ready to approve. Nothing locks. Next: ${approversOf("purchasing")}, told now.`,
  "prepare-3": () => `Marks ${sectionOf("finance")} ready to approve. Nothing locks. Next: ${approversOf("finance")}, told now.`,
  costs: () =>
    `Makes Landed Cost final and lets filing go ahead. Undo is offered. Next: filing, once ${ipasSectionLabel("filing")} is received, noted and checked.`,
  receive: () => `Starts ${sectionOf("filing")}. Next: Noted and Checked, in either order.`,
  note: (d) => `Records Noted on ${sectionOf("filing")}. Next: ${d.s7.checked ? "the filing approvers" : "whoever checks it"}.`,
  check: (d) => `Records Checked on ${sectionOf("filing")}. Next: ${d.s7.noted ? "the filing approvers" : "whoever notes it"}.`,
  file: () => "Files the IPAS and freezes it. Only a Super Admin can reopen it. Next: nobody.",
  "return-1": RETURN_HINT,
  "return-3": RETURN_HINT,
  "return-7": () =>
    `Clears Received, Noted and Checked and tells who gave them. ${ipasSectionLabel("purchasing")} and ${ipasSectionLabel("finance")} stay approved. Needs a reason. Next: Finance receives it again.`,
};

/** The one-line consequence hint for a move, from the digest. */
export function hintFor(key, digest) {
  return MOVE_HINT[key]?.(digest) ?? "";
}
