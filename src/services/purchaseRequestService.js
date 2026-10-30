import { supabase } from "../lib/supabase";
import { ITEM_STATUS, REQUEST_KIND, requestKind } from "../constants/purchaseRequest";
import { PO_NUMBER_HINT, PO_VERIFICATION, isValidPoNumber, normalizePoNumber } from "../constants/procurement";
import { shapeSorOverview } from "../utils/sorPurchaseRequest";

const ITEM_SELECT =
  "*, requester:employees!purchase_request_items_requested_by_fkey(id, name, avatar_path)";
const MESSAGE_SELECT =
  "*, author:employees!purchase_request_messages_author_id_fkey(id, name, avatar_path)";
const MEMBER_SELECT =
  "employee_id, side, employee:employees!purchase_request_members_employee_id_fkey(id, name, avatar_path)";

/**
 * Purchase Requests (issue #209). Every write is an RPC: the database decides
 * who may make it.
 *
 * Members (#304): a purchasing member or a Super Admin adds and removes them;
 * the database sets a new member's side and window.
 *
 * Requested Items (#305, #678): every S0 line has one item on the SOR's request, made and
 * kept in step with the line by the database (no call here). A sales-side member or the Buyer
 * adds the rest, described as a new product: an Other request. Each starts at Not checked
 * and posts in the request. `listItems` attaches an item's Component number and name
 * ("1.2 · name") as `component`.
 *
 * Status (#306): every change goes through `purchase_request_set_item_status`, which checks
 * the transition and the caller's side (purchasing walks the path; the sales
 * side may only cancel) and posts the change in the request.
 *
 * PO (#312): Ordered takes an optional PO number, checked against Odoo first;
 * the P0 line(s) the item is bought on are picked from the PO's IPAS stored
 * Odoo copy (none exists yet, so nothing can be picked).
 *
 * Chat and Buyer (#307): members post straight into the request's messages
 * (the insert policy checks author and membership); anyone with Purchasing
 * access may Take an unassigned request; a purchasing member or Super Admin
 * names the Buyer. Who is notified is decided in the database, by a trigger
 * on every message: see 20261005130600_purchase_request_chat_and_buyer.sql.
 *
 * The queue (#308): `purchase_request_queue` returns every request the caller may read,
 * with the SOR's locked header, the Buyer and item counts; the slices
 * (unassigned / mine, open / closed) are `filterQueue` over those rows.
 */

/**
 * The queue's slices (#308). `buyer`: "unassigned" (no Buyer), "mine" (I'm
 * the Buyer) or "all"; `state`: "open", "closed" or "all".
 */
export const QUEUE_BUYER = { UNASSIGNED: "unassigned", MINE: "mine", ALL: "all" };
export const QUEUE_STATE = { OPEN: "open", CLOSED: "closed", ALL: "all" };
export const QUEUE_KIND = { ALL: "all", ...REQUEST_KIND };

/**
 * A request is closed once it has items and every one is in a closed status.
 * One with nothing asked for yet is still open: someone has to act on it.
 */
export const isRequestClosed = (row) =>
  // A request whose SOR was deleted or lost is finished with, whatever lines it still holds (A8).
  Boolean(row?.sor_closed) || ((row?.item_count ?? 0) > 0 && (row?.open_count ?? 0) === 0);

/** The queue rows matching `filter`; "mine" compares the Buyer with `userId`. */
export function filterQueue(
  rows,
  { buyer = QUEUE_BUYER.ALL, state = QUEUE_STATE.ALL, kind = QUEUE_KIND.ALL } = {},
  userId = null,
) {
  return (rows || []).filter((row) => {
    if (kind !== QUEUE_KIND.ALL && requestKind(row) !== kind) return false;
    if (buyer === QUEUE_BUYER.UNASSIGNED && row.buyer_id) return false;
    if (buyer === QUEUE_BUYER.MINE && (!userId || row.buyer_id !== userId)) return false;
    if (state === QUEUE_STATE.OPEN && isRequestClosed(row)) return false;
    if (state === QUEUE_STATE.CLOSED && !isRequestClosed(row)) return false;
    return true;
  });
}

