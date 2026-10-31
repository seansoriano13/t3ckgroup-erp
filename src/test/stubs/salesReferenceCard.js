import { stubRpc, stubEdgeFunction } from "@/test/msw/server"
import { db, updateRow, insertRow, deleteRows } from "@/test/db/store"

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
 * The `sor-sales-reference` edge function: saves the typed S0 on the stored row and records each
 * call. `refuse` is `{ message, hint }` to answer a refusal.
 *
 *   odoo        what Odoo answered: "unreachable" (default; the S0 saves as Not checked), "found"
 *               (state found; `odooItems` replace the SOR's products, the pull) or "not_found"
 *               (the check and the save both refuse, "Odoo has no <S0>")
 *   odooItems   product rows Odoo's order holds ({ product_name, quantity, unit_price, odoo_line_id })
 *
 * The `check` action (#820, registration's pre-flight) runs format, duplicates and Odoo with the
 * database's refusal texts and hints and writes nothing. The policy tier
 * (815-set-sales-reference, 820-check-sales-reference) is the authority; this keeps the service and
 * screen tests honest. Returns the recorded save calls; `.previews` and `.checks` hold the others.
 */
export function stubSalesReferenceSave({ refuse = null, preview = null, odoo = "unreachable", odooItems = [] } = {}) {
  const calls = []
  const previews = []
  const checks = []
  calls.previews = previews
  calls.checks = checks
  const normalise = (v) => {
    let ref = v ? String(v).trim().toUpperCase() : null
    if (ref && /^SO\d+$/.test(ref)) ref = "S" + ref.slice(2)
    return ref
  }
  const notFound = (ref) => ({ success: false, refused: true, message: `Odoo has no ${ref}. Check the number.`, hint: "not_found" })
  const duplicate = (ref, exceptId) => {
    const other = db.internal
      .rowsOf("sales_opportunities")
      .find((o) => o.id !== exceptId && o.sales_reference === ref && !o.is_deleted)
    return other
      ? { success: false, refused: true, message: `${ref} is already on SOR "${other.project_title}" (${other.client_name}). One S0 per SOR.`, hint: "duplicate" }
      : null
  }
  stubEdgeFunction("sor-sales-reference", (body) => {
    // #820: registration's pre-flight. Nothing is written.
    if (body.action === "check") {
      checks.push(body)
      if (refuse) return { success: false, refused: true, ...refuse }
      const ref = normalise(body.salesReference)
      if (!ref) return { success: true, sales_reference: null, odoo_state: null }
      if (!/^S\d+$/.test(ref)) {
        return { success: false, refused: true, message: 'Sales Reference must be the Odoo quotation number — "S" followed by digits, e.g. S01237.', hint: "format" }
      }
      const taken = duplicate(ref, null)
      if (taken) return taken
      if (odoo === "not_found") return notFound(ref)
      return { success: true, sales_reference: ref, odoo_state: odoo === "found" ? "found" : "not_checked" }
    }
    // #818: a preview asks what a save would do; it is answered with `preview` and is not a save.
    if (body.action === "preview") {
      previews.push(body)
      return { success: true, preview }
    }
    calls.push(body)
    if (refuse) return { success: false, refused: true, ...refuse }
    const value = normalise(body.salesReference)
    if (value) {
      const taken = duplicate(value, body.opportunityId)
      if (taken) return taken
      if (odoo === "not_found") return notFound(value)
    }
    const state = !value ? null : odoo === "found" ? "found" : "not_checked"
    updateRow("sales_opportunities", findRow(body.opportunityId), {
      sales_reference: value,
      sales_reference_odoo_state: state,
    })
    if (value && odoo === "found" && odooItems.length) {
      deleteRows("sales_opportunity_items", db.internal.rowsOf("sales_opportunity_items").filter((i) => i.opportunity_id === body.opportunityId))
      odooItems.forEach((item, index) => insertRow("sales_opportunity_items", { opportunity_id: body.opportunityId, sort_order: index, ...item }))
    }
    return { success: true, sales_reference: value, odoo_state: state, checked_at: null }
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
