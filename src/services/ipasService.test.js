import { beforeEach, describe, expect, it } from "vitest"
import { ipasService } from "./ipasService"
import { db } from "@/test/db/store"
import { stubEdgeFunction } from "@/test/msw/server"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { stubIpasRpcs } from "@/test/stubs/ipasRpc"
import { IPAS_ERROR } from "@/constants/ipas"

/**
 * IPAS raise, list and cancel (#242) through the service, against the fake
 * database with the RPCs re-implemented on its store and Odoo's `odoo-po-ipas`
 * stubbed (it can't run locally). Proves the wiring and the screens' reading
 * of it; the rules themselves are the policy tier's (56-ipas-raise).
 */

const odooPo = ({ name = "P02552", state = "purchase", origin = null, company = "T3ck Trading", lines } = {}) => ({
  success: true,
  found: true,
  po: {
    id: 2552,
    name,
    state,
    company,
    company_id: 1,
    currency: "Php",
    origin,
    partner_ref: null,
  },
  supplier: { id: 553, name: "Scorpe Technologies", contact: "Ms. K. Tan" },
  lines: lines ?? [
    {
      line_id: 11400,
      product_id: 5350,
      name: "[10GPT00030] Greenspirit 2 Cutter SC",
      quantity: 6,
      unit: "Unit",
      price_unit: 1250,
      price_subtotal: 7500,
      taxes: ["12% VAT"],
      analytic: [],
      brand: "SCORPE",
    },
  ],
  receipts: { status: "pending", done: 0, total: 1 },
  bills: { count: 0, draft: 0 },
})

