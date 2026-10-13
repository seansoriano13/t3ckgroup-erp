import { stubRpc } from "@/test/msw/server"
import { db, insertRow, updateRow } from "@/test/db/store"
import { pgrstError } from "@/test/db/schema"

const rowsOf = (table) => db.internal.rowsOf(table)
const findRow = (table, id) => rowsOf(table).find((row) => row.id === id)

/** The sheet's last number is TGIPAS_048; the ERP carries on from there. */
const SHEET_LAST_NUMBER = 48

const refuse = (code, message) => {
  throw pgrstError(code, message)
}

/**
 * The IPAS RPCs (supabase/migrations/20261013100100_ipas.sql, issue #242) live
 * in Postgres, which the fake database does not execute. Re-implemented here
 * against the in-memory store, as stubPurchaseRequestItemRpcs does, so a
 * service test can raise, change and cancel an IPAS end to end with
 * `odoo-po-ipas` stubbed.
 *
 * The fake can't model a deferred trigger, a partial unique index on an
 * expression, a sequence or row level security, so the rules that rest on them
 * are enforced here by hand: one live IPAS per PO, `TGIPAS_` numbers that never
 * go back, and the Project-needs-an-SOR rule. The real functions are proven in
 * the policy tier (56-ipas-raise.test.js).
 *
 * The fake has no signed-in identity, so `actorId` stands in for
 * get_employee_id(). `purchasing: false` is a caller without Purchasing access;
 * `reader: false` one who can't read IPAS.
 */
