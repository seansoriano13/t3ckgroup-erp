import { supabase } from "../lib/supabase";
import { bandRefusalMessage } from "../constants/costing";
import { lineTotals, matrixTotals } from "../utils/costingMath";
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

/** Throws the typed band error when `error` is one, else the raw Supabase error. */
function fail(error) {
  throw toBandError(error) ?? error;
}

const blankToNull = (value) => (value === "" || value === undefined ? null : value);

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

/**
 * The read shaped for the screen: Tender Lines numbered 1, 2, … with the price
 * columns merged in where the tier received them, each with its totals and what
 * its SOR line now says, and the matrix's totals.
 */
export function shapeMatrix(read) {
  if (!read) return null;
  const tables = read.tables ?? {};
  const matrix = (tables.costing_matrices ?? [])[0] ?? null;
  const prices = new Map((tables.costing_tender_line_prices ?? []).map((p) => [p.tender_line_id, p]));

  const tenderLines = (tables.costing_tender_lines ?? []).map((line, index) => {
    const { tender_line_id: _link, ...price } = prices.get(line.id) ?? {};
    const merged = { ...line, ...price };
    return {
      ...merged,
      number: index + 1,
      totals: lineTotals(merged),
      sorChange: sorLineChange({ ...line, sorLine: line.sor_line_now }),
    };
  });

  return {
    tier: read.tier,
    bands: read.bands ?? [],
    matrixId: read.matrix_id,
    matrix,
    tenderLines,
    totals: matrixTotals(tenderLines),
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
