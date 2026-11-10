import { stubRpc } from "@/test/msw/server"
import { db, deleteRows, insertRow, updateRow } from "@/test/db/store"
import { pgrstError } from "@/test/db/schema"

const rowsOf = (table) => db.internal.rowsOf(table)
const findRow = (table, id) => rowsOf(table).find((row) => row.id === id)

const refuse = (code, message) => {
  throw pgrstError(code, message)
}

/**
 * Issue #255 — the Packing List RPCs (supabase/migrations/20261015300000_
 * packing_lists.sql) re-implemented against the in-memory store, as
 * stubTransmittalRpcs does, so a service test can make, box and pack a list.
 *
 * `actorId` stands in for get_employee_id(). Making a list needs `purchasing`
 * or a place on the Warehouse list (seed `ipas_signer_lists`). Editing and
 * packing need the creator, `purchasing` or a place on the Warehouse list. Who may read, and the freezes, are
 * the policy tier's to prove.
 */
export function stubPackingListRpcs({ actorId, purchasing = false } = {}) {
  let nextNumber = 1
  const onList = (key) =>
    rowsOf("ipas_signer_lists").some((row) => row.list_key === key && row.employee_id === actorId)

  const event = (listId, kind, detail = {}) =>
    insertRow("pms_handoff_events", {
      record_type: "packing_list",
      record_id: listId,
      actor_id: actorId,
      kind,
      detail,
    })

  const editable = (listId) => {
    const list = findRow("packing_lists", listId)
    if (!list) refuse("P0002", "packing list: no such Packing List")
    if (!(purchasing || list.created_by === actorId || onList("transmittal_warehouse"))) {
      refuse("42501", "packing list: only its creator, Purchasing or the Warehouse list changes a Packing List")
    }
    if (list.state !== "draft") refuse("42501", `packing list: ${list.number} is packed and can't be changed`)
    return list
  }

  const boxesOf = (listId) => rowsOf("packing_list_boxes").filter((b) => b.packing_list_id === listId)
  const contentsOf = (boxId) => rowsOf("packing_list_contents").filter((c) => c.box_id === boxId)

  stubRpc("packing_list_create", ({ p_opportunity_id, p_odoo_delivery_ref }) => {
    if (!(purchasing || onList("transmittal_warehouse"))) {
      refuse("42501", "packing_list_create: only Purchasing, or the Warehouse list, makes a Packing List")
    }
    const sor = findRow("sales_opportunities", p_opportunity_id)
    if (!sor || sor.is_deleted) refuse("22023", "packing_list_create: a Packing List is for one SOR")
    const number = `PKL_${String(nextNumber).padStart(3, "0")}`
    nextNumber += 1
    const row = insertRow("packing_lists", {
      number,
      opportunity_id: p_opportunity_id,
      odoo_delivery_ref: p_odoo_delivery_ref?.trim() || null,
      state: "draft",
      created_by: actorId,
      created_at: new Date().toISOString(),
    })
    event(row.id, "created", { number })
    return { id: row.id, number }
  })

  stubRpc("packing_list_add_box", ({ p_packing_list_id, p_marks, p_seal_no, p_gross_weight_kg }) => {
    editable(p_packing_list_id)
    const boxNo = boxesOf(p_packing_list_id).reduce((max, b) => Math.max(max, b.box_no), 0) + 1
    const box = insertRow("packing_list_boxes", {
      packing_list_id: p_packing_list_id,
      box_no: boxNo,
      marks: p_marks ?? null,
      seal_no: p_seal_no ?? null,
      gross_weight_kg: p_gross_weight_kg ?? null,
    })
    event(p_packing_list_id, "box_added", { box_no: boxNo })
    return { id: box.id, box_no: boxNo }
  })

  stubRpc("packing_list_set_contents", ({ p_box_id, p_contents }) => {
    const box = findRow("packing_list_boxes", p_box_id)
    if (!box) refuse("P0002", "packing list: no such box")
    const list = editable(box.packing_list_id)
    deleteRows("packing_list_contents", contentsOf(box.id))
    ;(p_contents ?? []).forEach((c, index) => {
      const quantity = Number(c.quantity)
      if (!(quantity > 0)) refuse("22023", "packing_list_contents: a quantity above zero")
      insertRow("packing_list_contents", {
        box_id: box.id,
        position: index + 1,
        description: String(c.description ?? "").trim(),
        quantity,
        unit: c.unit ?? null,
        sor_line_snapshot: c.snapshot ?? null,
      })
    })
    event(list.id, "contents_set", { box_no: box.box_no, lines: (p_contents ?? []).length })
    return null
  })

  stubRpc("packing_list_pack", ({ p_packing_list_id }) => {
    const list = editable(p_packing_list_id)
    const boxes = boxesOf(list.id)
    if (boxes.length === 0) refuse("22023", `packing list: ${list.number} has no boxes, so it can't be packed`)
    const empty = boxes.filter((b) => contentsOf(b.id).length === 0)
    if (empty.length > 0) {
      refuse("22023", `packing list: ${list.number} has ${empty.length} box(es) with no contents`)
    }
    updateRow("packing_lists", list, {
      state: "packed",
      packed_by: actorId,
      packed_at: new Date().toISOString(),
    })
    event(list.id, "packed", { number: list.number, boxes: boxes.length })
    return { id: list.id, number: list.number, boxes: boxes.length }
  })
}
