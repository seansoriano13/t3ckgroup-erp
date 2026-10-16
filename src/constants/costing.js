/**
 * Costing Matrix vocabulary (#267, spec #266): the read tiers, the write bands
 * and the words the screen uses for a refusal. The database decides who may
 * read and write what; this file only names things and mirrors the registries
 * (supabase/migrations/20261018100000_costing_matrix_tender_lines.sql) so the
 * screen can show a cell read-only instead of letting someone type into it.
 */

/** The caller's read tier on an SOR, resolved by `costing_tier` in the database. */
export const COSTING_TIER = {
  CLOSED_BOOK: "closed_book",
  COST: "cost",
  PRICE: "price",
  PARTICIPANT: "participant",
};

/** A write band (`costing_column_bands`). */
export const COSTING_BAND = {
  SALES: "sales",
  PURCHASING: "purchasing",
  MANAGEMENT: "management",
  TECHNICAL: "technical",
  FINANCE: "finance",
  SUPER_ADMIN_ONLY: "super_admin_only",
};

export const COSTING_BAND_LABEL = {
  [COSTING_BAND.SALES]: "Sales (the Deal Team)",
  [COSTING_BAND.PURCHASING]: "Purchasing",
  [COSTING_BAND.MANAGEMENT]: "the Final Acquire list",
  [COSTING_BAND.TECHNICAL]: "Technical",
  [COSTING_BAND.FINANCE]: "Finance",
  [COSTING_BAND.SUPER_ADMIN_ONLY]: "Super Admins",
};

/** The tiers that receive a money column of a Tender Line (`costing_column_tiers`). */
export const TENDER_PRICE_TIERS = {
  abc_unit: [COSTING_TIER.PRICE, COSTING_TIER.COST, COSTING_TIER.CLOSED_BOOK],
  final_offer_unit: [COSTING_TIER.PRICE, COSTING_TIER.CLOSED_BOOK],
  quotation_price_unit: [COSTING_TIER.PRICE, COSTING_TIER.CLOSED_BOOK],
};

/** Does this tier receive the named Tender Line price column? */
export const tierReads = (tier, column) => (TENDER_PRICE_TIERS[column] ?? []).includes(tier);

/** What a refused column is called on screen: `table.column` -> words. */
export const COSTING_COLUMN_LABEL = {
  "costing_tender_lines.*": "Adding or removing a Tender Line",
  "costing_tender_lines.position": "The order of Tender Lines",
  "costing_tender_lines.tender_specification": "A Tender Line's specification",
  "costing_tender_lines.unit": "A Tender Line's unit",
  "costing_tender_lines.quantity": "A Tender Line's quantity",
  "costing_tender_lines.source": "A Tender Line's source",
  "costing_tender_lines.sor_item_id": "A Tender Line's SOR line",
  "costing_tender_lines.odoo_product_id": "A Tender Line's product",
  "costing_tender_lines.sor_line_snapshot": "A Tender Line's picked SOR line",
  "costing_tender_line_prices.*": "A Tender Line's prices",
  "costing_tender_line_prices.abc_unit": "ABC",
  "costing_tender_line_prices.final_offer_unit": "Final Offer",
  "costing_matrices.sales_incharge_id": "The Sales incharge",
  "costing_matrices.purchasing_incharge_id": "The Purchasing incharge",
};

/** Words for a refused write: "Final Offer is written by Sales (the Deal Team)." */
export function bandRefusalMessage(table, column, bands) {
  const subject = COSTING_COLUMN_LABEL[`${table}.${column}`] ?? "That figure";
  const who = bands.map((b) => COSTING_BAND_LABEL[b] ?? b).join(" or ");
  return `${subject} is written by ${who}.`;
}
