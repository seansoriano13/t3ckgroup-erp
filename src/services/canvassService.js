import { supabase } from "../lib/supabase";
import { CANVASS_NOTIFICATION, DEFAULT_CURRENCY, OFFER_MONEY_KEYS } from "../constants/canvass";
import { notificationService } from "./notificationService";
import { isExpired, moreOffersWarning, needsMoreOffers, phpFigure } from "../utils/canvassMath";

/**
 * Canvass persistence (#275, built in #276): one Canvass per subject, its Offers, and the
 * original working sheet. A subject is at most one Costing Matrix Component or one Requested Item
 * (`{ componentId }` or `{ requestedItemId }`), never an Inclusion. Buying outside a project is
 * canvassed first against nothing (ADR 0034): such a Canvass is reached by its id
 * (`{ canvassId }`), says what is being bought in `product_name`, and a Purchase Request is later
 * created from it. A Canvass is written only when its first Offer is saved (`start`), which is
 * when it gets its number; reading one never creates it.
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
 * the Requested Item subject (#280, `getForRequestedItem`).
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
 * Resolves a caller's subject columns: `{ componentId }`, `{ requestedItemId }`, or `{}` for a
 * Canvass with no subject. Throws for both; the database CHECK backs this up, but that surfaces
 * as an opaque error string.
 */
