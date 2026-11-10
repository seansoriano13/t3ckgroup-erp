// The consequence hint under each move: what it records, what it locks (only
// filing locks anything), and who is next. Copy from the per-move table in the
// spec's copy notes; the "next" part reads the digest, so it stays true as the
// sign-offs move on. Section names come from the constants, never typed here.

import { IPAS_COMPUTATION_STATUS, IPAS_PART_NAMES, ipasPartWord, ipasSectionLabel } from "@/constants/ipas";

const sectionOf = (part) => `${ipasPartWord(part)} · ${IPAS_PART_NAMES[part]}`;

/** The card's line while no gate is Now: LC Odoo Done is Purchasing's, and it waits for the encoding. */
export const COSTS_WAITING = "Purchasing is still working out the costs.";

/** True once section 4 has a Received, Noted or Checked that a Return of 1 or 2 would clear. */
const filingStarted = (d) => Boolean(d.s7.received || d.s7.noted || d.s7.checked);
const FILING_CASCADE = (d) =>
  filingStarted(d) ? ` Also clears ${ipasSectionLabel("filing")}'s Received, Noted and Checked.` : "";

const RETURN_HINT = (d) =>
  `Sends it back to Purchasing to fix and submit again. Needs a reason.${FILING_CASCADE(d)}`;
const UNDO_HINT = (d) =>
  `Takes back the approval only. It goes back to waiting for an approver. Needs a reason.${FILING_CASCADE(d)}`;

/** What follows an approval of section 1, 2 or 3 (#590): filing opens once all three are approved. */
const AFTER_APPROVAL = (d, part) => {
  const others = [
    ["purchasing", d.s1],
    ["finance", d.s3],
    ["costing", d.s6],
  ].filter(([key, state]) => key !== part && !state.approved);
  if (others.length === 0) return "Next: Finance receives it for filing.";
  return `Filing opens once ${others.map(([key]) => ipasSectionLabel(key)).join(" and ")} ${others.length > 1 ? "are" : "is"} approved too.`;
};

const MOVE_HINT = {
  "approve-1": (d) => `Approves ${sectionOf("purchasing")}. ${AFTER_APPROVAL(d, "purchasing")}`,
  "approve-3": (d) => `Approves ${sectionOf("finance")}. ${AFTER_APPROVAL(d, "finance")}`,
  "prepare-1": () => `Sends ${sectionOf("purchasing")} to its approvers, who are told now.`,
  "prepare-3": () => `Sends ${sectionOf("finance")} to its approvers, who are told now.`,
  "approve-6": (d) => `Approves ${sectionOf("costing")}, so the Landed Cost counts as checked. ${AFTER_APPROVAL(d, "costing")}`,
  "prepare-6": () => `Sends ${sectionOf("costing")} to its approvers, who are told now.`,
  costs: (d) =>
    d.computationStatus === IPAS_COMPUTATION_STATUS.ENCODED
      ? "Records that Landed Cost is worked out in the GS sheet. Undo is offered. Next: LC Odoo Done."
      : `Makes Landed Cost final. Undo is offered, and it clears ${ipasPartWord("costing")}'s Submitted and Approved if it was given. Next: Purchasing submits ${sectionOf("costing")} for approval.`,
  receive: () => `Starts ${sectionOf("filing")}. Next: Noted and Checked, in either order.`,
  note: (d) => `Records Noted on ${sectionOf("filing")}. Next: ${d.s7.checked ? "the filing approvers" : "whoever checks it"}.`,
  check: (d) => `Records Checked on ${sectionOf("filing")}. Next: ${d.s7.noted ? "the filing approvers" : "whoever notes it"}.`,
  file: () => "Files the IPAS and locks it. Only a Super Admin can reopen it.",
  "return-1": RETURN_HINT,
  "return-3": RETURN_HINT,
  "return-6": RETURN_HINT,
  "undo-1": UNDO_HINT,
  "undo-3": UNDO_HINT,
  "undo-6": UNDO_HINT,
  return: () => "Something wrong? Pick the section and say why. It goes back to the person who has to fix it.",
  "return-7": () =>
    `Clears Received, Noted and Checked and tells who gave them. ${ipasSectionLabel("purchasing")}, ${ipasSectionLabel("finance")} and ${ipasSectionLabel("costing")} stay approved. Needs a reason. Next: Finance receives it again.`,
};

/** The one-line consequence hint for a move, from the digest. */
export function hintFor(key, digest) {
  return MOVE_HINT[key]?.(digest) ?? "";
}
