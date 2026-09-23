import { stubRpc } from "@/test/msw/server"
import { db, insertRow, deleteRows } from "@/test/db/store"

const rowsOf = (table) => db.internal.rowsOf(table)

/**
 * `sor_replace_items` (supabase/migrations/20260929030000_atomic_sor_items_replace.sql)
 * lives in Postgres, which the fake database does not execute. Re-implemented
 * here against the same in-memory store so opportunityService.replaceItems
 * keeps exercising a real delete-then-insert of sales_opportunity_items — and
 * the fake's own sor_recalc_expected_value mirror in triggers.js — through
 * the RPC instead of the two direct table calls it replaced.
 */
export function stubReplaceItemsRpc() {
  stubRpc("sor_replace_items", (args) => {
    const opportunityId = args.p_opportunity_id
    const existing = rowsOf("sales_opportunity_items").filter(
      (row) => row.opportunity_id === opportunityId,
    )
    deleteRows("sales_opportunity_items", existing)

    const items = Array.isArray(args.p_items) ? args.p_items : []
    items
      .filter((item) => (item.product_name || "").trim())
      .forEach((item, idx) => {
        insertRow("sales_opportunity_items", {
          opportunity_id: opportunityId,
          product_name: item.product_name.trim(),
          unit: (item.unit || "").trim() || null,
          quantity: Number(item.quantity) || 0,
          unit_price: Number(item.unit_price) || 0,
          sort_order: idx,
        })
      })
    return null
  })
}
