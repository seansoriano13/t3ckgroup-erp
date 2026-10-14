import { stubRpc } from "@/test/msw/server"
import { db, deleteRows, insertRow, updateRow } from "@/test/db/store"
import { pgrstError } from "@/test/db/schema"

const rowsOf = (table) => db.internal.rowsOf(table)
const findRow = (table, id) => rowsOf(table).find((row) => row.id === id)

const refuse = (code, message) => {
  throw pgrstError(code, message)
}

const ORIGINS = ["purchasing", "logistics", "warehouse", "other"]
const PRIORITIES = ["high", "medium", "low"]

/**
 * Issue #252 — the Transmittal RPCs (supabase/migrations/20261015100000_
 * transmittals_tracer.sql) live in Postgres, which the fake database does not
 * execute. Re-implemented here against the in-memory store, as
 * stubIpasRpcs does, so a service test can raise, submit and cancel a slip
 * with the staff lists and IPAS it needs.
 *
 * `actorId` stands in for get_employee_id(). A caller may prepare when
 * `purchasing` is true or they are on the Warehouse or Logistics list (seed
 * those with `db.seed("ipas_signer_lists", ...)`). Who may read, and the
 * freezes, are proven in the policy tier (68-transmittals-tracer.test.js).
 *
 * `superAdmin` is a Super Admin for transmittal_set_first_number. The first
 * number is held here (reset by each call to this stub), since the sequence
 * isn't in the fake database.
 */
