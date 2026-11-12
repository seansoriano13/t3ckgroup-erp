import { revenueComparison } from "./costingMath";
import { numberOrNull } from "./numberOrNull";

/**
 * The S0 Evaluation that starts from just an S0 number (#966, spec #955). Pure helpers: the S0 number's shape,
 * the lines the database is handed from what Odoo sent, and the S0 Evaluation list's standalone rows.
 */

// "S0" and digits: the same shape the Odoo lookup takes (S01237).
const S0_PATTERN = /^S0\d+$/;

/** An S0 number as typed, tidied (trimmed, upper case); empty text for anything not text. */
export function normalizeS0(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

/** True for an S0 number: "S0" and digits, like S01237. */
export function isS0Number(value) {
  return S0_PATTERN.test(normalizeS0(value));
}

/**
 * The lines to hand `costing_standalone_open` from the items Odoo sent for the sale order. A line with no
 * name is left out; the quantity falls back to 1 when Odoo sent none above zero.
 */
export function linesFromOdoo(items) {
  return (items ?? [])
    .map((item) => ({
      name: String(item?.product_name ?? "").trim(),
      quantity: Number(item?.quantity) > 0 ? Number(item.quantity) : 1,
      unit: String(item?.unit ?? "").trim() || null,
      odoo_product_id: Number.isInteger(item?.odoo_product_id) ? item.odoo_product_id : null,
      odoo_line_id: Number.isInteger(item?.odoo_line_id) ? item.odoo_line_id : null,
    }))
    .filter((line) => line.name);
}

/**
 * The standalone evaluations the caller reads, shaped like the SOR rows of the S0 Evaluation list so the
 * list shows both. Only the Closed Book gets the figures a Revenue needs, so the others show blanks there.
 * `subjectId` (its own id) opens the evaluation; `standalone` marks the row "No SOR". `projectNote`, `stageLabel` and
 * `itemsLabel` are what the table shows where a SOR row shows its project, stage and bought items.
 */
export function shapeStandalonePage(rows, settings) {
  return (rows ?? []).map((row) => ({
    standalone: true,
    matrixId: row.matrix_id,
    opportunityId: null,
    subjectId: row.matrix_id,
    projectNote: "Started from the S0 alone",
    stageLabel: "—",
    itemsLabel: "—",
    tier: row.tier,
    createdAt: row.created_at,
    createdBy: row.created_by,
    salesInchargeId: row.sales_incharge_id,
    pmsInchargeId: row.purchasing_incharge_id,
    sorNumber: "",
    soNumber: row.s0_number ?? "",
    projectTitle: "",
    stage: "",
    entities: [],
    lineCount: Number(row.line_count) || 0,
    finalOffer: numberOrNull(row.final_offer_total),
    comparison: revenueComparison(
      {
        finalOfferTotal: numberOrNull(row.final_offer_total),
        finalAcquireTotal: numberOrNull(row.final_acquire_total),
        projectExpensesTotal: numberOrNull(row.project_expenses_total),
        marketing: numberOrNull(row.marketing),
      },
      settings,
    ),
  }));
}
