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

  // ---- Issue #253: Warehouse checking, releasing, confirm, Odoo receipt, files

  const employeeName = (id) => findRow("employees", id)?.name ?? null
  const listIds = (key) => rowsOf("ipas_signer_lists").filter((row) => row.list_key === key).map((row) => row.employee_id)
  const onKey = (key) => listIds(key).includes(actorId)
  const stageOf = (transmittalId, stage) =>
    rowsOf("transmittal_stages").find((s) => s.transmittal_id === transmittalId && s.stage === stage) ?? null
  const WAREHOUSE_OPEN = ["warehouse_checking", "warehouse_releasing", "technical_inspection", "awaiting_check"]

  stubRpc("transmittal_stage_list_members", ({ p_transmittal_id, p_list_key }) => {
    if (!findRow("transmittals", p_transmittal_id)) refuse("42501", "transmittal_stage_list_members: that Transmittal doesn't exist or you can't read it")
    return listIds(p_list_key)
      .map((id) => ({ id, name: employeeName(id) }))
      .filter((m) => m.name)
      .sort((a, b) => a.name.localeCompare(b.name))
  })

  stubRpc("transmittal_rate", ({ p_transmittal_id, p_line_ratings }) => {
    const t = findRow("transmittals", p_transmittal_id)
    if (!t) refuse("P0002", "transmittal_rate: that Transmittal doesn't exist")
    if (!onKey("transmittal_warehouse")) refuse("42501", "transmittal_rate: only the Warehouse list rates the lines")
    const stage = stageOf(t.id, "warehouse_checking")
    if (!stage || stage.completed_at != null || t.state !== "warehouse_checking") {
      refuse("42501", `transmittal_rate: Warehouse checking is not open on ${t.number}`)
    }
    let count = 0
    for (const item of p_line_ratings ?? []) {
      const line = rowsOf("transmittal_lines").find((l) => l.id === item.line_id && l.transmittal_id === t.id)
      if (!line) refuse("22023", `transmittal_rate: that line isn't on ${t.number}`)
      const rating = String(item.rating ?? "").toLowerCase()
      if (!["gc", "na"].includes(rating)) refuse("22023", "transmittal_rate: each line is GC or NA")
      const remark = (item.remark ?? "").trim() || null
      if (rating === "na" && !remark) refuse("22023", "transmittal_rate: an NA needs a remark")
      const inCharge = item.in_charge_id ?? actorId
      if (!listIds("transmittal_warehouse").includes(inCharge)) {
        refuse("22023", "transmittal_rate: the in-charge is on the Warehouse list")
      }
      let received = item.quantity_received == null || item.quantity_received === "" ? null : Number(item.quantity_received)
      if (received !== null && received < 0) refuse("22023", "transmittal_rate: a quantity received is zero or more")
      if (received === Number(line.quantity)) received = null
      updateRow("transmittal_lines", line, {
        wh_in_charge_id: inCharge,
        wh_rating: rating,
        wh_remark: remark,
        quantity_received: received,
      })
      count++
    }
    event(t.id, "rated", { number: t.number, lines: count })
    return { id: t.id, number: t.number, rated: count }
  })

  stubRpc("transmittal_complete_stage", ({ p_transmittal_id, p_stage, p_other_signer_id, p_other_signer_name, p_remarks, p_no_pictures_reason, p_sign_as_second }) => {
    const t = findRow("transmittals", p_transmittal_id)
    if (!t) refuse("P0002", "transmittal_complete_stage: that Transmittal doesn't exist")
    if (["closed", "cancelled"].includes(t.state)) refuse("42501", `transmittal_complete_stage: ${t.number} is ${t.state}`)
    if (!["warehouse_checking", "warehouse_releasing"].includes(p_stage)) {
      refuse("22023", "transmittal_complete_stage: the Warehouse signs Warehouse checking or releasing")
    }
    if (!onKey("transmittal_warehouse")) refuse("42501", "transmittal_complete_stage: only the Warehouse list signs the Warehouse stages")

    let stage = stageOf(t.id, p_stage)
    if (!stage) {
      if (p_stage === "warehouse_releasing" && !t.check_technical) {
        insertRow("transmittal_stages", { transmittal_id: t.id, stage: p_stage })
        stage = stageOf(t.id, p_stage) // insertRow returns a copy; update the stored row
      } else {
        refuse("P0002", `transmittal_complete_stage: ${t.number} has no ${p_stage} stage`)
      }
    }
    if (stage.completed_at != null) refuse("42501", `transmittal_complete_stage: the ${p_stage} stage of ${t.number} is already signed`)
    if (p_stage === "warehouse_checking" && t.state !== "warehouse_checking") {
      refuse("42501", `transmittal_complete_stage: Warehouse checking is not open on ${t.number}`)
    }
    if (p_stage === "warehouse_releasing" && t.check_technical && t.state !== "warehouse_releasing") {
      refuse("42501", `transmittal_complete_stage: releasing is not open on ${t.number}`)
    }

    const asSecond = !!p_sign_as_second
    if (asSecond && p_stage === "warehouse_releasing") {
      refuse("22023", "transmittal_complete_stage: the Warehouse signs releasing as Released by")
    }
    const otherList = p_stage === "warehouse_checking" ? "transmittal_warehouse" : t.check_technical ? "transmittal_technical" : null
    if (otherList && (!p_other_signer_id || !listIds(otherList).includes(p_other_signer_id))) {
      refuse(
        "22023",
        p_stage === "warehouse_checking"
          ? "transmittal_complete_stage: name the other signatory from the Warehouse list"
          : "transmittal_complete_stage: Received by is on the Technical list",
      )
    }
    const otherName = p_other_signer_id ? employeeName(p_other_signer_id) : (p_other_signer_name ?? "").trim() || null
    if (!otherName) refuse("22023", "transmittal_complete_stage: name who signs with you")

    const pictures = rowsOf("pms_evidence").filter((e) => e.record_id === stage.id).length
    const reason = (p_no_pictures_reason ?? "").trim() || null
    let naLines = []
    if (p_stage === "warehouse_checking") {
      const lines = rowsOf("transmittal_lines").filter((l) => l.transmittal_id === t.id)
      if (lines.some((l) => !l.wh_rating || !l.wh_in_charge_id)) {
        refuse("22023", `transmittal_complete_stage: lines of ${t.number} still need a GC or NA rating`)
      }
      naLines = lines.filter((l) => l.wh_rating === "na")
    }
    // Every stage: no pictures needs a reason.
    if (pictures === 0 && !reason) {
      refuse("22023", "transmittal_complete_stage: attach a picture or video, or give the reason none")
    }

    const now = new Date().toISOString()
    updateRow("transmittal_stages", stage, {
      remarks: (p_remarks ?? "").trim() || null,
      no_pictures_reason: pictures > 0 ? null : reason,
      completed_by: actorId,
      completed_at: now,
      first_signer_id: asSecond ? p_other_signer_id : actorId,
      first_signed_at: now,
      first_confirmed: !asSecond,
      second_signer_id: asSecond ? actorId : (p_other_signer_id ?? null),
      second_signer_name: asSecond ? employeeName(actorId) : otherName,
      second_signed_at: now,
      second_confirmed: asSecond,
    })

    let nextState = t.state
    let nextList = null
    if (p_stage === "warehouse_checking") {
      nextState = t.check_technical ? "warehouse_releasing" : "awaiting_check"
      nextList = t.check_technical ? "transmittal_warehouse" : "transmittal_check_by"
    } else if (t.check_technical) {
      nextState = "technical_inspection"
      nextList = "transmittal_technical"
    }
    if (nextState !== t.state) updateRow("transmittals", t, { state: nextState })

    const naIds = naLines.length ? [...new Set([t.prepared_by, ...listIds("transmittal_check_by")])] : []
    event(t.id, "stage_signed", { number: t.number, stage: p_stage, state_to: nextState, na_count: naLines.length })
    return {
      id: t.id,
      number: t.number,
      stage: p_stage,
      state: nextState,
      na_count: naLines.length,
      notify_next_list: nextList,
      notify_next_ids: nextList ? listIds(nextList) : [],
      notify_confirm_id: p_other_signer_id ?? null,
      notify_na_ids: naIds,
    }
  })

  stubRpc("transmittal_confirm_signature", ({ p_stage_id, p_confirm }) => {
    const stage = rowsOf("transmittal_stages").find((s) => s.id === p_stage_id)
    if (!stage) refuse("P0002", "transmittal_confirm_signature: that stage doesn't exist")
    if (stage.completed_at == null) refuse("22023", "transmittal_confirm_signature: the stage isn't signed yet")
    // The co-signer's slot: the one the completer didn't take (the open one when a person holds both).
    const open = (slot) => !stage[`${slot}_confirmed`] || stage[`${slot}_signature_declined`]
    let slot = null
    if (stage.first_signer_id === actorId && stage.second_signer_id === actorId) {
      slot = open("first") ? "first" : open("second") ? "second" : null
      if (!slot) refuse("22023", "transmittal_confirm_signature: both signatures are already confirmed")
    } else if (stage.second_signer_id === actorId && actorId !== stage.completed_by) slot = "second"
    else if (stage.first_signer_id === actorId && actorId !== stage.completed_by) slot = "first"
    else refuse("42501", "transmittal_confirm_signature: only the co-signer confirms this signature")
    const confirm = !!p_confirm
    updateRow("transmittal_stages", stage, { [`${slot}_confirmed`]: confirm, [`${slot}_signature_declined`]: !confirm })
    return {
      id: stage.transmittal_id,
      stage_id: p_stage_id,
      confirmed: confirm,
      notify_id: confirm ? null : stage.completed_by,
    }
  })

  stubRpc("transmittal_received_in_odoo", ({ p_transmittal_id, p_ref }) => {
    const t = findRow("transmittals", p_transmittal_id)
    if (!t) refuse("P0002", "transmittal_received_in_odoo: that Transmittal doesn't exist")
    if (!(onKey("transmittal_warehouse") || purchasing)) {
      refuse("42501", "transmittal_received_in_odoo: only the Warehouse list or Purchasing records the Odoo receipt")
    }
    if (!WAREHOUSE_OPEN.includes(t.state)) {
      refuse("22023", `transmittal_received_in_odoo: ${t.number} is ${t.state}; the Odoo receipt is recorded from submission until close`)
    }
    if (t.odoo_received_at) refuse("22023", `transmittal_received_in_odoo: ${t.number} already has its Odoo receipt`)
    const at = new Date().toISOString()
    const ref = (p_ref ?? "").trim() || null
    updateRow("transmittals", t, { odoo_received_by: actorId, odoo_received_at: at, odoo_receipt_ref: ref })
    event(t.id, "received_in_odoo", { number: t.number, receipt_ref: ref })
    return { id: t.id, number: t.number, received_at: at, receipt_ref: ref }
  })

  stubRpc("transmittal_line_refs", ({ p_transmittal_id }) =>
    rowsOf("transmittal_lines")
      .filter((l) => l.transmittal_id === p_transmittal_id)
      .sort((a, b) => a.position - b.position)
      .map((l) => {
        const ipas = l.ipas_id ? findRow("ipas", l.ipas_id) : null
        const sor = l.opportunity_id ? findRow("sales_opportunities", l.opportunity_id) : null
        return {
          line_id: l.id,
          ipas_number: ipas?.number ?? null,
          po_number: ipas?.po_number ?? null,
          sor_id: sor?.id ?? null,
          sor_reference: sor?.sales_reference ?? null,
          sor_project: sor?.project_title ?? null,
        }
      }),
  )

  stubRpc("transmittal_attach_evidence", ({ p_stage_id, p_kind, p_path, p_file_name, p_mime, p_size }) => {
    const stage = rowsOf("transmittal_stages").find((s) => s.id === p_stage_id)
    if (!stage) refuse("P0002", "transmittal_attach_evidence: that stage doesn't exist")
    const t = findRow("transmittals", stage.transmittal_id)
    if (stage.completed_at != null || ["closed", "cancelled"].includes(t.state)) {
      refuse("42501", `transmittal_attach_evidence: the stage of ${t.number} is signed; its files can't change`)
    }
    const listKey = stage.stage === "technical_inspection" ? "transmittal_technical" : "transmittal_warehouse"
    if (!onKey(listKey)) refuse("42501", "transmittal_attach_evidence: only the stage's list adds files")
    if (!["picture", "video"].includes(p_kind)) refuse("22023", "transmittal_attach_evidence: a file is a picture or a video")
    if (!(p_size > 0 && p_size <= 52428800)) refuse("22023", "transmittal_attach_evidence: a file is 50 MB or less")
    if (!p_path || !p_path.startsWith(`${t.id}/${stage.id}/`)) {
      refuse("22023", "transmittal_attach_evidence: that file isn't stored for this stage")
    }
    const row = insertRow("pms_evidence", {
      record_type: "transmittal_stage",
      record_id: stage.id,
      transmittal_id: t.id,
      kind: p_kind,
      storage_path: p_path,
      file_name: (p_file_name ?? "").trim() || "file",
      mime_type: p_mime ?? null,
      size_bytes: p_size,
      uploaded_by: actorId,
    })
    return { id: row.id, transmittal_id: t.id, stage_id: stage.id }
  })

  stubRpc("transmittal_remove_evidence", ({ p_evidence_id }) => {
    const ev = rowsOf("pms_evidence").find((e) => e.id === p_evidence_id)
    if (!ev) refuse("P0002", "transmittal_remove_evidence: that file doesn't exist")
    if (ev.uploaded_by !== actorId) refuse("42501", "transmittal_remove_evidence: only the uploader removes a file")
    const stage = rowsOf("transmittal_stages").find((s) => s.id === ev.record_id)
    if (stage?.completed_at != null) refuse("42501", "transmittal_remove_evidence: the stage is signed; its files can't change")
    deleteRows("pms_evidence", [ev])
    return { id: p_evidence_id, storage_path: ev.storage_path }
  })
}
