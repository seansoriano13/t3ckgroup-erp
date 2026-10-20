import { IPAS_SIGNOFF_ROLE_LABELS, ipasSectionNo } from "../../../constants/ipas";

/** pending | overdue | approved | verified — the one-word state of a row. */
export function statusOf(item) {
  if (item.done) return item.queue === "hr" ? "verified" : "approved";
  return item.isStale ? "overdue" : "pending";
}

export const NOTE_PRESETS = {
  tasks: ["Completed as specified.", "Great quality work!", "Approved for payroll.", "Please update checklist items.", "Follow up required on details."],
  hr: ["Verified against payroll guidelines.", "Audited and approved.", "Incomplete documentation.", "Returned for manager review."],
  leaves: ["Approved, coverage is arranged.", "Please hand over your work first.", "Clashes with a deadline, please pick another date."],
};

/** Why this request reached the signed-in reviewer, in one sentence. */
export function whyYouSeeThis(item) {
  const first = (item.person?.name || "They").split(" ")[0];
  if (item.queue === "hr") return "You hold HR verification: graded work needs your sign-off before it counts for payroll.";
  if (item.queue === "ipas") {
    if (item.source?.section === 7) {
      return `You are on the section ${ipasSectionNo(7)} ${(IPAS_SIGNOFF_ROLE_LABELS[item.source?.role] ?? "").toLowerCase()} list, and ${item.source?.role === "approved" ? "everything before it is given. Approving files the IPAS and freezes it" : "it is your turn"}.`;
    }
    return `You are on the section ${ipasSectionNo(item.source?.section)} approval list, and ${first} prepared it. Whoever prepares a section can't approve it.`;
  }
  if (item.queue === "leaves") return `You are ${first}’s department head, the first approver for leave and overtime.`;
  return item.source?.reportedTo
    ? `${first} reported this task to you, so it comes to you for a grade.`
    : `${first} is in your department, so their task comes to you for a grade.`;
}