export function stubIpasRpcs({ actorId, purchasing = true, reader = true } = {}) {
  const requirePurchasing = (fn) => {
    if (!purchasing) refuse("42501", `${fn}: only Purchasing may do this`)
  }

  const nextNumber = () => {
    const used = rowsOf("ipas").map((row) => Number(String(row.number).replace(/\D/g, "")) || 0)
    const next = Math.max(SHEET_LAST_NUMBER, ...used) + 1
    return `TGIPAS_${String(next).padStart(3, "0")}`
  }

  const event = (ipasId, kind, detail) =>
    insertRow("ipas_events", { ipas_id: ipasId, actor_id: actorId, kind, detail })

  const cleanSors = (fn, purpose, sorIds) => {
    const ids = [...new Set(sorIds || [])]
    if (purpose === "project" && ids.length === 0) refuse("22023", `${fn}: a Project IPAS needs at least one SOR`)
    if (purpose !== "project" && ids.length > 0) {
      refuse("22023", `${fn}: an Inventory, Supplies or Events IPAS can't name an SOR; put the note in Remarks`)
    }
    for (const id of ids) {
      const sor = findRow("sales_opportunities", id)
      if (!sor || sor.is_deleted) refuse("P0002", `${fn}: one of those SORs no longer exists`)
    }
    return ids.sort()
  }

  const sorIdsOf = (ipasId) =>
    rowsOf("ipas_sors")
      .filter((s) => s.ipas_id === ipasId)
      .map((s) => s.opportunity_id)
      .sort()

  stubRpc("ipas_create", (args) => {
    requirePurchasing("ipas_create")
    const po = String(args.p_po_number || "").trim().toUpperCase()
    if (!/^P[0-9]+$/.test(po)) refuse("22023", `ipas_create: ${args.p_po_number} isn't an Odoo PO number`)
    const copy = args.p_odoo_copy
    if (!copy || typeof copy.po !== "object" || !Array.isArray(copy.lines)) {
      refuse("22023", "ipas_create: the Odoo copy is missing")
    }
    if (String(copy.po.name || "").trim().toUpperCase() !== po) {
      refuse("22023", `ipas_create: the Odoo copy is for ${copy.po.name}, not ${po}`)
    }
    const sors = cleanSors("ipas_create", args.p_purpose, args.p_sor_ids)

    const live = rowsOf("ipas").find((row) => row.po_number === po && row.state !== "cancelled")
    if (live) refuse("23505", `ipas_create: ${po} already has a live IPAS (${live.number}); cancel it to raise a new one`)

    const row = insertRow("ipas", {
      number: nextNumber(),
      po_number: po,
      odoo_po_id: copy.po.id ?? null,
      priority: args.p_priority,
      source: args.p_source,
      purpose: args.p_purpose,
      remarks: (args.p_remarks || "").trim() || null,
      odoo_copy: copy,
      odoo_fetched_at: new Date().toISOString(),
      created_by: actorId,
    })
    for (const opportunityId of sors) insertRow("ipas_sors", { ipas_id: row.id, opportunity_id: opportunityId })
    event(row.id, "created", {
      number: row.number,
      po_number: po,
      priority: row.priority,
      source: row.source,
      purpose: row.purpose,
      sor_ids: sors,
    })
    return row
  })

  stubRpc("ipas_set_purpose_and_sors", (args) => {
    requirePurchasing("ipas_set_purpose_and_sors")
    const row = findRow("ipas", args.p_ipas_id)
    if (!row) refuse("P0002", `ipas_set_purpose_and_sors: IPAS ${args.p_ipas_id} not found`)
    if (row.state === "filed") refuse("55000", `ipas_set_purpose_and_sors: ${row.number} is filed`)
    if (row.state === "cancelled") refuse("55000", `ipas_set_purpose_and_sors: ${row.number} is cancelled`)
    const after = cleanSors("ipas_set_purpose_and_sors", args.p_purpose, args.p_sor_ids)
    const before = sorIdsOf(row.id)
    if (row.purpose === args.p_purpose && JSON.stringify(before) === JSON.stringify(after)) return row

    const from = row.purpose
    const owned = rowsOf("ipas_sors").filter((s) => s.ipas_id === row.id)
    for (const s of owned) rowsOf("ipas_sors").splice(rowsOf("ipas_sors").indexOf(s), 1)
    const updated = updateRow("ipas", row, { purpose: args.p_purpose })
    for (const opportunityId of after) insertRow("ipas_sors", { ipas_id: row.id, opportunity_id: opportunityId })
    event(row.id, "purpose_sors_changed", {
      purpose_from: from,
      purpose_to: args.p_purpose,
      sor_ids_from: before,
      sor_ids_to: after,
    })
    return updated
  })

  stubRpc("ipas_cancel", (args) => {
    requirePurchasing("ipas_cancel")
    const reason = String(args.p_reason || "").trim()
    if (!reason) refuse("22023", "ipas_cancel: a cancelled IPAS needs a reason")
    const row = findRow("ipas", args.p_ipas_id)
    if (!row) refuse("P0002", `ipas_cancel: IPAS ${args.p_ipas_id} not found`)
    if (row.state === "filed") refuse("55000", `ipas_cancel: ${row.number} is filed; a Super Admin reopens it first`)
    if (row.state === "cancelled") refuse("55000", `ipas_cancel: ${row.number} is already cancelled`)
    const updated = updateRow("ipas", row, {
      state: "cancelled",
      cancel_reason: reason,
      cancelled_by: actorId,
      cancelled_at: new Date().toISOString(),
    })
    event(row.id, "cancelled", { reason })
    return updated
  })

  stubRpc("ipas_find_sors", (args) => {
    requirePurchasing("ipas_find_sors")
    const refs = (args.p_refs || []).map((r) => String(r).trim().toUpperCase())
    const term = String(args.p_search || "").trim().toLowerCase()
    return rowsOf("sales_opportunities")
      .filter((o) => !o.is_deleted && !o.is_scratch && o.sales_reference)
      .filter(
        (o) =>
          refs.includes(o.sales_reference) ||
          (term &&
            [o.sales_reference, o.project_title, o.client_name].some((f) => String(f || "").toLowerCase().includes(term))),
      )
      .map((o) => ({
        opportunity_id: o.id,
        sales_reference: o.sales_reference,
        project_title: o.project_title,
        client_name: o.client_name,
      }))
  })

  stubRpc("ipas_sor_headers", (args) => {
    if (!reader) return []
    const wanted = args.p_ipas_ids
    return rowsOf("ipas_sors")
      .filter((s) => !wanted || wanted.includes(s.ipas_id))
      .map((s) => {
        const o = findRow("sales_opportunities", s.opportunity_id)
        return {
          ipas_id: s.ipas_id,
          opportunity_id: s.opportunity_id,
          sales_reference: o?.sales_reference ?? null,
          project_title: o?.project_title ?? null,
          client_name: o?.client_name ?? null,
        }
      })
  })
}
