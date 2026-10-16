import { supabase } from "../lib/supabase";
import { bandRefusalMessage } from "../constants/costing";
import { complianceRollup, componentTotals, costRowsTotals, costRowTotals, lineTotals, matrixTotals } from "../utils/costingMath";
import { summariseCompleteness } from "../constants/projectEvaluation";
import { sorLineChange } from "../utils/requestedItem";

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
 * The Evaluation of Specification (#271) is on the Component row: `setCompliance` writes the
 * verdict, its note and the recommended alternative (the Technical band: Purchasing access, or a
 * member of the SOR's evaluation group task), and `sign` approves the whole evaluation once
 * (the evaluation list, every Component with a verdict). A change to a specification or a
 * verdict clears the approval in the database, with a reason the history keeps.
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

const RULE_MESSAGE = /^costing_(?:inclusion|move_inclusion|incharge): (.+)$/;
// The CHECK on costing_components that wants a note whenever the verdict is Deviates (#271).
const DEVIATION_NOTE_CHECK = /costing_components_deviation_note_chk/;

/** The typed error for a matrix rule refusal (a check violation), or null when `error` is anything else. */
export function toRuleError(error) {
  if (error?.code !== "23514") return null;
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
 */
export function shapeMatrix(read) {
  if (!read) return null;
  const tables = read.tables ?? {};
  const matrix = (tables.costing_matrices ?? [])[0] ?? null;
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
      const inclusions = inclusionsByComponent.get(component.id) ?? [];
      return {
        ...row,
        number: `${number}.${position + 1}`,
        totals: componentTotals(row),
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
      compliance: complianceRollup(components),
      sorChange: sorLineChange({ ...line, sorLine: line.sor_line_now }),
    };
  });

  const costRows = (tables.costing_cost_rows ?? []).map((row, index) => ({ ...row, number: index + 1, totals: costRowTotals(row) }));

  return {
    tier: read.tier,
    bands: read.bands ?? [],
    matrixId: read.matrix_id,
    matrix,
    tenderLines,
    totals: matrixTotals(tenderLines),
    compliance: complianceRollup(tenderLines.flatMap((line) => line.components)),
    evaluation: signoffState(signoffs, "evaluation_approved"),
    costRows,
    costRowsTotals: costRowsTotals(costRows),
  };
}

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
    return shapeMatrix(data);
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
   * Signs the matrix off for a role (ADR 0013: the database checks and writes together). Only
   * `"evaluation_approved"` is available (#271): the caller must be on the evaluation list and every
   * Component must carry a verdict, else the database refuses and the message says why. Returns
   * the new sign-off row.
   */
  async sign(matrixId, role = "evaluation_approved") {
    const { data, error } = await supabase.rpc("costing_sign", { p_matrix_id: matrixId, p_role: role });
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
};

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
