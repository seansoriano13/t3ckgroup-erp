import { supabase } from "../lib/supabase";
import { ITEM_STATUS } from "../constants/purchaseRequest";
import { PO_NUMBER_HINT, isValidPoNumber, normalizePoNumber } from "../constants/procurement";
import { purchasingService } from "./purchasingService";

const ITEM_SELECT =
  "*, requester:employees!purchase_request_items_requested_by_fkey(id, name, avatar_path)";

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
 * Status (#306): every change goes through `pr_set_item_status`, which checks
 * the transition and the caller's side (purchasing walks the path; the sales
 * side may only cancel) and posts the change in the request.
 *
 * PO (#312): Ordered takes an optional PO number, checked against Odoo first;
 * the PO line(s) the item is bought on are picked from the PO's IPAS stored
 * Odoo copy (none exists yet, so nothing can be picked).
 */
export const purchaseRequestService = {
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
   * Adds a product that isn't in Odoo. `images` are the uploaded files'
   * descriptors ({ url, name, type, bytes }), at most five. Returns the new
   * item's id.
   */
  async addNewItem(requestId, { name, quantity, unit = null, description = null, images = [] }) {
    const { data, error } = await supabase.rpc("purchase_request_add_new_item", {
      p_request_id: requestId,
      p_name: name,
      p_quantity: Number(quantity),
      p_unit: unit || null,
      p_description: description || null,
      p_images: images || [],
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
    return (items.data || []).map((item) =>
      lineByItem.has(item.id) ? { ...item, sorLine: lineByItem.get(item.id) } : item,
    );
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
      supabase.rpc("pr_actor_side", { p_request_id: requestId }),
      supabase.rpc("pr_can_add_substitute", { p_request_id: requestId }),
    ]);
    if (side.error) throw side.error;
    if (substitute.error) throw substitute.error;
    return { side: side.data ?? null, canSubstitute: substitute.data === true };
  },

  /**
   * Moves an item to `status`. The database refuses a step off the path, or
   * one the caller's side may not take, and posts the change in the request.
   * `details` carries per-status data: Ordered takes `{ po_number,
   * po_verification }` (#312; use `orderItem`). Returns the updated item.
   */
  async setItemStatus(itemId, status, details = {}) {
    const { data, error } = await supabase.rpc("pr_set_item_status", {
      p_item_id: itemId,
      p_status: status,
      p_details: details,
    });
    if (error) throw error;
    return data;
  },

  // ── PO number and PO lines (#312) ────────────────────────────────────────

  /**
   * Checks a PO number against Odoo (`odoo-po-verify`, through the legacy
   * panel's wrapper). Never throws: returns the `po_verification` value —
   * VERIFIED, NOT_FOUND, or PENDING_VERIFICATION when Odoo couldn't be asked.
   */
  async verifyPo(poNumber) {
    const { state } = await purchasingService.verifyPoNumber(normalizePoNumber(poNumber));
    return state;
  },

  /**
   * Sets an item Ordered. With a PO number, checks it against Odoo first and
   * stores the number with the result; without one, the item is Ordered with
   * no PO. Throws on a number that isn't an Odoo PO ("P" then digits).
   * Returns the updated item.
   */
  async orderItem(itemId, { poNumber = "" } = {}) {
    const po = normalizePoNumber(poNumber);
    if (!po) return purchaseRequestService.setItemStatus(itemId, ITEM_STATUS.ORDERED);
    if (!isValidPoNumber(po)) throw new Error(PO_NUMBER_HINT);
    const verification = await purchaseRequestService.verifyPo(po);
    return purchaseRequestService.setItemStatus(itemId, ITEM_STATUS.ORDERED, {
      po_number: po,
      po_verification: verification,
    });
  },

  /**
   * The Odoo PO line ids on the IPAS stored copy of the item's PO — what may
   * be picked. Empty when the item has no PO number or its PO has no IPAS.
   */
  async poLines(itemId) {
    if (!itemId) return [];
    const { data, error } = await supabase.rpc("pr_item_po_lines", { p_item_id: itemId });
    if (error) throw error;
    return data || [];
  },

  /**
   * Records the PO line(s) an Ordered item is bought on. The database
   * refuses any line not on the PO's IPAS copy. Returns the updated item.
   */
  async pickPoLines(itemId, lineIds) {
    const { data, error } = await supabase.rpc("pr_pick_po_lines", {
      p_item_id: itemId,
      p_line_ids: lineIds,
    });
    if (error) throw error;
    return data;
  },

  /** Withdraws an item: the one change the sales side may make. */
  async cancelItem(itemId) {
    return purchaseRequestService.setItemStatus(itemId, ITEM_STATUS.CANCELLED);
  },

  /**
   * The Buyer offers a substitute: a new product linked to the item it
   * replaces, which moves to Substituted so sales can re-price. Returns the
   * new item's id.
   */
  async addSubstitute(itemId, { name, quantity, unit = null, description = null, images = [] }) {
    const { data, error } = await supabase.rpc("pr_add_substitute", {
      p_item_id: itemId,
      p_name: name,
      p_quantity: Number(quantity),
      p_unit: unit || null,
      p_description: description || null,
      p_images: images || [],
    });
    if (error) throw error;
    return data;
  },
};