export function stubTransmittalRpcs({ actorId, purchasing = false, superAdmin = false } = {}) {
  let nextNumber = 1
  const onList = (key) =>
    rowsOf("ipas_signer_lists").some((row) => row.list_key === key && row.employee_id === actorId)
  const canPrepare = () => purchasing || onList("transmittal_warehouse") || onList("transmittal_logistics")
  const requirePrepare = (fn) => {
    if (!canPrepare()) refuse("42501", `${fn}: only Purchasing, or the Warehouse or Logistics list, raises a Transmittal`)
  }
  const isPreparerOrPurchasing = (row) => row.prepared_by === actorId || purchasing

  const event = (transmittalId, kind, detail) =>
    insertRow("pms_handoff_events", {
      record_type: "transmittal",
      record_id: transmittalId,
      actor_id: actorId,
      kind,
      detail,
    })

  const entityOf = (ipas) => ipas.entity_override?.trim() || ipas.odoo_copy?.po?.company?.trim() || null

  const sorsOf = (ipasId) =>
    rowsOf("ipas_sors")
      .filter((s) => s.ipas_id === ipasId)
      .map((s) => findRow("sales_opportunities", s.opportunity_id))
      .filter(Boolean)
      .map((o) => ({ id: o.id, sales_reference: o.sales_reference, project_title: o.project_title }))

  stubRpc("transmittal_pickable_po_lines", ({ p_search }) => {
    requirePrepare("transmittal_pickable_po_lines")
    const search = (p_search ?? "").trim().toLowerCase()
    return rowsOf("ipas")
      .filter((ipas) => ipas.state !== "cancelled")
      .flatMap((ipas) =>
        (ipas.odoo_copy?.lines ?? [])
          .filter((line) => !search || ipas.po_number.toLowerCase().includes(search) || (line.name ?? "").toLowerCase().includes(search))
          .map((line) => ({
            ipas_id: ipas.id,
            ipas_number: ipas.number,
            po_number: ipas.po_number,
            odoo_po_line_id: line.line_id,
            product_name: line.name ?? null,
            quantity: line.quantity ?? null,
            unit: line.unit ?? null,
            entity: entityOf(ipas),
            sors: sorsOf(ipas.id),
          })),
      )
  })

  /** Writes the header's lines (and products and references), returning the entity warnings. */
  const writeLines = (transmittal, lines) => {
    const warnings = []
    deleteRows(
      "transmittal_lines",
      rowsOf("transmittal_lines").filter((l) => l.transmittal_id === transmittal.id),
    )
    lines.forEach((line, index) => {
      const position = index + 1
      const quantity = Number(line.quantity)
      if (!(quantity > 0)) refuse("22023", `transmittal: line ${position} needs a quantity above zero`)

      if (line.kind === "po_line") {
        const ipas = findRow("ipas", line.ipas_id)
        if (!ipas || ipas.state === "cancelled") refuse("P0002", `transmittal: line ${position} names an IPAS that isn't live`)
        const poLine = (ipas.odoo_copy?.lines ?? []).find((l) => l.line_id === line.odoo_po_line_id)
        if (!poLine) refuse("22023", `transmittal: line ${position} isn't on ${ipas.po_number} Odoo copy`)

        const entity = entityOf(ipas)
        if (entity && entity !== transmittal.entity) {
          warnings.push({ kind: "entity", position, po_number: ipas.po_number, entity })
        }

        let opportunityId = line.opportunity_id ?? null
        if (!opportunityId) {
          const sors = rowsOf("ipas_sors").filter((s) => s.ipas_id === ipas.id)
          if (sors.length === 1) opportunityId = sors[0].opportunity_id
        }

        insertRow("transmittal_lines", {
          transmittal_id: transmittal.id,
          position,
          kind: "po_line",
          ipas_id: ipas.id,
          odoo_po_line_id: poLine.line_id,
          description: (poLine.name ?? "").trim() || `PO line ${poLine.line_id}`,
          quantity,
          unit: poLine.unit ?? null,
          opportunity_id: opportunityId,
          serial_numbers: line.serial_numbers ?? null,
          box_quantity: line.box_quantity ?? null,
        })
      } else if (line.kind === "typed") {
        if (!(line.description ?? "").trim()) refuse("22023", `transmittal: line ${position} needs a description`)
        if (!(line.unit ?? "").trim()) refuse("22023", `transmittal: line ${position} needs a unit`)
        insertRow("transmittal_lines", {
          transmittal_id: transmittal.id,
          position,
          kind: "typed",
          ipas_id: null,
          odoo_po_line_id: null,
          description: line.description.trim(),
          quantity,
          unit: line.unit.trim(),
          opportunity_id: line.opportunity_id ?? null,
          serial_numbers: line.serial_numbers ?? null,
          box_quantity: line.box_quantity ?? null,
        })
      } else {
        refuse("22023", `transmittal: line ${position} has no kind (po_line or typed)`)
      }
    })
    return warnings
  }

  const checkHeader = (fields) => {
    if (!ORIGINS.includes(fields.origin)) refuse("22023", `transmittal: ${fields.origin} isn't an Origin`)
    if (fields.origin === "other" && !(fields.origin_other ?? "").trim()) {
      refuse("22023", "transmittal: Origin Others needs its text")
    }
    if (!fields.check_warehouse && !fields.check_technical) {
      refuse("22023", "transmittal: tick Warehouse or TCA Technical under Checking")
    }
    if (!PRIORITIES.includes(fields.priority)) refuse("22023", `transmittal: ${fields.priority} isn't a Priority`)
    if (!(fields.entity ?? "").trim()) refuse("22023", "transmittal: a Company is needed")
  }

  stubRpc("transmittal_create", ({ p_fields, p_product_ids, p_reference_ids, p_lines }) => {
    requirePrepare("transmittal_create")
    checkHeader(p_fields)
    const number = `TG03-${nextNumber++}`
    const transmittal = insertRow("transmittals", {
      number,
      prepared_on: new Date().toISOString().slice(0, 10),
      origin: p_fields.origin,
      origin_other: p_fields.origin === "other" ? p_fields.origin_other : null,
      check_warehouse: !!p_fields.check_warehouse,
      check_technical: !!p_fields.check_technical,
      check_other: p_fields.check_other ?? null,
      priority: p_fields.priority,
      entity: p_fields.entity.trim(),
      product_other: p_fields.product_other ?? null,
      item_location_id: p_fields.item_location_id ?? null,
      state: "draft",
      prepared_by: actorId,
    })
    ;(p_product_ids ?? []).forEach((option_id) =>
      insertRow("transmittal_products", { transmittal_id: transmittal.id, option_id }),
    )
    ;(p_reference_ids ?? []).forEach((option_id) =>
      insertRow("transmittal_references", { transmittal_id: transmittal.id, option_id }),
    )
    const warnings = writeLines(transmittal, p_lines ?? [])
    event(transmittal.id, "created", { number, lines: (p_lines ?? []).length })
    return { id: transmittal.id, number, warnings }
  })

  stubRpc("transmittal_update_draft", ({ p_transmittal_id, p_fields, p_lines }) => {
    const transmittal = findRow("transmittals", p_transmittal_id)
    if (!transmittal) refuse("P0002", "transmittal_update_draft: that Transmittal doesn't exist")
    requirePrepare("transmittal_update_draft")
    if (!isPreparerOrPurchasing(transmittal)) {
      refuse("42501", "transmittal_update_draft: only the preparer or Purchasing changes a slip")
    }
    if (transmittal.state !== "draft") {
      refuse("42501", `transmittal_update_draft: ${transmittal.number} is ${transmittal.state}; only a draft changes`)
    }
    checkHeader(p_fields)
    updateRow("transmittals", transmittal, {
      origin: p_fields.origin,
      origin_other: p_fields.origin === "other" ? p_fields.origin_other : null,
      check_warehouse: !!p_fields.check_warehouse,
      check_technical: !!p_fields.check_technical,
      priority: p_fields.priority,
      entity: p_fields.entity.trim(),
    })
    const warnings = writeLines(transmittal, p_lines ?? [])
    event(transmittal.id, "draft_updated", { number: transmittal.number })
    return { id: transmittal.id, number: transmittal.number, warnings }
  })

  stubRpc("transmittal_submit", ({ p_transmittal_id }) => {
    const transmittal = findRow("transmittals", p_transmittal_id)
    if (!transmittal) refuse("P0002", "transmittal_submit: that Transmittal doesn't exist")
    requirePrepare("transmittal_submit")
    if (!isPreparerOrPurchasing(transmittal)) {
      refuse("42501", "transmittal_submit: only the preparer or Purchasing submits a slip")
    }
    if (transmittal.state !== "draft") refuse("22023", `transmittal_submit: ${transmittal.number} is already ${transmittal.state}`)
    const lines = rowsOf("transmittal_lines").filter((l) => l.transmittal_id === transmittal.id)
    if (lines.length === 0) refuse("22023", `transmittal_submit: ${transmittal.number} needs at least one line`)

    const first = transmittal.check_warehouse ? "warehouse_checking" : "technical_inspection"
    const notifyList = transmittal.check_warehouse ? "transmittal_warehouse" : "transmittal_technical"
    const stages = []
    if (transmittal.check_warehouse) stages.push("warehouse_checking")
    if (transmittal.check_warehouse && transmittal.check_technical) stages.push("warehouse_releasing")
    if (transmittal.check_technical) stages.push("technical_inspection")
    for (const stage of stages) insertRow("transmittal_stages", { transmittal_id: transmittal.id, stage })

    updateRow("transmittals", transmittal, { state: first, submitted_at: new Date().toISOString() })
    event(transmittal.id, "submitted", { number: transmittal.number, first_stage: first })

    const notifyIds = rowsOf("ipas_signer_lists")
      .filter((row) => row.list_key === notifyList)
      .map((row) => row.employee_id)
    return { id: transmittal.id, number: transmittal.number, state: first, notify_list: notifyList, notify_ids: notifyIds }
  })

  stubRpc("transmittal_cancel", ({ p_transmittal_id, p_reason }) => {
    const transmittal = findRow("transmittals", p_transmittal_id)
    if (!transmittal) refuse("P0002", "transmittal_cancel: that Transmittal doesn't exist")
    if (!isPreparerOrPurchasing(transmittal)) {
      refuse("42501", "transmittal_cancel: only the preparer or Purchasing cancels a slip")
    }
    if (["closed", "cancelled"].includes(transmittal.state)) {
      refuse("22023", `transmittal_cancel: ${transmittal.number} is already ${transmittal.state}`)
    }
    const reason = (p_reason ?? "").trim()
    if (!reason) refuse("22023", "transmittal_cancel: a cancel needs a reason")
    const signed = rowsOf("transmittal_stages").some(
      (s) => s.transmittal_id === transmittal.id && s.completed_at != null,
    )
    if (signed) refuse("42501", `transmittal_cancel: ${transmittal.number} has a signed stage and can't be cancelled`)

    updateRow("transmittals", transmittal, {
      state: "cancelled",
      cancelled_by: actorId,
      cancelled_at: new Date().toISOString(),
      cancel_reason: reason,
    })
    event(transmittal.id, "cancelled", { number: transmittal.number, reason, from_state: transmittal.state })
    return {
      id: transmittal.id,
      number: transmittal.number,
      notify_id: transmittal.prepared_by === actorId ? null : transmittal.prepared_by,
    }
  })

  stubRpc("transmittal_set_first_number", ({ p_number }) => {
    if (!superAdmin) refuse("42501", "transmittal_set_first_number: only a Super Admin sets the first number")
    if (!(p_number >= 1)) refuse("22023", "transmittal_set_first_number: the first number must be 1 or more")
    if (rowsOf("transmittals").length > 0) {
      refuse("42501", "transmittal_set_first_number: a Transmittal already exists; the first number is fixed")
    }
    nextNumber = Number(p_number)
    return { first_number: Number(p_number), number_format: `TG03-${p_number}` }
  })
}
