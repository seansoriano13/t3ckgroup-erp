import { revenueComparison } from "./costingMath";
import { sumPesos } from "./landedCost";
import { matchesSearch, sorSearchFields } from "./sorSearch";

/**
 * The Costing Matrix page's rows (#606, spec #595): every SOR that has a Costing Matrix with its
 * Planned and Actual Revenue, for the Closed Book. The database read (`costing_matrix_page`) gives
 * each SOR's totals; the Revenue figures are worked here with `revenueComparison`, the same maths the
 * SOR's own summary uses, so the page and the SOR can never disagree.
 */

const numberOrNull = (value) => (value === null || value === undefined || value === "" ? null : Number(value));

/**
 * Shapes the read's rows with the summary's rates: camelCase, numbers for numerics (PostgREST may
 * send them as text), and `comparison` = `revenueComparison` of the row's totals.
 */
export function shapeMatrixPage(rows, settings) {
  return (rows ?? []).map((row) => {
    const totals = {
      finalOfferTotal: numberOrNull(row.final_offer_total),
      finalAcquireTotal: numberOrNull(row.final_acquire_total),
      landedCostTotal: numberOrNull(row.landed_cost_total),
      boughtFinalAcquireTotal: numberOrNull(row.bought_final_acquire_total),
      itemsBought: Number(row.items_bought) || 0,
      itemsTotal: Number(row.items_total) || 0,
      ipasShort: Boolean(row.ipas_short),
    };
    return {
      opportunityId: row.opportunity_id,
      sorNumber: row.sor_code ?? "",
      soNumber: row.sales_reference ?? "",
      projectTitle: row.project_title ?? "",
      stage: row.stage ?? "",
      entities: row.entities ?? [],
      finalOffer: totals.finalOfferTotal,
      comparison: revenueComparison(totals, settings),
    };
  });
}

/**
 * The page's slices over shaped rows. `stage` and `entity` are exact; `belowPlanned` keeps rows whose
 * Actual Revenue is below Planned; `search` matches the SO number, SOR number and project name (a
 * case-insensitive "contains", like the IPAS list), or the SO number and project written together
 * the way Purchasing writes them ("S04081 BFP Command Bus").
 */
export function filterMatrixPage(rows, { stage = null, entity = null, belowPlanned = false, search = "" } = {}) {
  return rows.filter((row) => {
    if (stage && row.stage !== stage) return false;
    if (entity && !row.entities.includes(entity)) return false;
    if (belowPlanned && !row.comparison.actualLower) return false;
    return matchesSearch(search, sorSearchFields({ salesReference: row.soNumber, sorCode: row.sorNumber, projectTitle: row.projectTitle }));
  });
}

/**
 * Totals for the rows shown. Each money column adds the rows that have a figure; a row whose
 * Revenue cannot be worked yet (a blank offer or Final Acquire) is counted in `incomplete` and left
 * out. `estimate` is true when any row's Actual is an estimate, so the total is one too.
 */
export function matrixPageTotals(rows) {
  const have = (pick) => rows.map(pick).filter((v) => v !== null && v !== undefined);
  return {
    count: rows.length,
    finalOffer: sumPesos(have((r) => r.finalOffer)),
    planned: sumPesos(have((r) => r.comparison.planned)),
    actual: sumPesos(have((r) => r.comparison.actual)),
    difference: sumPesos(have((r) => r.comparison.difference)),
    itemsBought: rows.reduce((sum, r) => sum + r.comparison.itemsBought, 0),
    itemsTotal: rows.reduce((sum, r) => sum + r.comparison.itemsTotal, 0),
    estimate: rows.some((r) => r.comparison.estimate && r.comparison.actual !== null),
    incomplete: rows.filter((r) => r.comparison.planned === null).length,
  };
}