/**
 * One new product's fields as the item RPCs take them (#500): adding a new
 * item, adding a substitute and opening a Direct request all build them here,
 * so a new item field is one edit. `images` go only when given: a Direct
 * request's items carry none.
 */
const itemFields = ({ name, quantity, unit, description, images }) => ({
  name,
  quantity: Number(quantity),
  unit: unit || null,
  description: description || null,
  ...(images !== undefined && { images: images || [] }),
});

/** `itemFields` as an RPC's named arguments: `p_name`, `p_quantity`, … */
const itemArgs = (item) =>
  Object.fromEntries(Object.entries(itemFields(item)).map(([key, value]) => [`p_${key}`, value]));

export const purchaseRequestService = {
  // ── The queue and one request (#308) ─────────────────────────────────────

  /**
   * The Purchase Requests list: every request the signed-in employee may
   * read, most recently active first. Each row: `id`, `opportunity_id`, the
   * SOR's locked header (`sales_reference`, `project_title`, `stage_name`, and
   * `sor_closed`: "deleted", "lost" or null) or a Direct request's `title`, the
   * Buyer (`buyer_id`, `buyer_name`, `buyer_avatar_path`), `item_count`,
   * `open_count`, `created_at`, `last_activity_at`, `pr_number` (PR_0042). `filter` narrows it (see
   * `filterQueue`); "mine" needs `userId`.
   */
  async listQueue({ filter, userId = null } = {}) {
    const { data, error } = await supabase.rpc("purchase_request_queue");
    if (error) throw error;
    const rows = data || [];
    return filter ? filterQueue(rows, filter, userId) : rows;
  },

  /**
   * The SOR's Purchase Request as the SOR modal shows it (#310; see
   * `shapeSorOverview`). Null when the SOR has none, or the caller may not
   * read it: the SOR then shows nothing of purchasing.
   */
  async getSorOverview(opportunityId) {
    if (!opportunityId) return null;
    const { data, error } = await supabase.rpc("sor_purchase_request_overview", {
      p_opportunity_id: opportunityId,
    });
    if (error) throw error;
    return shapeSorOverview((data || [])[0]);
  },

  /**
   * Opens a Direct request (#179): no SOR, a title, and new products
   * (`{ name, quantity, unit, description }`). Any employee; returns its id.
   */
  async openDirect(title, items, forOpportunityId = null) {
    const { data, error } = await supabase.rpc("purchase_request_open", {
      p_title: title,
      p_items: items.map(({ name, quantity, unit, description }) =>
        itemFields({ name, quantity, unit, description }),
      ),
      p_for_opportunity_id: forOpportunityId,
    });
    if (error) throw error;
    return data;
  },

  /**
   * The Direct requests made for one SOR (#689): id, title, prNumber, p0 and status.
   * No money. Empty for a caller who cannot read the SOR.
   */
  async directForSor(opportunityId) {
    if (!opportunityId) return [];
    const { data, error } = await supabase.rpc("direct_requests_for_sor", {
      p_opportunity_id: opportunityId,
    });
    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      prNumber: row.pr_number,
      p0: row.p0 ?? null,
      status: row.status,
    }));
  },

  /** One request, shaped like a `listQueue` row; null when it can't be read. */
  async get(requestId) {
    if (!requestId) return null;
    const { data, error } = await supabase.rpc("purchase_request_queue", { p_request_id: requestId });
    if (error) throw error;
    return (data || [])[0] ?? null;
  },

  /** Whether the signed-in employee may add and remove members and name the Buyer. */
  async canManageMembers(requestId) {
    if (!requestId) return false;
    const { data, error } = await supabase.rpc("purchase_request_can_manage_members", {
      p_request_id: requestId,
    });
    if (error) throw error;
    return data === true;
  },

  // ── Members (#304) ───────────────────────────────────────────────────────

  async addMember(requestId, employeeId) {
    const { error } = await supabase.rpc("purchase_request_add_member", {
      p_request_id: requestId,
      p_employee_id: employeeId,
    });
    if (error) throw error;
  },

  async removeMember(requestId, employeeId) {
    const { error } = await supabase.rpc("purchase_request_remove_member", {
      p_request_id: requestId,
      p_employee_id: employeeId,
    });
    if (error) throw error;
  },

  // ── Requested Items (#305) ───────────────────────────────────────────────

  /** Whether the signed-in employee may add items: a sales-side member or the Buyer. */
  async canAddItems(requestId) {
    if (!requestId) return false;
    const { data, error } = await supabase.rpc("purchase_request_can_add_items", {
      p_request_id: requestId,
    });
    if (error) throw error;
    return data === true;
  },

  /**
   * #501 — the request's SOR stock snapshot (#202), `{ fetched_at, data }`,
   * or null. Read through the request, not `sor_stock_snapshots`, whose policy
   * hides it from a Buyer without SOR access; the picker and the saved items
   * both read this, so they show the same stock.
   */
  async stockSnapshot(requestId) {
    if (!requestId) return null;
    const { data, error } = await supabase.rpc("purchase_request_stock_snapshot", {
      p_request_id: requestId,
    });
    if (error) throw error;
    return data || null;
  },

  /**
   * Adds a product that isn't in Odoo. `images` are the uploaded files'
   * descriptors ({ url, name, type, bytes }), at most five. Returns the new
   * item's id.
   */
  async addNewItem(requestId, { name, quantity, unit = null, description = null, images = [], purpose }) {
    const { data, error } = await supabase.rpc("purchase_request_add_new_item", {
      p_request_id: requestId,
      ...itemArgs({ name, quantity, unit, description, images }),
      // "client" or "job" (#679); left out, the database says "client".
      ...(purpose && { p_purpose: purpose }),
    });
    if (error) throw error;
    return data;
  },

  /**
   * The request's items, oldest first. An item with `sor_item_id` is for an S0 line (and
   * carries `removed_from_s0` when the S0 dropped it); any other is an Other request.
   */
  async listItems(requestId) {
    if (!requestId) return [];
    const items = await supabase
      .from("purchase_request_items")
      .select(ITEM_SELECT)
      .eq("request_id", requestId)
      .order("created_at", { ascending: true });
    if (items.error) throw items.error;

    // An item bought for a Costing Matrix Component carries its number and name ("1.2 · name") (#273).
    // Read only when some item names one, so a request without any makes no extra call.
    let componentByItem = new Map();
    if ((items.data || []).some((item) => item.component_id)) {
      const labels = await supabase.rpc("purchase_request_component_labels", { p_request_id: requestId });
      if (labels.error) throw labels.error;
      componentByItem = new Map(
        (labels.data || []).map((l) => [l.item_id, { id: l.component_id, number: l.number, name: l.name }]),
      );
    }

    // Each item's Canvass (#280): its own, or its Component's. Number and signed state only.
    const canvassByItem = await this.canvassesForItems(items.data || []);

    // The price copied from a Canvass winner (#582). The table's row policy returns rows only to
    // a member with Purchasing, Finance or Super Admin access, so anyone else gets no entry.
    const priceByItem = await this.pricesForItems(items.data || []);

    return (items.data || []).map((item) => ({
      ...item,
      ...(priceByItem.has(item.id) ? { price: priceByItem.get(item.id) } : {}),
      ...(componentByItem.has(item.id) ? { component: componentByItem.get(item.id) } : {}),
      ...(canvassByItem.has(item.id) ? { canvass: canvassByItem.get(item.id) } : {}),
    }));
  },

  /**
   * The price of each item made from a Canvass (#582), as a Map of item id to
   * `{ unitPrice, currency }`. The database shows a row only to a member of the request with
   * Purchasing access, Finance access or Super Admin, so for anyone else the Map is empty.
   */
  async pricesForItems(items = []) {
    const byItem = new Map();
    if (items.length === 0) return byItem;
    const { data, error } = await supabase
      .from("purchase_request_item_prices")
      .select("item_id, unit_price, currency")
      .in("item_id", items.map((i) => i.id));
    if (error) throw error;
    for (const p of data || []) byItem.set(p.item_id, { unitPrice: Number(p.unit_price), currency: p.currency });
    return byItem;
  },

  /**
   * The Canvass of each item that has one (#280), as a Map of item id to
   * `{ id, number, signed, viaComponent }`. An item that names a Component shows that Component's
   * Canvass (`viaComponent`); any other shows its own. Only what the caller may read comes back,
   * so an item with none, or one the caller can't see, simply has no entry.
   */
  async canvassesForItems(items = []) {
    const own = items.filter((i) => !i.component_id).map((i) => i.id);
    const componentIds = [...new Set(items.filter((i) => i.component_id).map((i) => i.component_id))];
    const byItem = new Map();
    if (own.length === 0 && componentIds.length === 0) return byItem;

    const select = "id, number, requested_item_id, component_id, signed_off_at";
    const [ownRows, componentRows] = await Promise.all([
      own.length ? supabase.from("sor_canvasses").select(select).in("requested_item_id", own) : { data: [] },
      componentIds.length ? supabase.from("sor_canvasses").select(select).in("component_id", componentIds) : { data: [] },
    ]);
    if (ownRows.error) throw ownRows.error;
    if (componentRows.error) throw componentRows.error;

    const shape = (c, viaComponent) => ({ id: c.id, number: c.number, signed: Boolean(c.signed_off_at), viaComponent });
    for (const c of ownRows.data || []) byItem.set(c.requested_item_id, shape(c, false));
    const byComponent = new Map((componentRows.data || []).map((c) => [c.component_id, c]));
    for (const item of items) {
      if (item.component_id && byComponent.has(item.component_id)) {
        byItem.set(item.id, shape(byComponent.get(item.component_id), true));
      }
    }
    return byItem;
  },

  // ── Status (#306) ────────────────────────────────────────────────────────

  /**
   * What the signed-in employee may do to this request's items: `side` is
   * "purchasing", "sales" (may only cancel), "other", or null when not a
   * member — feed it to `allowedTransitions(status, side)`;
   * `canSubstitute` is true for the Buyer (or a Super Admin).
   */
  async itemActor(requestId) {
    if (!requestId) return { side: null, canSubstitute: false };
    const [side, substitute] = await Promise.all([
      supabase.rpc("purchase_request_actor_side", { p_request_id: requestId }),
      supabase.rpc("purchase_request_can_add_substitute", { p_request_id: requestId }),
    ]);
    if (side.error) throw side.error;
    if (substitute.error) throw substitute.error;
    return { side: side.data ?? null, canSubstitute: substitute.data === true };
  },

  /**
   * Moves an item to `status`. The database refuses a step off the path, or
   * one the caller's side may not take, and posts the change in the request.
   * `details` carries per-status data: Ordered takes `{ po_number }` (use
   * `orderItem`, which has the server check it, #548); a `po_verification` is refused. Returns the updated item.
   */
  async setItemStatus(itemId, status, details = {}) {
    const { data, error } = await supabase.rpc("purchase_request_set_item_status", {
      p_item_id: itemId,
      p_status: status,
      p_details: details,
    });
    if (error) throw error;
    return data;
  },

  /**
   * Takes back one status change: the item goes back to the status it had.
   * `changedAt` is the changed item's `status_changed_at`, which names the
   * change. The database allows it only to whoever made it, shortly after, and
   * while nothing has changed the item since. Returns the item as it is now.
   */
  async undoItemStatus(itemId, changedAt) {
    const { data, error } = await supabase.rpc("purchase_request_undo_item_status", {
      p_item_id: itemId,
      p_changed_at: changedAt,
    });
    if (error) throw error;
    return data;
  },

  // ── PO number and P0 lines (#312) ────────────────────────────────────────

  /**
   * Attaches an Odoo P0 to an item (#684). The `odoo-po-verify` edge function reads the P0
   * as it stands in Odoo and sets the line from it: an RFQ keeps the line To purchase, a
   * confirmed P0 makes it Purchased, a fully received one Received. The browser never sends
   * the P0's facts. A number Odoo doesn't have is refused (this throws, naming it); so is an
   * Odoo that doesn't answer, because a P0 is never attached unseen. Throws on a number that
   * isn't an Odoo P0 ("P" then digits). Returns the updated item.
   *
   * #724: on a project line, a flow with a "Buying opens here" Stage refuses the attach until the
   * SOR has entered it. That refusal throws an error whose `code` is "buying_not_open"; sending
   * `orderEarly` with a typed `orderEarlyReason` attaches anyway and records the reason.
   */
  async attachP0(itemId, poNumber, { orderEarly = false, orderEarlyReason = "" } = {}) {
    const po = normalizePoNumber(poNumber);
    if (!po || !isValidPoNumber(po)) throw new Error(PO_NUMBER_HINT);
    return purchaseRequestService.applyPoAction("attach", itemId, po, orderEarly ? { orderEarly: true, orderEarlyReason } : {});
  },

  /**
   * The P0s Purchasing can attach to a line (#684): P0s in Odoo whose Source Document names
   * `reference` (the S0, or a Direct request's PR number). `suggested` list the line's own
   * Odoo product; `others` name the reference for another product. Read-only; throws when
   * Odoo didn't answer, so an outage never reads as "no P0s".
   */
  async suggestP0s({ reference, productId = null }) {
    const { data, error } = await supabase.functions.invoke("odoo-po-suggest", {
      body: { reference, productId },
    });
    if (error) throw new Error("Couldn't read the P0s from Odoo. Try again.");
    if (!data?.success) throw new Error(data?.message || "Couldn't read the P0s from Odoo. Try again.");
    return { suggested: data.suggested || [], others: data.others || [] };
  },

  /**
   * Refreshes the request's lines from their P0s in Odoo (#685): the `odoo-po-sync` edge
   * function reads them and sets each line's stored status and delivery figures. Never
   * throws: when Odoo does not answer the lines keep their last values and this returns
   * `{ ok: false }`. Otherwise `{ ok: true, changed }`, the number of lines whose status moved.
   */
  async syncP0s(requestId) {
    if (!requestId) return { ok: true, changed: 0 };
    try {
      const { data, error } = await supabase.functions.invoke("odoo-po-sync", { body: { requestId } });
      if (error || !data?.success) return { ok: false, changed: 0 };
      return { ok: true, changed: data.changed ?? 0 };
    } catch {
      return { ok: false, changed: 0 };
    }
  },

  /**
   * Corrects the PO on an Ordered item (#549). The new number is checked against
   * Odoo like the first one; picked P0 lines on the old PO are cleared. Throws on
   * a number that isn't an Odoo PO. Returns the updated item.
   */
  async correctPo(itemId, poNumber) {
    const po = normalizePoNumber(poNumber);
    if (!po || !isValidPoNumber(po)) throw new Error(PO_NUMBER_HINT);
    return purchaseRequestService.applyPoAction("correct", itemId, po);
  },

  /**
   * Saves a PO on an item through the server (`odoo-po-verify`, save mode).
   * `action` is "attach" (#684) or "correct" (#549).
   */
  async applyPoAction(action, itemId, poNumber, extra = {}) {
    const { data, error } = await supabase.functions.invoke("odoo-po-verify", {
      body: { action, itemId, poNumber, ...extra },
    });
    if (error) {
      let message = "Couldn't save the PO number. Try again.";
      try {
        const body = await error.context?.json?.();
        if (body?.message) message = body.message;
      } catch {
        // keep the generic message
      }
      throw new Error(message);
    }
    if (!data?.success) {
      throw Object.assign(new Error(data?.message || "Couldn't save the PO number. Try again."), { code: data?.code });
    }
    // #730: attaching also raises the IPAS (or adds the SOR to the live one); `ipas` says what happened.
    return data.ipas ? { ...data.item, ipas: data.ipas } : data.item;
  },

  /**
   * #730: tries again to raise the IPAS of a project line whose P0 is attached but whose Odoo did not
   * answer ("IPAS to create"). The server reads the PO itself. Returns `{ result, message, ipas_number }`;
   * throws when Odoo still does not answer, and the line stays "IPAS to create".
   */
  async retryIpas(itemId, poNumber) {
    const { data, error } = await supabase.functions.invoke("odoo-po-verify", {
      body: { action: "ipas", itemId, poNumber },
    });
    if (error) throw new Error("Couldn't raise the IPAS. Try again.");
    if (!data?.success) throw new Error(data?.message || "Couldn't raise the IPAS. Try again.");
    return data.ipas;
  },

  /**
   * The Odoo P0 line ids on the IPAS stored copy of the item's PO — what may
   * be picked. Empty when the item has no PO number or its PO has no IPAS.
   */
  async poLines(itemId) {
    if (!itemId) return [];
    const { data, error } = await supabase.rpc("purchase_request_item_po_lines", { p_item_id: itemId });
    if (error) throw error;
    return data || [];
  },

  /**
   * #804: the same lines as poLines, each with its product name and quantity, as
   * `{ line_id, product_name, quantity }` rows. What the Pick P0 line screen lists.
   */
  async poLineRows(itemId) {
    if (!itemId) return [];
    const { data, error } = await supabase.rpc("purchase_request_item_po_line_rows", { p_item_id: itemId });
    if (error) throw error;
    return data || [];
  },

  /**
   * Records the P0 line(s) an Ordered item is bought on. The database
   * refuses any line not on the PO's IPAS copy. Returns the updated item.
   */
  async pickPoLines(itemId, lineIds) {
    const { data, error } = await supabase.rpc("purchase_request_pick_po_lines", {
      p_item_id: itemId,
      p_line_ids: lineIds,
    });
    if (error) throw error;
    return data;
  },

  /**
   * Unlinks an item from its Costing Matrix Component (#283), so the Component can be deleted.
   * Purchasing access only; the unlink is kept in the matrix's history.
   */
  async detachComponent(itemId) {
    const { error } = await supabase.rpc("purchase_request_item_detach_component", { p_item_id: itemId });
    if (error) throw error;
  },

  /**
   * #688: answers "Is this from your purchase request?" on an S0 line. `same` true moves the
   * Other request's P0, status and history onto the S0 line and closes the request (Cancelled,
   * nothing deleted); false clears the question and changes nothing else. One database call.
   * Returns the S0 line's item.
   */
  async answerYours(itemId, same) {
    const { data, error } = await supabase.rpc("purchase_request_answer_yours", { p_item_id: itemId, p_same: !!same });
    if (error) throw error;
    return data;
  },

  /** Withdraws an item: the one change the sales side may make. */
  async cancelItem(itemId) {
    return purchaseRequestService.setItemStatus(itemId, ITEM_STATUS.CANCELLED);
  },

  /**
   * Odoo products whose name matches `query`, as `[{ id, name, code }]` (at most 10), for picking
   * product B when replacing a product (#687). Never throws: with a short query, no match, or Odoo
   * not answering it gives `[]`, and Purchasing simply types the product.
   */
  async searchOdooProducts(query) {
    const name = String(query ?? "").trim();
    if (name.length < 2) return [];
    try {
      const { data, error } = await supabase.functions.invoke("odoo-product-search", { body: { query: name } });
      if (error || !data?.success || !Array.isArray(data.products)) return [];
      return data.products.slice(0, 10).map(({ id, name: product, code }) => ({ id, name: product, code: code ?? null }));
    } catch {
      return [];
    }
  },

  /**
   * Purchasing replaces product A with another (#687): A is Cancelled with the reason, A's open
   * Canvass stops, and B becomes its own Other request with A's quantity. One database call.
   * The reason is required. Returns the new item's id.
   */
  async replaceItem(itemId, { name, reason, odooProductId = null }) {
    const { data, error } = await supabase.rpc("purchase_request_replace_item", {
      p_item_id: itemId,
      p_name: name,
      p_reason: reason,
      ...(odooProductId && { p_odoo_product_id: odooProductId }),
    });
    if (error) throw error;
    return data;
  },

  // ── Chat (#307) ──────────────────────────────────────────────────────────

  /**
   * The request's messages, oldest first, each with its `author`
   * ({ id, name, avatar_path }; null on an automatic event). An event carries
   * `metadata.event`.
   */
  async listMessages(requestId) {
    if (!requestId) return [];
    const { data, error } = await supabase
      .from("purchase_request_messages")
      .select(MESSAGE_SELECT)
      .eq("request_id", requestId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data || [];
  },

  /**
   * One page of the request's messages, oldest first: the `limit` newest
   * strictly older than `before` (an ISO timestamp), or the newest overall when
   * `before` is null. A full page means older ones may remain.
   */
  async listMessagesPage(requestId, { before = null, limit = 30 } = {}) {
    if (!requestId) return [];
    let query = supabase
      .from("purchase_request_messages")
      .select(MESSAGE_SELECT)
      .eq("request_id", requestId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (before) query = query.lt("created_at", before);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).reverse();
  },

  /**
   * The request's members as `{ id, name, avatar_path, side }`, by name — the
   * roster a mention picks from. Only members can be mentioned: nobody else
   * could open the request.
   */
  async listMembers(requestId) {
    if (!requestId) return [];
    const { data, error } = await supabase
      .from("purchase_request_members")
      .select(MEMBER_SELECT)
      .eq("request_id", requestId);
    if (error) throw error;
    return (data || [])
      .filter((m) => m.employee)
      .map((m) => ({ ...m.employee, side: m.side }))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  },

  /**
   * Posts in the request's Chat. `attachments` are uploaded descriptors
   * ({ url, name, type, bytes }); `mentions` are the Mention model's
   * [{ id, name }], kept only while the name is still in the text. A message
   * with files needs no text. The database notifies: the people mentioned,
   * and the Buyer and requesters.
   */
  async postMessage(requestId, authorId, content, { attachments = [], mentions = [] } = {}) {
    const text = (content || "").trim();
    const files = (attachments || []).filter((a) => a?.url);
    if (!text && files.length === 0) throw new Error("Write a message or attach a file.");

    const live = (mentions || []).filter((m) => m?.id && m?.name && text.includes(`@${m.name}`));
    const metadata = {};
    if (files.length > 0) metadata.attachments = files;
    if (live.length > 0) metadata.mentions = live.map(({ id, name }) => ({ id, name }));

    const { data, error } = await supabase
      .from("purchase_request_messages")
      .insert({ request_id: requestId, author_id: authorId, content: text, metadata })
      .select(MESSAGE_SELECT)
      .single();
    if (error) throw error;
    return data;
  },

  // ── Buyer (#307) ─────────────────────────────────────────────────────────

  /**
   * The signed-in purchaser becomes the Buyer of an unassigned request.
   * Refused (55000) once someone else has it. Returns the request.
   */
  async take(requestId) {
    const { data, error } = await supabase.rpc("purchase_request_take", { p_request_id: requestId });
    if (error) throw error;
    return data;
  },

  /**
   * Names the Buyer (someone with Purchasing access), or `null` to send the
   * request back to the queue. A purchasing member or Super Admin only.
   * Returns the request.
   */
  async setBuyer(requestId, employeeId) {
    const { data, error } = await supabase.rpc("purchase_request_set_buyer", {
      p_request_id: requestId,
      p_employee_id: employeeId || null,
    });
    if (error) throw error;
    return data;
  },
};
