import { supabase } from "../lib/supabase";
import { REFUSAL } from "../constants/refusal";
import { BID_VERDICT, COSTING_SIGNER_LIST, DEFAULT_COSTING_SETTINGS, bandRefusalMessage, tierReadsBidDecision, tierReadsLandedCost, tierReadsSummary } from "../constants/costing";
import { complianceRollup, componentMarkup, componentTotals, costRowsTotals, costRowTotals, lineMarkup, lineTotals, markupPriceSum, landedCostRollup, matrixMarkup, matrixTotals, summary } from "../utils/costingMath";
import { summariseCompleteness } from "../constants/projectEvaluation";
import { sorLineChange } from "../utils/requestedItem";
import { canvassService } from "./canvassService";
import { brandProposal, supplierMismatch } from "../utils/canvassMath";

/**
 * The Costing Matrix (#267, spec #266). The database decides who may read and
 * write what; this service asks it and carries the answer.
 *
 * READS go through `costing_matrix_read`, which serves the caller's own columns
 * (their tier is resolved in the database, never passed in). A column the tier
 * may not read is ABSENT from the row, not null, and this service keeps it that
 * way: a Stage Participant's Tender Line has no `abc_unit` key at all. Every
 * figure computed here comes from `costingMath` over what arrived, so absent
 * input gives an absent figure.
 *
 * WRITES to the non-money tables go straight to the table (row policies and the
 * band trigger judge them); money goes through `costing_set_money`. A write
 * outside the caller's band throws a `CostingBandError` naming the column and
 * the bands that may write it, which the grid shows beside the cell.
 *
 * A matrix exists only once `costing_open_matrix` has run for the SOR (#462);
 * `get` returns null before that, which is a normal state and not an error.
 *
 * Components (#268) hang under a Tender Line and carry their unit costs in
 * `costing_component_costs`, a money table: Acquire is written by Purchasing, the Odoo
 * unit cost by Sales, Final Acquire and the markup factor by the Final Acquire list. A
 * bundle Component lists unpriced Inclusions. Cost-only rows (the Delivery Charge) sit
 * below the Tender Lines in `costing_cost_rows`, also a money table, and stay out of any
 * Tender Line's totals. A rule the database holds (an Inclusion only under a bundle, an
 * incharge on the Deal Team or with Purchasing access) surfaces as a `CostingRuleError`.
 *
 * The summary (#270) is worked here from what the tier received and only for the Closed Book
 * tier: the Final Acquire figures it needs reach no other tier, so every other tier's matrix has
 * no `summary` key at all. The rates it uses are `costing_settings`, a single row any signed-in
 * employee reads and Finance access or a Super Admin edits; the signer lists (who writes Final
 * Acquire) are readable by all and written by Super Admins.
 *
 * Markup (#269) is a factor on a Component's Acquire. The default factor sits on the matrix's money
 * row and a row may override it (`markup_factor`); both belong to the Final Acquire list and are read
 * by the Closed Book alone. Markup Price per unit is computed in the database so the price tier gets the
 * peso figure and never the factor. The named factors the business picks from are the presets
 * (`costing_markup_presets`), read and edited by Super Admins and the Final Acquire list. Achieved markup
 * is worked out here from what the tier received, which only the Closed Book has in full.
 *
 * The Evaluation of Specification (#271) is on the Component row: `setCompliance` writes the
 * verdict, its note and the recommended alternative (the Technical band: Purchasing access, or a
 * member of the SOR's evaluation group task), and `sign` approves the whole evaluation once
 * (the evaluation list, every Component with a verdict). A change to a specification or a
 * verdict clears the approval in the database, with a reason the history keeps.
 *
 * The Bid Decision (#320) is taken through `decideBid` and read through the same matrix read: Sales gets the
 * verdict and the reason (`bidDecision`), Closed Book also the Final Offer total and ABC total it was
 * stamped with, every other tier neither key.
 */

/**
 * A write refused by the band trigger. `table` and `column` are the registry's
 * names (`column` is "*" when adding or removing a row), `bands` the bands that
 * may write it (`["sales"]`), and `message` the same in words.
 */
export class CostingBandError extends Error {
  constructor({ table, column, bands }) {
    super(bandRefusalMessage(table, column, bands));
    this.name = "CostingBandError";
    this.table = table;
    this.column = column;
    this.bands = bands;
  }
}

const BAND_MESSAGE = /^costing_band:([a-z_]+)\.([a-z_*]+):([a-z_,]+)$/;

/** The typed error for a band refusal, or null when `error` is anything else. */
export function toBandError(error) {
  if (error?.code !== "42501") return null;
  const match = BAND_MESSAGE.exec(error.message ?? "");
  if (!match) return null;
  return new CostingBandError({ table: match[1], column: match[2], bands: match[3].split(",") });
}

/** A rule the database holds, in words ("An Inclusion can only sit under a bundle Component."). */
export class CostingRuleError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "CostingRuleError";
    this.code = code;
  }
}

const RULE_MESSAGE = /^costing_(?:inclusion|move_inclusion|incharge|bid): (.+)$/;
// The CHECK on costing_components that wants a note whenever the verdict is Deviates (#271).
const DEVIATION_NOTE_CHECK = /costing_components_deviation_note_chk/;

/**
 * The typed error for a matrix rule refusal (a check violation, or a Bid Decision refused to someone who
 * may not take it), or null when `error` is anything else.
 */
export function toRuleError(error) {
  // A CHECK violation (23514), a rule a matrix function refuses (22023, #556), or a Bid Decision refused to someone who may not take it (42501).
  const ruleRefusal = error?.code === REFUSAL.INVALID && RULE_MESSAGE.test(error?.message ?? "");
  if (error?.code !== "23514" && !ruleRefusal && !(error?.code === REFUSAL.NOT_ALLOWED && /^costing_bid: /.test(error?.message ?? ""))) return null;
  if (DEVIATION_NOTE_CHECK.test(error.message ?? "")) return new CostingRuleError("A deviation needs a note.", error.code);
  const match = RULE_MESSAGE.exec(error.message ?? "");
  if (!match) return null;
  const sentence = match[1].charAt(0).toUpperCase() + match[1].slice(1);
  return new CostingRuleError(sentence.endsWith(".") ? sentence : `${sentence}.`, error.code);
}

