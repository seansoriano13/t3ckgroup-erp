/**
 * The Technical list (#877, #908): the S0 Evaluations whose Technical in-charge is the caller. The database read
 * (`costing_technical_list`) carries SOR names and counts only, never money. This shapes it to camelCase with
 * numbers, and works the words the list and the sheet both show. "Checked" means the in-charge has given the
 * one offer-level verdict (the matrix counts as checked once every row has an answer, see `rowsJudged`).
 */
import { matchesSearch, sorSearchFields } from "./sorSearch";

/** One row of the read, shaped: `{ opportunityId, sorNumber, soNumber, projectTitle, clientName, stage, team, rowsTotal, rowsJudged, approved, isMine }`. `team` is always "Technical" now. */
export function shapeTechnicalList(rows) {
  return (rows ?? []).map((row) => ({
    opportunityId: row.opportunity_id,
    sorNumber: row.sor_code ?? "",
    soNumber: row.sales_reference ?? "",
    projectTitle: row.project_title ?? "",
    clientName: row.client_name ?? "",
    stage: row.stage ?? "",
    team: row.team,
    rowsTotal: Number(row.rows_total) || 0,
    rowsJudged: Number(row.rows_judged) || 0,
    rowsDeviates: Number(row.rows_deviates) || 0,
    compliance: row.compliance ?? null,
    approved: Boolean(row.approved),
    // On this row's team: only then can the caller answer it (a Super Admin reads every team's rows).
    isMine: Boolean(row.is_mine),
  }));
}

/** "7 of 12 judged", or "All 12 judged" when no product is left. Rows are products (#932). */
export function checkedLabel({ rowsJudged, rowsTotal }) {
  if (rowsTotal > 0 && rowsJudged >= rowsTotal) return `All ${rowsTotal} judged`;
  return `${rowsJudged} of ${rowsTotal} judged`;
}

/**
 * The overall verdict from the products' verdicts (#932, CONTEXT.md: Compliance): Complies only when every product
 * complies, Deviates as soon as one deviates, otherwise null (unjudged). No products is unjudged. The database keeps
 * `costing_matrices.compliance` at this same value.
 */
export function overallCompliance(components) {
  const list = components ?? [];
  if (list.some((c) => c?.compliance === "deviates")) return "deviates";
  if (list.length > 0 && list.every((c) => c?.compliance === "complies")) return "complies";
  return null;
}

/**
 * How far the judging is, for the list's bar: `{ total, judged, deviates, done, result }`. `done` once every product is
 * judged, and then `result` is the overall verdict the bar turns into (Complies or Deviates).
 */
export function judgingProgress({ rowsTotal = 0, rowsJudged = 0, rowsDeviates = 0 } = {}) {
  const done = rowsTotal > 0 && rowsJudged >= rowsTotal;
  return { total: rowsTotal, judged: rowsJudged, deviates: rowsDeviates, done, result: done ? (rowsDeviates > 0 ? "deviates" : "complies") : null };
}

export const TECHNICAL_TAB = { TO_CHECK: "to_check", TO_APPROVE: "to_approve", DONE: "done", ALL: "all" };

/** Where a row stands: Approved, Checked (every row answered, not approved yet) or To check. */
export function technicalState(row) {
  if (row.approved) return { key: "approved", label: "Approved" };
  if (row.rowsTotal > 0 && row.rowsJudged >= row.rowsTotal) return { key: "checked", label: "Checked" };
  return { key: "to_check", label: "To check" };
}

const isDone = (row) => technicalState(row).key !== "to_check";

/** The rows for a tab and a search. The tab counts are worked after the search, like the Purchasing lists. */
export function filterTechnical(rows, { tab = TECHNICAL_TAB.ALL, search = "" } = {}) {
  return rows.filter((row) => {
    if (tab === TECHNICAL_TAB.TO_CHECK && isDone(row)) return false;
    // The Evaluation list's queue: the verdict is in, the approval is not.
    if (tab === TECHNICAL_TAB.TO_APPROVE && technicalState(row).key !== "checked") return false;
    if (tab === TECHNICAL_TAB.DONE && !isDone(row)) return false;
    return matchesSearch(search, [
      ...sorSearchFields({ salesReference: row.soNumber, sorCode: row.sorNumber, projectTitle: row.projectTitle }),
      row.clientName,
    ]);
  });
}

/** Query keys of the Technical list and of one SOR's sheet. The "technical" prefix refreshes both. */
export const technicalKeys = {
  list: ["technical", "list"],
  sheet: (opportunityId) => ["technical", "sheet", opportunityId],
};
