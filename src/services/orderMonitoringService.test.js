import { beforeEach, describe, expect, it, vi } from "vitest"
import { orderMonitoringService } from "./orderMonitoringService"
import { orderAgeingRulesService } from "./orderAgeingRulesService"
import { ORDER_AGEING_STEPS } from "@/constants/orderMonitoring"
import { db } from "@/test/db/store"
import { stubEdgeFunction, stubRpc } from "@/test/msw/server"
import { makeEmployee, makeOpportunity } from "@/test/factories"

/**
 * Order Monitoring ageing rules (#262, spec #261), against the fake database.
 * Every step has at most one rule; a step with no rule reads back as null.
 * Who may write, and the database's own refusals, are the policy tier's
 * (75-order-ageing-rules). Here the service's reading and its checks are proven.
 */

const KEYS = ORDER_AGEING_STEPS.map((step) => step.key)
const daysOf = (rules, step) => rules.find((rule) => rule.step === step).days

describe("orderMonitoringService ageing rules", () => {
  it("lists every step in order, each with no rule, before anyone sets one", async () => {
    const rules = await orderAgeingRulesService.getRules()

    expect(rules.map((rule) => rule.step)).toEqual(KEYS)
    expect(rules.every((rule) => rule.days === null)).toBe(true)
  })

  it("reads back the days once a rule is set", async () => {
    await orderAgeingRulesService.setRule("import_clearance", 3)

    expect(daysOf(await orderAgeingRulesService.getRules(), "import_clearance")).toBe(3)
  })

  it("replaces a rule rather than adding a second one for the same step", async () => {
    await orderAgeingRulesService.setRule("create_bill", 7)
    await orderAgeingRulesService.setRule("create_bill", 10)

    const rules = await orderAgeingRulesService.getRules()
    expect(rules).toHaveLength(KEYS.length)
    expect(daysOf(rules, "create_bill")).toBe(10)
  })

  it("clearing a rule reads back as no rule", async () => {
    await orderAgeingRulesService.setRule("import_clearance", 3)
    await orderAgeingRulesService.setRule("import_clearance", null)

    expect(daysOf(await orderAgeingRulesService.getRules(), "import_clearance")).toBeNull()
  })

  it("refuses a day count that is not a positive whole number, and writes nothing", async () => {
    await expect(orderAgeingRulesService.setRule("create_bill", 0)).rejects.toThrow()
    await expect(orderAgeingRulesService.setRule("create_bill", -2)).rejects.toThrow()
    await expect(orderAgeingRulesService.setRule("create_bill", 2.5)).rejects.toThrow()

    expect(daysOf(await orderAgeingRulesService.getRules(), "create_bill")).toBeNull()
  })

  it("refuses a step that is not one of the ten", async () => {
    await expect(orderAgeingRulesService.setRule("not_a_step", 3)).rejects.toThrow()
  })
})

/**
 * What needs doing (#263, spec #261): every open IPAS across every SOR, with
 * its one next thing, who owes it and how long it has waited. The fixtures are
 * one per case in the spec. Days are counted in Asia/Manila; `today` is passed
 * in so the counts don't depend on the wall clock.
 *
 * Timestamps: `at(day)` is 12:00 Manila on that October day.
 */

const TODAY = "2026-10-16"
const at = (day, time = "04:00:00") => `2026-10-${String(day).padStart(2, "0")}T${time}Z`

const LINE = (odooPoLineId, subtotal = 1000) => ({
  line_id: odooPoLineId,
  product_id: 5350,
  name: "[10GPT00030] Greenspirit 2 Cutter SC",
  quantity: 1,
  unit: "Unit",
  price_unit: subtotal,
  price_subtotal: subtotal,
  taxes: [],
  analytic: [],
})

let seq = 0
const rowsFor = (rows, ipas) => rows.find((row) => row.id === ipas.id)