/** Throws the typed band or rule error when `error` is one, else the raw Supabase error. */
function fail(error) {
  throw toBandError(error) ?? toRuleError(error) ?? error;
}

const blankToNull = (value) => (value === "" || value === undefined ? null : value);
/** Free text, blank (or only spaces) as nothing. */
const blankText = (value) => (value === null || value === undefined || String(value).trim() === "" ? null : value);
const COMPLIANCE_VERDICTS = ["complies", "deviates"];

/** The Tender Line's own columns a caller may change, from the service's camelCase fields. */
function lineColumns(fields) {
  const columns = {};
  if ("tenderSpecification" in fields) columns.tender_specification = fields.tenderSpecification ?? "";
  if ("unit" in fields) columns.unit = blankToNull(fields.unit);
  if ("quantity" in fields) columns.quantity = fields.quantity;
  return columns;
}

/** The money columns of a Tender Line's price row. */
function priceColumns(fields) {
  const columns = {};
  if ("abcUnit" in fields) columns.abc_unit = blankToNull(fields.abcUnit);
  if ("finalOfferUnit" in fields) columns.final_offer_unit = blankToNull(fields.finalOfferUnit);
  return columns;
}

/** A Component's own columns from the service's camelCase fields. */
function componentColumns(fields) {
  const columns = {};
  if ("name" in fields) columns.name = fields.name ?? "";
  if ("offerSpecification" in fields) columns.offer_specification = blankToNull(fields.offerSpecification);
  if ("brand" in fields) columns.brand = blankToNull(fields.brand);
  if ("status" in fields) columns.status = blankToNull(fields.status);
  if ("availability" in fields) columns.availability = blankToNull(fields.availability);
  if ("source" in fields) columns.source = blankToNull(fields.source);
  if ("poRfqNo" in fields) columns.po_rfq_no = blankToNull(fields.poRfqNo);
  if ("isBundle" in fields) columns.is_bundle = Boolean(fields.isBundle);
  if ("quantity" in fields) columns.quantity = fields.quantity;
  if ("unit" in fields) columns.unit = blankToNull(fields.unit);
  if ("odooProductId" in fields) columns.odoo_product_id = blankToNull(fields.odooProductId);
  if ("salesInchargeId" in fields) columns.sales_incharge_id = blankToNull(fields.salesInchargeId);
  if ("purchasingInchargeId" in fields) columns.purchasing_incharge_id = blankToNull(fields.purchasingInchargeId);
  return columns;
}

/** The unit-cost columns of a Component or a cost-only row (money: written through `costing_set_money`). */
function costColumns(fields) {
  const columns = {};
  if ("acquireUnit" in fields) columns.acquire_unit = blankToNull(fields.acquireUnit);
  if ("odooUnit" in fields) columns.odoo_unit = blankToNull(fields.odooUnit);
  if ("finalAcquireUnit" in fields) columns.final_acquire_unit = blankToNull(fields.finalAcquireUnit);
  if ("markupFactor" in fields) columns.markup_factor = blankToNull(fields.markupFactor);
  return columns;
}

/** An Inclusion's columns from the service's camelCase fields. */
function inclusionColumns(fields) {
  const columns = {};
  if ("heading" in fields) columns.heading = blankToNull(fields.heading);
  if ("description" in fields) columns.description = fields.description ?? "";
  if ("quantity" in fields) columns.quantity = fields.quantity;
  if ("unit" in fields) columns.unit = blankToNull(fields.unit);
  if ("completeness" in fields) columns.completeness = fields.completeness;
  return columns;
}

const groupBy = (rows, key) => {
  const groups = new Map();
  for (const row of rows ?? []) {
    const list = groups.get(row[key]) ?? [];
    list.push(row);
    groups.set(row[key], list);
  }
  return groups;
};

/** An Inclusion list under its headings, in the order each heading first appears. */
function groupInclusions(inclusions) {
  const groups = [];
  for (const inclusion of inclusions) {
    const heading = inclusion.heading ? inclusion.heading : null;
    let group = groups.find((g) => g.heading === heading);
    if (!group) {
      group = { heading, items: [] };
      groups.push(group);
    }
    group.items.push(inclusion);
  }
  return groups;
}

/** The four sign-offs the printed matrix carries, in the order it prints them (#274). */
export const SIGNOFF_ROLES = ["prepared", "costed", "evaluation_approved", "final_approved"];

/**
 * Where a sign-off stands (#271): `approved` is whether a live (uncleared) row exists, `signoff` that
 * row (who signed and when), and `cleared` the newest cleared one while there is no live one, so the
 * screen can say why the approval went (`cleared_reason`).
 */
export function signoffState(signoffs, role) {
  const ofRole = (signoffs ?? []).filter((s) => s.role === role);
  const live = ofRole.find((s) => !s.cleared_at) ?? null;
  const cleared = live
    ? null
    : ofRole.filter((s) => s.cleared_at).sort((a, b) => String(b.cleared_at).localeCompare(String(a.cleared_at)))[0] ?? null;
  return { approved: Boolean(live), signoff: live, cleared };
}

/**
 * The read shaped for the screen: Tender Lines numbered 1, 2, … with the price
 * columns merged in where the tier received them, each with its totals and what
 * its SOR line now says, and the matrix's totals. Each line carries its Components
 * (numbered 1.1, 1.2, with their costs merged in where the tier received them, their
 * totals and, for a bundle, its Inclusions under their headings and the Completeness
 * count); the cost-only rows come beneath, outside every line's totals.
 *
 * Closed Book only: `money` (Marketing and OPEX as typed), `rates` (the settings it used) and `summary`, worked by
 * `costingMath.summary` from the rates in `settings`. Any other tier gets none of the three.
 */
