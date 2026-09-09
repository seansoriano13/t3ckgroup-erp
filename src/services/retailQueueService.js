import { supabase } from "../lib/supabase";

/**
 * Fetch queue items.
 * @param {object} options
 * @param {'pending'|'approved'|'dismissed'|'all'} [options.status='pending']
 */
export async function getRetailQueue({ status = "pending" } = {}) {
  let query = supabase
    .from("odoo_retail_queue")
    .select(
      `
      id,
      created_at,
      updated_at,
      odoo_so_number,
      odoo_so_id,
      odoo_partner_name,
      odoo_person_name,
      odoo_amount,
      odoo_salesperson_name,
      odoo_date_order,
      odoo_create_date,
      status,
      reviewed_at,
      client_name,
      contact_person,
      expected_value,
      lead_source,
      project_title,
      deal_owner_id,
      sales_director_id,
      opportunity_id,
      reviewed_by:employees!odoo_retail_queue_reviewed_by_fkey ( id, name ),
      deal_owner:employees!odoo_retail_queue_deal_owner_id_fkey ( id, name ),
      sales_director:employees!odoo_retail_queue_sales_director_id_fkey ( id, name )
      `
    )
    .order("created_at", { ascending: false });

  if (status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/**
 * Get the pending queue count (for the badge).
 */
export async function getRetailQueuePendingCount() {
  const { count, error } = await supabase
    .from("odoo_retail_queue")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");
  if (error) throw error;
  return count ?? 0;
}

/**
 * Approve a queue item — creates the SOR entry (marked retail, issue #171)
 * and marks the queue item approved, in one atomic call.
 *
 * Issue #173: this used to be two round trips from the client (insert, then
 * update), so a failure in between orphaned a record with the queue item
 * still pending, and a re-approve inserted a second SOR. The RPC does both
 * writes in one transaction, with `FOR UPDATE` and a status check that
 * refuses an item that isn't `pending` — a double-click now produces one
 * insert and one rejected second call, not two SORs.
 *
 * Terminal stage, project type, ITB exemption and participant assignments
 * are no longer sent — they never meant anything for a retail order, and
 * the column defaults ('LEAD', 'SSP', false, null, null) apply instead.
 * The RPC also derives the reviewer from the caller's own session
 * (`get_employee_id()`), not from a client-supplied id.
 *
 * @param {string} queueItemId
 * @param {object} edits  Editable fields the sales user may have changed
 * @returns {Promise<string>} the new SOR's id
 */
export async function approveQueueItem(queueItemId, edits = {}) {
  const { data, error } = await supabase.rpc("approve_retail_queue_item", {
    p_queue_item_id: queueItemId,
    p_client_name: edits.client_name ?? null,
    p_contact_person: edits.contact_person ?? null,
    p_project_title: edits.project_title ?? null,
    p_expected_value: edits.expected_value ?? null,
  });
  if (error) throw error;
  return data;
}

/**
 * Dismiss a queue item — marks it dismissed, never touches the SOR.
 * @param {string} queueItemId
 * @param {string} reviewerId
 */
export async function dismissQueueItem(queueItemId, reviewerId) {
  const { error } = await supabase
    .from("odoo_retail_queue")
    .update({
      status: "dismissed",
      reviewed_by: reviewerId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", queueItemId)
    .eq("status", "pending");
  if (error) throw error;
}
