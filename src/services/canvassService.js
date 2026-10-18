import { supabase } from "../lib/supabase";
import { DEFAULT_CURRENCY, OFFER_MONEY_KEYS } from "../constants/canvass";
import { isExpired, moreOffersWarning, needsMoreOffers, phpFigure } from "../utils/canvassMath";

/**
 * Canvass persistence (#275, built in #276): one Canvass per subject, its Offers, and the
 * original working sheet. A subject is exactly one Costing Matrix Component or exactly one
 * Requested Item (`{ componentId }` or `{ requestedItemId }`), never an Inclusion.
 *
 * Money is split the way the Costing Matrix splits it. An Offer's `unit_price` and
 * `comparison_rate` live in `sor_canvass_offer_prices`, a table the database only shows to a
 * reader whose tier may see money. This service asks the database whether the caller may
 * (`canvass_subject_can_read_money`) and, if not, leaves those keys OFF the Offer, so a missing
 * key reads like a blank and nothing downstream needs to know the tier. The figures that depend
 * on money (the PHP figure) are left off with them.
 *
 * Every figure comes from utils/canvassMath, so the panel, the sign-off and the print agree.
 * Later tickets add to this file: supplier search (#277), the winner (#278), sign-off (#279),
 * the Requested Item subject (#280).
 */

const CANVASS_SELECT = `
  *,
  signer:employees!sor_canvasses_signed_off_by_fkey(id, name, avatar_path),
  offers:sor_canvass_offers(*)
`;

/** The migration drops `unit_price` from the Offer table, but a stale copy must never reach a caller. */
const stripMoney = (offer) => {
  const clean = { ...offer };
  for (const key of OFFER_MONEY_KEYS) delete clean[key];
  return clean;
};

/**
 * Resolves the exactly-one-subject columns from a caller's `{ componentId }` or
 * `{ requestedItemId }`. Throws rather than letting a caller write a Canvass that satisfies
 * neither or both; the database CHECK backs this up, but that surfaces as an opaque error string.
 */
function subjectColumns({ componentId, requestedItemId } = {}) {
  const provided = [componentId, requestedItemId].filter(Boolean);
  if (provided.length !== 1) {
    throw new Error("A Canvass belongs to exactly one Component or one Requested Item.");
  }
  return { component_id: componentId || null, requested_item_id: requestedItemId || null };
}

const text = (value) => String(value ?? "").trim() || null;