export function shapeMatrix(read, settings = null) {
  if (!read) return null;
  const tables = read.tables ?? {};
  const matrix = (tables.costing_matrices ?? [])[0] ?? null;
  // The matrix's money row exists for the Closed Book only: no key means the viewer was not sent it.
  const money = (tables.costing_matrix_money ?? [])[0] ?? null;
  const defaultFactor = money?.default_factor ?? null;
  const prices = new Map((tables.costing_tender_line_prices ?? []).map((p) => [p.tender_line_id, p]));

  const costsByComponent = new Map((tables.costing_component_costs ?? []).map((c) => [c.component_id, c]));
  const inclusionsByComponent = groupBy(tables.costing_inclusions, "component_id");
  const componentsByLine = groupBy(tables.costing_components, "tender_line_id");

  const signoffs = tables.costing_signoffs ?? [];

  const tenderLines = (tables.costing_tender_lines ?? []).map((line, index) => {
    const { tender_line_id: _link, ...price } = prices.get(line.id) ?? {};
    const merged = { ...line, ...price };
    const number = index + 1;
    // A Component's cost columns arrive in their own rows, and only the ones the tier may read.
    const components = (componentsByLine.get(line.id) ?? []).map((component, position) => {
      const { component_id: _owner, ...cost } = costsByComponent.get(component.id) ?? {};
      const row = { ...component, ...cost };
      const markup = componentMarkup(row, defaultFactor);
      const inclusions = inclusionsByComponent.get(component.id) ?? [];
      return {
        ...row,
        number: `${number}.${position + 1}`,
        totals: componentTotals(row),
        markup,
        inclusions,
        inclusionGroups: groupInclusions(inclusions),
        completeness: summariseCompleteness(inclusions),
      };
    });
    return {
      ...merged,
      number,
      components,
      totals: lineTotals(merged, components),
      markup: lineMarkup(merged, components, defaultFactor),
      compliance: complianceRollup(components),
      sorChange: sorLineChange({ ...line, sorLine: line.sor_line_now }),
    };
  });

  // A cost-only row with no factor of its own is x1.00, not the matrix default.
  const costRows = (tables.costing_cost_rows ?? []).map((row, index) => ({
    ...row,
    number: index + 1,
    totals: costRowTotals(row),
    markup: componentMarkup(row, defaultFactor, { costOnly: true }),
  }));

  const shaped = {
    tier: read.tier,
    bands: read.bands ?? [],
    matrixId: read.matrix_id,
    matrix,
    tenderLines,
    totals: matrixTotals(tenderLines),
    defaultFactor: money ? (defaultFactor === null ? null : Number(defaultFactor)) : undefined,
    defaultPresetId: money ? (money.default_preset_id ?? null) : undefined,
    markup: matrixMarkup(tenderLines, costRows, defaultFactor),
    compliance: complianceRollup(tenderLines.flatMap((line) => line.components)),
    evaluation: signoffState(signoffs, "evaluation_approved"),
    // All four sign-offs (#274), each as signoffState; the print reads them and the screen's sign buttons.
    signoffs: Object.fromEntries(SIGNOFF_ROLES.map((role) => [role, signoffState(signoffs, role)])),
    costRows,
    costRowsTotals: costRowsTotals(costRows),
    costRowsMarkupTotal: markupPriceSum(costRows),
  };

  // The Bid Decision (#320): the tiers that read it get `bidDecision` (the live one, or null) and the
  // earlier cleared ones; any other tier gets neither key. The stamped figures are in it only for Closed Book.
  if (tierReadsBidDecision(read.tier)) {
    const decisions = (tables.costing_bid_decisions ?? []).map(shapeBidDecision);
    shaped.bidDecision = decisions.find((d) => d.clearedAt === null) ?? null;
    shaped.bidDecisionHistory = decisions.filter((d) => d.clearedAt !== null).reverse();
  }

  if (tierReadsSummary(read.tier)) {
    shaped.money = money;
    shaped.rates = settings ?? DEFAULT_COSTING_SETTINGS;
    shaped.summary = summary({ tenderLines, costRows, money }, shaped.rates);
  }
  return shaped;
}

/**
 * A Bid Decision row as the screen uses it: verdict, reason, decider, date and, when it was cleared, when
 * and why. `finalOfferTotal` and `abcTotal` (the figures it was taken against) are set only when the row
 * carried them, which only the Closed Book tier's does: for everyone else the keys are absent.
 */
export function shapeBidDecision(row) {
  const decision = {
    id: row.id,
    verdict: row.verdict,
    reason: row.reason,
    decidedBy: row.decided_by ?? null,
    decidedAt: row.decided_at,
    clearedAt: row.cleared_at ?? null,
    clearedReason: row.cleared_reason ?? null,
  };
  if ("final_offer_total" in row) decision.finalOfferTotal = Number(row.final_offer_total);
  if ("abc_total" in row) decision.abcTotal = row.abc_total === null ? null : Number(row.abc_total);
  return decision;
}

/**
 * Adds the Canvass to each Component (#278): `canvass` ({ number, signed, winner }) or null, the
 * brand the winner proposes (`brandProposal`, null when none or already the Component's), and
 * `fromCanvass` ({ acquire, offerSpecification }) for the fields still marked as filled from a
 * Canvass. Names and brands only, no price, so every tier that reads the matrix gets it.
 */
async function withCanvass(shaped, opportunityId) {
  if (!shaped) return shaped;
  const components = shaped.tenderLines.flatMap((line) => line.components);
  const canvasses = await canvassService.listForComponents(components.map((c) => c.id));
  const byComponent = new Map(canvasses.map((c) => [c.component_id, c]));
  for (const component of components) {
    const canvass = byComponent.get(component.id) ?? null;
    component.canvass = canvass
      ? { id: canvass.id, number: canvass.number, signed: Boolean(canvass.signed_off_at), winner: canvass.winner }
      : null;
    component.brandProposal = brandProposal(component, canvass?.winner);
    component.fromCanvass = {
      acquire: Boolean(component.acquire_from_offer_id),
      offerSpecification: Boolean(component.offer_specification_from_offer_id),
    };
  }
  await attachSupplierMismatch(components, opportunityId);
  return shaped;
}

