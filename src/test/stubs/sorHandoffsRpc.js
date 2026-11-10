import { stubRpc } from "@/test/msw/server"
import { db } from "@/test/db/store"

const rowsOf = (table) => db.internal.rowsOf(table)

/**
 * Issue #257 — `handoffs_for_sor` (supabase/migrations/20261015140000_
 * handoffs_for_sor.sql) re-implemented against the in-memory store, so the SOR
 * service test can read the handoffs an SOR shows. `canReadSor` stands in for
 * the SOR read rule the function applies; `canReadRecord` for each row's own
 * read rule (`can_open`). The rules and the no-remark columns are the policy
 * tier's to prove (73-sor-handoffs.test.js).
 */
export function stubSorHandoffsRpc({ canReadSor = true, canReadRecord = false } = {}) {
  stubRpc("handoffs_for_sor", ({ p_opportunity_id }) => {
    if (!canReadSor) return { transmittals: [], packing_lists: [] }

    const transmittals = rowsOf("transmittals")
      .filter((t) =>
        rowsOf("transmittal_lines").some((l) => l.transmittal_id === t.id && l.opportunity_id === p_opportunity_id),
      )
      .map((t) => ({
        id: t.id,
        number: t.number,
        prepared_on: t.prepared_on,
        priority: t.priority,
        state: t.state,
        na_count: rowsOf("transmittal_lines").filter(
          (l) => l.transmittal_id === t.id && (l.wh_rating === "na" || l.tech_rating === "na"),
        ).length,
        can_open: canReadRecord,
      }))

    const packingLists = rowsOf("packing_lists")
      .filter((p) => p.opportunity_id === p_opportunity_id)
      .map((p) => ({
        id: p.id,
        number: p.number,
        state: p.state,
        box_count: rowsOf("packing_list_boxes").filter((b) => b.packing_list_id === p.id).length,
        odoo_delivery_ref: p.odoo_delivery_ref ?? null,
        can_open: canReadRecord,
      }))

    return { transmittals, packing_lists: packingLists }
  })
}
