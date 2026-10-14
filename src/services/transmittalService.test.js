import { beforeEach, describe, expect, it, vi } from "vitest"
import { transmittalService, TransmittalError } from "./transmittalService"
import { db } from "@/test/db/store"
import { notificationService } from "./notificationService"
import { stubTransmittalRpcs } from "@/test/stubs/transmittalRpc"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { TRANSMITTAL_NOTIFICATION } from "@/constants/transmittals"

/**
 * Transmittals (TG03, #252) through the service, against the fake database
 * with the RPCs re-implemented on its store (stubTransmittalRpcs). The rules
 * themselves are the policy tier's (68-transmittals-tracer). This proves the
 * wiring: the SOR and entity the slip carries, the stage a submit opens, who is
 * told, and the cancel rules the screens word.
 */

const PO_LINE = (lineId, name) => ({
  line_id: lineId,
  product_id: 5350,
  name,
  quantity: 6,
  unit: "Unit",
  price_unit: 1250,
  price_subtotal: 7500,
  taxes: ["12% VAT"],
  analytic: [],
  brand: "SCORPE",
})

/** A live IPAS for a PO, with its Odoo copy, and optionally its one SOR. */
function seedIpas({ po = "P02552", company = "T3ck Trading", lines, sorIds = [], state = "open" } = {}) {
  const ipas = db.seed("ipas", {
    number: `TGIPAS_${po.slice(1)}`,
    po_number: po,
    priority: "high",
    source: "import",
    purpose: sorIds.length ? "project" : "supplies",
    state,
    odoo_copy: {
      po: { id: 2552, name: po, state: "purchase", company, currency: "Php" },
      supplier: { id: 553, name: "Scorpe Technologies" },
      lines: lines ?? [PO_LINE(11400, "[10GPT00030] Greenspirit 2 Cutter SC")],
      receipts: { status: "pending", done: 0, total: 1 },
      bills: { count: 0, draft: 0 },
    },
    odoo_fetched_at: new Date().toISOString(),
  })
  for (const opportunityId of sorIds) {
    db.seed("ipas_sors", { ipas_id: ipas.id, opportunity_id: opportunityId })
  }
  return ipas
}

const HEADER = {
  origin: "purchasing",
  checkWarehouse: true,
  checkTechnical: true,
  priority: "high",
  entity: "T3ck Trading",
}

const signerOn = (listKey, employeeId) => db.seed("ipas_signer_lists", { list_key: listKey, employee_id: employeeId })