/**
 * Sets `supplierMismatch` on each Component (#281): `{ po, poSupplier, winner }` when its PO, read from
 * the IPAS's stored Odoo copy, is with a supplier other than the winning Offer's, else null. It only
 * reports; nothing is blocked. Names, no money, so every tier gets it.
 */
async function attachSupplierMismatch(components, opportunityId) {
  for (const component of components) component.supplierMismatch = null;
  const withWinner = components.filter((c) => c.canvass?.winner && c.po_rfq_no);
  if (withWinner.length === 0 || !opportunityId) return;

  const { data: pos, error } = await supabase.rpc("canvass_po_suppliers", { p_opportunity_id: opportunityId });
  if (error) throw error;
  const poByComponent = new Map((pos ?? []).map((row) => [row.component_id, row]));
  const withPo = withWinner.filter((c) => poByComponent.has(c.id));
  if (withPo.length === 0) return;

  // The winner's Odoo id is not on the Canvass chip; the Offer row has it (not money).
  const { data: offers, error: offersError } = await supabase
    .from("sor_canvass_offers")
    .select("id, odoo_supplier_id")
    .in("id", withPo.map((c) => c.canvass.winner.id));
  if (offersError) throw offersError;
  const odooIds = new Map((offers ?? []).map((o) => [o.id, o.odoo_supplier_id ?? null]));

  for (const component of withPo) {
    const po = poByComponent.get(component.id);
    const winner = component.canvass.winner;
    const mismatch = supplierMismatch(
      { supplierName: winner.supplierName, odooSupplierId: odooIds.get(winner.id) },
      { id: po.supplier_id, name: po.supplier_name },
    );
    component.supplierMismatch = mismatch ? { po: po.po_number, ...mismatch } : null;
  }
}

/**
 * Adds what each Component's purchase came to (#283).
 *
 * Every tier: `purchases` = `{ poNumbers, ipas, requests, orderedQuantity, orderedShort }`; `requests` are
 * `{ itemId, requestId, name, poNumber, status, pickedLineIds }`. `poNumbers`
 * are its Requested Items' PO numbers and the typed P.O./RFQ No., de-duplicated; `ipas` is, per PO
 * number, `{ poNumber, ipasId, number, state }` (null fields where no IPAS exists); `orderedShort` is
 * `{ ordered, of }` when the Ordered and Received items don't add up to the Component's quantity
 * ("ordered 3 of 5"), else null. No money.
 *
 * The money tier only: `landed_cost` = `{ total, unit, mark, blankReason }` on each Component, and
 * `totals.landedCost` on each Tender Line and on the matrix (costingMath.landedCostRollup). For any
 * other tier the `landed_cost` key is absent. Landed Cost feeds nothing else: markup, the summary,
 * Revenue and "Costing settled" were worked out before it arrives and never read it.
 */
async function withPurchases(shaped, opportunityId) {
  if (!shaped || !opportunityId) return shaped;
  const components = shaped.tenderLines.flatMap((line) => line.components);
  const money = tierReadsLandedCost(shaped.tier);
  const [purchases, landed] = await Promise.all([
    supabase.rpc("costing_component_purchases", { p_opportunity_id: opportunityId }),
    money ? supabase.rpc("costing_landed_costs", { p_opportunity_id: opportunityId }) : Promise.resolve({ data: null }),
  ]);
  if (purchases.error) throw purchases.error;
  if (landed.error) throw landed.error;

  const purchasesBy = new Map((purchases.data ?? []).map((row) => [row.component_id, row]));
  const landedBy = new Map((landed.data ?? []).map((row) => [row.component_id, row]));
  for (const component of components) {
    component.purchases = shapePurchases(purchasesBy.get(component.id), component);
    if (money) component.landed_cost = shapeLandedCost(landedBy.get(component.id));
  }
  // A tier that reads no Landed Cost gets no key for it, not a null.
  for (const line of shaped.tenderLines) {
    const { landedCost: _none, ...totals } = line.totals;
    line.totals = money ? { ...totals, landedCost: landedCostRollup(line.components) } : totals;
  }
  const { landedCost: _none, ...totals } = shaped.totals;
  shaped.totals = money ? { ...totals, landedCost: matrixTotals(shaped.tenderLines).landedCost } : totals;
  return shaped;
}

const numberOrNull = (value) => (value === null || value === undefined || value === "" ? null : Number(value));

function shapePurchases(row, component) {
  const requests = (row?.requests ?? []).map((r) => ({
    itemId: r.item_id,
    requestId: r.request_id ?? null,
    name: r.name ?? "",
    poNumber: r.po_number ?? null,
    status: r.status,
    pickedLineIds: r.odoo_po_line_ids ?? [],
  }));
  const ipas = (row?.ipas ?? []).map((i) => ({ poNumber: i.po_number, ipasId: i.ipas_id ?? null, number: i.number ?? null, state: i.state ?? null }));
  const ordered = numberOrNull(row?.ordered_quantity) ?? 0;
  const of = numberOrNull(component.quantity);
  return {
    poNumbers: ipas.map((i) => i.poNumber),
    ipas,
    requests,
    orderedQuantity: ordered,
    orderedShort: ordered > 0 && of !== null && ordered !== of ? { ordered, of } : null,
  };
}

function shapeLandedCost(row) {
  if (!row) return { total: null, unit: null, mark: null, blankReason: "not_ordered" };
  return {
    total: numberOrNull(row.total_php),
    unit: numberOrNull(row.unit_php),
    mark: row.mark ?? null,
    blankReason: row.blank_reason ?? null,
  };
}

/** Requested Items grouped by the Component they name: a Map of component id -> items, oldest first. */
export function requestsByComponent(requests) {
  return groupBy(requests, "component_id");
}

/** The rates row as the screen uses it: camelCase numbers (PostgREST may send numeric columns as text). */
function shapeSettings(row) {
  if (!row) return null;
  return {
    vatDivisor: Number(row.vat_divisor),
    taxRate: Number(row.tax_rate),
    retentionRate: Number(row.retention_rate),
    itrRate: Number(row.itr_rate),
    itrAllowance: Number(row.itr_allowance),
    updatedAt: row.updated_at ?? null,
    updatedBy: row.updated_by ?? null,
  };
}

