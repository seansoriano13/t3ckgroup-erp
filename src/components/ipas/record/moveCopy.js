// The consequence hint under each move: what it records, what it locks (only
// filing locks anything), and who is next. Copy from the per-move table in the
// spec's copy notes; the "next" part reads the digest, so it stays true as the
// sign-offs move on. Section names come from the constants, never typed here.

import { IPAS_COMPUTATION_STATUS, ipasSectionLabel } from "@/constants/ipas";

const approversOf = (part) => `the approvers of ${ipasSectionLabel(part)}`;
const sectionOf = (part) => `section ${ipasSectionLabel(part)}`;

/** The card's line while no gate is Now: LC Odoo Done is Purchasing's, and it waits for the encoding. */
export const COSTS_WAITING = "Waiting for Purchasing to finish encoding costs.";

/** True once section 4 has a Received, Noted or Checked that a Return of 1 or 2 would clear. */
const filingStarted = (d) => Boolean(d.s7.received || d.s7.noted || d.s7.checked);
const FILING_CASCADE = (d) =>
  filingStarted(d) ? ` Also clears ${ipasSectionLabel("filing")}'s Received, Noted and Checked.` : "";

const RETURN_HINT = (d) =>
  `Clears Submitted and Approved and tells the submitter. Needs a reason. Next: Purchasing submits it again.${FILING_CASCADE(d)}`;
const UNDO_HINT = (d) =>
  `Takes back the approval only. Submitted stays, so it waits for an approver again. Needs a reason.${FILING_CASCADE(d)}`;

/** What follows an approval of section 1, 2 or 3 (#590): filing opens once all three are approved. */
const AFTER_APPROVAL = (d, part) => {
  const others = [
    ["purchasing", d.s1],
    ["finance", d.s3],
    ["costing", d.s6],
  ].filter(([key, state]) => key !== part && !state.approved);
  if (others.length === 0) return "Finance receives it for filing.";
  return `${others.map(([key]) => approversOf(key)).join(" and ")}, before filing opens.`;
};

const MOVE_HINT = {
  "approve-1": (d) => `Confirms ${sectionOf("purchasing")}. Nothing locks until filing. Next: ${AFTER_APPROVAL(d, "purchasing")}`,
  "approve-3": (d) => `Confirms ${sectionOf("finance")}. Nothing locks until filing. Next: ${AFTER_APPROVAL(d, "finance")}`,
  "prepare-1": () => `Submits ${sectionOf("purchasing")} for approval. Nothing locks. Next: ${approversOf("purchasing")}, told now.`,
  "prepare-3": () => `Submits ${sectionOf("finance")} for approval. Nothing locks. Next: ${approversOf("finance")}, told now.`,
  "approve-6": (d) =>
    `Confirms ${sectionOf("costing")}: the Landed Cost was checked. Nothing locks until filing. Next: ${AFTER_APPROVAL(d, "costing")}`,
  "prepare-6": () => `Submits ${sectionOf("costing")} for approval. Nothing locks. Next: ${approversOf("costing")}, told now.`,
  costs: (d) =>
    d.computationStatus === IPAS_COMPUTATION_STATUS.ENCODED
      ? "Records that Landed Cost is worked out in the GS sheet. Undo is offered. Next: LC Odoo Done."
      : `Makes Landed Cost final. Undo is offered. Next: Purchasing submits ${sectionOf("costing")} for approval.`,
  receive: () => `Starts ${sectionOf("filing")}. Next: Noted and Checked, in either order.`,
  note: (d) => `Records Noted on ${sectionOf("filing")}. Next: ${d.s7.checked ? "the filing approvers" : "whoever checks it"}.`,
  check: (d) => `Records Checked on ${sectionOf("filing")}. Next: ${d.s7.noted ? "the filing approvers" : "whoever notes it"}.`,
  file: () => "Files the IPAS and freezes it. Only a Super Admin can reopen it. Next: nobody.",
  "return-1": RETURN_HINT,
  "return-3": RETURN_HINT,
  "undo-1": UNDO_HINT,
  "undo-3": UNDO_HINT,
  return: () => "Asks which section and why. Return clears Prepared and Approved; Undo approval clears the approval only.",
  "return-7": () =>
    `Clears Received, Noted and Checked and tells who gave them. ${ipasSectionLabel("purchasing")}, ${ipasSectionLabel("finance")} and ${ipasSectionLabel("costing")} stay approved. Needs a reason. Next: Finance receives it again.`,
};

/** The one-line consequence hint for a move, from the digest. */
export function hintFor(key, digest) {
  return MOVE_HINT[key]?.(digest) ?? "";
}
