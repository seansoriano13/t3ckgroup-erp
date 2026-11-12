import { supabase } from "../lib/supabase";
import { DEFAULT_CURRENCY } from "../constants/canvass";
import { isExpired, phpFigure } from "../utils/canvassMath";

/**
 * Canvass persistence (spec #956, built in #967): one Canvass per Purchase Request, holding every
 * line of it. A supplier is added to the Canvass once (name, currency, comparison rate, how long
 * the quote holds, lead time, quality note); then its answer on each line it quotes is saved
 * (brand, description, source link, brochure, remarks, unit price). A line has at most one winner
 * and its own reason, and the Canvass has at most one "No other supplier" note.
 *
 * A Canvass is written only when its first supplier is saved (`addSupplier`), which is when it
 * gets its CNV_ number; reading one never creates it. The rules (three suppliers or a "No other
 * supplier" note before a winner, a reason per winner, the lock on a Purchased line, Still
 * canvassing, filling a Component) are the database's (#969); this service sends the write and
 * lets the database's refusal reach the caller.
 *
 * Money is split the way the Costing Matrix splits it. A quote's `unit_price` and a supplier's
 * `comparison_rate` live in `request_canvass_quote_prices` and `request_canvass_supplier_prices`,
 * tables the database only shows to a reader who may see money. This service asks the database
 * whether the caller may (`canvass_can_read_money`) and, if not, leaves those keys OFF, so a
 * missing key reads like a blank and nothing downstream needs to know the tier. The figures that
 * depend on money (the PHP figure) are left off with them.
 *
 * Every figure comes from utils/canvassMath, so the grid, the print and the list agree.
 */

const MONEY_SUPPLIER_KEYS = ["comparison_rate"];
const MONEY_QUOTE_KEYS = ["unit_price", "php_figure"];

/** A stale copy of money must never reach a caller who may not see it. */
const without = (row, keys) => {
  const clean = { ...row };
  for (const key of keys) delete clean[key];
  return clean;
};

const text = (value) => String(value ?? "").trim() || null;