function seedOrder({
  source = "local",
  state = "open",
  poState = "purchase",
  currency = "Php",
  company = "T3ck Trading",
  lines,
  computationStatus = "encoding",
  createdAt = at(1),
  arrivedInPh = null,
  deliveredOn = null,
  filedAt = null,
  sorIds = [],
  supplier = "Scorpe Technologies",
  onboardOn = null,
  shippedOutOn = null,
  importClearanceOn = null,
  lineName = "[10GPT00030] Greenspirit 2 Cutter SC",
} = {}) {
  seq += 1
  return db.seed("ipas", {
    number: `TGIPAS_${900 + seq}`,
    po_number: `P0${9000 + seq}`,
    priority: "high",
    source,
    purpose: sorIds.length ? "project" : "supplies",
    state,
    filed_at: filedAt,
    computation_status: computationStatus,
    arrived_in_ph_on: arrivedInPh,
    onboard_on: onboardOn,
    shipped_out_on: shippedOutOn,
    import_clearance_on: importClearanceOn,
    delivered_on: deliveredOn,
    odoo_copy: {
      po: { id: seq, name: `P0${9000 + seq}`, state: poState, company, currency },
      supplier: { id: 553, name: supplier },
      lines: lines ?? [{ ...LINE(10000 + seq), name: lineName }],
      receipts: { status: "pending", done: 0, total: 1 },
      bills: { count: 0, draft: 0 },
    },
    odoo_fetched_at: at(15),
    created_at: createdAt,
  })
}

/** A payment on the IPAS; with a proof it ticks With P.O.P. */
function seedPayment(ipas, { proof = true, paidOn = "2026-10-01" } = {}) {
  const method = db.seed("ipas_options", { list: "payment_method", label: "Bank transfer" })
  return db.seed("ipas_payments", {
    ipas_id: ipas.id,
    kind: "full_payment",
    paid_on: paidOn,
    amount: 1000,
    method_id: method.id,
    proof_url: proof ? "https://example.com/proof.pdf" : null,
  })
}

let slipSeq = 0
/**
 * A Transmittal. `stages` is `{ warehouse_checking: at(n), technical_inspection: at(n) }`
 * (the completion time per stage). `lines` are `{ ipas, odooPoLineId, wh, tech }`.
 */
function seedSlip({
  state = "warehouse_checking",
  checkWarehouse = true,
  checkTechnical = false,
  preparedOn = "2026-10-01",
  submittedAt = at(1),
  closedAt = null,
  stages = {},
  lines = [],
}) {
  slipSeq += 1
  const preparer = makeEmployee({ name: "Preparer" })
  const slip = db.seed("transmittals", {
    number: `TG03-${slipSeq}`,
    prepared_on: preparedOn,
    origin: "purchasing",
    priority: "high",
    entity: "T3ck Trading",
    check_warehouse: checkWarehouse,
    check_technical: checkTechnical,
    state,
    prepared_by: preparer.id,
    submitted_at: submittedAt,
    closed_at: closedAt,
  })
  lines.forEach((line, index) =>
    db.seed("transmittal_lines", {
      transmittal_id: slip.id,
      position: index + 1,
      kind: "po_line",
      ipas_id: line.ipas.id,
      odoo_po_line_id: line.odooPoLineId,
      description: "[10GPT00030] Greenspirit 2 Cutter SC",
      quantity: 1,
      wh_rating: line.wh ?? null,
      tech_rating: line.tech ?? null,
    }),
  )
  for (const [stage, completedAt] of Object.entries(stages)) {
    db.seed("transmittal_stages", { transmittal_id: slip.id, stage, completed_at: completedAt })
  }
  return slip
}

const odooCall = vi.fn(() => ({ data: null, error: null }))

