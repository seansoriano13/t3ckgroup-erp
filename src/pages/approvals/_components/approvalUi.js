/** Approve reads as "yes" in green, as it always has on the approval screens; red stays with Return. */
export const APPROVE_CLASS = "bg-green-9 text-white shadow-sm hover:bg-green-10";

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
    return `You are on the section ${item.source?.section} approval list, and ${first} prepared it. Whoever prepares a section can't approve it.`;
  }
  if (item.queue === "leaves") return `You are ${first}’s department head, the first approver for leave and overtime.`;
  return item.source?.reportedTo
    ? `${first} reported this task to you, so it comes to you for a grade.`
    : `${first} is in your department, so their task comes to you for a grade.`;
}
