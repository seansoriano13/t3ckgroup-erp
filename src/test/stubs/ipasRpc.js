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
 * #243 adds the Odoo refresh (`ipas_record_odoo_copy`), the overrides and the
 * typed header values. Sign-offs don't exist until #247, so the approval reset
 * runs against `signoffs`, an array a test fills with live rows
 * (`{ ipas_id, section, role, signed_by, cleared_at }`); the stub marks the
 * section 1 and 3 `approved` ones cleared, as the real function does against
 * `ipas_signoffs`.
 *
 * #244 adds payments and charges (`ipas_add_payment` ... `ipas_remove_charge`)
 * and widens `ipas_set_header`. They read `ipas_options` from the store, so a
 * test seeds the options it uses (`seedIpasOptions`). `money: false` is a caller
 * with neither Purchasing nor Finance access.
 *
 * #245 adds bank details (`ipas_set_bank_details`, `ipas_can_read_bank_details`).
 * The fake runs no row level security, so `bankReader: false` is a caller the
 * database would refuse bank details (a section 7 signer without flags); the
 * stub answers `ipas_can_read_bank_details` with it. The rows live in the fake
 * `ipas_bank_details` table; a test seeds a supplier's earlier IPAS and its bank
 * details there to exercise the flag.
 *
 * The fake has no signed-in identity, so `actorId` stands in for
 * get_employee_id(). `purchasing: false` is a caller without Purchasing access;
 * `reader: false` one who can't read IPAS.
 */
