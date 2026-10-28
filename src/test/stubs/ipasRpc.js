import { stubRpc } from "@/test/msw/server"
import { stubs } from "@/test/msw/postgrest"
import { db, insertRow, updateRow } from "@/test/db/store"
import { pgrstError } from "@/test/db/schema"
import { computeLandedCost } from "@/test/stubs/landedCostFake"

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
 * typed header values. Its approval reset, and the bank-details one (#245),
 * run against the fake `ipas_signoffs` table (#247), which a test seeds with
 * live rows (`db.seed("ipas_signoffs", { ipas_id, section, role, signed_by })`);
 * the stub marks the section 1 and 3 `approved` ones cleared, as the real
 * helper does.
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
 * #246 adds documents (`ipas_suggest_documents`, `ipas_add_document`,
 * `ipas_set_document_attachment`, `ipas_tick_document`, `ipas_remove_document`),
 * Supplier Origin, the typed statuses, Actual Checking and Item Location. A new
 * IPAS gets a row for every active document kind matching its Source, as the
 * database's insert trigger does. `finance: true` is a caller with Finance
 * access (it defaults to `money === true`): only that caller ticks Finance has
 * it, and only `purchasing` ticks Purchasing has it.
 *
 * #247 adds the sign-offs (`ipas_sign`, `ipas_send_back`) against the fake
 * `ipas_signoffs` and `ipas_signer_lists` tables: Prepared needs Purchasing
 * access (`purchasing`), Approved and Send back need the actor on the section's
 * list (seed it with `db.seed("ipas_signer_lists", ...)`), the preparer can't
 * approve, and `ipas_add_payment` sets `paid_before_approval` as the insert
 * trigger does. The fake can't run the real functions' row locks or
 * uniqueness index, so a live sign-off per section and role is enforced here
 * by hand; the real ones are proven in 61-ipas-signoffs.
 *
 * #248 adds section 7 to `ipas_sign` (sections 1 and 3 approved first, Received,
 * then Noted and Checked, then Approved, which needs Costs complete and files the
 * IPAS) and `ipas_reopen` (`superAdmin: true` is a Super Admin). It names who
 * to notify next as the real function does (`stage`, `notify_ids`). The fake
 * can't run the freeze trigger, so what a filed IPAS refuses is proven in
 * 62-ipas-filing.
 *
 * The #241 follow-ups: `ipas_send_back` takes section 7 (any list member, once
 * 1 and 3 are approved, clears Received/Noted/Checked), `ipas_remove_document`
 * refuses a row with a kind, and `ipas_set_signer_list` (`superAdmin: true`)
 * replaces a list and writes `ipas_signer_list_log`.
 *
 * The fake has no signed-in identity, so `actorId` stands in for
 * get_employee_id(). `purchasing: false` is a caller without Purchasing access;
 * `reader: false` one who can't read IPAS.
 *
 * #249 adds `ipas_summaries_for_sor`. `sorReader: false` is a caller who can't
 * read the SOR (the database's gate is `sor_access_level = 'full'`), so it
 * answers with no rows. It is independent of `reader`: a Deal Team member sees
 * the summary without being able to read any IPAS.
 */
export function stubIpasRpcs({
  actorId,
  purchasing = true,
  reader = true,
  money = null,
  bankReader = true,
  finance = undefined,
  superAdmin = false,
  sorReader = true,
  // #283: whether the caller is in the SOR's Costing Matrix money tier (costing_can_read_money).
  costingMoney = false,
} = {}) {
  const hasFinance = finance ?? money === true
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

  /** The insert trigger: a row for every active document kind matching the Source, if missing. Returns the labels added. */
  const suggestDocuments = (ipasId, source) => {
    const held = new Set(rowsOf("ipas_documents").filter((d) => d.ipas_id === ipasId).map((d) => d.kind_id))
    const added = rowsOf("ipas_options")
      .filter((o) => o.list === "document_kind" && o.active !== false && [source, "both"].includes(o.applies_to) && !held.has(o.id))
      .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    for (const kind of added) {
      insertRow("ipas_documents", {
        ipas_id: ipasId,
        kind_id: kind.id,
        label: null,
        attachment_url: null,
        purchasing_has: false,
        finance_has: false,
        created_by: actorId,
      })
    }
    return added.map((o) => o.label)
  }

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

  // #550: a signed-in caller can no longer hand over a copy; the old RPC refuses.
  stubRpc("ipas_create", () => refuse("42501", "ipas_create: an IPAS is raised through the server, which reads the PO from Odoo itself"))

  // What ipas_raise_from_odoo does with the verdict the server heard from Odoo.
  const raiseFromOdoo = (args) => {
    requirePurchasing("ipas_create")
    const po = String(args.p_po_number || "").trim().toUpperCase()
    if (!/^P[0-9]+$/.test(po)) refuse("22023", `ipas_create: ${args.p_po_number} isn't an Odoo PO number`)
    if (args.p_verdict === "not_found") {
      throw pgrstError("22023", `ipas_create: Odoo has no purchase order named ${po}`, { hint: "odoo_not_found" })
    }
    if (args.p_verdict !== "found") {
      throw pgrstError("55000", `ipas_create: Odoo couldn't be asked about ${po}; try again shortly`, { hint: "odoo_unavailable" })
    }
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
    suggestDocuments(row.id, row.source)
    event(row.id, "created", {
      number: row.number,
      po_number: po,
      priority: row.priority,
      source: row.source,
      purpose: row.purpose,
      sor_ids: sors,
    })
    return row
  }

  // The edge function: asks Odoo (the test's stub of `odoo-po-ipas`), then raises.
  stubs.edgeRaise.set("odoo-po-ipas", async (request, ask) => {
    if (request.action === "refresh") return refreshFromOdoo(request, ask)
    const answer = await ask(request.poNumber)
    const verdict = !answer?.success ? "unavailable" : answer.found ? "found" : "not_found"
    try {
      const ipas = raiseFromOdoo({
        p_actor: actorId,
        p_po_number: request.poNumber,
        p_priority: request.priority,
        p_source: request.source,
        p_purpose: request.purpose,
        p_sor_ids: request.sorIds ?? [],
        p_remarks: request.remarks ?? null,
        p_verdict: verdict,
        p_odoo_copy:
          verdict === "found"
            ? { po: answer.po, supplier: answer.supplier, lines: answer.lines ?? [], receipts: answer.receipts ?? null, bills: answer.bills ?? null }
            : null,
      })
      return { success: true, ipas }
    } catch (error) {
      const pg = error?.pgrst ?? {}
      return { success: false, refused: true, code: pg.code, hint: pg.hint ?? null, message: pg.message ?? error.message }
    }
  })

  stubRpc("ipas_set_purpose_and_sors", (args) => {
    requirePurchasing("ipas_set_purpose_and_sors")
    const row = findRow("ipas", args.p_ipas_id)
    if (!row) refuse("P0002", `ipas_set_purpose_and_sors: IPAS ${args.p_ipas_id} not found`)
    if (row.state === "filed") refuse("55000", `ipas_set_purpose_and_sors: ${row.number} is filed`)
    if (row.state === "cancelled") refuse("55000", `ipas_set_purpose_and_sors: ${row.number} is cancelled`)
    const before = sorIdsOf(row.id)
    if (args.p_sor_ids != null) {
      const sent = [...new Set(args.p_sor_ids)].sort()
      if (JSON.stringify(sent) !== JSON.stringify(before)) {
        refuse("22023", `ipas_set_purpose_and_sors: the SORs of ${row.number} can't be changed after it is raised; cancel it and raise a new one`)
      }
    }
    if (args.p_purpose === "project" && before.length === 0) {
      refuse("22023", "ipas_set_purpose_and_sors: a Project IPAS needs at least one SOR, and the SORs can't be changed after it is raised")
    }
    if (args.p_purpose !== "project" && before.length > 0) {
      refuse("22023", `ipas_set_purpose_and_sors: ${row.number} names SORs, so it can only be a Project; the SORs can't be changed after it is raised`)
    }
    if (row.purpose === args.p_purpose) return row

    const from = row.purpose
    const updated = updateRow("ipas", row, { purpose: args.p_purpose })
    event(row.id, "purpose_sors_changed", {
      purpose_from: from,
      purpose_to: args.p_purpose,
      sor_ids_from: before,
      sor_ids_to: before,
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

  const squash = (value) => String(value || "").toLowerCase().replace(/[\s-]/g, "")
  const sorSummary = (o) => ({
    opportunity_id: o.id,
    sor_code: o.sor_code ?? (o.serial_no != null ? `SOR-${o.serial_no}` : null),
    sales_reference: o.sales_reference ?? null,
    project_title: o.project_title,
    current_stage_name: findRow("flow_stages", o.flow_stage_id)?.name ?? null,
  })
  const liveSor = (o) => !o.is_deleted && !o.is_scratch

  // SOR number, SO number (Sales Reference and the older opportunity_no) or
  // project, in any case; an SOR with no SO number is found too (#601).
  stubRpc("ipas_find_sors", (args) => {
    requirePurchasing("ipas_find_sors")
    const refs = (args.p_refs || []).map((r) => String(r).trim().toUpperCase())
    const term = String(args.p_search || "").trim().toLowerCase()
    const squashed = squash(args.p_search)
    return rowsOf("sales_opportunities")
      .filter(liveSor)
      .filter(
        (o) =>
          (o.sales_reference && refs.includes(o.sales_reference)) ||
          (term &&
            ([o.sales_reference, o.opportunity_no, o.project_title].some((f) =>
              String(f || "").toLowerCase().includes(term),
            ) ||
              (squashed && squash(sorSummary(o).sor_code).includes(squashed)))),
      )
      .map(sorSummary)
  })

  // The caller's last five SORs named on an IPAS they raised, newest first.
  stubRpc("ipas_recent_sors", () => {
    requirePurchasing("ipas_recent_sors")
    const mine = new Set(rowsOf("ipas").filter((i) => i.created_by === actorId).map((i) => i.id))
    const seen = new Set()
    const recent = []
    for (const link of [...rowsOf("ipas_sors")].reverse()) {
      if (!mine.has(link.ipas_id) || seen.has(link.opportunity_id)) continue
      seen.add(link.opportunity_id)
      const sor = findRow("sales_opportunities", link.opportunity_id)
      if (sor && liveSor(sor)) recent.push(sorSummary(sor))
    }
    return recent.slice(0, 5)
  })

  stubRpc("ipas_sor_headers", (args) => {
    if (!reader) return []
    // A null or empty id list is nothing, as in the database.
    const wanted = args.p_ipas_ids
    if (!wanted || wanted.length === 0) return []
    return rowsOf("ipas_sors")
      .filter((s) => wanted.includes(s.ipas_id))
      .map((s) => {
        const o = findRow("sales_opportunities", s.opportunity_id)
        return {
          ipas_id: s.ipas_id,
          opportunity_id: s.opportunity_id,
          sales_reference: o?.sales_reference ?? null,
          project_title: o?.project_title ?? null,
          current_stage_name: (o && findRow("flow_stages", o.flow_stage_id)?.name) ?? null,
          sor_code: o?.sor_code ?? (o?.serial_no != null ? `SOR-${o.serial_no}` : null),
        }
      })
  })

  const liveSignoffs = (ipasId) =>
    rowsOf("ipas_signoffs").filter((s) => s.ipas_id === ipasId && !s.cleared_at)

  // #249: the SOR's summary. The database gates it on the SOR read rule, which
  // the fake has no identity for, so `sorReader: false` is a caller who can't
  // read the SOR. It returns exactly the columns the real function does and
  // never a money or bank column.
  // ipas_assert_unchanged (#581): Save all's stale check, over the fake ipas_events rows.
  stubRpc("ipas_assert_unchanged", (args) => {
    if (!args.p_since) return null
    const newer = rowsOf("ipas_events").some(
      (e) =>
        e.ipas_id === args.p_ipas_id &&
        e.created_at > args.p_since &&
        !["odoo_copy_changed", "filled_from_odoo", "odoo_changed_since_filing"].includes(e.kind) &&
        !(e.kind === "approvals_cleared" && e.detail?.reason === "PO changed in Odoo"),
    )
    if (newer) refuse("40001", "ipas_assert_unchanged: someone else saved this IPAS after you opened it. Nothing was saved. Reload to see their changes; what you typed is still here.")
    return null
  })

  // ipas_landed_cost (#283): the IPAS page's Landed Cost, for whoever may read the IPAS. The real
  // maths is the database's; this answers with the fake's copy (landedCostFake.js).
  stubRpc("ipas_landed_cost", (args) => {
    if (!reader) return null
    const row = rowsOf("ipas").find((r) => r.id === args.p_ipas_id)
    if (!row) return null
    return computeLandedCost({
      copy: row.odoo_copy,
      payments: rowsOf("ipas_payments").filter((p) => p.ipas_id === row.id),
      charges: rowsOf("ipas_charges").filter((p) => p.ipas_id === row.id),
      split: row.landed_cost_split || "value",
      computationStatus: row.computation_status || "encoding",
      filed: row.state === "filed",
      referenceRates: rowsOf("currency_rates"),
    })
  })

  stubRpc("ipas_summaries_for_sor", (args) => {
    if (!sorReader) return []
    const sorId = args.p_opportunity_id
    const wanted = new Set(rowsOf("ipas_sors").filter((s) => s.opportunity_id === sorId).map((s) => s.ipas_id))
    const num = (value) => (/^[0-9]+(\.[0-9]+)?$/.test(String(value ?? "")) ? Number(value) : 0)
    const rank = { open: 0, filed: 1, cancelled: 2 }

    return rowsOf("ipas")
      .filter((row) => wanted.has(row.id) && row.purpose === "project")
      .sort((a, b) => (rank[a.state] ?? 2) - (rank[b.state] ?? 2) || String(a.number).localeCompare(String(b.number)))
      .map((row) => {
        const copy = row.odoo_copy ?? {}
        const live = new Set(liveSignoffs(row.id).map((s) => `${s.section}:${s.role}`))
        const hasProof = rowsOf("ipas_payments").some((p) => p.ipas_id === row.id && (p.proof_url ?? "") !== "")
        const total = num(copy.receipts?.total)
        const done = num(copy.receipts?.done)
        const status = copy.receipts?.status
        let received = "none"
        if (status === "partial") received = "partial"
        else if (status === "full" || (total > 0 && done >= total)) received = "received"
        else if (done > 0) received = "partial"

        const item = (key, ticked, partial = false) => ({ key, ticked: Boolean(ticked), partial })
        const track = [
          item("purchase_order", ["purchase", "done"].includes(copy.po?.state)),
          item("with_pop", hasProof),
          ...(row.source === "import" ? [item("import_clearance", row.import_clearance_on)] : []),
          item("delivered", row.delivered_on),
          item("received_in_odoo", received === "received", received === "partial"),
          item("create_bill", num(copy.bills?.count) > 0),
          item("actual_checking", row.actual_checking_by),
        ]
        const roles = (section, names) => Object.fromEntries(names.map((r) => [r, live.has(`${section}:${r}`)]))

        return {
          ipas_id: row.id,
          number: row.number,
          po_number: row.po_number,
          supplier: (copy.supplier?.name ?? "").trim() || null,
          purpose: row.purpose,
          state: row.state,
          buyer_track: track,
          computation_status: row.computation_status ?? "encoding",
          signoffs: {
            1: roles(1, ["prepared", "approved"]),
            3: roles(3, ["prepared", "approved"]),
            6: roles(6, ["prepared", "approved"]),
            7: roles(7, ["received", "noted", "checked", "approved"]),
            8: roles(8, ["approved"]),
          },
          ...summaryLandedCost(row),
        }
      })
  })

  // #283: the IPAS's Landed Cost total and mark, for the matrix's money tier only.
  const summaryLandedCost = (row) => {
    if (!costingMoney) return { landed_cost_total_php: null, landed_cost_mark: null }
    const lc = computeLandedCost({
      copy: row.odoo_copy,
      payments: rowsOf("ipas_payments").filter((p) => p.ipas_id === row.id),
      charges: rowsOf("ipas_charges").filter((p) => p.ipas_id === row.id),
      split: row.landed_cost_split || "value",
      computationStatus: row.computation_status || "encoding",
      filed: row.state === "filed",
      referenceRates: rowsOf("currency_rates"),
    })
    if (lc.lines.length === 0 && lc.status === "unavailable" && lc.reason !== "no_payments") return { landed_cost_total_php: null, landed_cost_mark: null }
    return { landed_cost_total_php: lc.totals?.landedPhp ?? null, landed_cost_mark: lc.status }
  }

  // #265: the dates and Transmittal facts the SOR section needs for each
  // order's standing. The same gate as the summary; dates and slip facts only.
  stubRpc("ipas_standing_for_sor", (args) => {
    if (!sorReader) return []
    const sorId = args.p_opportunity_id
    const wanted = new Set(rowsOf("ipas_sors").filter((s) => s.opportunity_id === sorId).map((s) => s.ipas_id))
    const final = ["lc_odoo_done"]

    return rowsOf("ipas")
      .filter((row) => wanted.has(row.id) && row.purpose === "project")
      .sort((a, b) => String(a.number).localeCompare(String(b.number)))
      .map((row) => {
        const costs = rowsOf("ipas_events")
          .filter((e) => e.ipas_id === row.id && e.kind === "header_changed" && final.includes(e.detail?.fields?.computation_status?.to))
          .map((e) => e.created_at)
          .sort()
          .pop()
        const proofDates = rowsOf("ipas_payments")
          .filter((p) => p.ipas_id === row.id && (p.proof_url ?? "") !== "")
          .map((p) => p.paid_on)
          .sort()
        const slips = rowsOf("transmittals")
          .filter((t) => t.state !== "cancelled")
          .map((t) => ({ t, lines: rowsOf("transmittal_lines").filter((l) => l.transmittal_id === t.id && l.ipas_id === row.id) }))
          .filter(({ lines }) => lines.length > 0)
          .map(({ t, lines }) => ({
            id: t.id,
            number: t.number,
            prepared_on: t.prepared_on,
            created_at: t.created_at,
            submitted_at: t.submitted_at,
            state: t.state,
            check_warehouse: t.check_warehouse,
            check_technical: t.check_technical,
            stages: rowsOf("transmittal_stages")
              .filter((st) => st.transmittal_id === t.id)
              .map((st) => ({ stage: st.stage, completed_at: st.completed_at })),
            lines: lines.map((l) => ({
              ipas_id: l.ipas_id,
              odoo_po_line_id: l.odoo_po_line_id,
              wh_rating: l.wh_rating,
              tech_rating: l.tech_rating,
            })),
          }))
        return {
          ipas_id: row.id,
          source: row.source,
          created_at: row.created_at,
          updated_at: row.updated_at ?? row.created_at,
          costs_completed_at: costs ?? null,
          proof_paid_on: proofDates.pop() ?? null,
          shipped_out_on: row.shipped_out_on ?? null,
          onboard_on: row.onboard_on ?? null,
          arrived_in_ph_on: row.arrived_in_ph_on ?? null,
          arrived_in_whs_on: row.arrived_in_whs_on ?? null,
          import_clearance_on: row.import_clearance_on ?? null,
          delivered_on: row.delivered_on ?? null,
          actual_checking_stamped: Boolean(row.actual_checking_by),
          actual_checking_at: row.actual_checking_at ?? null,
          slips,
          on_hold: row.on_hold === true,
        }
      })
  })

  // #597: Purchasing or Finance sets and clears On-Hold on an open IPAS, with a history event per change.
  stubRpc("ipas_set_on_hold", (args) => {
    if (!canWriteMoney) refuse("42501", "ipas_set_on_hold: only Purchasing or Finance puts an IPAS On-Hold")
    const row = findRow("ipas", args.p_ipas_id)
    if (!row) refuse("22023", `ipas_set_on_hold: IPAS ${args.p_ipas_id} not found`)
    if (row.state === "filed") refuse("22023", `ipas_set_on_hold: ${row.number} is filed; a Super Admin reopens it first`)
    if (row.state === "cancelled") refuse("22023", `ipas_set_on_hold: ${row.number} is cancelled`)
    const onHold = args.p_on_hold === true
    const note = onHold ? String(args.p_note ?? "").trim() || null : null
    if (Boolean(row.on_hold) === onHold && (row.on_hold_note ?? null) === note) return row
    // updateRow edits the stored row in place, so read what it was first.
    const wasOnHold = Boolean(row.on_hold)
    const previousNote = row.on_hold_note ?? null
    const updated = updateRow("ipas", row, { on_hold: onHold, on_hold_note: note })
    event(row.id, !onHold ? "on_hold_cleared" : wasOnHold ? "on_hold_changed" : "on_hold_set", {
      note,
      previous_note: previousNote,
    })
    return updated
  })

  // #712: Purchasing marks the S0 warning checked, with a reason and an event.
  stubRpc("ipas_mark_sor_warning_checked", (args) => {
    if (!canWriteMoney) refuse("42501", "ipas_mark_sor_warning_checked: only Purchasing marks the S0 warning checked")
    const row = findRow("ipas", args.p_ipas_id)
    if (!row) refuse("22023", `ipas_mark_sor_warning_checked: IPAS ${args.p_ipas_id} not found`)
    if (row.state !== "open") refuse("22023", `ipas_mark_sor_warning_checked: ${row.number} is ${row.state}`)
    const reason = String(args.p_reason ?? "").trim()
    if (!reason) refuse("22023", "ipas_mark_sor_warning_checked: give the reason")
    const references = args.p_references ?? []
    const updated = updateRow("ipas", row, {
      sor_warning_checked: { references, reason, by: actorId, at: new Date().toISOString() },
    })
    event(row.id, "sor_warning_checked", { references, reason })
    return updated
  })

  // #597: which of these IPAS have history beyond the system's own entries.
  stubRpc("ipas_worked_on", (args) => {
    const system = ["created", "odoo_copy_changed", "filled_from_odoo", "odoo_changed_since_filing", "on_hold_set", "on_hold_changed", "on_hold_cleared"]
    const wanted = new Set(args.p_ipas_ids ?? [])
    return [
      ...new Set(
        rowsOf("ipas_events")
          .filter((e) => wanted.has(e.ipas_id) && !system.includes(e.kind))
          .filter((e) => !(e.kind === "approvals_cleared" && e.detail?.reason === "PO changed in Odoo"))
          .map((e) => e.ipas_id),
      ),
    ]
  })

  /** The helper both resets share: clears the live approvals of the given stored sections (1 and 3 unless told otherwise; an Account # flag passes only 3), returns { sections, preparers }. */
  const clearApprovals = (ipasId, reason, only = [1, 3]) => {
    const live = liveSignoffs(ipasId)
    const approved = live.filter((s) => only.includes(s.section) && s.role === "approved")
    const sections = [...new Set(approved.map((s) => s.section))].sort()
    for (const s of approved) {
      updateRow("ipas_signoffs", s, { cleared_at: new Date().toISOString(), cleared_by: actorId, cleared_reason: reason })
    }
    const preparers = [
      ...new Set(live.filter((s) => sections.includes(s.section) && s.role === "prepared").map((s) => s.signed_by)),
    ]
    if (sections.length) event(ipasId, "approvals_cleared", { reason, sections })
    return { sections, preparers }
  }

  // The engine behind refresh-on-open. Not an RPC a signed-in caller can make (#550):
  // the odoo-po-ipas edge function calls it after it has read Odoo itself.
  const recordOdooCopy = (args) => {
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

    const { sections, preparers } = note ? clearApprovals(row.id, "PO changed in Odoo") : { sections: [], preparers: [] }

    return { ipas: updated, changed: Boolean(note), filed: false, approvals_cleared: sections, preparer_ids: preparers }
  }

  stubRpc("ipas_record_odoo_copy", () => refuse("42501", "permission denied for function ipas_record_odoo_copy"))

  // The edge function's refresh mode: reads the IPAS's PO from the stubbed Odoo, records it.
  async function refreshFromOdoo(request, ask) {
    const row = findRow("ipas", request.ipasId)
    if (!row) return { success: false, refused: true, code: "22023", message: "That IPAS isn't there." }
    if (row.state === "cancelled") return { success: true, skipped: true }
    let answer
    try {
      answer = await ask(row.po_number)
    } catch (error) {
      return { success: false, message: error?.message ?? "Odoo lookup failed." }
    }
    if (!answer?.success) return { success: false, message: answer?.message ?? "Odoo lookup failed." }
    if (!answer.found) return { success: true, found: false, message: answer.message }
    try {
      const result = recordOdooCopy({
        p_ipas_id: row.id,
        p_odoo_copy: { po: answer.po, supplier: answer.supplier, lines: answer.lines ?? [], receipts: answer.receipts ?? null, bills: answer.bills ?? null },
      })
      return { success: true, refreshed: true, result }
    } catch (error) {
      const pg = error?.pgrst ?? {}
      return { success: false, refused: true, code: pg.code, message: pg.message ?? error.message }
    }
  }

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
    "google_sheet",
    "gantt_chart",
    "remarks",
  ]
  const SPLITS = ["value", "quantity", "equal"]
  const STATUSES = ["encoding", "encoded", "lc_gs_done", "lc_odoo_done"]

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
    // Only Purchasing changes an IPAS (#586: Checked by is gone, so Finance and Super Admins have no way in).
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

    if ("remarks" in fields) {
      const raw = fields.remarks
      if (raw !== null && typeof raw !== "string") refuse("22023", "ipas_set_header: Remarks must be text")
      const to = clean(raw)
      if (to !== (clean(row.remarks) ?? null)) {
        next.remarks = to
        note("remarks", row.remarks, to)
      }
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
        refuse("22023", "ipas_set_header: the computation status is Encoding, Encoded, LC GS Done or LC Odoo Done")
      }
      if (to !== (row.computation_status ?? "encoding")) {
        next.computation_status = to
        note("computation_status", row.computation_status ?? "encoding", to)
      }
    }

    // The section 2 ticks (#241): plain booleans. JSON null and anything else are refused.
    for (const key of ["google_sheet", "gantt_chart"]) {
      if (!(key in fields)) continue
      if (typeof fields[key] !== "boolean") {
        refuse("22023", `ipas_set_header: ${key === "google_sheet" ? "Googlesheet" : "Gantt Chart"} must be ticked or not ticked`)
      }
      if (fields[key] !== Boolean(row[key])) {
        next[key] = fields[key]
        note(key, Boolean(row[key]), fields[key])
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

    let cleared = { sections: [], preparers: [] }
    if (flagged && accountChanged) {
      event(ipas.id, "account_flagged", { previous_ipas_id: previous.ipas.id, previous_number: previous.ipas.number })
      cleared = clearApprovals(ipas.id, "Account # flagged", [3])
    }
    const { sections, preparers } = cleared

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
    else {
      // #604: the pesos taken from the bank may be blank; a figure that is given has to make sense.
      if (php !== null && !(php > 0)) {
        refuse("22023", `${fn}: the pesos taken from the bank must be more than zero, or left blank until the bank statement arrives`)
      }
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
      // The insert trigger: flagged while section 1 has no live Approved.
      paid_before_approval: !liveSignoffs(ipas.id).some((s) => s.section === 1 && s.role === "approved"),
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

  stubRpc("ipas_set_payment_money", (args) => {
    requireMoney("ipas_set_payment_money")
    const before = findRow("ipas_payments", args.p_payment_id)
    if (!before) refuse("P0002", `ipas_set_payment_money: payment ${args.p_payment_id} not found`)
    requireOpenIpas("ipas_set_payment_money", before.ipas_id)
    const rate = args.p_forex_rate == null ? null : Math.round(Number(args.p_forex_rate) * 1e6) / 1e6
    if (rate !== null && !(rate > 0)) refuse("22023", "ipas_set_payment_money: the forex rate must be more than zero")
    return updateRow("ipas_payments", before, {
      forex_rate: rate,
      doc_stamp_php: round2(Number(args.p_doc_stamp_php ?? 0)),
      misc_fee_php: round2(Number(args.p_misc_fee_php ?? 0)),
    })
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

  // ── Documents, Supplier Origin, the buyer track, Item Location (#246) ───

  const documentLabel = (doc) => doc.label ?? optionOf(doc.kind_id)?.label ?? null

  const lockDocument = (fn, id) => {
    const doc = findRow("ipas_documents", id)
    if (!doc) refuse("P0002", `${fn}: document ${id} not found`)
    requireOpenIpas(fn, doc.ipas_id)
    return doc
  }

  stubRpc("ipas_suggest_documents", (args) => {
    requirePurchasing("ipas_suggest_documents")
    const ipas = requireOpenIpas("ipas_suggest_documents", args.p_ipas_id)
    const labels = suggestDocuments(ipas.id, ipas.source)
    if (labels.length) event(ipas.id, "documents_suggested", { source: ipas.source, labels })
    return { added: labels }
  })

  stubRpc("ipas_add_document", (args) => {
    requirePurchasing("ipas_add_document")
    const ipas = requireOpenIpas("ipas_add_document", args.p_ipas_id)
    const label = clean(args.p_label)
    const url = clean(args.p_attachment_url)
    if (args.p_kind_id && label) refuse("22023", "ipas_add_document: pick a document kind or type a name, not both")
    if (!args.p_kind_id && !label) refuse("22023", "ipas_add_document: pick a document kind or type the document's name")
    if (label && label.length > 200) refuse("22023", "ipas_add_document: a document's name is 200 characters at most")
    if (url && !/^https?:\/\//i.test(url)) {
      refuse("22023", "ipas_add_document: the attachment must be a link to the uploaded file")
    }
    const kindLabel = args.p_kind_id ? checkOption("ipas_add_document", args.p_kind_id, "document_kind", null, "document kind") : null

    const mine = rowsOf("ipas_documents").filter((d) => d.ipas_id === ipas.id)
    const clash = args.p_kind_id
      ? mine.some((d) => d.kind_id === args.p_kind_id)
      : mine.some((d) => !d.kind_id && String(d.label).trim().toLowerCase() === label.toLowerCase())
    if (clash) refuse("23505", `ipas_add_document: ${kindLabel ?? label} is already on ${ipas.number}`)

    const row = insertRow("ipas_documents", {
      ipas_id: ipas.id,
      kind_id: args.p_kind_id || null,
      label: args.p_kind_id ? null : label,
      attachment_url: url,
      purchasing_has: false,
      finance_has: false,
      created_by: actorId,
    })
    event(ipas.id, "document_added", {
      document_id: row.id,
      kind_id: row.kind_id,
      label: kindLabel ?? label,
      by_hand: !row.kind_id,
      has_attachment: row.attachment_url !== null,
    })
    return row
  })

  stubRpc("ipas_set_document_attachment", (args) => {
    requirePurchasing("ipas_set_document_attachment")
    const doc = lockDocument("ipas_set_document_attachment", args.p_document_id)
    const url = clean(args.p_attachment_url)
    if (url && !/^https?:\/\//i.test(url)) {
      refuse("22023", "ipas_set_document_attachment: the attachment must be a link to the uploaded file")
    }
    if ((url ?? null) === (doc.attachment_url ?? null)) return doc
    const updated = updateRow("ipas_documents", doc, { attachment_url: url })
    event(doc.ipas_id, url ? "document_attachment_set" : "document_attachment_removed", {
      document_id: doc.id,
      label: documentLabel(updated),
    })
    return updated
  })

  stubRpc("ipas_tick_document", (args) => {
    if (!["purchasing", "finance"].includes(args.p_side)) {
      refuse("22023", "ipas_tick_document: tick Purchasing has it or Finance has it")
    }
    if (typeof args.p_value !== "boolean") refuse("22023", "ipas_tick_document: tick it or untick it")
    // Each tick belongs to its own department; neither flag ticks for the other.
    if (args.p_side === "purchasing" && !purchasing) {
      refuse("42501", "ipas_tick_document: only Purchasing ticks Purchasing has it")
    }
    if (args.p_side === "finance" && !hasFinance) {
      refuse("42501", "ipas_tick_document: only Finance ticks Finance has it")
    }
    const doc = lockDocument("ipas_tick_document", args.p_document_id)
    const column = args.p_side === "purchasing" ? "purchasing_has" : "finance_has"
    if (doc[column] === args.p_value) return doc
    const updated = updateRow("ipas_documents", doc, { [column]: args.p_value })
    event(doc.ipas_id, "document_ticked", {
      document_id: doc.id,
      label: documentLabel(updated),
      side: args.p_side,
      value: args.p_value,
    })
    return updated
  })

  stubRpc("ipas_remove_document", (args) => {
    requirePurchasing("ipas_remove_document")
    const doc = lockDocument("ipas_remove_document", args.p_document_id)
    if (doc.kind_id) {
      refuse(
        "55000",
        `ipas_remove_document: ${documentLabel(doc)} is a listed document kind; only a document added by hand can be removed`,
      )
    }
    if (doc.finance_has) {
      refuse("55000", "ipas_remove_document: Finance has ticked this document; ask Finance to untick it first")
    }
    const rows = rowsOf("ipas_documents")
    rows.splice(rows.indexOf(doc), 1)
    event(doc.ipas_id, "document_removed", {
      document_id: doc.id,
      label: documentLabel(doc),
      purchasing_has: doc.purchasing_has,
      had_attachment: doc.attachment_url !== null && doc.attachment_url !== undefined,
    })
    return doc
  })

  const ORIGIN_KEYS = ["shipped_out_on", "onboard_on", "arrived_in_ph_on", "arrived_in_whs_on"]

  const readDate = (fn, fields, key, label, current) => {
    if (!(key in fields)) return current ?? null
    const raw = fields[key]
    if (raw === null) return null
    if (typeof raw !== "string") refuse("22023", `${fn}: ${label} must be a date`)
    const text = raw.trim()
    if (text === "") return null
    const real = /^\d{4}-\d{2}-\d{2}$/.test(text) && new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) === text
    if (!real) refuse("22023", `${fn}: ${label} must be a date`)
    return text
  }

  stubRpc("ipas_set_supplier_origin", (args) => {
    requirePurchasing("ipas_set_supplier_origin")
    const fields = args.p_fields
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
      refuse("22023", "ipas_set_supplier_origin: the fields must be an object")
    }
    for (const key of Object.keys(fields)) {
      if (!ORIGIN_KEYS.includes(key)) refuse("22023", `ipas_set_supplier_origin: ${key} isn't a Supplier Origin date`)
    }
    const row = requireOpenIpas("ipas_set_supplier_origin", args.p_ipas_id)
    if (row.source !== "import") {
      refuse("22023", `ipas_set_supplier_origin: ${row.number} is a Local IPAS; Supplier Origin is for Import only`)
    }
    const names = { shipped_out_on: "Shipped Out", onboard_on: "Onboard", arrived_in_ph_on: "Arrived in PH", arrived_in_whs_on: "Arrived in Whs." }
    const next = {}
    const changes = {}
    for (const key of ORIGIN_KEYS) {
      next[key] = readDate("ipas_set_supplier_origin", fields, key, names[key], row[key])
      if (next[key] !== (row[key] ?? null)) changes[key] = { from: row[key] ?? null, to: next[key] }
    }
    if (!Object.keys(changes).length) return row
    const updated = updateRow("ipas", row, next)
    event(row.id, "supplier_origin_changed", { fields: changes })
    return updated
  })

  stubRpc("ipas_set_typed_status", (args) => {
    requirePurchasing("ipas_set_typed_status")
    if (!["import_clearance", "delivered"].includes(args.p_status)) {
      refuse("22023", "ipas_set_typed_status: Import Clearance and Delivered are the typed statuses")
    }
    const row = requireOpenIpas("ipas_set_typed_status", args.p_ipas_id)
    if (args.p_status === "import_clearance" && row.source !== "import") {
      refuse("22023", `ipas_set_typed_status: ${row.number} is a Local IPAS; Import Clearance is for Import only`)
    }
    const column = args.p_status === "import_clearance" ? "import_clearance" : "delivered"
    const from = row[`${column}_on`] ?? null
    const to = args.p_date ?? null
    if (from === to) return row
    const updated = updateRow("ipas", row, {
      [`${column}_on`]: to,
      [`${column}_typed_by`]: to === null ? null : actorId,
      [`${column}_typed_at`]: to === null ? null : new Date().toISOString(),
    })
    event(row.id, to === null ? "status_cleared" : "status_typed", { status: args.p_status, from, to })
    return updated
  })

  stubRpc("ipas_stamp_actual_checking", (args) => {
    requirePurchasing("ipas_stamp_actual_checking")
    const stamped = args.p_stamped === undefined ? true : args.p_stamped
    if (stamped === null) refuse("22023", "ipas_stamp_actual_checking: stamp it or clear it")
    const row = requireOpenIpas("ipas_stamp_actual_checking", args.p_ipas_id)
    if (stamped) {
      if (row.actual_checking_by) return row
      const updated = updateRow("ipas", row, { actual_checking_by: actorId, actual_checking_at: new Date().toISOString() })
      event(row.id, "actual_checking_stamped", { by: actorId, at: updated.actual_checking_at })
      return updated
    }
    if (!row.actual_checking_by) return row
    const updated = updateRow("ipas", row, { actual_checking_by: null, actual_checking_at: null })
    event(row.id, "actual_checking_cleared", { was_by: row.actual_checking_by, was_at: row.actual_checking_at })
    return updated
  })

  // ── Sign-offs (#247) ─────────────────────────────────────────────────────

  const LIST_KEY = {
    "1/approved": "s1_approved",
    "3/approved": "s3_approved",
    "6/approved": "s6_approved",
    "7/received": "s7_received",
    "7/noted": "s7_noted",
    "7/checked": "s7_checked",
    "7/approved": "s7_approved",
    "8/approved": "logistics_signed",
  }
  const SEND_BACK_LIST = { 1: "s1_approved", 3: "s3_approved", 6: "s6_approved" }
  const SECTION_7_LISTS = ["s7_received", "s7_noted", "s7_checked", "s7_approved"]
  const onList = (listKey, employeeId) => {
    const member = rowsOf("ipas_signer_lists").some((l) => l.list_key === listKey && l.employee_id === employeeId)
    return member && !findRow("employees", employeeId)?.is_deleted
  }
  const membersOf = (listKeys) => [
    ...new Set(
      rowsOf("ipas_signer_lists")
        .filter(
          (l) =>
            listKeys.includes(l.list_key) && l.employee_id !== actorId && !findRow("employees", l.employee_id)?.is_deleted,
        )
        .map((l) => l.employee_id),
    ),
  ]
  const requireSection = (fn, section) => {
    if (![1, 3, 6, 7].includes(section)) refuse("22023", `${fn}: only sections 1, 2, 3 and 4 can be sent back`)
  }

  stubRpc("ipas_sign", (args) => {
    const { p_section: section, p_role: role } = args
    const sheetHasIt =
      ([1, 3, 6].includes(section) && ["prepared", "approved"].includes(role)) ||
      (section === 8 && role === "approved") ||
      (section === 7 && ["received", "noted", "checked", "approved"].includes(role))
    if (!sheetHasIt) refuse("22023", `ipas_sign: section ${section} has no ${role} sign-off`)
    const ipas = requireOpenIpas("ipas_sign", args.p_ipas_id)

    if (role === "prepared") {
      if (!purchasing) refuse("42501", "ipas_sign: only Purchasing prepares a section")
      if (section === 6 && ipas.computation_status !== "lc_odoo_done") {
        refuse("22023", "ipas_sign: section 3 can be submitted once the Computation status is LC Odoo Done")
      }
    } else if (!onList(LIST_KEY[`${section}/${role}`], actorId)) {
      refuse("42501", "ipas_sign: you are not on the list that may give this sign-off")
    }

    const liveHere = liveSignoffs(ipas.id).filter((s) => s.section === section)
    if (liveHere.some((s) => s.role === role)) {
      refuse("55000", `ipas_sign: section ${section} is already ${role} on ${ipas.number}`)
    }
    if (role === "approved" && section !== 7 && section !== 8) {
      const prepared = liveHere.find((s) => s.role === "prepared")
      if (!prepared) refuse("55000", `ipas_sign: section ${section} hasn't been prepared yet`)
      if (prepared.signed_by === actorId) {
        refuse("42501", `ipas_sign: you prepared section ${section}, so someone else approves it`)
      }
    }
    if (section === 7) {
      const live = liveSignoffs(ipas.id)
      const has = (sec, r) => live.some((s) => s.section === sec && s.role === r)
      if (!has(1, "approved") || !has(3, "approved") || !has(6, "approved") || !has(8, "approved")) {
        refuse("55000", "ipas_sign: section 4 opens once sections 1, 2 and 3 are approved")
      }
      if (["noted", "checked"].includes(role) && !has(7, "received")) {
        refuse("55000", `ipas_sign: Received comes first; ${role[0].toUpperCase()}${role.slice(1)} can only be given after it`)
      }
      if (role === "approved") {
        if (!has(7, "received") || !has(7, "noted") || !has(7, "checked")) {
          refuse("55000", "ipas_sign: Approved needs Received, Noted and Checked first")
        }
        if (ipas.computation_status !== "lc_odoo_done") {
          refuse(
            "55000",
            `ipas_sign: ${ipas.number} can't be filed until LC Odoo Done: Landed Cost is still provisional, and Filing freezes it as final`,
          )
        }
      }
    }

    const declined = Boolean(args.p_decline_signature)
    const signoff = insertRow("ipas_signoffs", {
      ipas_id: ipas.id,
      section,
      role,
      signed_by: actorId,
      signature_declined: declined,
      signature_version: declined ? null : (findRow("employees", actorId)?.signature_path ?? null),
    })
    event(ipas.id, "signed", { section, role, signoff_id: signoff.id, signature_declined: declined })

    let stage = null
    let notify = []
    let filedIpas = ipas
    if (section === 7 && role === "approved") {
      filedIpas = updateRow("ipas", ipas, { state: "filed", filed_at: new Date().toISOString() })
      // Filing clears On-Hold (#597), as the database trigger does.
      if (ipas.on_hold) {
        filedIpas = updateRow("ipas", filedIpas, { on_hold: false, on_hold_note: null })
        event(ipas.id, "on_hold_cleared", { note: null, previous_note: ipas.on_hold_note ?? null, reason: "filed" })
      }
      event(ipas.id, "filed", { computation_status: ipas.computation_status, signoff_id: signoff.id })
      stage = "filed"
    } else if (role === "prepared") {
      stage = "section_prepared"
      notify = membersOf([LIST_KEY[`${section}/approved`]])
    } else if (section === 1 || section === 3 || section === 6 || section === 8) {
      // The last of sections 1, 2 and 3 to be approved opens section 4 (#590).
      const live = liveSignoffs(ipas.id)
      const allApproved = [1, 3, 6, 8].every((sec) => live.some((s) => s.section === sec && s.role === "approved"))
      if (allApproved && !live.some((s) => s.section === 7)) {
        stage = "received_ready"
        notify = membersOf(["s7_received"])
      }
    } else if (role === "received") {
      stage = "noted_checked_ready"
      notify = membersOf(["s7_noted", "s7_checked"])
    } else {
      const counterpart = role === "noted" ? "checked" : "noted"
      if (liveSignoffs(ipas.id).some((s) => s.section === 7 && s.role === counterpart)) {
        stage = "approve_ready"
        notify = membersOf(["s7_approved"])
      }
    }
    return {
      signoff,
      ipas: filedIpas,
      section,
      role,
      stage,
      filed: stage === "filed",
      notify_ids: notify,
    }
  })

  stubRpc("ipas_reopen", (args) => {
    if (!superAdmin) refuse("42501", "ipas_reopen: only a Super Admin reopens a filed IPAS")
    const reason = String(args.p_reason || "").trim()
    if (!reason) refuse("22023", "ipas_reopen: give the reason this IPAS is being reopened")
    const row = findRow("ipas", args.p_ipas_id)
    if (!row) refuse("P0002", `ipas_reopen: IPAS ${args.p_ipas_id} not found`)
    if (row.state !== "filed") refuse("55000", `ipas_reopen: ${row.number} isn't filed`)
    const updated = updateRow("ipas", row, { state: "open", filed_at: null, odoo_changed_since_filing: false })
    const live = liveSignoffs(row.id).filter((s) => s.section === 7)
    for (const s of live) {
      updateRow("ipas_signoffs", s, {
        cleared_at: new Date().toISOString(),
        cleared_by: actorId,
        cleared_reason: `Reopened: ${reason}`,
      })
    }
    const roles = live.map((s) => s.role).sort()
    event(row.id, "reopened", { reason, cleared: roles })
    return { ipas: updated, actor_id: actorId, cleared_roles: roles }
  })

  /** Clears section 4's live Received, Noted and Checked: a returned section no longer backs them. */
  const clearSectionSeven = (ipasId, why) => {
    const live = liveSignoffs(ipasId).filter((s) => s.section === 7 && ["received", "noted", "checked"].includes(s.role))
    for (const s of live) {
      updateRow("ipas_signoffs", s, {
        cleared_at: new Date().toISOString(),
        cleared_by: actorId,
        cleared_reason: why,
      })
    }
    return live
  }

  stubRpc("ipas_send_back", (args) => {
    const reason = String(args.p_reason || "").trim()
    if (!reason) refuse("22023", "ipas_send_back: give a reason, so the people who signed know what to fix")
    requireSection("ipas_send_back", args.p_section)
    const ipas = requireOpenIpas("ipas_send_back", args.p_ipas_id)
    const section = args.p_section
    const sectionSeven = section === 7

    const mayReturn = sectionSeven
      ? SECTION_7_LISTS.some((listKey) => onList(listKey, actorId))
      : onList(SEND_BACK_LIST[section], actorId)
    if (!mayReturn) refuse("42501", `ipas_send_back: only a signer of section ${section} returns it`)

    if (sectionSeven) {
      const everything = liveSignoffs(ipas.id)
      const approved = (sec) => everything.some((s) => s.section === sec && s.role === "approved")
      if (!approved(1) || !approved(3) || !approved(6)) {
        refuse("55000", "ipas_send_back: section 4 isn't open yet; sections 1, 2 and 3 must be approved first")
      }
    }

    const returned = sectionSeven ? ["received", "noted", "checked"] : ["prepared", "approved"]
    const live = liveSignoffs(ipas.id).filter((s) => s.section === section && returned.includes(s.role))
    if (live.length === 0) refuse("55000", `ipas_send_back: section ${section} has nothing to return`)
    for (const s of live) {
      updateRow("ipas_signoffs", s, {
        cleared_at: new Date().toISOString(),
        cleared_by: actorId,
        cleared_reason: `Returned: ${reason}`,
      })
    }
    const roles = live.map((s) => s.role).sort()
    const cascade = sectionSeven ? [] : clearSectionSeven(ipas.id, `Section ${section} returned: ${reason}`)
    const cascadeRoles = cascade.map((s) => s.role).sort()
    event(ipas.id, "sent_back", { section, reason, cleared: roles, cleared_section_7: cascadeRoles })
    const preparers = sectionSeven ? [] : [...new Set(live.filter((s) => s.role === "prepared").map((s) => s.signed_by))]
    const cascadeIds = cascade.map((s) => s.signed_by).filter((id) => id !== actorId)
    const notify = sectionSeven
      ? [...new Set(live.map((s) => s.signed_by).filter((id) => id !== actorId))]
      : [...new Set([...preparers, ...cascadeIds])]
    return {
      ipas,
      section,
      actor_id: actorId,
      cleared_roles: roles,
      cleared_section_7: cascadeRoles,
      preparer_ids: preparers,
      notify_ids: notify,
    }
  })

  stubRpc("ipas_undo_approval", (args) => {
    const reason = String(args.p_reason || "").trim()
    if (!reason) refuse("22023", "ipas_undo_approval: give a reason, so the approver knows why")
    const section = args.p_section
    if (![1, 3, 6].includes(section)) {
      refuse("22023", "ipas_undo_approval: only sections 1, 2 and 3 have an approval to undo")
    }
    const ipas = requireOpenIpas("ipas_undo_approval", args.p_ipas_id)
    if (!onList(SEND_BACK_LIST[section], actorId)) {
      refuse("42501", `ipas_undo_approval: only a signer of section ${section} undoes its approval`)
    }
    const approved = liveSignoffs(ipas.id).find((s) => s.section === section && s.role === "approved")
    if (!approved) refuse("55000", `ipas_undo_approval: section ${section} has no approval to undo`)
    updateRow("ipas_signoffs", approved, {
      cleared_at: new Date().toISOString(),
      cleared_by: actorId,
      cleared_reason: `Approval undone: ${reason}`,
    })
    const cascade = clearSectionSeven(ipas.id, `Section ${section} approval undone: ${reason}`)
    const cascadeRoles = cascade.map((s) => s.role).sort()
    event(ipas.id, "approval_undone", {
      section,
      reason,
      approver_id: approved.signed_by,
      cleared_section_7: cascadeRoles,
    })
    const notify = [
      ...new Set([approved.signed_by, ...cascade.map((s) => s.signed_by)].filter((id) => id && id !== actorId)),
    ]
    return {
      ipas,
      section,
      actor_id: actorId,
      approver_id: approved.signed_by,
      cleared_section_7: cascadeRoles,
      notify_ids: notify,
    }
  })

  // ── The signer lists and their log (#241 follow-up) ──────────────────────

  stubRpc("ipas_set_signer_list", (args) => {
    if (!superAdmin) refuse("42501", "ipas_set_signer_list: only a Super Admin changes who is on a sign-off list")
    const listKey = args.p_list_key
    const keys = ["s1_approved", "s3_approved", "s6_approved", "s7_received", "s7_noted", "s7_checked", "s7_approved"]
    keys.push("transmittal_warehouse", "transmittal_technical", "transmittal_logistics", "transmittal_check_by")
    if (!keys.includes(listKey)) {
      refuse("22023", `ipas_set_signer_list: ${listKey} isn't a sign-off list`)
    }
    const wanted = [...new Set((args.p_employee_ids || []).filter(Boolean))]
    const have = rowsOf("ipas_signer_lists").filter((l) => l.list_key === listKey)
    const haveIds = have.map((l) => l.employee_id)
    const added = wanted.filter((id) => !haveIds.includes(id))
    const removed = haveIds.filter((id) => !wanted.includes(id))
    for (const id of added) {
      const person = findRow("employees", id)
      if (!person || person.is_deleted) refuse("P0002", `ipas_set_signer_list: employee ${id} isn't an active employee`)
    }
    const rows = rowsOf("ipas_signer_lists")
    for (const id of removed) rows.splice(rows.findIndex((l) => l.list_key === listKey && l.employee_id === id), 1)
    for (const id of added) insertRow("ipas_signer_lists", { list_key: listKey, employee_id: id })
    for (const id of removed) {
      insertRow("ipas_signer_list_log", { list_key: listKey, employee_id: id, action: "removed", actor_id: actorId })
    }
    for (const id of added) {
      insertRow("ipas_signer_list_log", { list_key: listKey, employee_id: id, action: "added", actor_id: actorId })
    }
    return { list_key: listKey, added, removed }
  })

  // The options a filed IPAS uses (they can't be renamed). The refusal itself is
  // a trigger the fake can't run; it is proven in 66-ipas-options-filed-guard.
  stubRpc("ipas_filed_option_ids", () => {
    if (!reader) return []
    const filed = new Set(rowsOf("ipas").filter((row) => row.state === "filed").map((row) => row.id))
    const used = new Set()
    for (const row of rowsOf("ipas")) {
      if (!filed.has(row.id)) continue
      if (row.freight_service_id) used.add(row.freight_service_id)
      if (row.item_location_id) used.add(row.item_location_id)
    }
    for (const p of rowsOf("ipas_payments")) if (filed.has(p.ipas_id) && p.method_id) used.add(p.method_id)
    for (const c of rowsOf("ipas_charges")) if (filed.has(c.ipas_id) && c.kind_id) used.add(c.kind_id)
    for (const d of rowsOf("ipas_documents")) if (filed.has(d.ipas_id) && d.kind_id) used.add(d.kind_id)
    return [...used]
  })

  stubRpc("ipas_set_item_location", (args) => {
    requirePurchasing("ipas_set_item_location")
    const row = requireOpenIpas("ipas_set_item_location", args.p_ipas_id)
    const to = args.p_option_id ?? null
    const toLabel = to ? checkOption("ipas_set_item_location", to, "item_location", row.item_location_id, "item location") : null
    if (to === (row.item_location_id ?? null)) return row
    const fromLabel = row.item_location_id ? (optionOf(row.item_location_id)?.label ?? null) : null
    const updated = updateRow("ipas", row, { item_location_id: to })
    event(row.id, "item_location_changed", { from: fromLabel, to: toLabel })
    return updated
  })
}

/**
 * Seeds the migration's option lists (the sheet's real values) into the fake
 * store; the policy tier has the real rows. Returns `{ [list]: { [label]: row } }`.
 */
export function seedIpasOptions(seed) {
  const lists = {
    payment_method: ["Alipay", "Bank Deposit", "Bank TT", "Cash", "Credit Card", "Dated Check", "Petnet", "Western Union", "Alibaba", "Paypal", "Others"],
    charge_kind: ["Brokerage Fee", "Delivery Fee", "Destination Charges", "Duties & Taxes", "Origin Charges", "Processing Fee", "Truck Rental"],
    freight_service: ["Ahead", "AVV", "DHL", "FedEx", "UPS", "Wide Range", "DSV", "TD Express Air", "TD Express Sea", "Other"],
  }
  const out = {}
  for (const [list, labels] of Object.entries(lists)) {
    out[list] = {}
    labels.forEach((label, index) => {
      out[list][label] = seed("ipas_options", { list, label, sort: (index + 1) * 10, active: true })
    })
  }

  // Document kinds (#246): label, the Source it is suggested for, documentation / filing / both.
  const kinds = [
    ["Proforma Invoice", "import", "both"],
    ["Quotation (Local)", "local", "documentation"],
    ["Sales Contract", "both", "documentation"],
    ["BL or Waybill", "import", "documentation"],
    ["Packing List", "import", "documentation"],
    ["Commercial Invoice", "import", "documentation"],
    ["Form E / Form K", "import", "documentation"],
    ["Compliance (Local)", "local", "documentation"],
    ["OR / P.O.P (SS)", "both", "filing"],
    ["Waybill", "import", "filing"],
    ["BIR 2307", "both", "filing"],
    ["Landed / Local Cost (OPC)", "both", "filing"],
    ["Freight Billing", "import", "filing"],
    ["Others", "both", "filing"],
  ]
  out.document_kind = {}
  kinds.forEach(([label, applies_to, used_for], index) => {
    out.document_kind[label] = seed("ipas_options", {
      list: "document_kind",
      label,
      sort: (index + 1) * 10,
      active: true,
      applies_to,
      used_for,
    })
  })

  out.item_location = {}
  ;["BM Office", "Marikina Warehouse"].forEach((label, index) => {
    out.item_location[label] = seed("ipas_options", { list: "item_location", label, sort: (index + 1) * 10, active: true })
  })
  return out
}
