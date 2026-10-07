import { stubRpc } from "@/test/msw/server"
import { db } from "@/test/db/store"

/**
 * Issue #311 — `sor_purchase_request_item_states` (supabase/migrations/
 * 20261007161100_purchasing_settled_condition.sql), Purchasing settled's
 * evidence, re-implemented on the fake store: the SOR's Requested Items as
 * `{ status, created_at, status_changed_at }`, or null when it has no
 * Purchase Request. Who may call it is proven in the policy tier
 * (42-purchasing-settled-condition.test.js), not here.
 */
export function stubPurchasingSettledRpc() {
  stubRpc("sor_purchase_request_item_states", ({ p_opportunity_id }) => {
    const request = db.internal.rowsOf("purchase_requests").find((r) => r.opportunity_id === p_opportunity_id)
    if (!request) return null
    return db.internal
      .rowsOf("purchase_request_items")
      .filter((i) => i.request_id === request.id)
      .map((i) => ({ status: i.status, created_at: i.created_at, status_changed_at: i.status_changed_at ?? null }))
  })
}