const toNumber = (value, noun) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${noun} has to be a number.`);
  return n;
};

/** Normalises and checks the non-money columns a caller wants written for an Offer. */
function cleanOfferInput(input = {}) {
  const row = {};
  const setText = (key, column) => {
    if (input[key] !== undefined) row[column] = text(input[key]);
  };

  setText("supplierName", "supplier_name");
  setText("brand", "brand");
  setText("description", "description");
  setText("sourceLink", "source_link");
  setText("remarks", "remarks");
  setText("leadTime", "lead_time");
  setText("qualityNote", "quality_note");

  if (input.odooSupplierId !== undefined) {
    const id = toNumber(input.odooSupplierId, "The Odoo supplier id");
    row.odoo_supplier_id = id === null ? null : Math.trunc(id);
  }
  if (input.brochure !== undefined) row.brochure = input.brochure || [];
  if (input.validUntil !== undefined) row.valid_until = text(input.validUntil);

  if (input.currency !== undefined) {
    const currency = String(input.currency || DEFAULT_CURRENCY).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error(`"${input.currency}" is not a currency code.`);
    row.currency = currency;
  }
  return row;
}

/** The money columns a caller wants written, as a patch to `sor_canvass_offer_prices`. */
function cleanPriceInput(input = {}) {
  const row = {};
  if (input.unitPrice !== undefined) {
    const price = toNumber(input.unitPrice, "Unit price");
    if (price !== null && price < 0) throw new Error("Unit price can't be negative.");
    row.unit_price = price;
  }
  if (input.comparisonRate !== undefined) {
    const rate = toNumber(input.comparisonRate, "The comparison rate");
    if (rate !== null && rate <= 0) throw new Error("The comparison rate has to be more than zero.");
    row.comparison_rate = rate;
  }
  return row;
}

/** Puts the figures canvassMath owns onto a shaped Offer. */
function withFigures(offer, canReadMoney) {
  const shaped = { ...offer, expired: isExpired(offer) };
  if (canReadMoney) shaped.php_figure = phpFigure(offer);
  return shaped;
}

export const canvassService = {
  /**
   * The Canvass for a subject, with its Offers, or null when nobody has opened one. Offers come in
   * the order they were arranged. For a reader who may not see money, the Offers carry no
   * `unit_price`, `comparison_rate` or `php_figure` keys at all.
   */
  async get(subject) {
    const columns = subjectColumns(subject);
    const filterKey = columns.component_id ? "component_id" : "requested_item_id";

    const { data, error } = await supabase
      .from("sor_canvasses")
      .select(CANVASS_SELECT)
      .eq(filterKey, columns[filterKey])
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const { data: canReadMoney, error: moneyError } = await supabase.rpc("canvass_subject_can_read_money", {
      p_component_id: columns.component_id,
      p_requested_item_id: columns.requested_item_id,
    });
    if (moneyError) throw moneyError;

    const offers = (data.offers || []).map(stripMoney);
    const prices = new Map();
    if (canReadMoney && offers.length > 0) {
      const { data: priceRows, error: priceError } = await supabase
        .from("sor_canvass_offer_prices")
        .select("offer_id, unit_price, comparison_rate")
        .in("offer_id", offers.map((o) => o.id));
      if (priceError) throw priceError;
      for (const row of priceRows || []) prices.set(row.offer_id, row);
    }

    const shaped = offers
      .sort((a, b) => a.sort_order - b.sort_order || String(a.created_at).localeCompare(String(b.created_at)))
      .map((offer) => {
        if (!canReadMoney) return withFigures(offer, false);
        const price = prices.get(offer.id);
        return withFigures(
          { ...offer, unit_price: price?.unit_price ?? null, comparison_rate: price?.comparison_rate ?? null },
          true,
        );
      });

    return {
      ...data,
      offers: shaped,
      canReadMoney: Boolean(canReadMoney),
      needsMoreOffers: needsMoreOffers(shaped),
      moreOffersWarning: moreOffersWarning(shaped),
    };
  },

  /** The Canvass of one Costing Matrix Component, or null. */
  getForComponent(componentId) {
    if (!componentId) return Promise.resolve(null);
    return this.get({ componentId });
  },

  /**
   * One light row per Component that has a Canvass (id, number, signed state, Offer count), for
   * the matrix to show a chip without opening anything. No money.
   */
  async listForComponents(componentIds = []) {
    const ids = [...new Set((componentIds || []).filter(Boolean))];
    if (ids.length === 0) return [];

    const { data, error } = await supabase
      .from("sor_canvasses")
      .select("id, number, component_id, signed_off_at, offers:sor_canvass_offers(id, brand, supplier_name, is_winner)")
      .in("component_id", ids);
    if (error) throw error;

    // The winner's brand and supplier are not money, so a Stage Participant gets them too (#278).
    return (data || []).map(({ offers, ...canvass }) => {
      const winner = (offers || []).find((o) => o.is_winner);
      return {
        ...canvass,
        offerCount: (offers || []).length,
        winner: winner ? { id: winner.id, brand: winner.brand ?? null, supplierName: winner.supplier_name ?? null } : null,
      };
    });
  },

  /**
   * Opens the Canvass for a subject, once. A second call (or a second purchaser) gets the same
   * Canvass back with the same number: one Canvass per subject.
   */
  async open(subject, actorId) {
    const columns = subjectColumns(subject);
    const existing = await this.get(subject);
    if (existing) return existing;

    const { error } = await supabase.from("sor_canvasses").insert({ ...columns, created_by: actorId || null });
    // Someone opened it between the read and the write: theirs is the one.
    if (error && error.code !== "23505") throw error;

    return this.get(subject);
  },

  /**
   * Adds one Offer, appended after the current ones. Its prices row is always written (blank if
   * the caller gave none), so a reader who may see money always has a row to read.
   */
  async addOffer(canvassId, input = {}, actorId) {
    if (!canvassId) throw new Error("A Canvass id is required.");

    const row = cleanOfferInput(input);
    const price = cleanPriceInput(input);
    if (!row.supplier_name && !row.brand && !row.description) {
      throw new Error("An offer needs at least a supplier, a brand or a description.");
    }
    const currency = row.currency || DEFAULT_CURRENCY;
    if (currency === DEFAULT_CURRENCY && price.comparison_rate != null) {
      throw new Error("A PHP offer takes no comparison rate.");
    }

    const { data: siblings, error: siblingsError } = await supabase
      .from("sor_canvass_offers")
      .select("id")
      .eq("canvass_id", canvassId);
    if (siblingsError) throw siblingsError;

    const { data: offer, error } = await supabase
      .from("sor_canvass_offers")
      .insert({
        brochure: [],
        ...row,
        currency,
        canvass_id: canvassId,
        sort_order: (siblings || []).length,
        created_by: actorId || null,
      })
      .select()
      .single();
    if (error) throw error;

    const { error: priceError } = await supabase
      .from("sor_canvass_offer_prices")
      .insert({ unit_price: null, comparison_rate: null, ...price, offer_id: offer.id });
    if (priceError) {
      await supabase.from("sor_canvass_offers").delete().eq("id", offer.id);
      throw priceError;
    }

    return stripMoney(offer);
  },

  /**
   * Edits one Offer; only the fields named in `patch` are touched. A change to PHP clears the
   * comparison rate first (a PHP Offer takes none); a change to a foreign currency leaves the
   * rate for the canvasser to fill.
   */
  async updateOffer(offerId, patch = {}) {
    if (!offerId) throw new Error("An offer id is required.");

    const row = cleanOfferInput(patch);
    const price = cleanPriceInput(patch);

    if (row.currency !== undefined || price.comparison_rate != null) {
      const { data: current, error: readError } = await supabase
        .from("sor_canvass_offers")
        .select("currency")
        .eq("id", offerId)
        .single();
      if (readError) throw readError;
      const currency = row.currency ?? current.currency ?? DEFAULT_CURRENCY;
      if (currency === DEFAULT_CURRENCY) {
        if (price.comparison_rate != null) throw new Error("A PHP offer takes no comparison rate.");
        if (row.currency !== undefined) price.comparison_rate = null;
      }
    }

    // A rate has to go before the Offer turns PHP; it can only arrive after the Offer turns foreign.
    const clearsRate = price.comparison_rate === null && row.currency === DEFAULT_CURRENCY;
    const writePrice = async () => {
      if (Object.keys(price).length === 0) return;
      const { error } = await supabase.from("sor_canvass_offer_prices").update(price).eq("offer_id", offerId);
      if (error) throw error;
    };

    if (clearsRate) await writePrice();

    let offer = null;
    if (Object.keys(row).length > 0) {
      const { data, error } = await supabase
        .from("sor_canvass_offers")
        .update(row)
        .eq("id", offerId)
        .select()
        .single();
      if (error) throw error;
      offer = data;
    }

    if (!clearsRate) await writePrice();
    return offer ? stripMoney(offer) : null;
  },

  /** Removes an Offer outright: a comparison being built up is a draft. */
  async removeOffer(offerId) {
    if (!offerId) throw new Error("An offer id is required.");
    const { error } = await supabase.from("sor_canvass_offers").delete().eq("id", offerId);
    if (error) throw error;
  },

  /** Arranges the Offers in the order of `orderedIds`. Ids that aren't the Canvass's are ignored. */
  async reorderOffers(canvassId, orderedIds = []) {
    if (!canvassId) throw new Error("A Canvass id is required.");

    const writes = orderedIds
      .filter(Boolean)
      .map((id, index) =>
        supabase.from("sor_canvass_offers").update({ sort_order: index }).eq("id", id).eq("canvass_id", canvassId),
      );
    const failure = (await Promise.all(writes)).find((r) => r.error);
    if (failure) throw failure.error;
  },

  /** Records why the winner was chosen: one paragraph, kept as written. Blank clears it. */
  async setReason(canvassId, reason) {
    if (!canvassId) throw new Error("A Canvass id is required.");
    const { data, error } = await supabase
      .from("sor_canvasses")
      .update({ reason: text(reason) })
      .eq("id", canvassId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  /**
   * Marks an Offer the winner (`canvass_apply_winner`): the old winner is cleared, and on a
   * Component the Offer fills Acquire (price x comparison rate when foreign), Offer Specification
   * and the Component's documents, each marked "from Canvass" until someone edits it. A field a
   * person has typed over is left alone. Refused for a foreign Offer with no comparison rate.
   * Returns `{ offer_id, filled: { acquire, offer_specification, documents } }`.
   */
  async markWinner(canvassId, offerId) {
    if (!canvassId || !offerId) throw new Error("A Canvass id and an offer id are required.");
    const { data, error } = await supabase.rpc("canvass_apply_winner", { p_canvass_id: canvassId, p_offer_id: offerId });
    if (error) throw error;
    return data;
  },

  /**
   * Sales accepts the winning Offer's brand into the Component's Brand (`costing_accept_brand`).
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
      .from("sor_canvasses")
      .update({ attachments: attachments || [] })
      .eq("id", canvassId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
};