export function stubIpasRpcs({
  actorId,
  purchasing = true,
  reader = true,
  signoffs = [],
  money = null,
  bankReader = true,
} = {}) {
  const requirePurchasing = (fn) => {
    if (!purchasing) refuse("42501", `${fn}: only Purchasing may do this`)
  }

  // Payments and charges: Purchasing access or Finance access. `money` lets a
  // test say the caller holds Finance access without Purchasing.
  const canWriteMoney = money ?? purchasing
  const requireMoney = (fn) => {
    if (!canWriteMoney) refuse("42501", `${fn}: only Purchasing or Finance records payments and charges`)
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

  const clean = (value) => {
    const text = typeof value === "string" ? value.trim() : ""
    return text === "" ? null : text
  }

  /** The trigger: Odoo fills a blank contact and P.I # from the copy. */
  const filledFromCopy = (row, copy) => ({
    supplier_contact: clean(row.supplier_contact) ?? clean(copy?.supplier?.contact),
    pi_number: clean(row.pi_number) ?? clean(copy?.po?.partner_ref),
  })

  const lineKey = (line) => String(line.line_id ?? `p${line.product_id ?? ""}:${line.name ?? ""}`)
  const totalOf = (copy) => (copy.lines || []).reduce((sum, l) => sum + (Number(l.price_subtotal) || 0), 0)
  const stateClass = (copy) => ({ cancel: "cancel", purchase: "ordered", done: "ordered" })[copy?.po?.state] ?? "rfq"

  const digestOf = (copy) =>
    JSON.stringify({
      lines: (copy.lines || [])
        .map((l) => [lineKey(l), l.quantity ?? null, l.price_unit ?? null, l.price_subtotal ?? null])
        .sort((a, b) => (a[0] < b[0] ? -1 : 1)),
      total: totalOf(copy),
      company: copy.po?.company ?? null,
      currency: copy.po?.currency ?? null,
      origin: copy.po?.origin ?? null,
      partner_ref: copy.po?.partner_ref ?? null,
      supplier: copy.supplier?.id ?? null,
      state: stateClass(copy),
    })

  const noteOf = (oldCopy, newCopy, previousFetchedAt) => {
    const olds = new Map((oldCopy.lines || []).map((l) => [lineKey(l), l]))
    const news = new Map((newCopy.lines || []).map((l) => [lineKey(l), l]))
    const brief = (l) => ({ line_id: l.line_id, name: l.name, quantity: l.quantity, price_unit: l.price_unit })
    const added = [...news].filter(([k]) => !olds.has(k)).map(([, l]) => brief(l))
    const removed = [...olds].filter(([k]) => !news.has(k)).map(([, l]) => brief(l))
    const changed = [...news]
      .filter(([k, l]) => olds.has(k) && (olds.get(k).quantity !== l.quantity || olds.get(k).price_unit !== l.price_unit))
      .map(([k, l]) => ({
        line_id: l.line_id,
        name: l.name,
        quantity_from: olds.get(k).quantity,
        quantity_to: l.quantity,
        price_unit_from: olds.get(k).price_unit,
        price_unit_to: l.price_unit,
      }))
    const totalFrom = totalOf(oldCopy)
    const totalTo = totalOf(newCopy)
    if (!added.length && !removed.length && !changed.length && totalFrom === totalTo) return null
    return {
      previous_fetched_at: previousFetchedAt,
      added,
      removed,
      changed,
      total_from: totalFrom,
      total_to: totalTo,
    }
  }

  const odooValueOf = (copy, field) => {
    if (field === "entity") return clean(copy.po?.company)
    if (field === "source_doc") return clean(copy.po?.origin)
    const names = []
    for (const line of copy.lines || []) {
      for (const name of line.analytic || []) if (clean(name) && !names.includes(name)) names.push(name)
    }
    return names.length ? names.join(" \u00b7 ") : null
  }

  const OVERRIDE_COLUMNS = { entity: "entity_override", source_doc: "source_doc_override", analytic: "analytic_override" }

  const requireOpen = (fn, row) => {
    if (!row) refuse("P0002", `${fn}: IPAS not found`)
    if (row.state === "filed") refuse("55000", `${fn}: ${row.number} is filed; a Super Admin reopens it first`)
    if (row.state === "cancelled") refuse("55000", `${fn}: ${row.number} is cancelled`)
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
      ...filledFromCopy({}, copy),
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

  stubRpc("ipas_record_odoo_copy", (args) => {
    if (!reader) refuse("42501", "ipas_record_odoo_copy: you can't read IPAS")
    const copy = args.p_odoo_copy
    if (!copy || typeof copy.po !== "object" || !Array.isArray(copy.lines)) {
      refuse("22023", "ipas_record_odoo_copy: the Odoo copy is missing")
    }
    const row = findRow("ipas", args.p_ipas_id)
    if (!row) refuse("P0002", `ipas_record_odoo_copy: IPAS ${args.p_ipas_id} not found`)
    if (String(copy.po.name || "").trim().toUpperCase() !== row.po_number) {
      refuse("22023", `ipas_record_odoo_copy: the Odoo copy is for ${copy.po.name}, not ${row.po_number}`)
    }
    if (row.state === "cancelled") refuse("55000", `ipas_record_odoo_copy: ${row.number} is cancelled`)

    const digestChanged = digestOf(row.odoo_copy) !== digestOf(copy)

    if (row.state === "filed") {
      let current = row
      if (digestChanged !== Boolean(row.odoo_changed_since_filing)) {
        current = updateRow("ipas", row, { odoo_changed_since_filing: digestChanged })
        if (digestChanged) {
          event(row.id, "odoo_changed_since_filing", { note: noteOf(row.odoo_copy, copy, row.odoo_fetched_at) })
        }
      }
      return { ipas: current, changed: false, filed: true, approvals_cleared: [], preparer_ids: [] }
    }

    // updateRow edits the stored row in place: keep what it was.
    const before = { ...row }
    const note = noteOf(before.odoo_copy, copy, before.odoo_fetched_at)
    const stateFrom = stateClass(before.odoo_copy)
    const stateTo = stateClass(copy)
    const filled = filledFromCopy(before, copy)
    const updated = updateRow("ipas", row, {
      odoo_copy: copy,
      odoo_fetched_at: new Date().toISOString(),
      odoo_po_id: copy.po.id ?? row.odoo_po_id,
      odoo_change_note: note ? { ...note, at: new Date().toISOString() } : (before.odoo_change_note ?? null),
      ...filled,
    })

    const filledFields = ["supplier_contact", "pi_number"].filter((f) => clean(before[f]) !== filled[f])
    if (filledFields.length) event(row.id, "filled_from_odoo", { fields: filledFields })
    if (note || stateFrom !== stateTo) {
      event(row.id, "odoo_copy_changed", { note, po_state_from: before.odoo_copy.po?.state, po_state_to: copy.po.state })
    }

    let sections = []
    let preparers = []
    if (note) {
      const live = signoffs.filter((s) => s.ipas_id === row.id && !s.cleared_at)
      const approved = live.filter((s) => [1, 3].includes(s.section) && s.role === "approved")
      sections = [...new Set(approved.map((s) => s.section))].sort()
      for (const s of approved) {
        s.cleared_at = new Date().toISOString()
        s.cleared_reason = "PO changed in Odoo"
      }
      preparers = [
        ...new Set(
          live.filter((s) => sections.includes(s.section) && s.role === "prepared" && s.signed_by).map((s) => s.signed_by),
        ),
      ]
      if (sections.length) event(row.id, "approvals_cleared", { reason: "PO changed in Odoo", sections })
    }

    return { ipas: updated, changed: Boolean(note), filed: false, approvals_cleared: sections, preparer_ids: preparers }
  })

  stubRpc("ipas_override_field", (args) => {
    requirePurchasing("ipas_override_field")
    const column = OVERRIDE_COLUMNS[args.p_field]
    if (!column) refuse("22023", `ipas_override_field: ${args.p_field} can't be overridden`)
    const value = clean(args.p_value)
    if (!value) refuse("22023", "ipas_override_field: type a value, or reset the field to Odoo")
    const row = findRow("ipas", args.p_ipas_id)
    requireOpen("ipas_override_field", row)
    if (row[column] === value) return row
    const from = row[column] ?? null
    const updated = updateRow("ipas", row, { [column]: value })
    event(row.id, "override_set", { field: args.p_field, from, to: value, odoo: odooValueOf(row.odoo_copy, args.p_field) })
    return updated
  })

  stubRpc("ipas_reset_override", (args) => {
    requirePurchasing("ipas_reset_override")
    const column = OVERRIDE_COLUMNS[args.p_field]
    if (!column) refuse("22023", `ipas_reset_override: ${args.p_field} isn't an overridable field`)
    const row = findRow("ipas", args.p_ipas_id)
    requireOpen("ipas_reset_override", row)
    if (row[column] == null) return row
    const from = row[column]
    const updated = updateRow("ipas", row, { [column]: null })
    event(row.id, "override_reset", { field: args.p_field, from, odoo: odooValueOf(row.odoo_copy, args.p_field) })
    return updated
  })

  const HEADER_KEYS = [
    "supplier_contact",
    "pi_number",
    "pi_qt_amount",
    "freight_service_id",
    "landed_cost_split",
    "computation_status",
  ]
  const SPLITS = ["value", "quantity", "equal"]
  const STATUSES = ["encoding", "encoded", "costs_complete", "checked"]

  const optionOf = (id) => findRow("ipas_options", id)

  /** _ipas_check_option: an option of the list; a deactivated one only if the row already holds it. */
  const checkOption = (fn, id, list, current, what) => {
    const option = id ? optionOf(id) : null
    if (!option || option.list !== list) refuse("22023", `${fn}: pick a ${what}`)
    if (option.active === false && id !== current) {
      refuse("22023", `${fn}: ${option.label} is deactivated; pick another ${what}`)
    }
    return option.label
  }

  const isPhpCopy = (copy) => String(copy?.po?.currency ?? "").trim().toUpperCase() === "PHP"
  const round2 = (n) => Math.round(n * 100) / 100

  stubRpc("ipas_set_header", (args) => {
    requirePurchasing("ipas_set_header")
    const fields = args.p_fields
    if (!fields || typeof fields !== "object") refuse("22023", "ipas_set_header: the fields must be an object")
    for (const key of Object.keys(fields)) {
      if (!HEADER_KEYS.includes(key)) {
        refuse("22023", `ipas_set_header: ${key} isn't a header field you can type here`)
      }
    }
    const row = findRow("ipas", args.p_ipas_id)
    requireOpen("ipas_set_header", row)

    const next = {}
    const changes = {}
    const note = (key, from, to, extra = {}) => {
      changes[key] = { from: from ?? null, to: to ?? null, ...extra }
    }

    for (const key of ["supplier_contact", "pi_number"]) {
      if (!(key in fields)) continue
      const to = clean(fields[key])
      if (to !== (clean(row[key]) ?? null)) {
        next[key] = to
        note(key, row[key], to)
      }
    }

    if ("pi_qt_amount" in fields) {
      const raw = fields.pi_qt_amount
      let to = null
      if (raw === null || raw === undefined) to = null
      else if (typeof raw === "number") to = round2(raw)
      else if (typeof raw === "string") {
        const text = raw.replace(/,/g, "").trim()
        if (text === "") to = null
        else if (/^[0-9]+(\.[0-9]+)?$/.test(text)) to = round2(Number(text))
        else refuse("22023", "ipas_set_header: P.I/QT Amount must be a number")
      } else refuse("22023", "ipas_set_header: P.I/QT Amount must be a number")
      if (to !== null && to < 0) refuse("22023", "ipas_set_header: P.I/QT Amount can't be negative")
      if (to !== (row.pi_qt_amount ?? null)) {
        next.pi_qt_amount = to
        note("pi_qt_amount", row.pi_qt_amount, to)
      }
    }

    if ("freight_service_id" in fields) {
      const to = clean(fields.freight_service_id)
      if (to !== null) checkOption("ipas_set_header", to, "freight_service", row.freight_service_id, "freight service")
      if (to !== (row.freight_service_id ?? null)) {
        next.freight_service_id = to
        note("freight_service_id", optionOf(row.freight_service_id)?.label ?? null, to ? optionOf(to).label : null)
      }
    }

    if ("landed_cost_split" in fields) {
      const to = fields.landed_cost_split
      if (!SPLITS.includes(to)) {
        refuse("22023", "ipas_set_header: Landed Cost is spread by value, by quantity or equally")
      }
      if (to !== (row.landed_cost_split ?? "value")) {
        next.landed_cost_split = to
        note("landed_cost_split", row.landed_cost_split ?? "value", to)
      }
    }

    if ("computation_status" in fields) {
      const to = fields.computation_status
      if (!STATUSES.includes(to)) {
        refuse("22023", "ipas_set_header: the computation status is Encoding, Encoded, Costs complete or Checked")
      }
      if (to !== (row.computation_status ?? "encoding")) {
        next.computation_status = to
        note("computation_status", row.computation_status ?? "encoding", to)
      }
    }

    if (!Object.keys(changes).length) return row
    const updated = updateRow("ipas", row, next)
    event(row.id, "header_changed", { fields: changes })
    return updated
  })

  // ── Bank details (#245) ──────────────────────────────────────────────────

  stubRpc("ipas_can_read_bank_details", () => bankReader)

  /** _ipas_account_key: spaces and dashes stripped. */
  const accountKey = (value) => String(value ?? "").replace(/[\s-]/g, "")

  stubRpc("ipas_set_bank_details", (args) => {
    requirePurchasing("ipas_set_bank_details")
    const ipas = findRow("ipas", args.p_ipas_id)
    requireOpen("ipas_set_bank_details", ipas)

    const bank = clean(args.p_bank_name)
    const name = clean(args.p_account_name)
    const number = clean(args.p_account_number)
    const key = accountKey(number)
    const partner = ipas.odoo_copy?.supplier?.id == null ? null : String(ipas.odoo_copy.supplier.id)

    // The supplier's most recent other IPAS, not cancelled, with an Account # typed.
    let previous = null
    if (key !== "" && partner !== null) {
      const candidates = rowsOf("ipas_bank_details")
        .filter((b) => b.ipas_id !== ipas.id && accountKey(b.account_number) !== "")
        .map((b) => ({ bank: b, ipas: findRow("ipas", b.ipas_id) }))
        .filter(
          ({ ipas: other }) =>
            other && other.state !== "cancelled" && String(other.odoo_copy?.supplier?.id ?? "") === partner,
        )
        // Newest first; rows created in the same millisecond go by insertion order.
        .sort(
          (a, b) =>
            String(b.ipas.created_at).localeCompare(String(a.ipas.created_at)) ||
            rowsOf("ipas").indexOf(b.ipas) - rowsOf("ipas").indexOf(a.ipas),
        )
      previous = candidates[0] ?? null
    }
    const flagged = previous ? accountKey(previous.bank.account_number) !== key : false

    const before = rowsOf("ipas_bank_details").find((b) => b.ipas_id === ipas.id) ?? null
    const accountChanged = accountKey(before?.account_number) !== key
    const fields = []
    if (before) {
      if (bank !== (before.bank_name ?? null)) fields.push("bank_name")
      if (name !== (before.account_name ?? null)) fields.push("account_name")
      if (number !== (before.account_number ?? null)) fields.push("account_number")
      if (!fields.length && flagged === Boolean(before.account_flagged)) {
        return {
          bank_details: before,
          flagged: Boolean(before.account_flagged),
          account_changed: false,
          approvals_cleared: [],
          preparer_ids: [],
        }
      }
    } else {
      if (bank) fields.push("bank_name")
      if (name) fields.push("account_name")
      if (number) fields.push("account_number")
    }

    const values = {
      bank_name: bank,
      account_name: name,
      account_number: number,
      account_flagged: flagged,
      updated_by: actorId,
    }
    const wasFlagged = before ? Boolean(before.account_flagged) : false
    const row = before
      ? updateRow("ipas_bank_details", before, values)
      : insertRow("ipas_bank_details", { ipas_id: ipas.id, ...values })

    // What changed, never the values.
    event(ipas.id, before ? "bank_details_changed" : "bank_details_set", {
      fields,
      account_changed: accountChanged,
      flagged,
      was_flagged: wasFlagged,
    })

    let sections = []
    let preparers = []
    if (flagged && accountChanged) {
      event(ipas.id, "account_flagged", { previous_ipas_id: previous.ipas.id, previous_number: previous.ipas.number })
      const live = signoffs.filter((s) => s.ipas_id === ipas.id && !s.cleared_at)
      const approved = live.filter((s) => [1, 3].includes(s.section) && s.role === "approved")
      sections = [...new Set(approved.map((s) => s.section))].sort()
      for (const s of approved) {
        s.cleared_at = new Date().toISOString()
        s.cleared_reason = "Account # flagged"
      }
      preparers = [
        ...new Set(
          live.filter((s) => sections.includes(s.section) && s.role === "prepared" && s.signed_by).map((s) => s.signed_by),
        ),
      ]
      if (sections.length) event(ipas.id, "approvals_cleared", { reason: "Account # flagged", sections })
    }

    return { bank_details: row, flagged, account_changed: accountChanged, approvals_cleared: sections, preparer_ids: preparers }
  })

  // ── Payments and charges (#244) ──────────────────────────────────────────

  const requireOpenIpas = (fn, id) => {
    const row = findRow("ipas", id)
    requireOpen(fn, row)
    return row
  }

  const cleanPayment = (fn, ipas, args, currentMethod) => {
    if (!["down_payment", "payment", "full_payment", "shipping_fee"].includes(args.p_kind)) {
      refuse("22023", `${fn}: ${args.p_kind ?? "null"} isn't a payment kind`)
    }
    if (!args.p_paid_on) refuse("22023", `${fn}: give the date of the payment`)
    const amount = args.p_amount == null ? null : round2(Number(args.p_amount))
    if (amount === null || !(amount > 0)) refuse("22023", `${fn}: the amount must be more than zero`)
    const fee = round2(Number(args.p_charge_fee_php ?? 0))
    if (fee < 0) refuse("22023", `${fn}: the charge fee can't be negative`)

    let php = args.p_php_debited == null ? null : round2(Number(args.p_php_debited))
    if (isPhpCopy(ipas.odoo_copy)) php = null
    else if (php === null || !(php > 0)) {
      refuse("22023", `${fn}: ${ipas.number} is a foreign-currency PO; give the PHP actually debited`)
    }
    const label = checkOption(fn, args.p_method_id, "payment_method", currentMethod, "payment method")
    const proof = clean(args.p_proof_url)
    if (proof && !/^https?:\/\//i.test(proof)) {
      refuse("22023", `${fn}: the proof of payment must be a link to the uploaded file`)
    }
    return { amount, php, fee, label, proof }
  }

  stubRpc("ipas_add_payment", (args) => {
    requireMoney("ipas_add_payment")
    const ipas = requireOpenIpas("ipas_add_payment", args.p_ipas_id)
    const clean_ = cleanPayment("ipas_add_payment", ipas, args, null)
    const row = insertRow("ipas_payments", {
      ipas_id: ipas.id,
      kind: args.p_kind,
      paid_on: args.p_paid_on,
      amount: clean_.amount,
      php_debited: clean_.php,
      charge_fee_php: clean_.fee,
      method_id: args.p_method_id,
      check_no: clean(args.p_check_no),
      proof_url: clean_.proof,
      paid_before_approval: false,
      created_by: actorId,
    })
    event(ipas.id, "payment_added", {
      payment_id: row.id,
      kind: row.kind,
      paid_on: row.paid_on,
      amount: row.amount,
      php_debited: row.php_debited,
      charge_fee_php: row.charge_fee_php,
      method_id: row.method_id,
      method: clean_.label,
      check_no: row.check_no,
      has_proof: row.proof_url !== null,
      currency: ipas.odoo_copy?.po?.currency ?? null,
    })
    return row
  })

  stubRpc("ipas_update_payment", (args) => {
    requireMoney("ipas_update_payment")
    const before = findRow("ipas_payments", args.p_payment_id)
    if (!before) refuse("P0002", `ipas_update_payment: payment ${args.p_payment_id} not found`)
    const ipas = requireOpenIpas("ipas_update_payment", before.ipas_id)
    const c = cleanPayment("ipas_update_payment", ipas, args, before.method_id)
    const checkNo = clean(args.p_check_no)

    const changes = {}
    const diff = (key, from, to) => {
      if ((from ?? null) !== (to ?? null)) changes[key] = { from: from ?? null, to: to ?? null }
    }
    diff("kind", before.kind, args.p_kind)
    diff("paid_on", before.paid_on, args.p_paid_on)
    diff("amount", before.amount, c.amount)
    diff("php_debited", before.php_debited, c.php)
    diff("charge_fee_php", before.charge_fee_php, c.fee)
    if (before.method_id !== args.p_method_id) {
      changes.method = { from: optionOf(before.method_id)?.label ?? null, to: c.label }
    }
    diff("check_no", before.check_no, checkNo)
    if (Boolean(before.proof_url) !== Boolean(c.proof) || (before.proof_url ?? null) !== (c.proof ?? null)) {
      changes.proof = { from: before.proof_url !== null && before.proof_url !== undefined, to: c.proof !== null }
    }
    if (!Object.keys(changes).length) return before

    const updated = updateRow("ipas_payments", before, {
      kind: args.p_kind,
      paid_on: args.p_paid_on,
      amount: c.amount,
      php_debited: c.php,
      charge_fee_php: c.fee,
      method_id: args.p_method_id,
      check_no: checkNo,
      proof_url: c.proof,
    })
    event(ipas.id, "payment_changed", { payment_id: updated.id, kind: updated.kind, changes })
    return updated
  })

  stubRpc("ipas_remove_payment", (args) => {
    requireMoney("ipas_remove_payment")
    const row = findRow("ipas_payments", args.p_payment_id)
    if (!row) refuse("P0002", `ipas_remove_payment: payment ${args.p_payment_id} not found`)
    const ipas = requireOpenIpas("ipas_remove_payment", row.ipas_id)
    const rows = rowsOf("ipas_payments")
    rows.splice(rows.indexOf(row), 1)
    event(ipas.id, "payment_removed", {
      payment_id: row.id,
      kind: row.kind,
      paid_on: row.paid_on,
      amount: row.amount,
      php_debited: row.php_debited,
      charge_fee_php: row.charge_fee_php,
      method: optionOf(row.method_id)?.label ?? null,
      check_no: row.check_no,
      had_proof: Boolean(row.proof_url),
      currency: ipas.odoo_copy?.po?.currency ?? null,
    })
    return row
  })

  const cleanCharge = (fn, args, currentKind) => {
    if (!args.p_charged_on) refuse("22023", `${fn}: give the date of the charge`)
    const amount = args.p_amount_php == null ? null : round2(Number(args.p_amount_php))
    if (amount === null || !(amount > 0)) refuse("22023", `${fn}: the amount must be more than zero`)
    const label = checkOption(fn, args.p_kind_id, "charge_kind", currentKind, "charge kind")
    return { amount, label }
  }

  stubRpc("ipas_add_charge", (args) => {
    requireMoney("ipas_add_charge")
    const ipas = requireOpenIpas("ipas_add_charge", args.p_ipas_id)
    const c = cleanCharge("ipas_add_charge", args, null)
    const row = insertRow("ipas_charges", {
      ipas_id: ipas.id,
      kind_id: args.p_kind_id,
      charged_on: args.p_charged_on,
      amount_php: c.amount,
      created_by: actorId,
    })
    event(ipas.id, "charge_added", {
      charge_id: row.id,
      kind_id: row.kind_id,
      kind: c.label,
      charged_on: row.charged_on,
      amount_php: row.amount_php,
    })
    return row
  })

  stubRpc("ipas_update_charge", (args) => {
    requireMoney("ipas_update_charge")
    const before = findRow("ipas_charges", args.p_charge_id)
    if (!before) refuse("P0002", `ipas_update_charge: charge ${args.p_charge_id} not found`)
    const ipas = requireOpenIpas("ipas_update_charge", before.ipas_id)
    const c = cleanCharge("ipas_update_charge", args, before.kind_id)

    const changes = {}
    if (before.kind_id !== args.p_kind_id) {
      changes.kind = { from: optionOf(before.kind_id)?.label ?? null, to: c.label }
    }
    if (before.charged_on !== args.p_charged_on) {
      changes.charged_on = { from: before.charged_on, to: args.p_charged_on }
    }
    if (before.amount_php !== c.amount) changes.amount_php = { from: before.amount_php, to: c.amount }
    if (!Object.keys(changes).length) return before

    const updated = updateRow("ipas_charges", before, {
      kind_id: args.p_kind_id,
      charged_on: args.p_charged_on,
      amount_php: c.amount,
    })
    event(ipas.id, "charge_changed", { charge_id: updated.id, kind: c.label, changes })
    return updated
  })

  stubRpc("ipas_remove_charge", (args) => {
    requireMoney("ipas_remove_charge")
    const row = findRow("ipas_charges", args.p_charge_id)
    if (!row) refuse("P0002", `ipas_remove_charge: charge ${args.p_charge_id} not found`)
    const ipas = requireOpenIpas("ipas_remove_charge", row.ipas_id)
    const rows = rowsOf("ipas_charges")
    rows.splice(rows.indexOf(row), 1)
    event(ipas.id, "charge_removed", {
      charge_id: row.id,
      kind: optionOf(row.kind_id)?.label ?? null,
      charged_on: row.charged_on,
      amount_php: row.amount_php,
    })
    return row
  })
}

/**
 * Seeds the migration's option lists into the fake store (the policy tier has
 * the real rows). Returns `{ [list]: { [label]: row } }`.
 */
export function seedIpasOptions(seed) {
  const lists = {
    payment_method: ["Alipay", "Bank Transfer", "Cash", "Check", "Credit Card", "GCash", "PayPal", "Telegraphic Transfer", "Other"],
    charge_kind: [
      "Brokerage Fee",
      "Duties & Taxes",
      "Destination Charges",
      "Arrastre & Wharfage",
      "Documentary Stamps",
      "Delivery / Trucking",
      "Other Charges",
    ],
    freight_service: [
      "DHL Express",
      "FedEx",
      "UPS",
      "Air Freight Forwarder",
      "Sea Freight Forwarder",
      "Local Courier",
      "Supplier Delivery",
      "Own Pickup",
      "Other",
    ],
  }
  const out = {}
  for (const [list, labels] of Object.entries(lists)) {
    out[list] = {}
    labels.forEach((label, index) => {
      out[list][label] = seed("ipas_options", { list, label, sort: (index + 1) * 10, active: true })
    })
  }
  return out
}
