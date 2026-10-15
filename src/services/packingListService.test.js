import { beforeEach, describe, expect, it } from "vitest"
import { packingListService, sorLineSnapshot } from "./packingListService"
import { db } from "@/test/db/store"
import { stubPackingListRpcs } from "@/test/stubs/packingListRpc"
import { makeEmployee, makeOpportunity } from "@/test/factories"

/**
 * Packing Lists (#255, spec #251) through the service, against the fake
 * database with the RPCs re-implemented on its store (stubPackingListRpcs).
 * The rules and the freeze are the policy tier's; this proves the wiring: the
 * create rule, the snapshot a content keeps, and the pack refusal.
 */

const signerOn = (listKey, employeeId) => db.seed("ipas_signer_lists", { list_key: listKey, employee_id: employeeId })

describe("packingListService", () => {
  let buyer

  beforeEach(() => {
    buyer = makeEmployee({ name: "Buyer", has_purchasing_flow: true })
    stubPackingListRpcs({ actorId: buyer.id, purchasing: true })
  })

  it("lets a Warehouse-list member with no flags make a list, and refuses an employee with neither access nor the list", async () => {
    const sor = makeOpportunity({ sales_reference: "S07920" })
    const warehouse = makeEmployee({ name: "Warehouse" })
    const ordinary = makeEmployee({ name: "Ordinary" })
    signerOn("transmittal_warehouse", warehouse.id)

    stubPackingListRpcs({ actorId: warehouse.id })
    const made = await packingListService.create({ opportunityId: sor.id, odooDeliveryRef: " TG En/OUT/03390 " })
    expect(made.number).toMatch(/^PKL_\d{3}$/)
    expect(db.internal.rowsOf("packing_lists")[0]).toMatchObject({
      number: made.number,
      state: "draft",
      odoo_delivery_ref: "TG En/OUT/03390",
    })

    stubPackingListRpcs({ actorId: ordinary.id })
    await expect(packingListService.create({ opportunityId: sor.id })).rejects.toMatchObject({ code: "42501" })
  })

  it("keeps the SOR line a content was picked from after the SOR's lines change", async () => {
    const sor = makeOpportunity()
    const { id: listId } = await packingListService.create({ opportunityId: sor.id })
    const { id: boxId } = await packingListService.addBox(listId, { marks: "A", sealNo: "S-1", grossWeightKg: 12.5 })

    await packingListService.setContents(boxId, [
      {
        description: "Full Body Harness",
        quantity: 4,
        unit: "pc",
        snapshot: sorLineSnapshot({ product_name: "Full Body Harness", quantity: 10, unit: "pc" }),
      },
      { description: "Spare straps", quantity: 2, unit: "pc", snapshot: null },
    ])

    // The SOR's Product List changing after the pick cannot reach the copy kept here.
    const contents = db.internal.rowsOf("packing_list_contents").filter((c) => c.box_id === boxId)
    expect(contents).toHaveLength(2)
    expect(contents[0].sor_line_snapshot).toEqual({ name: "Full Body Harness", quantity: 10, unit: "pc" })
    expect(contents[1].sor_line_snapshot).toBeNull()
  })

  it("refuses to pack with no box, and with a box that has no contents", async () => {
    const sor = makeOpportunity()
    const { id: listId, number } = await packingListService.create({ opportunityId: sor.id })

    await expect(packingListService.pack(listId)).rejects.toMatchObject({
      message: expect.stringContaining(`${number} has no boxes`),
    })

    await packingListService.addBox(listId, { marks: "B" })
    await expect(packingListService.pack(listId)).rejects.toMatchObject({
      message: expect.stringContaining("box(es) with no contents"),
    })
    expect(db.internal.rowsOf("packing_lists")[0].state).toBe("draft")
  })

  it("packs a list with contents, signing Packed by, and then refuses further change", async () => {
    const sor = makeOpportunity()
    const { id: listId } = await packingListService.create({ opportunityId: sor.id })
    const { id: boxId } = await packingListService.addBox(listId, { marks: "C", sealNo: "Z-9" })
    await packingListService.setContents(boxId, [{ description: "Cable", quantity: 3, unit: "m" }])

    const packed = await packingListService.pack(listId)
    expect(packed).toMatchObject({ boxes: 1 })
    expect(db.internal.rowsOf("packing_lists")[0]).toMatchObject({ state: "packed", packed_by: buyer.id })

    await expect(packingListService.addBox(listId, { marks: "D" })).rejects.toMatchObject({ code: "42501" })
    await expect(packingListService.setContents(boxId, [])).rejects.toMatchObject({ code: "42501" })
  })
})