function subjectColumns({ componentId, requestedItemId } = {}) {
  if (componentId && requestedItemId) {
    throw new Error("A Canvass belongs to one Component or one Requested Item, never both.");
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

/** A new Offer's columns and prices, checked: it says something, and a PHP Offer takes no rate. */
function offerPayload(input) {
  const row = cleanOfferInput(input);
  const price = cleanPriceInput(input);
  if (!row.supplier_name && !row.brand && !row.description) {
    throw new Error("An offer needs at least a supplier, a brand or a description.");
  }
  const currency = row.currency || DEFAULT_CURRENCY;
  if (currency === DEFAULT_CURRENCY && price.comparison_rate != null) {
    throw new Error("A PHP offer takes no comparison rate.");
  }
  return {
    p_offer: { brochure: [], ...row, currency },
    p_price: { unit_price: null, comparison_rate: null, ...price },
  };
}

const SUPPLIER_MIN_QUERY = 2;

export const canvassService = {
  /**
   * Odoo suppliers whose name matches `query`, as `[{ id, name }]` (at most 10), for the Offer's
   * supplier field. Never throws: with a short query, no match, or Odoo not answering it gives
   * `[]`, and the purchaser simply types the supplier (saved with no Odoo id).
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
   * The Canvass for a subject, with its Offers, or null when none has been started (no Offer saved
   * yet). `{ canvassId }` reads one by id; `{}` (a new Canvass with no subject) is always null.
   * Offers come in the order they were arranged. For a reader who may not see money, the Offers
   * carry no `unit_price`, `comparison_rate` or `php_figure` keys at all.
   */
  async get(subject = {}) {
    let query = supabase.from("sor_canvasses").select(CANVASS_SELECT);
    if (subject.canvassId) {
      query = query.eq("id", subject.canvassId);
    } else {
      const columns = subjectColumns(subject);
      if (!columns.component_id && !columns.requested_item_id) return null;
      const filterKey = columns.component_id ? "component_id" : "requested_item_id";
      query = query.eq(filterKey, columns[filterKey]);
    }

    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (!data) return null;

    // Asked of the Canvass's own subject, so one read by id is judged like any other.
    const { data: canReadMoney, error: moneyError } = await supabase.rpc("canvass_subject_can_read_money", {
      p_component_id: data.component_id ?? null,
      p_requested_item_id: data.requested_item_id ?? null,
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

    const { data: locked, error: lockError } = await supabase.rpc("canvass_is_locked", { p_canvass_id: data.id });
    if (lockError) throw lockError;

    return {
      ...data,
      offers: shaped,
      locked: Boolean(locked),
      canReadMoney: Boolean(canReadMoney),
      needsMoreOffers: needsMoreOffers(shaped),
      moreOffersWarning: moreOffersWarning(shaped),
    };
  },

  /**
   * The Offer Projection (#321) of a Component's Canvass: one `{ offer_id, acquire_unit,
   * markup_price_unit }` per Offer, or null when the caller is not Purchasing or the Closed Book or the
   * Canvass has no Component. Worked out in the database so the markup factor stays there; nothing is
   * stored.
   */
  async projection(canvassId) {
    if (!canvassId) return null;
    const { data, error } = await supabase.rpc("canvass_offer_projection", { p_canvass_id: canvassId });
    if (error) throw error;
    return Array.isArray(data) ? data : null;
  },

  /** The Canvass of one Costing Matrix Component, or null. */
  getForComponent(componentId) {
    if (!componentId) return Promise.resolve(null);
    return this.get({ componentId });
  },

  /**
   * The Canvass of one Requested Item, or null (#280). Only an item that names no Component has
   * one of its own: an item that names a Component is canvassed through the Component, and
   * `start` refuses it. Prices come only to members with Purchasing access, Finance access or
   * Super Admin; for any other member of the request the Offers carry no price keys.
   */
  getForRequestedItem(itemId) {
    if (!itemId) return Promise.resolve(null);
    return this.get({ requestedItemId: itemId });
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
   * Every Canvass the caller may read, newest first, for the Canvasses page (ADR 0034): project
   * ones on a Component, ones on a Requested Item, and ones with no subject yet. Names only, no
   * money. `kind` is "component", "requested_item" or "none".
   */
  async list() {
    const { data, error } = await supabase.rpc("canvass_list");
    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: row.id,
      number: row.number,
      kind: row.kind,
      productName: row.product_name ?? null,
      subjectName: row.subject_name ?? null,
      componentId: row.component_id ?? null,
      componentNumber: row.component_number ?? null,
      requestedItemId: row.requested_item_id ?? null,
      requestId: row.request_id ?? null,
      requestLabel: row.request_label ?? null,
      requestItemStatus: row.request_item_status ?? null,
      opportunityId: row.opportunity_id ?? null,
      salesReference: row.sales_reference ?? null,
      projectTitle: row.project_title ?? null,
      canvasserId: row.canvasser_id ?? null,
      canvasserName: row.canvasser_name ?? null,
      offerCount: Number(row.offer_count) || 0,
      winner: row.winner_offer_id
        ? { id: row.winner_offer_id, supplierName: row.winner_supplier ?? null, brand: row.winner_brand ?? null }
        : null,
      signedOffAt: row.signed_off_at ?? null,
      signerName: row.signer_name ?? null,
      createdBy: row.created_by ?? null,
      createdAt: row.created_at,
      locked: Boolean(row.locked),
    }));
  },

  /**
   * Saves the first Offer of a Canvass not started yet, which starts it and gives it its number
   * (`canvass_start`). Opening a panel writes nothing; this does. On a subject that already has a
   * Canvass (another purchaser got there first) the Offer joins that one: one Canvass per subject.
   * A Canvass with no subject needs `productName`, what is being bought. Returns
   * `{ canvassId, number, offer }`.
   */
  async start(subject = {}, { productName = null } = {}, input = {}, actorId) {
    const columns = subjectColumns(subject);
    const name = text(productName);
    if (!columns.component_id && !columns.requested_item_id && !name) {
      throw new Error("Say what is being bought before saving the first offer.");
    }
    const { p_offer, p_price } = offerPayload(input);

    const { data, error } = await supabase.rpc("canvass_start", {
      p_component_id: columns.component_id,
      p_requested_item_id: columns.requested_item_id,
      p_product_name: name,
      p_offer: { ...p_offer, created_by: actorId || null },
      p_price,
    });
    if (error) throw error;
    return { canvassId: data.canvass_id, number: data.number, offer: stripMoney(data.offer ?? {}) };
  },

  /** What a Canvass with no subject is buying. Blank is refused there: it has nothing else to go by. */
  async setProductName(canvassId, productName) {
    if (!canvassId) throw new Error("A Canvass id is required.");
    if (!text(productName)) throw new Error("Say what this Canvass is buying.");
    const { data, error } = await supabase
      .from("sor_canvasses")
      .update({ product_name: text(productName) })
      .eq("id", canvassId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  /**
   * Creates one Direct Purchase Request from Canvasses with no subject yet
   * (`canvass_create_purchase_request`): one Requested Item per Canvass, named from the Canvass and
   * described from its winner, and each Canvass then points at its item. Every Canvass needs a
   * winner; one not signed off is allowed (the screen warns first). `items` is
   * `[{ canvassId, quantity, unit }]`. Returns `{ requestId, items: [{ canvassId, itemId }], unsignedCanvassIds }`.
   */
  async createPurchaseRequest({ title, items = [] } = {}) {
    const name = text(title);
    if (!name) throw new Error("Give the Purchase Request a title.");
    if (items.length === 0) throw new Error("Pick at least one Canvass.");
    const payload = items.map(({ canvassId, quantity, unit }) => {
      const qty = toNumber(quantity, "The quantity");
      if (qty !== null && qty <= 0) throw new Error("The quantity has to be more than zero.");
      return { canvass_id: canvassId, quantity: qty, unit: text(unit) };
    });
    const { data, error } = await supabase.rpc("canvass_create_purchase_request", { p_title: name, p_items: payload });
    if (error) throw error;
    return {
      requestId: data.request_id,
      items: (data.items ?? []).map((i) => ({ canvassId: i.canvass_id, itemId: i.item_id })),
      unsignedCanvassIds: data.unsigned_canvass_ids ?? [],
    };
  },

  /**
   * Adds Canvasses that already exist to a Purchase Request that already exists
   * (`canvass_add_to_purchase_request`). Each `{ canvassId, quantity?, unit? }` becomes a new
   * Requested Item; each `{ canvassId, itemId }` is attached to that item of the request (one with no
   * Canvass yet). The winner's price goes on the item and the Canvass locks. Returns
   * `{ requestId, items: [{ canvassId, itemId }], unsignedCanvassIds }`.
   */
  async addToPurchaseRequest(requestId, items = []) {
    if (!requestId) throw new Error("A Purchase Request id is required.");
    if (items.length === 0) throw new Error("Pick at least one Canvass.");
    const payload = items.map(({ canvassId, itemId, quantity, unit }) => {
      if (itemId) return { canvass_id: canvassId, item_id: itemId };
      const qty = toNumber(quantity, "The quantity");
      if (qty !== null && qty <= 0) throw new Error("The quantity has to be more than zero.");
      return { canvass_id: canvassId, quantity: qty, unit: text(unit) };
    });
    const { data, error } = await supabase.rpc("canvass_add_to_purchase_request", { p_request_id: requestId, p_items: payload });
    if (error) throw error;
    return {
      requestId: data.request_id,
      items: (data.items ?? []).map((i) => ({ canvassId: i.canvass_id, itemId: i.item_id })),
      unsignedCanvassIds: data.unsigned_canvass_ids ?? [],
    };
  },

  /**
   * Adds one Offer to a started Canvass, appended after the current ones. Its prices row is always
   * written (blank if the caller gave none), so a reader who may see money always has a row to read.
   */
  async addOffer(canvassId, input = {}, actorId) {
    if (!canvassId) throw new Error("A Canvass id is required.");
    const { p_offer, p_price } = offerPayload(input);

    // One call writes the Offer and its prices row together, so a failure leaves neither.
    const { data: offer, error } = await supabase.rpc("canvass_add_offer", {
      p_canvass_id: canvassId,
      p_offer: { ...p_offer, created_by: actorId || null },
      p_price,
    });
    if (error) throw error;

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
    await this.notifyApprovers(canvassId);
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
    await this.notifyApprovers(canvassId);
    return data;
  },

  /**
   * Un-picks the winner, leaving none (`canvass_clear_winner`), which unsigns the Canvass. What the
   * winner filled on a Component (Acquire, Offer Specification, documents) stays, still marked as
   * from the Canvass, until a new winner replaces it; the matrix row says there is no winner now.
   */
  async clearWinner(canvassId) {
    if (!canvassId) throw new Error("A Canvass id is required.");
    const { data, error } = await supabase.rpc("canvass_clear_winner", { p_canvass_id: canvassId });
    if (error) throw error;
    return data;
  },

  /**
   * Releases a locked Canvass (`canvass_unlock`): a Super Admin only, and the reason is kept in the
   * Canvass history. Returns `{ canvass_id, unlocked }`.
   */
  async unlock(canvassId, reason) {
    if (!canvassId) throw new Error("A Canvass id is required.");
    if (!String(reason ?? "").trim()) throw new Error("Say why it is being unlocked.");
    const { data, error } = await supabase.rpc("canvass_unlock", { p_canvass_id: canvassId, p_reason: reason.trim() });
    if (error) throw error;
    return data;
  },

  /**
   * Tells the purchasing approver list that a Canvass is ready to sign: it has a winner and a
   * reason and is unsigned. The database says whether that is so and who is on the list (the list
   * is not readable to a purchaser). Never throws: a notice that fails must not undo the edit that
   * made the Canvass ready. Returns how many people were told.
   */
  async notifyApprovers(canvassId) {
    try {
      const { data, error } = await supabase.rpc("canvass_signoff_audience", { p_canvass_id: canvassId });
      if (error || !data?.ready) return 0;
      const ids = data.notify_ids ?? [];
      await Promise.all(
        ids.map((recipient_id) =>
          notificationService.createNotification({
            recipient_id,
            type: CANVASS_NOTIFICATION.READY_TO_SIGN,
            title: `${data.number} is ready to sign`,
            message: `Canvass ${data.number} has a winner and a reason. It needs the purchasing approver's sign-off.`,
            reference_id: canvassId,
          }),
        ),
      );
      return ids.length;
    } catch (err) {
      console.error("Could not notify the Canvass approvers:", err);
      return 0;
    }
  },

  /**
   * Signs the Canvass off (`canvass_sign`): only the purchasing approver list, never the person who
   * opened it, and only with a winner and a reason. Fewer than three Offers never blocks; the
   * count is recorded and the screen warns beforehand. Returns `{ canvass_id, number,
   * signed_off_at, offer_count }`.
   */
  async sign(canvassId) {
    if (!canvassId) throw new Error("A Canvass id is required.");
    const { data, error } = await supabase.rpc("canvass_sign", { p_canvass_id: canvassId });
    if (error) throw error;
    return data;
  },

  /** The sign-off history, oldest first: `{ id, kind, reason, offer_count, created_at, actor }`. */
  async signoffHistory(canvassId) {
    if (!canvassId) throw new Error("A Canvass id is required.");
    const { data, error } = await supabase
      .from("sor_canvass_signoff_events")
      .select("id, canvass_id, kind, actor_id, reason, offer_count, created_at, actor:employees!sor_canvass_signoff_events_actor_id_fkey(id, name, avatar_path)")
      .eq("canvass_id", canvassId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data || [];
  },

  /**
   * The Approval Center queue: Canvasses with a winner and a reason that nobody has signed, for a
   * member of the approver list (anyone else gets none, and never one they opened themselves).
   * Names only, no money.
   */
  async pendingSignoffs() {
    const { data, error } = await supabase.rpc("canvass_pending_signoffs");
    if (error) throw error;
    return (data ?? []).map((row) => ({
      canvassId: row.canvass_id,
      number: row.number,
      componentId: row.component_id ?? null,
      requestedItemId: row.requested_item_id ?? null,
      subjectName: row.subject_name ?? null,
      reason: row.reason,
      creatorId: row.creator_id ?? null,
      creatorName: row.creator_name ?? null,
      opportunityId: row.opportunity_id ?? null,
      projectTitle: row.project_title ?? null,
      clientName: row.client_name ?? null,
      offerCount: Number(row.offer_count) || 0,
      winnerBrand: row.winner_brand ?? null,
      winnerSupplier: row.winner_supplier ?? null,
      waitingSince: row.waiting_since,
    }));
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