const SIGNER_LISTS = Object.values(COSTING_SIGNER_LIST);

export const costingMatrixService = {
  /** The caller's read tier on the SOR (`closed_book`, `cost`, `price`, `participant`), or null. */
  async tier(opportunityId) {
    if (!opportunityId) return null;
    const { data, error } = await supabase.rpc("costing_tier", { p_opportunity_id: opportunityId });
    if (error) throw error;
    return data ?? null;
  },

  /**
   * The SOR's Costing Matrix as the caller's tier may read it, or null when the
   * caller has no tier or the SOR has no matrix yet. See `shapeMatrix`.
   */
  async get(opportunityId) {
    if (!opportunityId) return null;
    const { data, error } = await supabase.rpc("costing_matrix_read", { p_opportunity_id: opportunityId });
    if (error) throw error;
    // The rates are only needed for the summary, which only the Closed Book tier is given.
    const settings = data && tierReadsSummary(data.tier) ? await costingMatrixService.getSettings() : null;
    return withPurchases(await withCanvass(shapeMatrix(data, settings), opportunityId), opportunityId);
  },

  /**
   * The summary's rates: `{ vatDivisor, taxRate, retentionRate, itrRate, itrAllowance, updatedAt,
   * updatedBy }`, or null when the row cannot be read. Any signed-in employee may read them.
   */
  async getSettings() {
    const { data, error } = await supabase.from("costing_settings").select("*").eq("id", 1).maybeSingle();
    if (error) throw error;
    return shapeSettings(data);
  },

  /**
   * Changes the rates: any of `vatDivisor`, `taxRate`, `retentionRate`, `itrRate`, `itrAllowance`.
   * Finance access or a Super Admin; the database refuses anyone else, and so does this method (it
   * reports it in words rather than leaving a save that silently did nothing). Returns the new rates.
   */
  async setSettings(fields) {
    const columns = {};
    if ("vatDivisor" in fields) columns.vat_divisor = fields.vatDivisor;
    if ("taxRate" in fields) columns.tax_rate = fields.taxRate;
    if ("retentionRate" in fields) columns.retention_rate = fields.retentionRate;
    if ("itrRate" in fields) columns.itr_rate = fields.itrRate;
    if ("itrAllowance" in fields) columns.itr_allowance = fields.itrAllowance;
    if (Object.keys(columns).length === 0) return costingMatrixService.getSettings();
    const { data, error } = await supabase.from("costing_settings").update(columns).eq("id", 1).select("*");
    if (error) throw error;
    if (!data?.length) throw new CostingRuleError("Only Finance access or a Super Admin can change the rates.", "42501");
    return shapeSettings(data[0]);
  },

  /**
   * The signer lists as `{ final_acquire: [{ id, employeeId }], evaluation: [...] }`, oldest first.
   * Anyone signed in reads who is on a list; only Super Admins change one.
   */
  async getSignerLists() {
    const { data, error } = await supabase
      .from("costing_signer_lists")
      .select("id, list_key, employee_id, created_at")
      .order("created_at", { ascending: true });
    if (error) throw error;
    const lists = Object.fromEntries(SIGNER_LISTS.map((key) => [key, []]));
    for (const row of data ?? []) {
      if (lists[row.list_key]) lists[row.list_key].push({ id: row.id, employeeId: row.employee_id });
    }
    return lists;
  },

  /**
   * Makes one signer list exactly the given employees: adds who is new, removes who is gone.
   * Super Admins only (the database refuses everyone else, and a refused removal is reported).
   * Returns the list as `getSignerLists` gives it.
   */
  async setSignerList(listKey, employeeIds = []) {
    if (!SIGNER_LISTS.includes(listKey)) throw new CostingRuleError("That is not a signer list.", "22023");
    const wanted = [...new Set((employeeIds ?? []).filter(Boolean))];
    const current = (await costingMatrixService.getSignerLists())[listKey];

    const toAdd = wanted.filter((id) => !current.some((m) => m.employeeId === id));
    if (toAdd.length > 0) {
      const { error } = await supabase.from("costing_signer_lists").insert(toAdd.map((employee_id) => ({ list_key: listKey, employee_id })));
      if (error) throw error;
    }
    const toRemove = current.filter((m) => !wanted.includes(m.employeeId));
    if (toRemove.length > 0) {
      const { data, error } = await supabase
        .from("costing_signer_lists")
        .delete()
        .in("id", toRemove.map((m) => m.id))
        .select("id");
      if (error) throw error;
      if ((data?.length ?? 0) !== toRemove.length) throw new CostingRuleError("Only a Super Admin can change a signer list.", "42501");
    }
    return (await costingMatrixService.getSignerLists())[listKey];
  },

  /**
   * Types Marketing and OPEX on the summary: `{ marketing, opex }` (null clears). Finance access or
   * the Final Acquire list. Written through `costing_set_money`: the caller usually cannot select
   * the money row.
   */
  async updateMatrixMoney(matrixId, fields) {
    const patch = {};
    if ("marketing" in fields) patch.marketing = blankToNull(fields.marketing);
    if ("opex" in fields) patch.opex = blankToNull(fields.opex);
    await writeMoney("costing_matrix_money", matrixId, patch);
  },

  /**
   * The Requested Items that name a Component of the SOR's matrix (#273), as `{ id, component_id,
   * status, request_id }` and nothing more, for every tier that can read the matrix. Empty when the
   * caller has no tier or the SOR has no matrix. Group them with `requestsByComponent`.
   */
  async componentRequests(opportunityId) {
    if (!opportunityId) return [];
    const { data, error } = await supabase.rpc("costing_component_requests", { p_opportunity_id: opportunityId });
    if (error) throw error;
    return data ?? [];
  },

  /**
   * Adds a Tender Line at the end, typed: `{ tenderSpecification, unit, quantity,
   * abcUnit, finalOfferUnit }`. Returns the new line's id. Sales band.
   */
  async addTenderLine(matrixId, fields = {}, actorId = null) {
    const id = await insertLine(matrixId, {
      source: "typed",
      tender_specification: fields.tenderSpecification ?? "",
      unit: blankToNull(fields.unit),
      quantity: fields.quantity ?? 1,
      created_by: actorId,
    });
    await writePrices(id, fields);
    return id;
  },

  /**
   * Adds a Tender Line picked from an SOR line `{ id, product_name, quantity,
   * unit, odoo_product_id }`. It keeps its own copy (name, quantity, unit) so a
   * later save of the SOR cannot rewrite what is being costed; `get` reports what
   * the SOR line says now. Returns the new line's id.
   */
  async addTenderLineFromSorLine(matrixId, sorLine, fields = {}, actorId = null) {
    const quantity = Number(sorLine.quantity);
    const id = await insertLine(matrixId, {
      source: "sor_line",
      sor_item_id: sorLine.id ?? null,
      odoo_product_id: sorLine.odoo_product_id ?? null,
      tender_specification: sorLine.product_name ?? "",
      unit: blankToNull(sorLine.unit),
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      sor_line_snapshot: { name: sorLine.product_name, quantity: Number.isFinite(quantity) ? quantity : null, unit: blankToNull(sorLine.unit) },
      created_by: actorId,
    });
    await writePrices(id, fields);
    return id;
  },

  /**
   * Changes a Tender Line: any of `tenderSpecification`, `unit`, `quantity`
   * (the line itself) and `abcUnit`, `finalOfferUnit` (its prices; null clears).
   */
  async updateTenderLine(lineId, fields) {
    const columns = lineColumns(fields);
    if (Object.keys(columns).length > 0) {
      const { data, error } = await supabase.from("costing_tender_lines").update(columns).eq("id", lineId).select("id");
      if (error) fail(error);
      if (!data?.length) throw new Error("That Tender Line could not be changed.");
    }
    await writePrices(lineId, fields);
  },

  /** Removes a Tender Line and the prices it carries. Sales band. */
  async removeTenderLine(lineId) {
    const { data, error } = await supabase.from("costing_tender_lines").delete().eq("id", lineId).select("id");
    if (error) fail(error);
    if (!data?.length) throw new Error("That Tender Line could not be removed.");
  },

  /** Puts the Tender Lines in the given order; `orderedIds` must name every line. */
  async reorder(matrixId, orderedIds) {
    const { error } = await supabase.rpc("costing_reorder_tender_lines", { p_matrix_id: matrixId, p_ids: orderedIds });
    if (error) fail(error);
  },

  /**
   * Adds a Component at the end of a Tender Line. Fields: `name`, `offerSpecification`, `brand`,
   * `status` (`source_out` | `stockable`), `availability` (`available` | `for_order`), `source`
   * (`local` | `import`), `poRfqNo`, `isBundle`, `quantity`, `unit`, `odooProductId`, and the costs
   * `acquireUnit`, `odooUnit`, `finalAcquireUnit`, `markupFactor`. Sales or Purchasing adds; each
   * column is then held to its own band. Returns the new Component's id.
   */
  async addComponent(tenderLineId, fields = {}) {
    const { data: last, error: lastError } = await supabase
      .from("costing_components")
      .select("position")
      .eq("tender_line_id", tenderLineId)
      .order("position", { ascending: false })
      .limit(1);
    if (lastError) throw lastError;
    const position = (last?.[0]?.position ?? 0) + 1;

    const { data, error } = await supabase
      .from("costing_components")
      .insert({ tender_line_id: tenderLineId, position, name: "", quantity: 1, ...componentColumns(fields) })
      .select("id")
      .single();
    if (error) fail(error);
    await writeMoney("costing_component_costs", data.id, costColumns(fields));
    return data.id;
  },

  /** Changes a Component: any field `addComponent` takes. A cost field set to null clears it. */
  async updateComponent(componentId, fields) {
    const columns = componentColumns(fields);
    if (Object.keys(columns).length > 0) {
      const { data, error } = await supabase.from("costing_components").update(columns).eq("id", componentId).select("id");
      if (error) fail(error);
      if (!data?.length) throw new Error("That Component could not be changed.");
    }
    await writeMoney("costing_component_costs", componentId, costColumns(fields));
  },

  /** Removes a Component with its costs and, for a bundle, its Inclusions. The change stays in the history. */
  async removeComponent(componentId) {
    const { data, error } = await supabase.from("costing_components").delete().eq("id", componentId).select("id");
    if (error) fail(error);
    if (!data?.length) throw new Error("That Component could not be removed.");
  },

  /**
   * Adds an Inclusion under a bundle Component, at the end of its list: `{ heading, description,
   * quantity, unit }`. The database refuses a Component that is not a bundle. Returns the id.
   */
  async addInclusion(componentId, fields = {}) {
    const { data: last, error: lastError } = await supabase
      .from("costing_inclusions")
      .select("position")
      .eq("component_id", componentId)
      .order("position", { ascending: false })
      .limit(1);
    if (lastError) throw lastError;
    const position = (last?.[0]?.position ?? 0) + 1;

    const { data, error } = await supabase
      .from("costing_inclusions")
      .insert({ component_id: componentId, position, description: "", quantity: 1, ...inclusionColumns(fields) })
      .select("id")
      .single();
    if (error) fail(error);
    return data.id;
  },

  /** Changes an Inclusion: `heading`, `description`, `quantity`, `unit`, and `completeness` (Technical's). */
  async updateInclusion(inclusionId, fields) {
    const columns = inclusionColumns(fields);
    if (Object.keys(columns).length === 0) return;
    const { data, error } = await supabase.from("costing_inclusions").update(columns).eq("id", inclusionId).select("id");
    if (error) fail(error);
    if (!data?.length) throw new Error("That Inclusion could not be changed.");
  },

  /** Removes an Inclusion. Sales or Purchasing. */
  async removeInclusion(inclusionId) {
    const { data, error } = await supabase.from("costing_inclusions").delete().eq("id", inclusionId).select("id");
    if (error) fail(error);
    if (!data?.length) throw new Error("That Inclusion could not be removed.");
  },

  /**
   * Moves an Inclusion under another bundle Component of the same matrix, at the end of its list
   * (how an "Unplaced inclusions" row finds its bundle). A target that is not a bundle is refused.
   */
  async moveInclusion(inclusionId, componentId) {
    const { error } = await supabase.rpc("costing_move_inclusion", { p_inclusion_id: inclusionId, p_component_id: componentId });
    if (error) fail(error);
  },

  /**
   * Adds a cost-only row below the Tender Lines: `{ description, quantity }` and, optionally, its
   * costs (`acquireUnit`, `odooUnit`, ...). It starts at a x1.00 markup factor. Returns the new id.
   */
  async addCostRow(matrixId, fields = {}) {
    const { data, error } = await supabase.rpc("costing_add_cost_row", {
      p_matrix_id: matrixId,
      p_description: fields.description ?? "",
      p_quantity: fields.quantity ?? 1,
    });
    if (error) fail(error);
    await writeMoney("costing_cost_rows", data, costColumns(fields));
    return data;
  },

  /** Changes a cost-only row: `description`, `quantity` and the costs. All through `costing_set_money` (it is a money table). */
  async updateCostRow(rowId, fields) {
    const patch = { ...costColumns(fields) };
    if ("description" in fields) patch.description = fields.description ?? "";
    if ("quantity" in fields) patch.quantity = fields.quantity;
    await writeMoney("costing_cost_rows", rowId, patch);
  },

  /** Removes a cost-only row. Sales or Purchasing. */
  async removeCostRow(rowId) {
    const { error } = await supabase.rpc("costing_remove_cost_row", { p_row_id: rowId });
    if (error) fail(error);
  },

  /**
   * Names who answers for the matrix, or for one Component when `target` is `{ componentId }`:
   * `{ sales, purchasing }` (an employee id, or null for the default). The Sales incharge must be
   * on the Deal Team (written by Sales) and the Purchasing incharge must have Purchasing access
   * (written by Purchasing). It grants nothing and notifies nobody.
   */
  async setIncharge(target, { sales, purchasing } = {}) {
    const columns = {};
    if (sales !== undefined) columns.sales_incharge_id = blankToNull(sales);
    if (purchasing !== undefined) columns.purchasing_incharge_id = blankToNull(purchasing);
    if (Object.keys(columns).length === 0) return;
    const table = target?.componentId ? "costing_components" : "costing_matrices";
    const id = target?.componentId ?? target?.matrixId;
    const { data, error } = await supabase.from(table).update(columns).eq("id", id).select("id");
    if (error) fail(error);
    if (!data?.length) throw new Error("The incharge could not be changed.");
  },

  /**
   * Sets the matrix's default markup factor: `{ factor }` typed (a number above zero; null clears it) or
   * `{ presetId }` picked from a preset, which copies the preset's factor so a later edit of the preset
   * does not move this matrix. Written by the Final Acquire list. A row that has its own factor keeps it.
   */
  async setDefaultMarkup(matrixId, { factor, presetId } = {}) {
    let patch;
    if (presetId) {
      const { data, error } = await supabase.from("costing_markup_presets").select("id, factor, active").eq("id", presetId).maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("That markup preset could not be found.");
      if (!data.active) throw new Error("That markup preset is switched off.");
      patch = { default_factor: Number(data.factor), default_preset_id: data.id };
    } else if (factor === null) {
      patch = { default_factor: null, default_preset_id: null };
    } else {
      const n = Number(factor);
      if (factor === undefined || factor === "" || !Number.isFinite(n) || n <= 0) throw new Error("The markup factor must be a number above zero.");
      patch = { default_factor: n, default_preset_id: null };
    }
    await writeMoney("costing_matrix_money", matrixId, patch);
  },

  /** Does the caller edit the markup presets and the factor? Super Admins and the Final Acquire list. */
  async canManageMarkup() {
    const { data, error } = await supabase.rpc("costing_can_manage_markup");
    if (error) throw error;
    return Boolean(data);
  },

  /**
   * The markup presets in their order: `{ id, label, factor, sort, active }`. A preset that is switched off
   * stays on the list (`includeInactive`) so it can be switched on again. The database serves them to Super
   * Admins and the Final Acquire list only; anyone else gets an empty list.
   */
  async listPresets({ includeInactive = true } = {}) {
    let query = supabase.from("costing_markup_presets").select("*").order("sort", { ascending: true }).order("label", { ascending: true });
    if (!includeInactive) query = query.eq("active", true);
    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  },

  /**
   * Adds a preset (no `id`) or changes one: `{ id, label, factor, sort, active }`. A preset is switched off with
   * `active: false`, never deleted. Returns the saved row.
   */
  async savePreset({ id = null, label, factor, sort, active } = {}) {
    const columns = {};
    if (label !== undefined) {
      const trimmed = String(label ?? "").trim();
      if (!trimmed) throw new Error("A markup preset needs a name.");
      columns.label = trimmed;
    } else if (!id) {
      throw new Error("A markup preset needs a name.");
    }
    if (factor !== undefined) {
      const n = Number(factor);
      if (factor === null || factor === "" || !Number.isFinite(n) || n <= 0) throw new Error("The markup factor must be a number above zero.");
      columns.factor = n;
    } else if (!id) {
      throw new Error("A markup preset needs a factor.");
    }
    if (sort !== undefined) columns.sort = sort;
    if (active !== undefined) columns.active = Boolean(active);

    if (id) {
      const { data, error } = await supabase.from("costing_markup_presets").update(columns).eq("id", id).select("*");
      if (error) throw presetError(error);
      if (!data?.length) throw new Error("That markup preset could not be changed.");
      return data[0];
    }
    if (columns.sort === undefined) {
      const { data: last, error: lastError } = await supabase.from("costing_markup_presets").select("sort").order("sort", { ascending: false }).limit(1);
      if (lastError) throw lastError;
      columns.sort = (last?.[0]?.sort ?? 0) + 1;
    }
    const { data, error } = await supabase.from("costing_markup_presets").insert(columns).select("*").single();
    if (error) throw presetError(error);
    return data;
  },

  /**
   * Records Technical's verdict on a Component (#271): `{ verdict, note, alternative }`. `verdict` is
   * `"complies"`, `"deviates"` or null (not evaluated); a field left out is left as it is, and
   * `note` or `alternative` set to null or "" clears it. A deviation needs a note: the database
   * refuses one without it (a `CostingRuleError`), and so does this when the note is passed blank.
   * Written by the Technical band (Purchasing access, or a member of the SOR's evaluation group
   * task); anyone else gets a `CostingBandError`. It never touches a figure: a gap is recorded and
   * blocks nothing. Changing the verdict or the note clears "Evaluation approved".
   */
  async setCompliance(componentId, { verdict, note, alternative } = {}) {
    const columns = {};
    if (verdict !== undefined) {
      if (verdict !== null && !COMPLIANCE_VERDICTS.includes(verdict)) {
        throw new CostingRuleError("A verdict is Complies, Deviates or not evaluated.", "23514");
      }
      columns.compliance = verdict;
    }
    if (note !== undefined) columns.compliance_note = blankText(note);
    if (alternative !== undefined) columns.recommended_alternative = blankText(alternative);
    if (columns.compliance === "deviates" && "compliance_note" in columns && columns.compliance_note === null) {
      throw new CostingRuleError("A deviation needs a note.", "23514");
    }
    if (Object.keys(columns).length === 0) return;
    const { data, error } = await supabase.from("costing_components").update(columns).eq("id", componentId).select("id");
    if (error) fail(error);
    if (!data?.length) throw new Error("That Component could not be changed.");
  },

  /**
   * Signs the matrix off for a role (ADR 0013: the database checks and writes together):
   * `"prepared"` (the Sales incharge), `"costed"` (the Purchasing incharge), `"evaluation_approved"`
   * (the evaluation list, every Component with a verdict, #271) or `"final_approved"` (the Final Acquire
   * list), #274. Otherwise the database refuses and the message says why. `declineSignature` signs
   * without applying the stored signature, so the print shows the name only. Returns the new sign-off row.
   */
  async sign(matrixId, role = "evaluation_approved", { declineSignature = false } = {}) {
    const { data, error } = await supabase.rpc("costing_sign", { p_matrix_id: matrixId, p_role: role, p_decline_signature: Boolean(declineSignature) });
    if (error) fail(error);
    return data?.signoff ?? null;
  },

  /**
   * The matrix's history for the caller's tier, newest first: `{ id, at,
   * actor_id, kind, detail }`. Filters: `{ table, rowId, limit }`.
   */
  async history(opportunityId, { table = null, rowId = null, limit = 100 } = {}) {
    const { data, error } = await supabase.rpc("costing_history", {
      p_opportunity_id: opportunityId,
      p_table: table,
      p_row: rowId,
      p_limit: limit,
    });
    if (error) throw error;
    return data ?? [];
  },

  /**
   * Takes the Bid Decision on a matrix (#320): `verdict` is "go", "no_go" or "revise" and `reason` is
   * written in the decider's own words. Only a Super Admin or a member of the Final Acquire list can
   * (the database decides; there is no self-approval rule), and every Tender Line needs a Final Offer
   * first. The database stamps the Final Offer total and ABC total, replaces a live decision, tells the
   * Deal Team on No-go and Revise, and moves nothing on the SOR. Returns the new decision's id.
   */
  async decideBid(matrixId, { verdict, reason } = {}) {
    if (!Object.values(BID_VERDICT).includes(verdict)) {
      throw new CostingRuleError("The verdict must be Go, No-go or Revise.", "23514");
    }
    const { data, error } = await supabase.rpc("costing_decide_bid", {
      p_matrix_id: matrixId,
      p_verdict: verdict,
      p_reason: reason ?? "",
    });
    if (error) fail(error);
    return data;
  },

  /**
   * The matrices waiting for a Bid Decision, oldest first (the Approval Center queue, #320): every
   * Tender Line has a Final Offer and no decision is live. Only a Super Admin or the Final Acquire list
   * is given any; anyone else gets an empty list.
   */
  async pendingBidDecisions() {
    const { data, error } = await supabase.rpc("costing_pending_bid_decisions");
    if (error) throw error;
    return (data ?? []).map((row) => ({
      matrixId: row.matrix_id,
      opportunityId: row.opportunity_id,
      projectTitle: row.project_title,
      clientName: row.client_name ?? null,
      dealOwnerId: row.deal_owner_id ?? null,
      dealOwnerName: row.deal_owner_name ?? null,
      finalOfferTotal: Number(row.final_offer_total),
      abcTotal: row.abc_total === null || row.abc_total === undefined ? null : Number(row.abc_total),
      waitingSince: row.waiting_since,
    }));
  },
};