describe("ipasService", () => {
  let buyer, salesperson

  beforeEach(() => {
    buyer = makeEmployee({ name: "Buyer", department: "OPERATIONS", has_purchasing_flow: true })
    salesperson = makeEmployee({ name: "Sales Person", department: "SALES" })
    stubIpasRpcs({ actorId: buyer.id })
  })

  const raise = (overrides = {}) =>
    ipasService.create({
      poNumber: "P02552",
      priority: "high",
      source: "local",
      purpose: "inventory",
      ...overrides,
    })

  describe("create", () => {
    it("raises an IPAS against a PO Odoo finds, numbered from TGIPAS_049", async () => {
      let asked
      stubEdgeFunction("odoo-po-ipas", (body) => {
        asked = body
        return odooPo()
      })

      const row = await raise({ poNumber: " p02552 ", remarks: "  Stock for Q4  " })

      expect(asked).toEqual({ poNumber: "P02552" })
      expect(row).toMatchObject({
        number: "TGIPAS_049",
        po_number: "P02552",
        state: "open",
        purpose: "inventory",
        remarks: "Stock for Q4",
        created_by: buyer.id,
      })
      expect(row.odoo_copy.po.company).toBe("T3ck Trading")
      expect(row.odoo_copy.lines[0]).toMatchObject({ line_id: 11400, price_unit: 1250, brand: "SCORPE" })
      expect(db.rows("ipas_events").map((e) => e.kind)).toEqual(["created"])
    })

    it("accepts an RFQ that isn't confirmed yet", async () => {
      stubEdgeFunction("odoo-po-ipas", odooPo({ state: "draft" }))
      const row = await raise()
      expect(row.odoo_copy.po.state).toBe("draft")
    })

    it("refuses a PO Odoo doesn't have, and writes nothing", async () => {
      stubEdgeFunction("odoo-po-ipas", { success: true, found: false })

      await expect(raise()).rejects.toMatchObject({ code: IPAS_ERROR.PO_NOT_FOUND })
      expect(db.rows("ipas")).toEqual([])
    })

    it.each([
      ["Odoo answers success:false", { success: false, message: "Odoo is rate-limiting requests" }],
      ["the function is unreachable", null],
    ])("reports could-not-check, never not-found, when %s", async (_, answer) => {
      if (answer) stubEdgeFunction("odoo-po-ipas", answer)

      const failure = await raise().catch((error) => error)

      expect(failure.code).toBe(IPAS_ERROR.ODOO_UNAVAILABLE)
      expect(failure.code).not.toBe(IPAS_ERROR.PO_NOT_FOUND)
      expect(failure.message).toMatch(/couldn't check/i)
      expect(db.rows("ipas")).toEqual([])
    })

    it("refuses a number that isn't an Odoo PO before asking Odoo", async () => {
      let asked = false
      stubEdgeFunction("odoo-po-ipas", () => {
        asked = true
        return odooPo()
      })
      await expect(raise({ poNumber: "PO-12" })).rejects.toMatchObject({ code: IPAS_ERROR.PO_INVALID })
      expect(asked).toBe(false)
    })

    it("refuses a second live IPAS for the PO, and allows one once the first is cancelled", async () => {
      stubEdgeFunction("odoo-po-ipas", odooPo())
      const first = await raise()

      await expect(raise()).rejects.toMatchObject({ code: "23505", message: expect.stringContaining(first.number) })
      expect(db.rows("ipas")).toHaveLength(1)

      await ipasService.cancel(first.id, "Wrong PO")
      const second = await raise()

      expect(second.state).toBe("open")
      expect(db.rows("ipas")).toHaveLength(2)
    })

    it("never reuses a cancelled number", async () => {
      stubEdgeFunction("odoo-po-ipas", (body) => odooPo({ name: body.poNumber }))
      const a = await raise({ poNumber: "P01001" })
      const b = await raise({ poNumber: "P01002" })
      await ipasService.cancel(b.id, "Dropped")
      const c = await raise({ poNumber: "P01003" })

      expect([a.number, b.number, c.number]).toEqual(["TGIPAS_049", "TGIPAS_050", "TGIPAS_051"])
    })

    it("needs an SOR on a Project and refuses one on any other Purpose", async () => {
      stubEdgeFunction("odoo-po-ipas", odooPo())
      const sor = makeOpportunity({ registered_by: salesperson.id, sales_reference: "S07920" })

      await expect(raise({ purpose: "project", sorIds: [] })).rejects.toMatchObject({ code: IPAS_ERROR.INVALID })
      await expect(raise({ purpose: "events", sorIds: [sor.id] })).rejects.toMatchObject({ code: IPAS_ERROR.INVALID })
      expect(db.rows("ipas")).toEqual([])

      const row = await raise({ purpose: "project", sorIds: [sor.id] })
      expect(db.rows("ipas_sors")).toEqual([expect.objectContaining({ ipas_id: row.id, opportunity_id: sor.id })])
    })

    it("refuses a Purchasing-less caller at the database", async () => {
      stubIpasRpcs({ actorId: salesperson.id, purchasing: false })
      stubEdgeFunction("odoo-po-ipas", odooPo())
      await expect(raise()).rejects.toMatchObject({ code: "42501" })
    })
  })

  describe("suggestSors", () => {
    let s07920, s06070, s04602

    beforeEach(() => {
      s07920 = makeOpportunity({ registered_by: salesperson.id, sales_reference: "S07920", project_title: "Capas LGU" })
      s06070 = makeOpportunity({ registered_by: salesperson.id, sales_reference: "S06070", project_title: "Rescue Vehicle" })
      s04602 = makeOpportunity({ registered_by: salesperson.id, sales_reference: "S04602", project_title: "Wack-Wack" })
      makeOpportunity({ registered_by: salesperson.id, sales_reference: "S09999", project_title: "Unrelated" })
    })

    it("suggests the SORs the Source Document names", async () => {
      const copy = odooPo({ origin: "S07920 Capas  Municipal Government" })
      const suggestions = await ipasService.suggestSors(copy)

      expect(suggestions).toEqual([
        expect.objectContaining({ id: s07920.id, sales_reference: "S07920", found_in: ["origin"] }),
      ])
    })

    it("suggests from analytic account names too, and says where each was found", async () => {
      const copy = odooPo({
        origin: "1pc S06070 Las Nieves & 1pc S04602 Brgy. Wack-Wack",
        lines: [
          { line_id: 1, name: "A", quantity: 1, price_unit: 1, analytic: ["S06070 Rescue Vehicle"] },
          { line_id: 2, name: "B", quantity: 1, price_unit: 1, analytic: ["S07920 Capas"] },
        ],
      })
      const suggestions = await ipasService.suggestSors(copy)
      const byRef = Object.fromEntries(suggestions.map((s) => [s.sales_reference, s]))

      expect(Object.keys(byRef).sort()).toEqual(["S04602", "S06070", "S07920"])
      expect(byRef.S06070.found_in).toEqual(["origin", "analytic"])
      expect(byRef.S04602.found_in).toEqual(["origin"])
      expect(byRef.S07920.found_in).toEqual(["analytic"])
      expect(byRef.S06070.id).toBe(s06070.id)
      expect(byRef.S04602.id).toBe(s04602.id)
    })

    it("suggests nothing when the copy names no SOR, and ignores an S number no SOR has", async () => {
      expect(await ipasService.suggestSors(odooPo({ origin: "Stock replenishment" }))).toEqual([])
      expect(await ipasService.suggestSors(odooPo({ origin: "S00001 Nobody" }))).toEqual([])
    })
  })

  describe("change and cancel", () => {
    let sor, otherSor

    beforeEach(() => {
      stubEdgeFunction("odoo-po-ipas", odooPo())
      sor = makeOpportunity({ registered_by: salesperson.id, sales_reference: "S07920", project_title: "Capas LGU" })
      otherSor = makeOpportunity({ registered_by: salesperson.id, sales_reference: "S06070" })
    })

    it("changes Purpose and SORs together, and keeps the change in history", async () => {
      const row = await raise({ purpose: "project", sorIds: [sor.id] })

      await ipasService.setPurposeAndSors(row.id, { purpose: "project", sorIds: [sor.id, otherSor.id] })
      expect(db.rows("ipas_sors")).toHaveLength(2)

      const updated = await ipasService.setPurposeAndSors(row.id, { purpose: "supplies", sorIds: [] })
      expect(updated.purpose).toBe("supplies")
      expect(db.rows("ipas_sors")).toEqual([])
      expect(db.rows("ipas_events").map((e) => e.kind)).toEqual([
        "created",
        "purpose_sors_changed",
        "purpose_sors_changed",
      ])
    })

    it("refuses a Project with no SOR and a non-Project with one, and changes nothing", async () => {
      const row = await raise({ purpose: "inventory" })
      await expect(ipasService.setPurposeAndSors(row.id, { purpose: "project", sorIds: [] })).rejects.toMatchObject({
        code: IPAS_ERROR.INVALID,
      })
      await expect(ipasService.setPurposeAndSors(row.id, { purpose: "inventory", sorIds: [sor.id] })).rejects.toMatchObject({
        code: IPAS_ERROR.INVALID,
      })
      expect(db.rows("ipas")[0].purpose).toBe("inventory")
    })

    it("refuses a change to a filed IPAS", async () => {
      const row = await raise()
      db.internal.rowsOf("ipas").find((r) => r.id === row.id).state = "filed"

      await expect(ipasService.setPurposeAndSors(row.id, { purpose: "events", sorIds: [] })).rejects.toMatchObject({
        code: "55000",
      })
    })

    it("needs a reason to cancel, keeps the number, and leaves the IPAS readable", async () => {
      const row = await raise()

      await expect(ipasService.cancel(row.id, "   ")).rejects.toMatchObject({ code: IPAS_ERROR.INVALID })
      expect(db.rows("ipas")[0].state).toBe("open")

      const cancelled = await ipasService.cancel(row.id, "Supplier withdrew")
      expect(cancelled).toMatchObject({
        number: row.number,
        state: "cancelled",
        cancel_reason: "Supplier withdrew",
        cancelled_by: buyer.id,
      })

      const read = await ipasService.get(row.id)
      expect(read).toMatchObject({ number: row.number, state: "cancelled", cancel_reason: "Supplier withdrew" })
      expect(read.events.map((e) => e.kind)).toEqual(["created", "cancelled"])
    })

    it("refuses to cancel a filed IPAS or one already cancelled", async () => {
      const filed = await raise()
      db.internal.rowsOf("ipas").find((r) => r.id === filed.id).state = "filed"
      await expect(ipasService.cancel(filed.id, "Oops")).rejects.toMatchObject({ code: "55000" })

      stubEdgeFunction("odoo-po-ipas", odooPo({ name: "P03000" }))
      const second = await raise({ poNumber: "P03000" })
      await ipasService.cancel(second.id, "Once")
      await expect(ipasService.cancel(second.id, "Twice")).rejects.toMatchObject({ code: "55000" })
    })
  })

  describe("list and get", () => {
    beforeEach(() => {
      stubEdgeFunction("odoo-po-ipas", (body) =>
        odooPo({
          name: body.poNumber,
          company: body.poNumber === "P01003" ? "TG Enterprise" : "T3ck Trading",
        }),
      )
    })

    it("lists newest first with each IPAS's entity, supplier and SORs", async () => {
      const sor = makeOpportunity({ registered_by: salesperson.id, sales_reference: "S07920", project_title: "Capas LGU" })
      await raise({ poNumber: "P01001", purpose: "project", sorIds: [sor.id] })
      db.setClock("2026-10-14T00:00:00.000Z")
      await raise({ poNumber: "P01002" })

      const rows = await ipasService.list()

      expect(rows.map((r) => r.po_number)).toEqual(["P01002", "P01001"])
      expect(rows[1]).toMatchObject({ entity: "T3ck Trading", supplier: "Scorpe Technologies", currency: "Php" })
      expect(rows[1].sors).toEqual([
        { id: sor.id, salesReference: "S07920", projectTitle: "Capas LGU", clientName: sor.client_name },
      ])
      expect(rows[0].sors).toEqual([])
    })

    it("filters by state, entity and Purpose", async () => {
      const sor = makeOpportunity({ registered_by: salesperson.id, sales_reference: "S07920" })
      const a = await raise({ poNumber: "P01001", purpose: "project", sorIds: [sor.id] })
      const b = await raise({ poNumber: "P01002", purpose: "supplies" })
      await raise({ poNumber: "P01003", purpose: "supplies" })
      await ipasService.cancel(b.id, "Dropped")

      const numbers = async (filter) => (await ipasService.list(filter)).map((r) => r.po_number).sort()

      expect(await numbers({ state: "open" })).toEqual(["P01001", "P01003"])
      expect(await numbers({ state: "cancelled" })).toEqual(["P01002"])
      expect(await numbers({ state: "filed" })).toEqual([])
      expect(await numbers({ entity: "TG Enterprise" })).toEqual(["P01003"])
      expect(await numbers({ purpose: "project" })).toEqual([a.po_number])
      expect(await numbers({ state: "open", purpose: "supplies" })).toEqual(["P01003"])
    })

    it("reads one IPAS with its stored copy, fetch time and SORs", async () => {
      const sor = makeOpportunity({ registered_by: salesperson.id, sales_reference: "S07920", project_title: "Capas LGU" })
      const row = await raise({ poNumber: "P01001", purpose: "project", sorIds: [sor.id] })

      const read = await ipasService.get(row.id)

      expect(read).toMatchObject({ id: row.id, number: row.number, purpose: "project", isProject: true })
      expect(read.odoo_fetched_at).toBeTruthy()
      expect(read.lines).toHaveLength(1)
      expect(read.sors.map((s) => s.salesReference)).toEqual(["S07920"])
      expect(read.creator).toMatchObject({ id: buyer.id, name: "Buyer" })
      expect(read.events[0]).toMatchObject({ kind: "created", actor: { id: buyer.id } })
    })

    it("returns null for an IPAS that isn't there", async () => {
      expect(await ipasService.get(db.nextUuid())).toBeNull()
      expect(await ipasService.get(null)).toBeNull()
    })
  })
})
