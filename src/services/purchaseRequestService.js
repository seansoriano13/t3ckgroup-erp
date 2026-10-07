import { supabase } from "../lib/supabase";

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
};