/** A duplicate preset name in words; anything else as it came. */
function presetError(error) {
  return error?.code === REFUSAL.DUPLICATE ? new Error("There is already a markup preset with that name.") : error;
}

async function insertLine(matrixId, columns) {
  const { data: last, error: lastError } = await supabase
    .from("costing_tender_lines")
    .select("position")
    .eq("matrix_id", matrixId)
    .order("position", { ascending: false })
    .limit(1);
  if (lastError) throw lastError;
  const position = (last?.[0]?.position ?? 0) + 1;

  const { data, error } = await supabase
    .from("costing_tender_lines")
    .insert({ matrix_id: matrixId, position, ...columns })
    .select("id")
    .single();
  if (error) fail(error);
  return data.id;
}

async function writePrices(lineId, fields) {
  const patch = priceColumns(fields);
  if (Object.keys(patch).length === 0) return;
  const { error } = await supabase.rpc("costing_set_money", {
    p_table: "costing_tender_line_prices",
    p_row: lineId,
    p_patch: patch,
  });
  if (error) fail(error);
}

/** Writes money columns through `costing_set_money` (the caller usually cannot select a money table). */
async function writeMoney(table, rowId, patch) {
  if (Object.keys(patch).length === 0) return;
  const { error } = await supabase.rpc("costing_set_money", { p_table: table, p_row: rowId, p_patch: patch });
  if (error) fail(error);
}
