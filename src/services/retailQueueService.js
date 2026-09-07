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
 * Approve a queue item — creates the SOR entry and marks the queue item approved.
 * @param {string} queueItemId
 * @param {object} edits  Editable fields the sales user may have changed
 * @param {string} reviewerId  The authenticated employee's UUID
 */
export async function approveQueueItem(queueItemId, edits, reviewerId) {
  // 1. Fetch the queue item
  const { data: item, error: fetchErr } = await supabase
    .from("odoo_retail_queue")
    .select("*")
    .eq("id", queueItemId)
    .single();
  if (fetchErr) throw fetchErr;
  if (item.status !== "pending") throw new Error("Queue item is no longer pending.");

  // 2. Create the SOR entry
  const sorPayload = {
    sales_reference: item.odoo_so_number,
    client_name: edits.client_name ?? item.client_name,
    contact_person: edits.contact_person ?? item.contact_person,
    project_title: edits.project_title ?? item.project_title,
    expected_value: edits.expected_value ?? item.expected_value,
    lead_source: edits.lead_source ?? item.lead_source,
    status: "CLOSED_WON",
    registered_by: reviewerId,
    project_type: "SSP",
    itb_exempt: true,
    expected_award_date: item.odoo_date_order ?? null,
    registration_date: item.odoo_create_date ?? null,
    deal_owner_id: edits.deal_owner_id ?? item.deal_owner_id,
    sales_director_id: edits.sales_director_id ?? item.sales_director_id,
  };

  const { data: newOpp, error: sorErr } = await supabase
    .from("sales_opportunities")
    .insert(sorPayload)
    .select("id")
    .single();
  if (sorErr) throw sorErr;

  // 3. Mark the queue item as approved
  const { error: updateErr } = await supabase
    .from("odoo_retail_queue")
    .update({
      status: "approved",
      reviewed_by: reviewerId,
      reviewed_at: new Date().toISOString(),
      opportunity_id: newOpp.id,
      // Persist the final edited values
      client_name: sorPayload.client_name,
      contact_person: sorPayload.contact_person,
      project_title: sorPayload.project_title,
      expected_value: sorPayload.expected_value,
      lead_source: sorPayload.lead_source,
      deal_owner_id: sorPayload.deal_owner_id,
      sales_director_id: sorPayload.sales_director_id,
    })
    .eq("id", queueItemId);
  if (updateErr) throw updateErr;

  return newOpp.id;
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
