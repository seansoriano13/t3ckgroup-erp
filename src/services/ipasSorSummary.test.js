import { beforeEach, describe, expect, it } from "vitest"
import { ipasService } from "./ipasService"
import { db, updateRow } from "@/test/db/store"
import { supabase } from "@/lib/supabase"
import { stubEdgeFunction } from "@/test/msw/server"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { seedIpasOptions, stubIpasRpcs } from "@/test/stubs/ipasRpc"
import { IPAS_SUMMARY_KEYS } from "@/utils/ipasSummary"

/**
 * The SOR's IPAS summary (#249) through the service, against the fake database
 * with the RPCs re-implemented on its store and Odoo stubbed. Who may read the
 * SOR, and that the function never reaches the money, are the policy tier's
 * (63-ipas-sor-summary); what is proven here is the wiring: what the SOR
 * section lists, in what shape, and that nothing of the money rides along.
 */

const line = (id, quantity = 6, price = 1250) => ({
  line_id: id,
  product_id: id * 10,
  name: `Item ${id}`,
  quantity,
  unit: "Unit",
  price_unit: price,
  price_subtotal: quantity * price,
  taxes: [],
  analytic: [],
  brand: null,
})

const odooPo = ({ name, state = "purchase", receipts, bills } = {}) => ({
  success: true,
  found: true,
  po: { id: 2552, name, state, company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
  supplier: { id: 553, name: "Scorpe Technologies", contact: "Ms. K. Tan" },
  lines: [line(11400)],
  receipts: receipts ?? { status: "pending", done: 0, total: 1 },
  bills: bills ?? { count: 0, draft: 0 },
})

describe("ipasService.summariesForSor", () => {
  let buyer, options, sorA, sorB

  beforeEach(() => {
    buyer = makeEmployee({ name: "Buyer", department: "OPERATIONS", has_purchasing_flow: true })
    options = seedIpasOptions((table, row) => db.seed(table, row))
    sorA = makeOpportunity({ sales_reference: "S07001", project_title: "Capas Fire Station" })
    sorB = makeOpportunity({ sales_reference: "S07002", project_title: "Las Nieves Rescue" })
    stubIpasRpcs({ actorId: buyer.id })
  })

  async function raise({ poNumber = "P02552", purpose = "project", sorIds = [sorA.id], source = "local", copy } = {}) {
    stubEdgeFunction("odoo-po-ipas", copy ?? odooPo({ name: poNumber }))
    return ipasService.create({ poNumber, priority: "high", source, purpose, sorIds })
  }

  it("lists each Project IPAS naming the SOR as a summary", async () => {
    const ipas = await raise()

    const rows = await ipasService.summariesForSor(sorA.id)

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: ipas.id,
      number: ipas.number,
      poNumber: "P02552",
      supplier: "Scorpe Technologies",
      purpose: "project",
      state: "open",
      computationStatus: "encoding",
      computationLabel: "Encoding",
    })
    expect(rows[0].buyerTrack.map((item) => [item.key, item.label, item.ticked])).toEqual([
      ["purchase_order", "Purchase Order", true],
      ["with_pop", "With P.O.P", false],
      ["delivered", "Delivered", false],
      ["received_in_odoo", "Received in Odoo", false],
      ["create_bill", "Create Bill", false],
      ["actual_checking", "Actual Checking", false],
    ])
    expect(rows[0].signoffs.map((s) => [s.section, s.done, s.total])).toEqual([
      [1, 0, 2],
      [3, 0, 2],
      [6, 0, 2],
      [7, 0, 4],
    ])
  })

  it("asks the database function and reads exactly its key set, no money or bank column", async () => {
    await raise()
    // A payment with proof and bank details are on file: none of it may ride along.
    const [ipas] = db.rows("ipas")
    db.seed("ipas_payments", {
      ipas_id: ipas.id,
      kind: "payment",
      paid_on: "2026-10-01",
      amount: 987654.32,
      method_id: options.payment_method["Dated Check"].id,
      proof_url: "https://res.cloudinary.com/demo/proof.png",
      created_by: buyer.id,
    })
    db.seed("ipas_bank_details", {
      ipas_id: ipas.id,
      bank_name: "BDO",
      account_name: "Scorpe Technologies Inc.",
      account_number: "0012 3456 7890",
    })

    const { data, error } = await supabase.rpc("ipas_summaries_for_sor", { p_opportunity_id: sorA.id })

    expect(error).toBeNull()
    expect(Object.keys(data[0]).sort()).toEqual([...IPAS_SUMMARY_KEYS].sort())
    const shown = JSON.stringify(await ipasService.summariesForSor(sorA.id))
    for (const secret of ["987654", "0012 3456 7890", "Scorpe Technologies Inc.", "cloudinary", "BDO"]) {
      expect(shown).not.toContain(secret)
    }
  })

  it("carries Landed Cost's total and mark for the matrix's money tier only (#283)", async () => {
    await raise()
    const participant = (await ipasService.summariesForSor(sorA.id))[0]
    expect(participant.landedCost).toBeNull()
    const { data: participantRows } = await supabase.rpc("ipas_summaries_for_sor", { p_opportunity_id: sorA.id })
    expect(Object.keys(participantRows[0]).sort()).toEqual([...IPAS_SUMMARY_KEYS].sort())

    stubIpasRpcs({ actorId: buyer.id, costingMoney: true })
    const { data: moneyRows } = await supabase.rpc("ipas_summaries_for_sor", { p_opportunity_id: sorA.id })
    expect(Object.keys(moneyRows[0]).sort()).toEqual([...IPAS_SUMMARY_KEYS].sort())
    const money = (await ipasService.summariesForSor(sorA.id))[0]
    expect(money.landedCost).toMatchObject({ mark: "provisional" })
    expect(money.landedCost.total).toBeGreaterThan(0)
  })

  it("ticks With P.O.P once a payment carries proof, without exposing the payment", async () => {
    await raise()
    const [ipas] = db.rows("ipas")
    expect((await ipasService.summariesForSor(sorA.id))[0].buyerTrack.find((i) => i.key === "with_pop").ticked).toBe(false)

    db.seed("ipas_payments", {
      ipas_id: ipas.id,
      kind: "payment",
      paid_on: "2026-10-01",
      amount: 100,
      method_id: options.payment_method["Dated Check"].id,
      proof_url: "https://res.cloudinary.com/demo/proof.png",
      created_by: buyer.id,
    })

    expect((await ipasService.summariesForSor(sorA.id))[0].buyerTrack.find((i) => i.key === "with_pop").ticked).toBe(true)
  })

  it("reads Odoo's stamped statuses from the stored copy, a partial receipt included", async () => {
    await raise({
      copy: odooPo({ name: "P02552", receipts: { status: "partial", done: 1, total: 2 }, bills: { count: 1, draft: 1 } }),
    })

    const track = (await ipasService.summariesForSor(sorA.id))[0].buyerTrack
    const by = Object.fromEntries(track.map((item) => [item.key, item]))

    expect(by.received_in_odoo).toMatchObject({ ticked: false, partial: true })
    expect(by.create_bill.ticked).toBe(true)
  })

  it("adds Import Clearance to an Import IPAS's track and leaves it off a Local one", async () => {
    await raise({ poNumber: "P02553", source: "import" })
    await raise({ poNumber: "P02554", source: "local" })

    const rows = await ipasService.summariesForSor(sorA.id)
    const importRow = rows.find((r) => r.poNumber === "P02553")
    const localRow = rows.find((r) => r.poNumber === "P02554")

    expect(importRow.buyerTrack.map((i) => i.key)).toContain("import_clearance")
    expect(localRow.buyerTrack.map((i) => i.key)).not.toContain("import_clearance")
  })

  it("shows sign-off progress per section, from live sign-offs only", async () => {
    const ipas = await raise()
    const approver = makeEmployee({ name: "Boss" })
    const live = (section, role) => ({ ipas_id: ipas.id, section, role, signed_by: approver.id })
    db.seed("ipas_signoffs", live(1, "prepared"))
    db.seed("ipas_signoffs", live(1, "approved"))
    db.seed("ipas_signoffs", live(3, "prepared"))
    db.seed("ipas_signoffs", {
      ...live(3, "approved"),
      cleared_at: "2026-10-05T00:00:00Z",
      cleared_by: approver.id,
      cleared_reason: "PO changed in Odoo",
    })

    const [row] = await ipasService.summariesForSor(sorA.id)
    const steps = (section) => row.signoffs.find((s) => s.section === section).steps.filter((s) => s.done).map((s) => s.role)

    expect(steps(1)).toEqual(["prepared", "approved"])
    expect(steps(3)).toEqual(["prepared"])
    expect(steps(7)).toEqual([])
  })

  it("lists an IPAS naming two SORs on both", async () => {
    const ipas = await raise({ sorIds: [sorA.id, sorB.id] })

    expect((await ipasService.summariesForSor(sorA.id)).map((r) => r.id)).toEqual([ipas.id])
    expect((await ipasService.summariesForSor(sorB.id)).map((r) => r.id)).toEqual([ipas.id])
  })

  it("never lists an Inventory IPAS on any SOR", async () => {
    await raise({ poNumber: "P02560", purpose: "inventory", sorIds: [] })
    // Even a stray SOR row can't put a non-Project IPAS on an SOR.
    const [ipas] = db.rows("ipas")
    db.seed("ipas_sors", { ipas_id: ipas.id, opportunity_id: sorA.id })

    expect(await ipasService.summariesForSor(sorA.id)).toEqual([])
    expect(await ipasService.summariesForSor(sorB.id)).toEqual([])
  })

  it("lists open IPAS first, then filed, then cancelled, each keeping its state", async () => {
    const open = await raise({ poNumber: "P02561" })
    const cancelled = await raise({ poNumber: "P02562" })
    await ipasService.cancel(cancelled.id, "Wrong PO")
    const filed = await raise({ poNumber: "P02563" })
    updateRow("ipas", db.internal.rowsOf("ipas").find((r) => r.id === filed.id), { state: "filed", filed_at: "2026-10-10T00:00:00Z" })

    const rows = await ipasService.summariesForSor(sorA.id)

    expect(rows.map((r) => [r.id, r.state])).toEqual([
      [open.id, "open"],
      [filed.id, "filed"],
      [cancelled.id, "cancelled"],
    ])
  })

  it("is empty for someone who can't read the SOR", async () => {
    await raise()
    stubIpasRpcs({ actorId: buyer.id, sorReader: false })

    expect(await ipasService.summariesForSor(sorA.id)).toEqual([])
  })

  it("is empty for an SOR no IPAS names, and asks nothing without an SOR", async () => {
    await raise()

    expect(await ipasService.summariesForSor(sorB.id)).toEqual([])
    expect(await ipasService.summariesForSor(null)).toEqual([])
  })

  it("lists the summary to a reader who can't read any IPAS", async () => {
    await raise()
    stubIpasRpcs({ actorId: buyer.id, reader: false })

    const rows = await ipasService.summariesForSor(sorA.id)

    expect(rows).toHaveLength(1)
    expect(rows[0].number).toMatch(/^TGIPAS_/)
  })
})
