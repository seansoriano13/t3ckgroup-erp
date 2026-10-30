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
  MARKUP: "markup",
};

export const COSTING_BAND_LABEL = {
  [COSTING_BAND.SALES]: "Sales (the Deal Team)",
  [COSTING_BAND.PURCHASING]: "Purchasing",
  [COSTING_BAND.MANAGEMENT]: "the decider list",
  [COSTING_BAND.TECHNICAL]: "Technical",
  [COSTING_BAND.FINANCE]: "Finance",
  [COSTING_BAND.SUPER_ADMIN_ONLY]: "Super Admins",
  [COSTING_BAND.MARKUP]: "the Markup list",
};

/** The tiers that receive a money column of a Tender Line (`costing_column_tiers`). */
export const TENDER_PRICE_TIERS = {
  abc_unit: [COSTING_TIER.PRICE, COSTING_TIER.COST, COSTING_TIER.CLOSED_BOOK],
  final_offer_unit: [COSTING_TIER.PRICE, COSTING_TIER.CLOSED_BOOK],
  quotation_price_unit: [COSTING_TIER.PRICE, COSTING_TIER.CLOSED_BOOK],
};

/** Does this tier receive the named Tender Line price column? */
export const tierReads = (tier, column) => (TENDER_PRICE_TIERS[column] ?? []).includes(tier);

/**
 * The tiers that receive each unit-cost column of a Component (costing_component_costs) and of a
 * cost-only row (costing_cost_rows) (#268, shaped by #319). Final Acquire and the markup factor are
 * Closed Book only; Acquire is the cost side's; the Odoo unit cost is Sales's own column and
 * Purchasing reads it. A tier that is not listed is not sent the key at all.
 */
export const COMPONENT_COST_TIERS = {
  acquire_unit: [COSTING_TIER.COST, COSTING_TIER.CLOSED_BOOK],
  odoo_unit: [COSTING_TIER.PRICE, COSTING_TIER.COST, COSTING_TIER.CLOSED_BOOK],
  final_acquire_unit: [COSTING_TIER.CLOSED_BOOK],
  markup_factor: [COSTING_TIER.CLOSED_BOOK],
  // #269: Markup Price per unit is computed in the database (Acquire x factor) so the price tier gets
  // the peso figure without the Acquire or the factor behind it. Purchasing does not read it.
  markup_price_unit: [COSTING_TIER.PRICE, COSTING_TIER.CLOSED_BOOK],
};

/** Does this tier receive the named unit-cost column of a Component? */
export const tierReadsCost = (tier, column) => (COMPONENT_COST_TIERS[column] ?? []).includes(tier);

/**
 * The same for a cost-only row (costing_cost_rows). One difference: the price tier gets no Markup
 * Price on a cost-only row. A cost-only row with no factor is x1.00, so its Markup Price would be its
 * Acquire to the centavo (Closed Book leak, #266 review).
 */
export const COST_ROW_TIERS = {
  ...COMPONENT_COST_TIERS,
  markup_price_unit: [COSTING_TIER.CLOSED_BOOK],
  // #723: the cost guide category is a label, not money; every tier that reads the row reads it.
  category_key: [COSTING_TIER.PARTICIPANT, COSTING_TIER.PRICE, COSTING_TIER.COST, COSTING_TIER.CLOSED_BOOK],
};

/** Does this tier receive the named unit-cost column of a cost-only row? */
export const tierReadsCostRow = (tier, column) => (COST_ROW_TIERS[column] ?? []).includes(tier);

const { SALES, PURCHASING, MANAGEMENT, TECHNICAL } = COSTING_BAND;

/**
 * Which write bands may change each column (costing_column_bands), so a cell outside the viewer's
 * bands is read-only instead of a field that refuses on blur. The database still decides; this
 * only saves a typed-then-refused round trip. A policy test (79) proves it equals the registry.
 */
export const COMPONENT_BANDS = {
  name: [SALES, PURCHASING],
  quantity: [SALES, PURCHASING],
  unit: [SALES, PURCHASING],
  is_bundle: [SALES, PURCHASING],
  odoo_product_id: [SALES, PURCHASING],
  brand: [SALES, PURCHASING],
  status: [SALES],
  offer_specification: [PURCHASING],
  availability: [PURCHASING],
  source: [PURCHASING],
  po_rfq_no: [PURCHASING],
  sales_incharge_id: [SALES],
  purchasing_incharge_id: [PURCHASING],
  // The Canvass fill (#278): which winning Offer filled Offer Specification, and the Component's documents.
  offer_specification_from_offer_id: [PURCHASING],
  documents: [PURCHASING],
  // The Evaluation of Specification (#271): written by members of the SOR's evaluation task, and by Purchasing access.
  compliance: [TECHNICAL],
  compliance_note: [TECHNICAL],
  recommended_alternative: [TECHNICAL],
};

