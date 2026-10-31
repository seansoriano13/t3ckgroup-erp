import { stubRpc, stubEdgeFunction } from "@/test/msw/server"
import { db, updateRow, insertRow } from "@/test/db/store"

const findRow = (id) => db.internal.rowsOf("sales_opportunities").find((row) => row.id === id)

/**
 * `sales_reference_card` (supabase/migrations/20261118110000_815_set_sales_reference.sql) lives in
 * Postgres, which the fake database does not run. This answers it from the stored SOR row; the lock
 * and who may edit are given, because the policy tier (815-set-sales-reference.test.js) is the
 * authority on them.
 *
 *   lock        "open" | "fill_once" | "locked"
 *   canEdit     what the caller may do now
 *   odooState   "found" | "not_checked" | "gone" | null
 */
export function stubSalesReferenceCard({
  lock = "open",
  canEdit = true,
  firstStageName = "Lead",
  odooState = null,
  checkedAt = null,
  productCount = 0,
  duplicates = [],
} = {}) {
  stubRpc("sales_reference_card", (args) => {
    const row = findRow(args.p_opportunity_id)
    return {
      sales_reference: row?.sales_reference ?? null,
      lock,
      first_stage_name: firstStageName,
      can_edit: canEdit,
      odoo_state: odooState,
      checked_at: checkedAt,
      product_count: productCount,
      duplicates,
    }
  })
}

/**
 * The `sor-sales-reference` edge function: saves the typed S0 on the stored row (as Not checked,
 * the #815 behaviour) and records each call. `refuse` is `{ message, hint }` to answer a refusal.
 * Returns the recorded calls.
 */
export function stubSalesReferenceSave({ refuse = null, preview = null } = {}) {
  const calls = []
  const previews = []
  calls.previews = previews
  stubEdgeFunction("sor-sales-reference", (body) => {
    // #818: a preview asks what a save would do; it is answered with `preview` and is not a save.
    if (body.action === "preview") {
      previews.push(body)
      return { success: true, preview }
    }
    calls.push(body)
    if (refuse) return { success: false, refused: true, ...refuse }
    const value = body.salesReference ? String(body.salesReference).trim().toUpperCase() : null
    updateRow("sales_opportunities", findRow(body.opportunityId), {
      sales_reference: value,
      sales_reference_odoo_state: value ? "not_checked" : null,
    })
    return { success: true, sales_reference: value, odoo_state: value ? "not_checked" : null, checked_at: null }
  })
  return calls
}

/**
 * `restore_opportunity` (supabase/migrations/20261118150000_819_s0_duplicates_and_restore.sql) on
 * the fake store: who may restore, the one-S0-per-SOR refusal, the restore and its history. The
 * policy tier (819-sales-reference-duplicates-restore.test.js) is the authority; this keeps the
 * service and screen tests honest.
 */
export function stubRestoreOpportunityRpc({ actorId } = {}) {
  stubRpc("restore_opportunity", (args) => {
    const row = findRow(args.p_opportunity_id)
    const actor = db.internal.rowsOf("employees").find((e) => e.id === actorId)
    if (!actor?.is_super_admin && row.deal_owner_id !== actorId) {
      throw { pgrst: { code: "42501", message: "Only a Super Admin or this SOR's Deal Owner can restore it.", details: null, hint: "forbidden" } }
    }
    const taker = row.sales_reference
      ? db.internal
          .rowsOf("sales_opportunities")
          .find((o) => o.id !== row.id && o.sales_reference === row.sales_reference && !o.is_deleted)
      : null
    if (taker) {
      throw {
        pgrst: {
          code: "23505",
          message: `${row.sales_reference} is now on SOR "${taker.project_title}" (${taker.client_name}). One S0 per SOR; change one before restoring.`,
          details: null,
          hint: "duplicate",
        },
      }
    }
    updateRow("sales_opportunities", row, { is_deleted: false, deleted_at: null, deleted_by: null })
    insertRow("sales_opportunity_logs", {
      opportunity_id: row.id,
      author_id: actorId,
      type: "SYSTEM",
      content: "SOR restored from Deleted.",
      metadata: { event: "OPPORTUNITY_RESTORED", employeeId: actorId },
    })
    insertRow("system_audit_logs", {
      author_id: actorId,
      entity_type: "OPPORTUNITY",
      entity_id: row.id,
      content: "Sales opportunity restored.",
      type: "SYSTEM",
      metadata: { event: "OPPORTUNITY_RESTORED", employeeId: actorId },
    })
    return { ...findRow(row.id) }
  })
}
