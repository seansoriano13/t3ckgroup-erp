/**
 * The Technical list (#706): the SORs with rows given to the caller's evaluation team (RRD or IOE). The
 * database read (`costing_technical_list`) carries SOR names and counts only, never money. This shapes it
 * to camelCase with numbers, and works the progress line the list and the sheet both show.
 */

/** One row of the read, shaped: `{ opportunityId, sorNumber, soNumber, projectTitle, clientName, stage, team, rowsTotal, rowsJudged, approved }`. */
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
    // On this row's team: only then can the caller judge it (a Super Admin reads every team's rows).
    isMine: Boolean(row.is_mine),
  }));
}

/** "7 of 12 judged", or "All 12 judged" when nothing is left. */
export function judgedLabel({ rowsJudged, rowsTotal }) {
  if (rowsTotal > 0 && rowsJudged >= rowsTotal) return `All ${rowsTotal} judged`;
  return `${rowsJudged} of ${rowsTotal} judged`;
}

/**
 * The rows of an SOR's Tender Lines that belong to the teams the caller is on. A Super Admin passes
 * `teams: null` and sees every team's rows. Rows with no team are nobody's to judge yet and are left out.
 */
export function linesForTeams(tenderLines, teams) {
  return (tenderLines ?? []).filter((line) => line.evaluating_team && (teams === null || teams.includes(line.evaluating_team)));
}

/** Query keys of the Technical list and of one SOR's sheet. The "technical" prefix refreshes both. */
export const technicalKeys = {
  list: ["technical", "list"],
  sheet: (opportunityId) => ["technical", "sheet", opportunityId],
};