/**
 * Which winning Offer filled Acquire (#278), on the Component's costs row only: a cost-only row is
 * never canvassed, so this stays out of COMPONENT_COST_TIERS / COMPONENT_COST_BANDS, which a
 * cost-only row inherits. Acquire's own audience reads it; Purchasing writes it.
 */
export const COMPONENT_CANVASS_COST_TIERS = {
  acquire_from_offer_id: [COSTING_TIER.COST, COSTING_TIER.CLOSED_BOOK],
  // Where Acquire came from (#701): canvass, odoo or typed. Same audience as the mark above.
  acquire_source: [COSTING_TIER.COST, COSTING_TIER.CLOSED_BOOK],
  // The P0 line price, the Actual cost (#686), read by the tiers that read Acquire: in pesos, and
  // as Odoo has it with its currency (a foreign P0 is turned into pesos at the Canvass winner's rate).
  p0_unit_price: [COSTING_TIER.COST, COSTING_TIER.CLOSED_BOOK],
  p0_quoted_unit_price: [COSTING_TIER.COST, COSTING_TIER.CLOSED_BOOK],
  p0_currency: [COSTING_TIER.COST, COSTING_TIER.CLOSED_BOOK],
};
export const COMPONENT_CANVASS_COST_BANDS = {
  acquire_from_offer_id: [PURCHASING],
  acquire_source: [PURCHASING],
  p0_unit_price: [PURCHASING],
  p0_quoted_unit_price: [PURCHASING],
  p0_currency: [PURCHASING],
};

export const COMPONENT_COST_BANDS = {
  acquire_unit: [PURCHASING],
  odoo_unit: [SALES],
  final_acquire_unit: [SALES, PURCHASING, MANAGEMENT],
  markup_factor: [COSTING_BAND.MARKUP],
};

/**
 * The matrix's own money row (#269): the default markup factor and the preset it was taken from. The
 * Closed Book reads them and the Final Acquire list writes them (policy 80 holds both to the registry).
 */
export const INCLUSION_BANDS = {
  heading: [SALES, PURCHASING],
  description: [SALES, PURCHASING],
  quantity: [SALES, PURCHASING],
  unit: [SALES, PURCHASING],
  completeness: [TECHNICAL],
};

export const COST_ROW_BANDS = {
  description: [SALES, PURCHASING],
  category_key: [SALES, PURCHASING],
  quantity: [SALES, PURCHASING],
  ...COMPONENT_COST_BANDS,
};

/**
 * The matrix's own money row (costing_matrix_money): the default markup factor (#269), and Marketing and OPEX (#270)
 * typed on the summary. Closed Book reads them; Sales, Purchasing and the Final Acquire list write the factor, and
 * Finance access joins them on Marketing and OPEX (policy tests 80 and 81 prove these equal the registries).
 */
export const MATRIX_MONEY_TIERS = {
  default_factor: [COSTING_TIER.CLOSED_BOOK],
  default_preset_id: [COSTING_TIER.CLOSED_BOOK],
  marketing: [COSTING_TIER.CLOSED_BOOK],
  opex: [COSTING_TIER.CLOSED_BOOK],
};

export const MATRIX_MONEY_BANDS = {
  default_factor: [COSTING_BAND.MARKUP],
  default_preset_id: [COSTING_BAND.MARKUP],
  marketing: [COSTING_BAND.FINANCE, SALES, PURCHASING, MANAGEMENT],
  opex: [COSTING_BAND.FINANCE, SALES, PURCHASING, MANAGEMENT],
};

/**
 * Does this tier receive Landed Cost (#283, #546)? Landed Cost is cost (costing_can_read_cost):
 * Closed Book and cost only. The price tier and a Stage Participant never do.
 */
export const tierReadsLandedCost = (tier) => [COSTING_TIER.CLOSED_BOOK, COSTING_TIER.COST].includes(tier);

/** Why a Component shows no Landed Cost (costing_landed_costs.blank_reason, #283), in words. */
export const LANDED_COST_BLANK_LABEL = {
  not_ordered: "Not ordered yet",
  po_line_not_picked: "P0 line not picked",
  landed_cost_unavailable: "Landed Cost not yet available",
  line_removed: "Pick the P0 line again",
};

/** A Landed Cost's mark: provisional until every IPAS it draws from has Costs complete. */
export const LANDED_COST_MARK_LABEL = { provisional: "Provisional", final: "Final" };

/** Does this tier receive the summary? Only Closed Book does: the figures it works from are Closed Book's. */
export const tierReadsSummary = (tier) => tier === COSTING_TIER.CLOSED_BOOK;

