/**
 * The Technical list (#877): the SORs with rows given to the caller's evaluation team (RRD or IOE). The
 * database read (`costing_technical_list`) carries SOR names and counts only, never money. This shapes it
 * to camelCase with numbers, and works the words the list and the sheet both show. "Checked" is a row
 * the team has answered Complies or Deviates on.
 */
import { matchesSearch, sorSearchFields } from "./sorSearch";

/** One row of the read, shaped: `{ opportunityId, sorNumber, soNumber, projectTitle, clientName, stage, team, rowsTotal, rowsJudged, approved, isMine }`. */
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
    approved: Boolean(row.approved),
    // On this row's team: only then can the caller answer it (a Super Admin reads every team's rows).
    isMine: Boolean(row.is_mine),
  }));
}

/** "7 of 12 checked", or "All 12 checked" when nothing is left. */
export function checkedLabel({ rowsJudged, rowsTotal }) {
  if (rowsTotal > 0 && rowsJudged >= rowsTotal) return `All ${rowsTotal} checked`;
  return `${rowsJudged} of ${rowsTotal} checked`;
}

export const TECHNICAL_TAB = { TO_CHECK: "to_check", DONE: "done", ALL: "all" };

/** Where a row stands: Approved, Checked (every row answered, not approved yet) or To check. */
export function technicalState(row) {
  if (row.approved) return { key: "approved", label: "Approved" };
  if (row.rowsTotal > 0 && row.rowsJudged >= row.rowsTotal) return { key: "checked", label: "Checked" };
  return { key: "to_check", label: "To check" };
}

const isDone = (row) => technicalState(row).key !== "to_check";

/** The rows for a tab, a team and a search. The tab counts are worked after the team and search, like the Purchasing lists. */
export function filterTechnical(rows, { tab = TECHNICAL_TAB.ALL, team = null, search = "" } = {}) {
  return rows.filter((row) => {
    if (team && row.team !== team) return false;
    if (tab === TECHNICAL_TAB.TO_CHECK && isDone(row)) return false;
    if (tab === TECHNICAL_TAB.DONE && !isDone(row)) return false;
    return matchesSearch(search, [
      ...sorSearchFields({ salesReference: row.soNumber, sorCode: row.sorNumber, projectTitle: row.projectTitle }),
      row.clientName,
    ]);
  });
}

/**
 * The rows of an SOR's Tender Lines that belong to the teams the caller is on. A Super Admin passes
 * `teams: null` and sees every team's rows. Rows with no team are nobody's to check yet and are left out.
 */
export function linesForTeams(tenderLines, teams) {
  return (tenderLines ?? []).filter((line) => line.evaluating_team && (teams === null || teams.includes(line.evaluating_team)));
}

/** Query keys of the Technical list and of one SOR's sheet. The "technical" prefix refreshes both. */
export const technicalKeys = {
  list: ["technical", "list"],
  sheet: (opportunityId) => ["technical", "sheet", opportunityId],
};