describe("transmittalService", () => {
  let buyer
  let notify

  beforeEach(() => {
    buyer = makeEmployee({ name: "Buyer", has_purchasing_flow: true })
    notify = vi.spyOn(notificationService, "createNotification").mockResolvedValue(undefined)
    stubTransmittalRpcs({ actorId: buyer.id, purchasing: true, superAdmin: true })
  })

  it("raises a slip whose PO lines carry each IPAS's SOR, and warns on a PO line of another Company", async () => {
    const sor = makeOpportunity({ sales_reference: "S07920", project_title: "Capas LGU" })
    const onSor = seedIpas({ po: "P02552", company: "T3ck Trading", sorIds: [sor.id] })
    const otherCompany = seedIpas({ po: "P02554", company: "TG Enterprise" })

    const result = await transmittalService.create({
      header: HEADER,
      lines: [
        { kind: "po_line", ipasId: onSor.id, odooPoLineId: 11400, quantity: 6 },
        { kind: "po_line", ipasId: otherCompany.id, odooPoLineId: 11400, quantity: 2 },
        { kind: "typed", description: "Sample unit", unit: "Unit", quantity: 1 },
      ],
    })

    expect(result.number).toBe("TG03-1")
    expect(result.warnings).toEqual([
      { kind: "entity", position: 2, po_number: "P02554", entity: "TG Enterprise" },
    ])

    const lines = db.internal.rowsOf("transmittal_lines").filter((l) => l.transmittal_id === result.id)
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatchObject({ kind: "po_line", opportunity_id: sor.id, description: "[10GPT00030] Greenspirit 2 Cutter SC", unit: "Unit" })
    expect(lines[1].opportunity_id).toBeNull()
    expect(lines[2]).toMatchObject({ kind: "typed", ipas_id: null, description: "Sample unit" })
  })

  it("lets a Warehouse-list member raise a slip, and refuses an employee with no access to it", async () => {
    const warehouse = makeEmployee({ name: "Warehouse Staff" })
    signerOn("transmittal_warehouse", warehouse.id)
    const ipas = seedIpas()
    stubTransmittalRpcs({ actorId: warehouse.id })

    const picks = await transmittalService.pickablePoLines("P0255")
    expect(picks).toHaveLength(1)
    // Only what a slip needs: no price, supplier or bank column reaches the screen.
    expect(Object.keys(picks[0]).sort()).toEqual(
      ["entity", "ipasId", "ipasNumber", "odooPoLineId", "poNumber", "productName", "quantity", "sors", "unit"].sort(),
    )

    const made = await transmittalService.create({
      header: HEADER,
      lines: [{ kind: "po_line", ipasId: ipas.id, odooPoLineId: 11400, quantity: 6 }],
    })
    expect(made.number).toBe("TG03-1")

    const outsider = makeEmployee({ name: "Outsider" })
    stubTransmittalRpcs({ actorId: outsider.id })
    await expect(
      transmittalService.create({ header: HEADER, lines: [{ kind: "typed", description: "x", unit: "Unit", quantity: 1 }] }),
    ).rejects.toThrow(/only Purchasing, or the Warehouse or Logistics list/)
  })

  it("refuses a slip with neither Warehouse nor TCA Technical ticked, before it reaches the database", async () => {
    await expect(
      transmittalService.create({
        header: { ...HEADER, checkWarehouse: false, checkTechnical: false },
        lines: [{ kind: "typed", description: "x", unit: "Unit", quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(TransmittalError)
  })

  it("submits to Warehouse checking with its releasing and Technical stages, and notifies the Warehouse list", async () => {
    const whs = makeEmployee({ name: "Whs One" })
    const whs2 = makeEmployee({ name: "Whs Two" })
    signerOn("transmittal_warehouse", whs.id)
    signerOn("transmittal_warehouse", whs2.id)
    const ipas = seedIpas()
    const { id } = await transmittalService.create({
      header: HEADER,
      lines: [{ kind: "po_line", ipasId: ipas.id, odooPoLineId: 11400, quantity: 6 }],
    })

    const submitted = await transmittalService.submit(id)

    expect(submitted).toMatchObject({ state: "warehouse_checking", notify_list: "transmittal_warehouse" })
    const stages = db.internal.rowsOf("transmittal_stages").filter((s) => s.transmittal_id === id).map((s) => s.stage)
    expect(stages).toEqual(["warehouse_checking", "warehouse_releasing", "technical_inspection"])
    expect(notify.mock.calls.map(([args]) => args.recipient_id).sort()).toEqual([whs.id, whs2.id].sort())
    expect(notify.mock.calls[0][0].type).toBe(TRANSMITTAL_NOTIFICATION.SUBMITTED)
  })

  it("opens Technical inspection on a Technical-only slip, and notifies the Technical list", async () => {
    const tech = makeEmployee({ name: "Tech" })
    signerOn("transmittal_technical", tech.id)
    const ipas = seedIpas()
    const { id } = await transmittalService.create({
      header: { ...HEADER, checkWarehouse: false, checkTechnical: true },
      lines: [{ kind: "po_line", ipasId: ipas.id, odooPoLineId: 11400, quantity: 6 }],
    })

    const submitted = await transmittalService.submit(id)

    expect(submitted).toMatchObject({ state: "technical_inspection", notify_list: "transmittal_technical" })
    expect(notify.mock.calls.map(([args]) => args.recipient_id)).toEqual([tech.id])
  })

  it("refuses a cancel with no reason, and tells the preparer when someone else cancels", async () => {
    const ipas = seedIpas()
    const { id } = await transmittalService.create({
      header: HEADER,
      lines: [{ kind: "po_line", ipasId: ipas.id, odooPoLineId: 11400, quantity: 6 }],
    })

    await expect(transmittalService.cancel(id, "   ")).rejects.toBeInstanceOf(TransmittalError)

    const purchaser = makeEmployee({ name: "Other Purchaser", has_purchasing_flow: true })
    stubTransmittalRpcs({ actorId: purchaser.id, purchasing: true })
    await transmittalService.cancel(id, "Raised by mistake")

    const row = db.internal.rowsOf("transmittals").find((t) => t.id === id)
    expect(row).toMatchObject({ state: "cancelled", cancel_reason: "Raised by mistake" })
    expect(notify).toHaveBeenLastCalledWith(
      expect.objectContaining({ recipient_id: buyer.id, type: TRANSMITTAL_NOTIFICATION.CANCELLED }),
    )
  })

  it("sets the first number once, for a Super Admin, before any slip exists", async () => {
    await transmittalService.setFirstNumber(526)
    const ipas = seedIpas()
    const made = await transmittalService.create({
      header: HEADER,
      lines: [{ kind: "po_line", ipasId: ipas.id, odooPoLineId: 11400, quantity: 6 }],
    })
    expect(made.number).toBe("TG03-526")

    await expect(transmittalService.setFirstNumber(600)).rejects.toThrow(/already exists/)
  })
})