/** A Bid Decision's verdict (`costing_bid_decisions.verdict`, #320). */
export const BID_VERDICT = { GO: "go", NO_GO: "no_go", REVISE: "revise" };

export const BID_VERDICT_LABEL = { go: "Go", no_go: "No-go", revise: "Revise" };

/**
 * The tiers that receive each column of a Bid Decision (costing_column_tiers, #320). Sales (the price
 * tier) reads the verdict and the reason, never the figures it was taken against; those are Closed
 * Book's alone. Purchasing and a Stage Participant read nothing of it. Policy test 85 proves these equal
 * the registry.
 */
const { PRICE, CLOSED_BOOK } = COSTING_TIER;
export const BID_DECISION_TIERS = {
  id: [PRICE, CLOSED_BOOK],
  matrix_id: [PRICE, CLOSED_BOOK],
  verdict: [PRICE, CLOSED_BOOK],
  reason: [PRICE, CLOSED_BOOK],
  decided_by: [PRICE, CLOSED_BOOK],
  decided_at: [PRICE, CLOSED_BOOK],
  cleared_at: [PRICE, CLOSED_BOOK],
  cleared_reason: [PRICE, CLOSED_BOOK],
  final_offer_total: [CLOSED_BOOK],
  abc_total: [CLOSED_BOOK],
  planned_cost_total: [CLOSED_BOOK],
  unlocked_by: [PRICE, CLOSED_BOOK],
};

/** Does this tier receive the named column of a Bid Decision? */
export const tierReadsBid = (tier, column) => (BID_DECISION_TIERS[column] ?? []).includes(tier);

/** Does this tier receive the Bid Decision at all (its verdict and reason)? */
export const tierReadsBidDecision = (tier) => tierReadsBid(tier, "verdict");

/** Where a row's cost came from (`resolveCost` / `lineCost` in utils/costingMath.js, #701). MIXED is a line whose parts disagree. */
export const COST_SOURCE = { TYPED: "typed", CANVASS: "canvass", P0: "p0", ODOO: "odoo", MIXED: "mixed" };

/** Who takes a Bid Decision: the Closed Book tier (a Super Admin or the Final Acquire list). The database decides. */
export const tierDecidesBid = (tier) => tier === COSTING_TIER.CLOSED_BOOK;

/** The signer lists of `costing_signer_lists`: who writes Final Acquire, and who approves an Evaluation of Specification (#271). */
export const COSTING_SIGNER_LIST = { FINAL_ACQUIRE: "final_acquire", EVALUATION: "evaluation", MARKUP: "markup", TEAM_RRD: "team_rrd", TEAM_IOE: "team_ioe" };

/** The Technical teams that judge a row (#706), and the signer list that says who is in each. */
export const EVALUATION_TEAMS = ["RRD", "IOE"];
export const EVALUATION_TEAM_LIST = { RRD: COSTING_SIGNER_LIST.TEAM_RRD, IOE: COSTING_SIGNER_LIST.TEAM_IOE };

export const COSTING_SIGNER_LIST_LABEL = {
  [COSTING_SIGNER_LIST.FINAL_ACQUIRE]: "Decider list",
  [COSTING_SIGNER_LIST.EVALUATION]: "Evaluation of Specification list",
  [COSTING_SIGNER_LIST.MARKUP]: "Markup list",
  [COSTING_SIGNER_LIST.TEAM_RRD]: "RRD team",
  [COSTING_SIGNER_LIST.TEAM_IOE]: "IOE team",
};

/**
 * The summary's rates as the sheet has them (the `costing_settings` row's defaults). The screen
 * reads the live row; these only stand in when it cannot be read, so the summary still adds up.
 */
export const DEFAULT_COSTING_SETTINGS = {
  vatDivisor: 1.12,
  taxRate: 0.06,
  retentionRate: 0.01,
  itrRate: 0.08,
  itrAllowance: 250000,
  finalVatRate: 0.12,
  hiddenLines: ["finalVat"],
};

/** The summary lines Settings can switch on or off (Final Offer and Revenue always show). */
export const SUMMARY_LINES = [
  { key: "vatExclusive", label: "VAT-exclusive" },
  { key: "finalVat", label: "Final VAT" },
  { key: "tax", label: "Less Tax (withholding)" },
  { key: "retention", label: "Retention" },
  { key: "collected", label: "Collected Amount" },
  { key: "operationalExpenses", label: "Operational Expenses" },
  { key: "marketing", label: "Marketing" },
  { key: "opex", label: "OPEX" },
  { key: "itr", label: "ITR" },
];