const toNumber = (value, noun) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${noun} has to be a number.`);
  return n;
};

/** Normalises and checks the non-money columns a caller wants written for a supplier. */
function cleanSupplierInput(input = {}) {
  const row = {};
  if (input.supplierName !== undefined) row.supplier_name = text(input.supplierName);
  if (input.leadTime !== undefined) row.lead_time = text(input.leadTime);
  if (input.qualityNote !== undefined) row.quality_note = text(input.qualityNote);
  if (input.validUntil !== undefined) row.valid_until = text(input.validUntil);

  if (input.odooSupplierId !== undefined) {
    const id = toNumber(input.odooSupplierId, "The Odoo supplier id");
    row.odoo_supplier_id = id === null ? null : Math.trunc(id);
  }

  if (input.currency !== undefined) {
    const currency = String(input.currency || DEFAULT_CURRENCY).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error(`"${input.currency}" is not a currency code.`);
    row.currency = currency;
  }
  return row;
}

/** The supplier's money, as a patch to `request_canvass_supplier_prices`. */
function cleanRateInput(input = {}) {
  const row = {};
  if (input.comparisonRate !== undefined) {
    const rate = toNumber(input.comparisonRate, "The comparison rate");
    if (rate !== null && rate <= 0) throw new Error("The comparison rate has to be more than zero.");
    row.comparison_rate = rate;
  }
  return row;
}

/** The non-money columns a caller wants written for a quote. */
function cleanQuoteInput(input = {}) {
  const row = {};
  if (input.brand !== undefined) row.brand = text(input.brand);
  if (input.description !== undefined) row.description = text(input.description);
  if (input.sourceLink !== undefined) row.source_link = text(input.sourceLink);
  if (input.remarks !== undefined) row.remarks = text(input.remarks);
  if (input.brochure !== undefined) row.brochure = input.brochure || [];
  return row;
}

/** The quote's money, as a patch to `request_canvass_quote_prices`. */
function cleanUnitPriceInput(input = {}) {
  const row = {};
  if (input.unitPrice !== undefined) {
    const price = toNumber(input.unitPrice, "Unit price");
    if (price !== null && price < 0) throw new Error("Unit price can't be negative.");
    row.unit_price = price;
  }
  return row;
}

/** A new supplier's columns and rate, checked: it has a name, and a PHP supplier takes no rate. */
function supplierPayload(input) {
  const row = cleanSupplierInput(input);
  const rate = cleanRateInput(input);
  if (!row.supplier_name) throw new Error("A supplier needs a name.");
  const currency = row.currency || DEFAULT_CURRENCY;
  if (currency === DEFAULT_CURRENCY && rate.comparison_rate != null) {
    throw new Error("A PHP supplier takes no comparison rate.");
  }
  return {
    p_supplier: { ...row, currency },
    p_price: { comparison_rate: null, ...rate },
  };
}

const SUPPLIER_MIN_QUERY = 2;

const sortSuppliers = (a, b) =>
  a.sort_order - b.sort_order || String(a.created_at).localeCompare(String(b.created_at));

export const canvassService = {
  /**
   * Odoo suppliers whose name matches `query`, as `[{ id, name }]` (at most 10), for the supplier
   * field. Never throws: with a short query, no match, or Odoo not answering it gives `[]`, and the
   * purchaser simply types the supplier (saved with no Odoo id).
   */
  async searchSuppliers(query) {
    const name = String(query ?? "").trim();
    if (name.length < SUPPLIER_MIN_QUERY) return [];

    try {
      const { data, error } = await supabase.functions.invoke("odoo-supplier-search", { body: { query: name } });
      if (error || !data?.success || !Array.isArray(data.suppliers)) return [];
      return data.suppliers.slice(0, 10).map(({ id, name: supplier }) => ({ id, name: supplier }));
    } catch {
      return [];
    }
  },

  /**
   * The Canvass of a Purchase Request, or null when none has been started (no supplier saved yet).
   * `{ requestId }` reads the request's Canvass, `{ canvassId }` one by id. It carries the
   * `suppliers` in the order they were arranged, every `quotes` row, the line `winners` and the
   * `noOtherSupplier` note (or null). For a reader who may not see money, the suppliers and quotes
   * carry no `comparison_rate`, `unit_price` or `php_figure` keys at all.
   */
  async get({ requestId, canvassId } = {}) {
    if (!requestId && !canvassId) return null;

    let query = supabase.from("request_canvasses").select("*");
    query = canvassId ? query.eq("id", canvassId) : query.eq("request_id", requestId);
    const { data: canvass, error } = await query.maybeSingle();
    if (error) throw error;
    if (!canvass) return null;

    const { data: canReadMoney, error: moneyError } = await supabase.rpc("canvass_can_read_money", {
      p_canvass_id: canvass.id,
    });
    if (moneyError) throw moneyError;

    const [suppliersResult, quotesResult, noOtherResult] = await Promise.all([
      supabase.from("request_canvass_suppliers").select("*").eq("canvass_id", canvass.id),
      supabase.from("request_canvass_quotes").select("*").eq("canvass_id", canvass.id),
      supabase.from("request_canvass_no_other_supplier").select("*").eq("canvass_id", canvass.id).maybeSingle(),
    ]);
    for (const result of [suppliersResult, quotesResult, noOtherResult]) if (result.error) throw result.error;

    const supplierRows = (suppliersResult.data || []).map((s) => without(s, MONEY_SUPPLIER_KEYS));
    const quoteRows = (quotesResult.data || []).map((q) => without(q, MONEY_QUOTE_KEYS));

    const rates = new Map();
    const prices = new Map();
    if (canReadMoney) {
      if (supplierRows.length > 0) {
        const { data, error: rateError } = await supabase
          .from("request_canvass_supplier_prices")
          .select("supplier_id, comparison_rate")
          .in("supplier_id", supplierRows.map((s) => s.id));
        if (rateError) throw rateError;
        for (const row of data || []) rates.set(row.supplier_id, row.comparison_rate);
      }
      if (quoteRows.length > 0) {
        const { data, error: priceError } = await supabase
          .from("request_canvass_quote_prices")
          .select("quote_id, unit_price")
          .in("quote_id", quoteRows.map((q) => q.id));
        if (priceError) throw priceError;
        for (const row of data || []) prices.set(row.quote_id, row.unit_price);
      }
    }

    const suppliers = supplierRows
      .sort(sortSuppliers)
      .map((s) => {
        const shaped = { ...s, expired: isExpired(s) };
        if (canReadMoney) shaped.comparison_rate = rates.get(s.id) ?? null;
        return shaped;
      });
    const supplierById = new Map(suppliers.map((s) => [s.id, s]));

    const quotes = quoteRows.map((q) => {
      if (!canReadMoney) return q;
      const supplier = supplierById.get(q.supplier_id);
      const unit_price = prices.get(q.id) ?? null;
      return {
        ...q,
        unit_price,
        php_figure: phpFigure({
          unit_price,
          currency: supplier?.currency,
          comparison_rate: supplier?.comparison_rate ?? null,
        }),
      };
    });

    let winners = [];
    if (suppliers.length > 0) {
      const { data, error: winnerError } = await supabase
        .from("request_canvass_winners")
        .select("*")
        .in("supplier_id", suppliers.map((s) => s.id));
      if (winnerError) throw winnerError;
      winners = data || [];
    }

    return {
      ...canvass,
      suppliers,
      quotes,
      winners,
      noOtherSupplier: noOtherResult.data ?? null,
      canReadMoney: Boolean(canReadMoney),
    };
  },

  /** The Canvass of one Purchase Request, or null. */
  getForRequest(requestId) {
    if (!requestId) return Promise.resolve(null);
    return this.get({ requestId });
  },

  /**
   * One light row per Component that a supplier has quoted, for the matrix to show a chip without
   * opening anything: `{ id, number, component_id, offerCount, winner }`, where `offerCount` is the
   * number of suppliers that quoted a line of the Component and `winner` is the latest line winner
   * (`{ id: supplier id, brand, supplierName }`) or null. A Component's lines are the Requested
   * Items that name it. No money.
   */
  async listForComponents(componentIds = []) {
    const ids = [...new Set((componentIds || []).filter(Boolean))];
    if (ids.length === 0) return [];

    const { data: items, error: itemsError } = await supabase
      .from("purchase_request_items")
      .select("id, component_id")
      .in("component_id", ids);
    if (itemsError) throw itemsError;
    const componentOf = new Map((items || []).map((i) => [i.id, i.component_id]));
    if (componentOf.size === 0) return [];
    const itemIds = [...componentOf.keys()];

    const { data: quotes, error: quotesError } = await supabase
      .from("request_canvass_quotes")
      .select("canvass_id, supplier_id, item_id, brand")
      .in("item_id", itemIds);
    if (quotesError) throw quotesError;
    if (!quotes || quotes.length === 0) return [];

    const [canvassResult, supplierResult, winnerResult] = await Promise.all([
      supabase.from("request_canvasses").select("id, number").in("id", [...new Set(quotes.map((q) => q.canvass_id))]),
      supabase.from("request_canvass_suppliers").select("id, supplier_name").in("id", [...new Set(quotes.map((q) => q.supplier_id))]),
      supabase.from("request_canvass_winners").select("item_id, supplier_id, chosen_at").in("item_id", itemIds),
    ]);
    for (const result of [canvassResult, supplierResult, winnerResult]) if (result.error) throw result.error;
    const canvassById = new Map((canvassResult.data || []).map((c) => [c.id, c]));
    const supplierById = new Map((supplierResult.data || []).map((s) => [s.id, s]));

    const byComponent = new Map();
    for (const quote of quotes) {
      const componentId = componentOf.get(quote.item_id);
      const canvass = canvassById.get(quote.canvass_id);
      if (!componentId || !canvass) continue;
      const row = byComponent.get(componentId) ?? { id: canvass.id, number: canvass.number, component_id: componentId, suppliers: new Set(), winner: null, winnerAt: "" };
      row.suppliers.add(quote.supplier_id);
      byComponent.set(componentId, row);
    }
    for (const win of winnerResult.data || []) {
      const row = byComponent.get(componentOf.get(win.item_id));
      if (!row || String(win.chosen_at ?? "") < row.winnerAt) continue;
      const quote = quotes.find((q) => q.supplier_id === win.supplier_id && q.item_id === win.item_id);
      row.winnerAt = String(win.chosen_at ?? "");
      row.winner = {
        id: win.supplier_id,
        brand: quote?.brand ?? null,
        supplierName: supplierById.get(win.supplier_id)?.supplier_name ?? null,
      };
    }
    return [...byComponent.values()].map(({ suppliers, winnerAt: _winnerAt, ...row }) => ({ ...row, offerCount: suppliers.size }));
  },

  /**
   * Every Canvass the caller may read, newest first, for the Canvasses page: one row per Purchase
   * Request. Names and counts only, no money.
   */
  async list() {
    const { data, error } = await supabase.rpc("canvass_list");
    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: row.id,
      number: row.number,
      // Until the Canvasses page is rebuilt for one row per request (#973), the old page's fields
      // are filled from the new ones so it still lists something sensible.
      kind: "request",
      subjectName: row.request_label ?? null,
      offerCount: Number(row.supplier_count) || 0,
      winner: Number(row.winner_count) > 0 ? {} : null,
      requestId: row.request_id ?? null,
      requestLabel: row.request_label ?? null,
      opportunityId: row.opportunity_id ?? null,
      salesReference: row.sales_reference ?? null,
      projectTitle: row.project_title ?? null,
      canvasserId: row.canvasser_id ?? null,
      canvasserName: row.canvasser_name ?? null,
      supplierCount: Number(row.supplier_count) || 0,
      lineCount: Number(row.line_count) || 0,
      quotedLineCount: Number(row.quoted_line_count) || 0,
      winnerCount: Number(row.winner_count) || 0,
      createdBy: row.created_by ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at ?? null,
    }));
  },

  /**
   * Adds a supplier to a Purchase Request's Canvass (`canvass_add_supplier`). The first supplier
   * starts the Canvass and gives it its number; later ones join it, appended after the current
   * ones. Opening a grid writes nothing; this does. Returns `{ canvassId, number, supplier }`.
   */
  async addSupplier(requestId, input = {}, actorId) {
    if (!requestId) throw new Error("A Purchase Request id is required.");
    const { p_supplier, p_price } = supplierPayload(input);

    const { data, error } = await supabase.rpc("canvass_add_supplier", {
      p_request_id: requestId,
      p_supplier: { ...p_supplier, created_by: actorId || null },
      p_price,
    });
    if (error) throw error;
    return { canvassId: data.canvass_id, number: data.number, supplier: without(data.supplier ?? {}, MONEY_SUPPLIER_KEYS) };
  },

  /**
   * Edits one supplier; only the fields named in `patch` are touched. A change to PHP clears the
   * comparison rate first (a PHP supplier takes none); a change to a foreign currency leaves the
   * rate for the canvasser to fill.
   */
  async updateSupplier(supplierId, patch = {}) {
    if (!supplierId) throw new Error("A supplier id is required.");

    const row = cleanSupplierInput(patch);
    if (row.supplier_name !== undefined && !row.supplier_name) throw new Error("A supplier needs a name.");
    const price = cleanRateInput(patch);

    if (row.currency !== undefined || price.comparison_rate != null) {
      const { data: current, error: readError } = await supabase
        .from("request_canvass_suppliers")
        .select("currency")
        .eq("id", supplierId)
        .single();
      if (readError) throw readError;
      const currency = row.currency ?? current.currency ?? DEFAULT_CURRENCY;
      if (currency === DEFAULT_CURRENCY) {
        if (price.comparison_rate != null) throw new Error("A PHP supplier takes no comparison rate.");
        if (row.currency !== undefined) price.comparison_rate = null;
      }
    }

    // A rate has to go before the supplier turns PHP; it can only arrive after it turns foreign.
    const clearsRate = price.comparison_rate === null && row.currency === DEFAULT_CURRENCY;
    const writeRate = async () => {
      if (Object.keys(price).length === 0) return;
      const { error } = await supabase.from("request_canvass_supplier_prices").update(price).eq("supplier_id", supplierId);
      if (error) throw error;
    };

    if (clearsRate) await writeRate();

    let supplier = null;
    if (Object.keys(row).length > 0) {
      const { data, error } = await supabase
        .from("request_canvass_suppliers")
        .update(row)
        .eq("id", supplierId)
        .select()
        .single();
      if (error) throw error;
      supplier = data;
    }

    if (!clearsRate) await writeRate();
    return supplier ? without(supplier, MONEY_SUPPLIER_KEYS) : null;
  },

  /** Removes a supplier outright, with its quotes and any win they held: a comparison being built up is a draft. */
  async removeSupplier(supplierId) {
    if (!supplierId) throw new Error("A supplier id is required.");
    const { error } = await supabase.from("request_canvass_suppliers").delete().eq("id", supplierId);
    if (error) throw error;
  },

  /** Arranges the suppliers in the order of `orderedIds`. Ids that aren't the Canvass's are ignored. */
  async reorderSuppliers(canvassId, orderedIds = []) {
    if (!canvassId) throw new Error("A Canvass id is required.");

    const writes = orderedIds
      .filter(Boolean)
      .map((id, index) =>
        supabase.from("request_canvass_suppliers").update({ sort_order: index }).eq("id", id).eq("canvass_id", canvassId),
      );
    const failure = (await Promise.all(writes)).find((r) => r.error);
    if (failure) throw failure.error;
  },

  /**
   * Saves one supplier's answer on one line (`canvass_save_quote`): the quote and its price row
   * together. Only the fields named in `input` are touched; a quote not there yet is made. The line
   * has to be on the Canvass's own request. Returns the quote without its money.
   */
  async saveQuote(supplierId, itemId, input = {}) {
    if (!supplierId || !itemId) throw new Error("A supplier id and a line id are required.");
    const quote = cleanQuoteInput(input);
    const price = cleanUnitPriceInput(input);

    const { data, error } = await supabase.rpc("canvass_save_quote", {
      p_supplier_id: supplierId,
      p_item_id: itemId,
      p_quote: quote,
      p_price: price,
    });
    if (error) throw error;
    return without(data ?? {}, MONEY_QUOTE_KEYS);
  },

  /** Takes one supplier's answer off a line. A win it held goes with it. */
  async removeQuote(quoteId) {
    if (!quoteId) throw new Error("A quote id is required.");
    const { error } = await supabase.from("request_canvass_quotes").delete().eq("id", quoteId);
    if (error) throw error;
  },

  /**
   * Makes a supplier the winner of one line, with the reason, replacing the line's winner if it has
   * one. The database refuses a supplier that did not quote the line, a blank reason, a cancelled or
   * Purchased line, and a Canvass without three suppliers or a note; it fills the Component on a
   * pick (#969).
   */
  async setWinner(itemId, supplierId, reason, actorId) {
    if (!itemId || !supplierId) throw new Error("A line id and a supplier id are required.");
    const { data, error } = await supabase
      .from("request_canvass_winners")
      .upsert(
        {
          item_id: itemId,
          supplier_id: supplierId,
          reason: text(reason),
          chosen_by: actorId || null,
          chosen_at: new Date().toISOString(),
        },
        { onConflict: "item_id" },
      )
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  /** Rewrites why a line's winner was chosen: one paragraph, kept as written. A winner needs a reason, so blank is refused. */
  async setWinnerReason(itemId, reason) {
    if (!itemId) throw new Error("A line id is required.");
    const { data, error } = await supabase
      .from("request_canvass_winners")
      .update({ reason: text(reason) })
      .eq("item_id", itemId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  /** Un-picks a line's winner, leaving none. What the winner filled on the Component stays. */
  async clearWinner(itemId) {
    if (!itemId) throw new Error("A line id is required.");
    const { error } = await supabase.from("request_canvass_winners").delete().eq("item_id", itemId);
    if (error) throw error;
  },

  /**
   * Writes the Canvass's "No other supplier" note: why it has fewer than three suppliers. One note
   * per Canvass; saving again replaces it. Refused without a reason.
   */
  async markNoOtherSupplier(canvassId, reason, actorId) {
    if (!canvassId) throw new Error("A Canvass id is required.");
    if (!text(reason)) throw new Error("Say why there is no other supplier.");
    const { data, error } = await supabase
      .from("request_canvass_no_other_supplier")
      .upsert(
        { canvass_id: canvassId, reason: text(reason), actor_id: actorId || null, created_at: new Date().toISOString() },
        { onConflict: "canvass_id" },
      )
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  /**
   * "This supplier wins every line" (`canvass_pick_supplier_for_all`): picks the supplier on every
   * line it quoted, with one reason, and skips the rest (and any cancelled or Purchased line).
   * Returns `{ picked, skipped }`.
   */
  async pickSupplierForAll(canvassId, supplierId, reason) {
    if (!canvassId || !supplierId) throw new Error("A Canvass id and a supplier id are required.");
    const { data, error } = await supabase.rpc("canvass_pick_supplier_for_all", {
      p_canvass_id: canvassId,
      p_supplier_id: supplierId,
      p_reason: text(reason),
    });
    if (error) throw error;
    return data;
  },

  /** "Use the same reason for all" (`canvass_use_same_reason`): copies one reason to every picked line that isn't locked. Returns `{ changed }`. */
  async useSameReason(canvassId, reason) {
    if (!canvassId) throw new Error("A Canvass id is required.");
    const { data, error } = await supabase.rpc("canvass_use_same_reason", { p_canvass_id: canvassId, p_reason: text(reason) });
    if (error) throw error;
    return data;
  },

  /** A Super Admin lifts the lock on one Purchased line, with a reason kept in the history (`canvass_unlock_line`). */
  async unlockLine(itemId, reason) {
    if (!itemId) throw new Error("A line id is required.");
    const { data, error } = await supabase.rpc("canvass_unlock_line", { p_item_id: itemId, p_reason: text(reason) });
    if (error) throw error;
    return data;
  },

  /**
   * The ids, among `itemIds`, of lines a Super Admin has unlocked (`request_canvass_line_unlocks`),
   * as a Set: a Purchased line in it is open to change again. The history itself is the table's.
   */
  async unlockedItemIds(itemIds = []) {
    const ids = [...new Set((itemIds || []).filter(Boolean))];
    if (ids.length === 0) return new Set();
    const { data, error } = await supabase.from("request_canvass_line_unlocks").select("item_id").in("item_id", ids);
    if (error) throw error;
    return new Set((data || []).map((row) => row.item_id));
  },

  /**
   * Each quote's Acquire (PHP) and Markup Price if it won (`canvass_offer_projection`), for the
   * Closed Book and Cost tiers; null for anyone else or when no line names a Component.
   */
  async offerProjection(canvassId) {
    if (!canvassId) return null;
    const { data, error } = await supabase.rpc("canvass_offer_projection", { p_canvass_id: canvassId });
    if (error) throw error;
    return data ?? null;
  },

  /** Takes the "No other supplier" note off the Canvass. The database refuses while a winner depends on it. */
  async clearNoOtherSupplier(canvassId) {
    if (!canvassId) throw new Error("A Canvass id is required.");
    const { error } = await supabase.from("request_canvass_no_other_supplier").delete().eq("canvass_id", canvassId);
    if (error) throw error;
  },

  /**
   * Sales accepts the winning quote's brand into the Component's Brand (`costing_accept_brand`).
   * Only the Deal Team may; the database refuses anyone else. Returns `{ brand }`.
   */
  async acceptBrand(componentId) {
    if (!componentId) throw new Error("A Component id is required.");
    const { data, error } = await supabase.rpc("costing_accept_brand", { p_component_id: componentId });
    if (error) throw error;
    return data;
  },

  /** Replaces the original working sheet: the whole descriptor list `[{ url, name, type, bytes }]`. */
  async setAttachments(canvassId, attachments = []) {
    if (!canvassId) throw new Error("A Canvass id is required.");
    const { data, error } = await supabase
      .from("request_canvasses")
      .update({ attachments: attachments || [] })
      .eq("id", canvassId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
};
