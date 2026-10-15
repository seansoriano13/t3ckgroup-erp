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

  describe("Warehouse checking, releasing and Received in Odoo (#253)", () => {
    let whs
    let whs2
    let tech
    let checkBy

    /** A submitted Warehouse + Technical slip with one PO line, in Warehouse checking. */
    async function submittedSlip({ header = HEADER, lines = 1 } = {}) {
      const ipas = seedIpas()
      const made = await transmittalService.create({
        header,
        lines: Array.from({ length: lines }, () => ({ kind: "po_line", ipasId: ipas.id, odooPoLineId: 11400, quantity: 6 })),
      })
      await transmittalService.submit(made.id)
      return made.id
    }

    const stageRow = (id, stage) =>
      db.internal.rowsOf("transmittal_stages").find((s) => s.transmittal_id === id && s.stage === stage)
    const slipRow = (id) => db.internal.rowsOf("transmittals").find((t) => t.id === id)
    const lineRows = (id) => db.internal.rowsOf("transmittal_lines").filter((l) => l.transmittal_id === id)

    beforeEach(() => {
      whs = makeEmployee({ name: "Whs One" })
      whs2 = makeEmployee({ name: "Whs Two" })
      tech = makeEmployee({ name: "Tech One" })
      checkBy = makeEmployee({ name: "Ma'am Grace" })
      signerOn("transmittal_warehouse", whs.id)
      signerOn("transmittal_warehouse", whs2.id)
      signerOn("transmittal_technical", tech.id)
      signerOn("transmittal_check_by", checkBy.id)
      stubTransmittalRpcs({ actorId: whs.id })
    })

    it("lets the Warehouse rate a line GC, and refuses an NA without a remark or an in-charge off the list", async () => {
      const id = await submittedSlip({ lines: 2 })
      const [a, b] = lineRows(id)

      await transmittalService.rateLines(id, [{ lineId: a.id, rating: "gc" }])
      expect(lineRows(id).find((l) => l.id === a.id)).toMatchObject({ wh_rating: "gc", wh_in_charge_id: whs.id })

      await expect(transmittalService.rateLines(id, [{ lineId: b.id, rating: "na", remark: "  " }])).rejects.toThrow(/NA needs a remark/)
      await expect(
        transmittalService.rateLines(id, [{ lineId: b.id, rating: "gc", inChargeId: tech.id }]),
      ).rejects.toThrow(/in-charge is on the Warehouse list/)
    })

    it("keeps a quantity received only where it differs from the quantity sent", async () => {
      const id = await submittedSlip()
      const [line] = lineRows(id)

      await transmittalService.rateLines(id, [{ lineId: line.id, rating: "gc", quantityReceived: 5 }])
      expect(lineRows(id)[0].quantity_received).toBe(5)

      await transmittalService.rateLines(id, [{ lineId: line.id, rating: "gc", quantityReceived: 6 }])
      expect(lineRows(id)[0].quantity_received).toBeNull()
    })

    it("refuses Warehouse checking until every line is rated, and until a picture or a reason is given", async () => {
      const id = await submittedSlip({ lines: 2 })
      const [a] = lineRows(id)
      await transmittalService.rateLines(id, [{ lineId: a.id, rating: "gc" }])

      await expect(
        transmittalService.completeStage(id, { stage: "warehouse_checking", otherSignerId: whs2.id, noPicturesReason: "none" }),
      ).rejects.toThrow(/still need a GC or NA rating/)

      await transmittalService.rateLines(id, [{ lineId: lineRows(id)[1].id, rating: "gc" }])
      await expect(
        transmittalService.completeStage(id, { stage: "warehouse_checking", otherSignerId: whs2.id }),
      ).rejects.toThrow(/picture or video, or give the reason none/)
    })

    it("signs checking with its co-signer, moves to releasing and notifies the Warehouse list", async () => {
      const id = await submittedSlip({ lines: 2 })
      const rated = lineRows(id)
      await transmittalService.rateLines(id, [
        { lineId: rated[0].id, rating: "gc" },
        { lineId: rated[1].id, rating: "na", remark: "Dented corner" },
      ])
      notify.mockClear()

      const result = await transmittalService.completeStage(id, {
        stage: "warehouse_checking",
        otherSignerId: whs2.id,
        noPicturesReason: "Camera down",
      })

      expect(result).toMatchObject({ state: "warehouse_releasing", na_count: 1 })
      expect(slipRow(id).state).toBe("warehouse_releasing")
      const stage = stageRow(id, "warehouse_checking")
      expect(stage).toMatchObject({ second_signer_id: whs2.id, second_signer_name: "Whs Two", no_pictures_reason: "Camera down" })
      expect(stage.completed_at).toBeTruthy()

      const sent = notify.mock.calls.map(([args]) => [args.recipient_id, args.type])
      // The next stage's list, the co-signer to confirm, and the NA notice to the preparer and Check by.
      expect(sent).toEqual(
        expect.arrayContaining([
          [whs.id, TRANSMITTAL_NOTIFICATION.STAGE_READY],
          [whs2.id, TRANSMITTAL_NOTIFICATION.STAGE_READY],
          [whs2.id, TRANSMITTAL_NOTIFICATION.CONFIRM_SIGNATURE],
          [whs.id, TRANSMITTAL_NOTIFICATION.NA_RAISED],
          [checkBy.id, TRANSMITTAL_NOTIFICATION.NA_RAISED],
        ]),
      )
    })

    it("opens Technical inspection when releasing is signed by someone on the Technical list", async () => {
      const id = await submittedSlip()
      await transmittalService.rateLines(id, [{ lineId: lineRows(id)[0].id, rating: "gc" }])
      await transmittalService.completeStage(id, { stage: "warehouse_checking", otherSignerId: whs2.id, noPicturesReason: "none" })

      await expect(
        transmittalService.completeStage(id, { stage: "warehouse_releasing", otherSignerId: whs2.id }),
      ).rejects.toThrow(/Received by is on the Technical list/)

      // Every stage, releasing too: no pictures needs a reason.
      await expect(
        transmittalService.completeStage(id, { stage: "warehouse_releasing", otherSignerId: tech.id }),
      ).rejects.toThrow(/give the reason none/)

      notify.mockClear()
      await transmittalService.completeStage(id, { stage: "warehouse_releasing", otherSignerId: tech.id, noPicturesReason: "No camera" })

      expect(slipRow(id).state).toBe("technical_inspection")
      expect(notify.mock.calls.map(([args]) => [args.recipient_id, args.type])).toEqual(
        expect.arrayContaining([
          [tech.id, TRANSMITTAL_NOTIFICATION.STAGE_READY],
          [tech.id, TRANSMITTAL_NOTIFICATION.CONFIRM_SIGNATURE],
        ]),
      )
    })

    it("on a Warehouse-only slip, checking goes to Awaiting Check, and releasing can still be signed before close", async () => {
      const id = await submittedSlip({ header: { ...HEADER, checkTechnical: false } })
      await transmittalService.rateLines(id, [{ lineId: lineRows(id)[0].id, rating: "gc" }])
      notify.mockClear()
      await transmittalService.completeStage(id, { stage: "warehouse_checking", otherSignerId: whs2.id, noPicturesReason: "none" })

      expect(slipRow(id).state).toBe("awaiting_check")
      expect(notify.mock.calls.map(([args]) => args.recipient_id)).toEqual(expect.arrayContaining([checkBy.id]))

      await transmittalService.completeStage(id, { stage: "warehouse_releasing", otherSignerName: "Typed Receiver", noPicturesReason: "No camera" })
      expect(stageRow(id, "warehouse_releasing")).toMatchObject({ second_signer_name: "Typed Receiver", second_signer_id: null })
      expect(slipRow(id).state).toBe("awaiting_check")
    })

    it("refuses a signature from someone off the Warehouse list, and naming oneself as the other", async () => {
      const id = await submittedSlip()
      const outsider = makeEmployee({ name: "Outsider" })
      stubTransmittalRpcs({ actorId: outsider.id })
      await expect(
        transmittalService.completeStage(id, { stage: "warehouse_checking", otherSignerId: whs2.id, noPicturesReason: "x" }),
      ).rejects.toThrow(/only the Warehouse list signs/)

      stubTransmittalRpcs({ actorId: whs.id })
      await expect(
        transmittalService.completeStage(id, { stage: "warehouse_checking", otherSignerId: whs.id, noPicturesReason: "x" }),
      ).rejects.toThrow(/someone else/)
    })

    it("confirms a signature for the co-signer only, and tells the first signatory of a decline", async () => {
      const id = await submittedSlip({ header: { ...HEADER, checkTechnical: false } })
      await transmittalService.rateLines(id, [{ lineId: lineRows(id)[0].id, rating: "gc" }])
      await transmittalService.completeStage(id, { stage: "warehouse_checking", otherSignerId: whs2.id, noPicturesReason: "none" })
      const stageId = stageRow(id, "warehouse_checking").id

      stubTransmittalRpcs({ actorId: whs.id })
      await expect(transmittalService.confirmSignature(stageId, true)).rejects.toThrow(/only the co-signer/)

      stubTransmittalRpcs({ actorId: whs2.id })
      await transmittalService.confirmSignature(stageId, true)
      expect(stageRow(id, "warehouse_checking")).toMatchObject({ second_confirmed: true, second_signature_declined: false })

      notify.mockClear()
      await transmittalService.confirmSignature(stageId, false)
      expect(stageRow(id, "warehouse_checking")).toMatchObject({ second_confirmed: false, second_signature_declined: true })
      expect(notify).toHaveBeenLastCalledWith(
        expect.objectContaining({ recipient_id: whs.id, type: TRANSMITTAL_NOTIFICATION.SIGNATURE_DECLINED }),
      )
    })

    it("records the Odoo receipt by its signer, once, from submission until close", async () => {
      const id = await submittedSlip()
      const outsider = makeEmployee({ name: "Outsider" })
      stubTransmittalRpcs({ actorId: outsider.id })
      await expect(transmittalService.receivedInOdoo(id, "WH/IN/01234")).rejects.toThrow(/only the Warehouse list or Purchasing/)

      stubTransmittalRpcs({ actorId: whs.id })
      const done = await transmittalService.receivedInOdoo(id, "  WH/IN/01234 ")
      expect(done).toMatchObject({ receipt_ref: "WH/IN/01234" })
      expect(slipRow(id)).toMatchObject({ odoo_received_by: whs.id, odoo_receipt_ref: "WH/IN/01234" })
      expect(slipRow(id).odoo_received_at).toBeTruthy()

      await expect(transmittalService.receivedInOdoo(id, "again")).rejects.toThrow(/already has its Odoo receipt/)
    })

    it("uploads a picture to the stage's bucket path, and records it for the open stage", async () => {
      const id = await submittedSlip()
      const stageId = stageRow(id, "warehouse_checking").id
      const file = new File(["png"], "dent photo.png", { type: "image/png" })

      await transmittalService.attachEvidence(id, stageId, file)

      const [evidence] = db.internal.rowsOf("pms_evidence")
      expect(evidence).toMatchObject({ record_id: stageId, transmittal_id: id, kind: "picture", size_bytes: 3 })
      expect(evidence.storage_path.startsWith(`${id}/${stageId}/`)).toBe(true)

      await expect(transmittalService.attachEvidence(id, stageId, new File(["x"], "notes.txt", { type: "text/plain" }))).rejects.toThrow(
        /Pictures and videos only/,
      )
    })

    it("lists the names on a staff list for a signatory picker", async () => {
      const id = await submittedSlip()
      const members = await transmittalService.stageListMembers(id, "transmittal_warehouse")
      expect(members.map((m) => m.name)).toEqual(["Whs One", "Whs Two"])
    })
  })

  it("sets the first number once, for a Super Admin, before any slip exists", async () => {
    await transmittalService.setFirstNumber(526)
    const ipas = seedIpas()
    const made = await transmittalService.create({
      header: HEADER,
      lines: [{ kind: "po_line", ipasId: ipas.id, odooPoLineId: 11400, quantity: 6 }],
    })
    expect(made.number).toBe("TG03-526")

    await expect(transmittalService.setFirstNumber(600)).rejects.toThrow(
      "TG03 numbering has already started, so the first number can't be changed.",
    )
    expect(await transmittalService.firstNumber()).toBe("TG03-526")
  })
})