/** Does Settings leave this summary line on? */
export const summaryLineShown = (rates, key) => !(rates?.hiddenLines ?? DEFAULT_COSTING_SETTINGS.hiddenLines).includes(key);

/** Who adds and removes Components, Inclusions and cost-only rows. */
export const ROW_EDIT_BANDS = [SALES, PURCHASING];

/** Is the viewer (whose bands the read reports) in any band that may write? */
export const inAnyBand = (viewerBands, columnBands) => (columnBands ?? []).some((band) => (viewerBands ?? []).includes(band));

export const COMPONENT_STATUS = { SOURCE_OUT: "source_out", STOCKABLE: "stockable" };
export const COMPONENT_STATUS_LABEL = { source_out: "Source Out", stockable: "Stockable" };
export const COMPONENT_AVAILABILITY_LABEL = { available: "Available", for_order: "For Order" };
export const COMPONENT_SOURCE_LABEL = { local: "Local", import: "Import" };

/** The Compliance verdicts in words, and the badge theme each reads in (#271). */
export const COMPLIANCE_LABEL = { complies: "Complies", deviates: "Deviates" };
export const COMPLIANCE_THEME = { complies: "green", deviates: "amber" };

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
  "costing_components.*": "Adding or removing a Component",
  "costing_components.name": "A Component's name",
  "costing_components.quantity": "A Component's quantity",
  "costing_components.unit": "A Component's unit",
  "costing_components.is_bundle": "Whether a Component is a bundle",
  "costing_components.odoo_product_id": "A Component's product",
  "costing_components.position": "The order of Components",
  "costing_components.tender_line_id": "Which Tender Line a Component is under",
  "costing_components.brand": "Brand",
  "costing_components.status": "Status",
  "costing_components.offer_specification": "Offer Specification",
  "costing_components.availability": "Availability",
  "costing_components.source": "Source",
  "costing_components.po_rfq_no": "P.O./RFQ No.",
  "costing_components.sales_incharge_id": "A Component's Sales incharge",
  "costing_components.purchasing_incharge_id": "A Component's Purchasing incharge",
  "costing_components.offer_specification_from_offer_id": "Where the Offer Specification came from",
  "costing_components.documents": "A Component's documents",
  "costing_component_costs.acquire_from_offer_id": "Where Acquire came from",
  "costing_component_costs.p0_unit_price": "The actual cost from the attached P0",
  "costing_component_costs.p0_quoted_unit_price": "The attached P0's price as Odoo has it",
  "costing_component_costs.p0_currency": "The attached P0's currency",
  "costing_components.compliance": "Compliance",
  "costing_components.compliance_note": "A Compliance note",
  "costing_components.recommended_alternative": "The recommended alternative",
  "costing_component_costs.*": "A Component's costs",
  "costing_component_costs.acquire_unit": "Acquire",
  "costing_component_costs.odoo_unit": "Odoo unit cost",
  "costing_component_costs.final_acquire_unit": "Final cost",
  "costing_component_costs.markup_factor": "The markup factor",
  "costing_inclusions.*": "Adding or removing an Inclusion",
  "costing_inclusions.component_id": "Which bundle an Inclusion sits under",
  "costing_inclusions.heading": "An Inclusion's heading",
  "costing_inclusions.position": "The order of Inclusions",
  "costing_inclusions.description": "An Inclusion's description",
  "costing_inclusions.quantity": "An Inclusion's quantity",
  "costing_inclusions.unit": "An Inclusion's unit",
  "costing_inclusions.completeness": "An Inclusion's Completeness",
  "costing_cost_rows.*": "Adding or removing a cost-only row",
  "costing_cost_rows.position": "The order of cost-only rows",
  "costing_cost_rows.description": "A cost-only row's description",
  "costing_cost_rows.quantity": "A cost-only row's quantity",
  "costing_cost_rows.acquire_unit": "Acquire",
  "costing_cost_rows.odoo_unit": "Odoo unit cost",
  "costing_cost_rows.final_acquire_unit": "Final cost",
  "costing_cost_rows.markup_factor": "The markup factor",
  "costing_matrix_money.marketing": "Marketing",
  "costing_matrix_money.opex": "OPEX",
  "costing_matrix_money.default_factor": "The default markup factor",
  "costing_matrix_money.default_preset_id": "The default markup factor",
};

/** Words for a refused write: "Final Offer is written by Sales (the Deal Team)." */
export function bandRefusalMessage(table, column, bands) {
  const subject = COSTING_COLUMN_LABEL[`${table}.${column}`] ?? "That figure";
  const who = bands.map((b) => COSTING_BAND_LABEL[b] ?? b).join(" or ");
  return `${subject} is written by ${who}.`;
}