describe("orderMonitoringService: what needs doing", () => {
  beforeEach(() => {
    odooCall.mockClear()
    stubEdgeFunction("odoo-po-ipas", odooCall)
    stubRpc("ipas_sor_headers", ({ p_ipas_ids }) =>
      db
        .internal.rowsOf("ipas_sors")
        .filter((link) => p_ipas_ids?.includes(link.ipas_id))
        .map((link) => {
          const sor = db.internal.rowsOf("sales_opportunities").find((o) => o.id === link.opportunity_id)
          return {
            ipas_id: link.ipas_id,
            opportunity_id: sor.id,
            sales_reference: sor.sales_reference,
            project_title: sor.project_title,
            current_stage_name: null,
          }
        }),
    )
  })

  const listAll = (options = {}) => orderMonitoringService.list({ today: TODAY, ...options })

  describe("grouping and the next thing", () => {
    it("puts an Import six days past Arrived in PH, with no Import Clearance, past a three-day rule", async () => {
      const ipas = seedOrder({ source: "import", arrivedInPh: "2026-10-10" })
      seedPayment(ipas)
      await orderAgeingRulesService.setRule("import_clearance", 3)

      const row = rowsFor(await listAll(), ipas)

      expect(row.group).toBe("needs_chasing")
      expect(row.next.step).toBe("import_clearance")
      expect(row.next.owner).toBe("others")
      expect(row.daysWaiting).toBe(6)
      expect(row.late).toBe(true)
      expect(row.daysPastRule).toBe(3)
    })

    it("leaves the same Import waiting on someone else, and never late, with no rule", async () => {
      const ipas = seedOrder({ source: "import", arrivedInPh: "2026-10-10" })
      seedPayment(ipas)

      const row = rowsFor(await listAll(), ipas)

      expect(row.group).toBe("waiting_on_others")
      expect(row.late).toBe(false)
      expect(row.ruleDays).toBeNull()
    })

    it("sends a payment with no proof of payment to Finance as With P.O.P", async () => {
      const ipas = seedOrder()
      seedPayment(ipas, { proof: false })

      const row = rowsFor(await listAll(), ipas)

      expect(row.next.step).toBe("with_pop")
      expect(row.next.owner).toBe("finance")
      expect(row.group).toBe("waiting_on_us")
    })

    it("says a delivered order has no Transmittal raised, owed by Purchasing", async () => {
      const ipas = seedOrder({ deliveredOn: "2026-10-14" })
      seedPayment(ipas)

      const row = rowsFor(await listAll(), ipas)

      expect(row.next.label).toBe("Delivered — no Transmittal raised")
      expect(row.next.step).toBe("no_transmittal")
      expect(row.next.owner).toBe("purchasing")
      expect(row.daysWaiting).toBe(2)
      expect(row.group).toBe("waiting_on_us")
    })

    it("names the Technical inspection a Transmittal waits on", async () => {
      const ipas = seedOrder({ deliveredOn: "2026-10-14" })
      seedPayment(ipas)
      seedSlip({
        state: "technical_inspection",
        checkWarehouse: true,
        checkTechnical: true,
        stages: { warehouse_checking: at(10) },
        lines: [{ ipas, odooPoLineId: 10001 }],
      })

      const row = rowsFor(await listAll(), ipas)

      expect(row.next.label).toMatch(/ needs Technical checking$/)
      expect(row.next.slip.id).toBeTruthy()
      expect(row.next.owner).toBe("technical")
      expect(row.next.step).toBe("check_open")
      expect(row.group).toBe("waiting_on_us")
    })

    it("does not say no Transmittal was raised when a draft already names the order", async () => {
      const ipas = seedOrder({ deliveredOn: "2026-10-14" })
      seedPayment(ipas)
      seedSlip({ state: "draft", submittedAt: null, lines: [{ ipas, odooPoLineId: 10001 }] })

      const row = rowsFor(await listAll(), ipas)

      expect(row.next.step).not.toBe("no_transmittal")
      expect(row.transmittals.count).toBe(0)
    })

    it("still says no Transmittal was raised when the only one is cancelled", async () => {
      const ipas = seedOrder({ deliveredOn: "2026-10-14" })
      seedPayment(ipas)
      seedSlip({ state: "cancelled", lines: [{ ipas, odooPoLineId: 10001 }] })

      expect(rowsFor(await listAll(), ipas).next.step).toBe("no_transmittal")
    })

    it("is owed by the Warehouse when the one open slip waits on the Warehouse", async () => {
      const ipas = seedOrder({ deliveredOn: "2026-10-14" })
      seedPayment(ipas)
      seedSlip({ state: "warehouse_checking", checkWarehouse: true, checkTechnical: true, lines: [{ ipas, odooPoLineId: 10001 }] })

      const row = rowsFor(await listAll(), ipas)

      expect(row.next.label).toMatch(/ needs Warehouse checking$/)
      expect(row.next.owner).toBe("warehouse")
    })

    it("is owed by Technical when the Warehouse is done and only Technical is open, even beside a Technical-only slip", async () => {
      const ipas = seedOrder({ deliveredOn: "2026-10-14" })
      seedPayment(ipas)
      seedSlip({
        state: "technical_inspection", checkWarehouse: true, checkTechnical: true,
        stages: { warehouse_checking: at(10) }, lines: [{ ipas, odooPoLineId: 10001 }],
      })
      seedSlip({ state: "technical_inspection", checkWarehouse: false, checkTechnical: true, lines: [{ ipas, odooPoLineId: 10002 }] })

      const row = rowsFor(await listAll(), ipas)

      expect(row.next.label).toMatch(/ needs Technical checking \(\+1 more\)$/)
      expect(row.next.owner).toBe("technical")
    })

    it("when slips wait on different departments, keeps both in the words and is owed by the Warehouse, the earlier stage", async () => {
      const ipas = seedOrder({ deliveredOn: "2026-10-14" })
      seedPayment(ipas)
      seedSlip({ state: "warehouse_checking", checkWarehouse: true, lines: [{ ipas, odooPoLineId: 10001 }] })
      seedSlip({
        state: "technical_inspection", checkWarehouse: true, checkTechnical: true,
        stages: { warehouse_checking: at(10) }, lines: [{ ipas, odooPoLineId: 10002 }],
      })

      const row = rowsFor(await listAll(), ipas)

      expect(row.next.label).toMatch(/ needs Warehouse checking \(\+1 more\)$/)
      expect(row.next.owner).toBe("warehouse")
    })

    it("says a Transmittal awaiting Check by is owed by the Check by signers", async () => {
      const ipas = seedOrder({ deliveredOn: "2026-10-14" })
      seedPayment(ipas)
      seedSlip({
        state: "awaiting_check",
        checkWarehouse: true,
        checkTechnical: true,
        stages: { warehouse_checking: at(10), technical_inspection: at(11) },
        lines: [{ ipas, odooPoLineId: 10001, wh: "gc", tech: "gc" }],
      })

      const row = rowsFor(await listAll(), ipas)

      expect(row.next.label).toMatch(/ needs Check by$/)
      expect(row.next.owner).toBe("check_by")
      expect(row.daysWaiting).toBe(5)
    })

    it("flags an NA rated at its slip's checking stage, owed by Purchasing", async () => {
      const ipas = seedOrder({ deliveredOn: "2026-10-14" })
      seedPayment(ipas)
      seedSlip({
        state: "awaiting_check",
        stages: { warehouse_checking: at(9) },
        lines: [{ ipas, odooPoLineId: 10001, wh: "na" }],
      })

      const row = rowsFor(await listAll(), ipas)

      expect(row.next.label).toMatch(/ has NA at checking — resolve with supplier$/)
      expect(row.next.owner).toBe("purchasing")
      expect(row.next.step).toBe("check_open")
    })

    it("stops flagging an NA once a later Transmittal rates the same PO line GC at its checking stage", async () => {
      const ipas = seedOrder({ deliveredOn: "2026-10-14" })
      seedPayment(ipas)
      seedSlip({
        state: "closed",
        closedAt: at(9),
        preparedOn: "2026-10-05",
        stages: { warehouse_checking: at(9) },
        lines: [{ ipas, odooPoLineId: 10001, wh: "na" }],
      })
      seedSlip({
        state: "closed",
        closedAt: at(12),
        preparedOn: "2026-10-12",
        stages: { warehouse_checking: at(12) },
        lines: [{ ipas, odooPoLineId: 10001, wh: "gc" }],
      })

      const row = rowsFor(await listAll(), ipas)

      expect(row.next.label).not.toMatch(/NA at checking/)
      expect(row.next.step).toBe("received_in_odoo")
    })

    it("says costs complete, section 3 approved and unfiled are ready to file, owed by the section 7 signers", async () => {
      const ipas = seedOrder({ computationStatus: "lc_odoo_done" })
      db.seed("ipas_signoffs", { ipas_id: ipas.id, section: 6, role: "approved", signed_by: makeEmployee({ name: "S3 Approver" }).id, cleared_at: null })
      db.seed("ipas_events", {
        ipas_id: ipas.id,
        kind: "header_changed",
        detail: { fields: { computation_status: { from: "lc_gs_done", to: "lc_odoo_done" } } },
        created_at: at(5),
      })

      const row = rowsFor(await listAll(), ipas)

      expect(row.next.label).toBe("Costs complete — ready to file")
      expect(row.next.owner).toBe("signers")
      expect(row.next.step).toBe("ready_to_file")
      expect(row.daysWaiting).toBe(11)
      expect(row.group).toBe("waiting_on_us")
    })

    it("says costs complete but section 3 not approved is waiting on the section 3 list (#590)", async () => {
      const ipas = seedOrder({ computationStatus: "lc_odoo_done" })
      db.seed("ipas_events", {
        ipas_id: ipas.id,
        kind: "header_changed",
        detail: { fields: { computation_status: { from: "lc_gs_done", to: "lc_odoo_done" } } },
        created_at: at(5),
      })
      // A cleared approval does not count.
      db.seed("ipas_signoffs", { ipas_id: ipas.id, section: 6, role: "approved", signed_by: makeEmployee({ name: "S3 Approver" }).id, cleared_at: at(6) })

      const row = rowsFor(await listAll(), ipas)

      expect(row.next.label).toBe("Section 3 waiting for approval")
      expect(row.next.owner).toBe("section_3_approvers")
      expect(row.next.step).toBe("section_3_approval")
      expect(row.daysWaiting).toBe(11)
      expect(row.group).toBe("waiting_on_us")
    })

    it("shows an RFQ-only order as no Purchase Order yet, owed by Purchasing", async () => {
      const ipas = seedOrder({ poState: "draft", createdAt: at(12) })

      const row = rowsFor(await listAll(), ipas)

      expect(row.next.step).toBe("purchase_order")
      expect(row.next.owner).toBe("purchasing")
      expect(row.next.label).toBe("Purchase Order — no PO confirmed yet")
      expect(row.daysWaiting).toBe(4)
    })

    it("files a filed order into the Filed group", async () => {
      const ipas = seedOrder({ state: "filed", filedAt: at(3), deliveredOn: "2026-10-01", computationStatus: "lc_odoo_done" })

      const row = rowsFor(await listAll({ group: "filed" }), ipas)

      expect(row.group).toBe("filed")
      expect(row.late).toBe(false)
    })

    it("leaves a cancelled order out of every list", async () => {
      const ipas = seedOrder({ state: "cancelled" })

      expect(rowsFor(await listAll(), ipas)).toBeUndefined()
    })

    it("counts days in Asia/Manila, so a time just after Manila midnight is the next day", async () => {
      const ipas = seedOrder({ computationStatus: "lc_odoo_done" })
      // 16:30 UTC on the 10th is 00:30 on the 11th in Manila.
      seedSlip({
        state: "awaiting_check",
        checkWarehouse: true,
        checkTechnical: true,
        stages: { warehouse_checking: at(9), technical_inspection: "2026-10-10T16:30:00Z" },
        lines: [{ ipas, odooPoLineId: 10001, wh: "gc", tech: "gc" }],
      })
      await orderAgeingRulesService.setRule("check_open", 1)

      const row = rowsFor(await orderMonitoringService.list({ today: "2026-10-12" }), ipas)

      expect(row.daysWaiting).toBe(1)
      expect(row.late).toBe(false)
    })
  })

  describe("rules", () => {
    it("moves an order into Needs chasing when a rule is set, and back out when it is cleared", async () => {
      const ipas = seedOrder({ deliveredOn: "2026-10-14" })
      seedPayment(ipas)

      expect(rowsFor(await listAll(), ipas).group).toBe("waiting_on_us")

      await orderAgeingRulesService.setRule("no_transmittal", 1)
      expect(rowsFor(await listAll(), ipas).group).toBe("needs_chasing")

      await orderAgeingRulesService.setRule("no_transmittal", null)
      expect(rowsFor(await listAll(), ipas).group).toBe("waiting_on_us")
    })
  })

  describe("the list", () => {
    it("filters to one group when asked", async () => {
      const late = seedOrder({ source: "import", arrivedInPh: "2026-10-10" })
      seedPayment(late)
      const waiting = seedOrder({ poState: "draft" })
      await orderAgeingRulesService.setRule("import_clearance", 3)

      const rows = await listAll({ group: "needs_chasing" })

      expect(rows.map((row) => row.id)).toEqual([late.id])
      expect(rows.some((row) => row.id === waiting.id)).toBe(false)
    })

    it("carries the SOR, value, currency, age, buyer track and Transmittal summary", async () => {
      const sor = makeOpportunity({ sales_reference: "S07920", project_title: "Capas LGU" })
      const ipas = seedOrder({ sorIds: [sor.id], createdAt: at(1) })
      db.seed("ipas_sors", { ipas_id: ipas.id, opportunity_id: sor.id })
      seedSlip({
        state: "warehouse_checking",
        stages: {},
        lines: [{ ipas, odooPoLineId: 10001, wh: "na" }],
      })

      const row = rowsFor(await listAll(), ipas)

      expect(row.sors.map((s) => s.salesReference)).toEqual(["S07920"])
      expect(row.currency).toBe("Php")
      expect(row.value).toBe(1000)
      expect(row.ageDays).toBe(15)
      expect(row.buyerTrack.find((item) => item.key === "purchase_order").ticked).toBe(true)
      expect(row.transmittals).toMatchObject({ count: 1, naCount: 1 })
    })

    it("reads the stored Odoo copy and never calls Odoo", async () => {
      seedOrder({ poState: "draft" })

      await listAll()
      await orderMonitoringService.counts({ today: TODAY })

      expect(odooCall).not.toHaveBeenCalled()
    })
  })

  describe("counts", () => {
    it("tiles match the groups, and value open totals each currency, leaving out filed", async () => {
      const late = seedOrder({ source: "import", arrivedInPh: "2026-10-10", lines: [LINE(20001, 1000)] })
      seedPayment(late)
      seedOrder({ poState: "draft", lines: [LINE(20002, 2000)] })
      const importOther = seedOrder({ source: "import", arrivedInPh: "2026-10-14", currency: "USD", lines: [LINE(20003, 500)] })
      seedPayment(importOther)
      seedOrder({ state: "filed", filedAt: at(3), deliveredOn: "2026-10-01", computationStatus: "lc_odoo_done", lines: [LINE(20004, 9999)] })
      await orderAgeingRulesService.setRule("import_clearance", 3)

      const counts = await orderMonitoringService.counts({ today: TODAY })

      expect(counts.needsChasing).toBe(1)
      expect(counts.waitingOnUs).toBe(1)
      expect(counts.waitingOnOthers).toBe(1)
      expect(counts.valueOpen.find((v) => v.currency === "Php").total).toBe(3000)
      expect(counts.valueOpen.find((v) => v.currency === "USD").total).toBe(500)
    })
  })

  describe("the register (#264): filters and search", () => {
    const sortedIds = (rows) => rows.map((row) => row.id).sort((a, b) => a - b)
    const idsOf = (...ipas) => ipas.map((i) => i.id).sort((a, b) => a - b)

    it("narrows to one entity", async () => {
      const trading = seedOrder({ company: "T3ck Trading" })
      const solutions = seedOrder({ company: "T3ck Solutions" })

      expect(sortedIds(await listAll({ entity: "T3ck Solutions" }))).toEqual(idsOf(solutions))
      expect(sortedIds(await listAll({ entity: "T3ck Trading" }))).toEqual(idsOf(trading))
    })

    it("narrows to Import or Local", async () => {
      const imported = seedOrder({ source: "import" })
      const local = seedOrder({ source: "local" })

      expect(sortedIds(await listAll({ source: "import" }))).toEqual(idsOf(imported))
      expect(sortedIds(await listAll({ source: "local" }))).toEqual(idsOf(local))
    })

    it("narrows to the orders on one SOR", async () => {
      const sorA = makeOpportunity({ sales_reference: "S07920", project_title: "Capas LGU" })
      const sorB = makeOpportunity({ sales_reference: "S07921", project_title: "Tarlac" })
      const onA = seedOrder()
      const onB = seedOrder()
      seedOrder()
      db.seed("ipas_sors", { ipas_id: onA.id, opportunity_id: sorA.id })
      db.seed("ipas_sors", { ipas_id: onB.id, opportunity_id: sorB.id })

      expect(sortedIds(await listAll({ sorId: sorA.id }))).toEqual(idsOf(onA))
      expect(sortedIds(await listAll({ sorId: sorB.id }))).toEqual(idsOf(onB))
    })

    it("narrows to one supplier", async () => {
      const scorpe = seedOrder({ supplier: "Scorpe Technologies" })
      const acme = seedOrder({ supplier: "Acme Supply" })

      expect(sortedIds(await listAll({ supplier: "Acme Supply" }))).toEqual(idsOf(acme))
      expect(sortedIds(await listAll({ supplier: "Scorpe Technologies" }))).toEqual(idsOf(scorpe))
    })

    it("narrows to open or filed orders by state", async () => {
      const open = seedOrder()
      const filed = seedOrder({ state: "filed", filedAt: at(3), computationStatus: "lc_odoo_done", deliveredOn: "2026-10-01" })

      expect(sortedIds(await listAll({ state: "open" }))).toEqual(idsOf(open))
      expect(sortedIds(await listAll({ state: "filed" }))).toEqual(idsOf(filed))
    })

    it("includes a filed order and finds it by search, and never shows a cancelled one", async () => {
      const filed = seedOrder({ state: "filed", filedAt: at(3), computationStatus: "lc_odoo_done", deliveredOn: "2026-10-01" })
      const cancelled = seedOrder({ state: "cancelled" })

      const all = await listAll()
      expect(all.map((row) => row.id)).toContain(filed.id)
      expect(all.map((row) => row.id)).not.toContain(cancelled.id)
      expect(sortedIds(await listAll({ search: filed.number }))).toEqual(idsOf(filed))
      expect(await listAll({ search: cancelled.number })).toEqual([])
      expect(await listAll({ state: "cancelled" })).toEqual([])
    })

    it("searches by IPAS number, ignoring case and surrounding spaces", async () => {
      const wanted = seedOrder()
      seedOrder()

      expect(sortedIds(await listAll({ search: `  ${wanted.number.toLowerCase()} ` }))).toEqual(idsOf(wanted))
    })

    it("searches by PO number", async () => {
      const wanted = seedOrder()
      seedOrder()

      expect(sortedIds(await listAll({ search: wanted.po_number.toLowerCase() }))).toEqual(idsOf(wanted))
    })

    it("searches by the S number of an SOR the order names", async () => {
      const sor = makeOpportunity({ sales_reference: "S07920", project_title: "Capas LGU" })
      const wanted = seedOrder()
      seedOrder()
      db.seed("ipas_sors", { ipas_id: wanted.id, opportunity_id: sor.id })

      expect(sortedIds(await listAll({ search: "s07920" }))).toEqual(idsOf(wanted))
      expect(await listAll({ search: "S99999" })).toEqual([])
    })

    it("combines filters, so an order must match every one", async () => {
      const match = seedOrder({ source: "import", company: "T3ck Solutions" })
      seedOrder({ source: "import", company: "T3ck Trading" })
      seedOrder({ source: "local", company: "T3ck Solutions" })

      expect(sortedIds(await listAll({ source: "import", entity: "T3ck Solutions" }))).toEqual(idsOf(match))
    })

    it("carries the item: the first line's name, and how many more", async () => {
      const ipas = seedOrder({ lines: [{ ...LINE(30001), name: "Cutter" }, { ...LINE(30002), name: "Blade" }] })

      expect(rowsFor(await listAll(), ipas).item).toEqual({ name: "Cutter", more: 1 })
    })
  })

  describe("the register (#264): the track", () => {
    it("marks each step stamped, typed or pending, as the IPAS page does", async () => {
      const ipas = seedOrder({ source: "import", importClearanceOn: "2026-10-12" })
      seedPayment(ipas)

      const row = rowsFor(await listAll(), ipas)
      const mark = (key) => row.buyerTrack.find((item) => item.key === key).mark

      expect(row.buyerTrack).toHaveLength(7)
      expect(mark("purchase_order")).toBe("stamped")
      expect(mark("with_pop")).toBe("stamped")
      expect(mark("import_clearance")).toBe("typed")
      expect(mark("delivered")).toBe("pending")
      expect(mark("received_in_odoo")).toBe("pending")
      expect(mark("create_bill")).toBe("pending")
      expect(mark("actual_checking")).toBe("pending")
    })

    it("marks a typed Delivered date typed, and one stamped from a Transmittal stamped", async () => {
      const typed = seedOrder({ deliveredOn: "2026-10-14" })
      const slipped = seedOrder()
      seedSlip({ stages: { warehouse_checking: at(10) }, lines: [{ ipas: slipped, odooPoLineId: slipped.odoo_copy.lines[0].line_id }] })

      const rows = await listAll()

      expect(rowsFor(rows, typed).buyerTrack.find((i) => i.key === "delivered").mark).toBe("typed")
      expect(rowsFor(rows, slipped).buyerTrack.find((i) => i.key === "delivered").mark).toBe("stamped")
    })

    it("draws no Import Clearance for a Local order", async () => {
      const ipas = seedOrder({ source: "local" })

      expect(rowsFor(await listAll(), ipas).buyerTrack.map((i) => i.key)).not.toContain("import_clearance")
    })
  })

  describe("the register (#264): the hand-off", () => {
    const lineOf = (ipas) => ipas.odoo_copy.lines[0].line_id

    it("shows no hand-off for an order with no Transmittal", async () => {
      const ipas = seedOrder({ deliveredOn: "2026-10-14" })

      expect(rowsFor(await listAll(), ipas).transmittals.latest).toBeNull()
    })

    it("shows the latest Transmittal's stage and an open check", async () => {
      const ipas = seedOrder()
      seedSlip({ state: "warehouse_checking", stages: {}, lines: [{ ipas, odooPoLineId: lineOf(ipas) }] })

      const { latest } = rowsFor(await listAll(), ipas).transmittals

      expect(latest.stateLabel).toBeTruthy()
      expect(latest.check).toBe("open")
    })

    it("shows GC once the checking stage is complete and every line is rated GC", async () => {
      const ipas = seedOrder()
      seedSlip({
        state: "awaiting_check",
        stages: { warehouse_checking: at(10) },
        lines: [{ ipas, odooPoLineId: lineOf(ipas), wh: "gc" }],
      })

      expect(rowsFor(await listAll(), ipas).transmittals.latest.check).toBe("gc")
    })

    it("shows NA for a line rated NA at checking", async () => {
      const ipas = seedOrder()
      seedSlip({
        state: "awaiting_check",
        stages: { warehouse_checking: at(10) },
        lines: [{ ipas, odooPoLineId: lineOf(ipas), wh: "na" }],
      })

      expect(rowsFor(await listAll(), ipas).transmittals.latest.check).toBe("na")
    })

    it("shows NA · replaced when a later Transmittal rates the same PO line GC", async () => {
      const ipas = seedOrder()
      seedSlip({
        state: "closed",
        closedAt: at(9),
        preparedOn: "2026-10-05",
        stages: { warehouse_checking: at(9) },
        lines: [{ ipas, odooPoLineId: lineOf(ipas), wh: "na" }],
      })
      const later = seedSlip({
        state: "closed",
        closedAt: at(12),
        preparedOn: "2026-10-12",
        stages: { warehouse_checking: at(12) },
        lines: [{ ipas, odooPoLineId: lineOf(ipas), wh: "gc" }],
      })

      const { latest } = rowsFor(await listAll(), ipas).transmittals

      expect(latest.check).toBe("na_replaced")
      expect(latest.number).toBe(later.number)
    })
  })

  describe("the register (#264): Supplier Origin on Delivered", () => {
    it("gives an Import order waiting on Delivered its latest Supplier Origin date", async () => {
      const ipas = seedOrder({
        source: "import",
        shippedOutOn: "2026-10-02",
        onboardOn: "2026-10-05",
        importClearanceOn: "2026-10-12",
      })
      seedPayment(ipas)

      const row = rowsFor(await listAll(), ipas)

      expect(row.next.step).toBe("delivered")
      expect(row.next.detail).toEqual({ label: "Onboard", on: "2026-10-05" })
    })

    it("gives a Local order waiting on Delivered no such date", async () => {
      const ipas = seedOrder({ source: "local" })
      seedPayment(ipas)

      const row = rowsFor(await listAll(), ipas)

      expect(row.next.step).toBe("delivered")
      expect(row.next.detail).toBeNull()
    })
  })
})
