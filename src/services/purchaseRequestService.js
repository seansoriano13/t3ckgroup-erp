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
 * Requested Items (#305): a sales-side member or the Buyer adds them, picked
 * from an SOR line or described as a new product. Each starts at Requested
 * and posts in the request.
 *
 * From the Costing Matrix (#273): Purchasing access adds one item per picked Component
 * (`addItemsFromComponents`); each copies the Component's name, quantity, unit and Odoo
 * product id and keeps its own copy, and names the Component. `listItems` attaches the
 * Component's number and name ("1.2 · name") as `component`.
 *
 * Status (#306): every change goes through `purchase_request_set_item_status`, which checks
 * the transition and the caller's side (purchasing walks the path; the sales
 * side may only cancel) and posts the change in the request.
 *
 * PO (#312): Ordered takes an optional PO number, checked against Odoo first;
 * the PO line(s) the item is bought on are picked from the PO's IPAS stored
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
export const isRequestClosed = (row) => (row?.item_count ?? 0) > 0 && (row?.open_count ?? 0) === 0;

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
   * Whether the signed-in employee has Purchasing access (#273): the only people who may add
   * Requested Items from the Costing Matrix. A convenience for showing the button; the
   * database refuses anyone else.
   */
  async hasPurchasingAccess() {
    const { data, error } = await supabase.rpc("has_purchasing_access");
    if (error) throw error;
    return data === true;
  },

  /**
   * The SOR's Product List as it stands, to pick from — `{ id, product_name,
   * quantity, unit, odoo_product_id, sort_order }`, no prices. Read through
   * the request, so the Buyer can pick without a window into the SOR.
   */
  async pickableLines(requestId) {
    const { data, error } = await supabase.rpc("purchase_request_pickable_lines", {
      p_request_id: requestId,
    });
    if (error) throw error;
    return data || [];
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
   * Adds an item copied from one Product List line: its Odoo product, name,
   * quantity and unit, as they are now. Returns the new item's id.
   *
   * Lines are re-created on every Product List save, so a line id from a
   * picker that has been open a while can be gone; the database refuses it
   * and the caller re-reads the list.
   */
  async addItemFromLine(requestId, lineId) {
    const { data, error } = await supabase.rpc("purchase_request_add_item_from_line", {
      p_request_id: requestId,
      p_line_id: lineId,
    });
    if (error) throw error;
    return data;
  },

  /**
   * Makes a line-sourced item say what its SOR line says now (quantity and unit),
   * and posts the change in the request. The database wants a reason once the item
   * is Ordered, and refuses a closed item or a line the SOR no longer has.
   */
  async updateItemFromSor(itemId, reason = null) {
    const { error } = await supabase.rpc("purchase_request_update_item_from_sor", {
      p_item_id: itemId,
      p_reason: reason,
    });
    if (error) throw error;
  },

  /** "Keep as asked": the item stays as picked, and its "SOR changed" flag stays quiet until the SOR says something else. */
  async keepItemAsAsked(itemId) {
    const { error } = await supabase.rpc("purchase_request_keep_item_as_asked", { p_item_id: itemId });
    if (error) throw error;
  },

  /**
   * Adds one Requested Item for each given Component of the request's SOR (#273): the Component's
   * name, quantity, unit and Odoo product id are copied and the item names the Component. Purchasing
   * access only; a Component on another SOR's matrix is refused, and so is the whole call. The same
   * Component may be asked for more than once. Returns the new items' ids.
   */
  async addItemsFromComponents(requestId, componentIds) {
    const { data, error } = await supabase.rpc("purchase_request_add_items_from_components", {
      p_request_id: requestId,
      p_component_ids: componentIds,
    });
    if (error) throw error;
    return data || [];
  },

  /**
   * Adds a product that isn't in Odoo. `images` are the uploaded files'
   * descriptors ({ url, name, type, bytes }), at most five. Returns the new
   * item's id.
   */
  async addNewItem(requestId, { name, quantity, unit = null, description = null, images = [] }) {
    const { data, error } = await supabase.rpc("purchase_request_add_new_item", {
      p_request_id: requestId,
      ...itemArgs({ name, quantity, unit, description, images }),
    });
    if (error) throw error;
    return data;
  },

  /**
   * The request's items, oldest first. A line-sourced item carries `sorLine`,
   * its SOR line as the SOR says it now (`{ found, quantity, unit }`) — what
   * `sorLineChange` compares with the snapshot to say "SOR line now says N".
   */
  async listItems(requestId) {
    if (!requestId) return [];
    const [items, lines] = await Promise.all([
      supabase
        .from("purchase_request_items")
        .select(ITEM_SELECT)
        .eq("request_id", requestId)
        .order("created_at", { ascending: true }),
      supabase.rpc("purchase_request_item_lines", { p_request_id: requestId }),
    ]);
    if (items.error) throw items.error;
    if (lines.error) throw lines.error;

    const lineByItem = new Map(
      (lines.data || []).map((l) => [
        l.item_id,
        { found: l.line_found, quantity: l.line_quantity, unit: l.line_unit },
      ]),
    );

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
      ...(lineByItem.has(item.id) ? { sorLine: lineByItem.get(item.id) } : {}),
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

  // ── PO number and PO lines (#312) ────────────────────────────────────────

  /**
   * Sets an item Ordered. Without a PO number it is a direct status move. With
   * one, the `odoo-po-verify` edge function does the work (#548): it asks Odoo,
   * then moves the item itself with its own verdict. The browser never sends
   * the check. Verified is saved; a PO Odoo says it doesn't have is refused
   * (this throws, naming the PO); an Odoo that doesn't answer saves the PO as
   * "not checked" (PENDING_VERIFICATION) for the screen to warn about. Throws on
   * a number that isn't an Odoo PO ("P" then digits). Returns the updated item.
   */
  async orderItem(itemId, { poNumber = "" } = {}) {
    const po = normalizePoNumber(poNumber);
    if (!po) return purchaseRequestService.setItemStatus(itemId, ITEM_STATUS.PURCHASED);
    if (!isValidPoNumber(po)) throw new Error(PO_NUMBER_HINT);
    return purchaseRequestService.applyPoAction("order", itemId, po);
  },

  /**
   * Corrects the PO on an Ordered item (#549). The new number is checked against
   * Odoo like the first one; picked PO lines on the old PO are cleared. Throws on
   * a number that isn't an Odoo PO. Returns the updated item.
   */
  async correctPo(itemId, poNumber) {
    const po = normalizePoNumber(poNumber);
    if (!po || !isValidPoNumber(po)) throw new Error(PO_NUMBER_HINT);
    return purchaseRequestService.applyPoAction("correct", itemId, po);
  },

  /**
   * Saves a PO on an item through the server (`odoo-po-verify`, save mode).
   * `action` names what to do with it; "order" today, so "Correct PO" can use
   * the same path.
   */
  async applyPoAction(action, itemId, poNumber) {
    const { data, error } = await supabase.functions.invoke("odoo-po-verify", {
      body: { action, itemId, poNumber },
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
    if (!data?.success) throw new Error(data?.message || "Couldn't save the PO number. Try again.");
    return data.item;
  },

  /**
   * The Odoo PO line ids on the IPAS stored copy of the item's PO — what may
   * be picked. Empty when the item has no PO number or its PO has no IPAS.
   */
  async poLines(itemId) {
    if (!itemId) return [];
    const { data, error } = await supabase.rpc("purchase_request_item_po_lines", { p_item_id: itemId });
    if (error) throw error;
    return data || [];
  },

  /**
   * Records the PO line(s) an Ordered item is bought on. The database
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

  /** Withdraws an item: the one change the sales side may make. */
  async cancelItem(itemId) {
    return purchaseRequestService.setItemStatus(itemId, ITEM_STATUS.CANCELLED);
  },

  /**
   * The Buyer offers a substitute: a new product linked to the item it
   * replaces, which is cancelled (the link stays) so sales can re-price. Returns the
   * new item's id.
   */
  async addSubstitute(itemId, { name, quantity, unit = null, description = null, images = [] }) {
    const { data, error } = await supabase.rpc("purchase_request_add_substitute", {
      p_item_id: itemId,
      ...itemArgs({ name, quantity, unit, description, images }),
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
