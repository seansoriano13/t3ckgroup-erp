import { beforeEach, describe, expect, it } from "vitest"
import { ipasService } from "./ipasService"
import { db } from "@/test/db/store"
import { supabase } from "@/lib/supabase"
import { stubEdgeFunction } from "@/test/msw/server"
import { waitForNetworkIdle } from "@/test/network"
import { makeEmployee, makeFlowStage, makeOpportunity } from "@/test/factories"
import { stubIpasRpcs } from "@/test/stubs/ipasRpc"
import { IPAS_ERROR, IPAS_NOTIFICATION, IPAS_WARNING } from "@/constants/ipas"
import { REFUSAL } from "@/constants/refusal"

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

    it("keeps counting past TGIPAS_999 without cutting the number short", async () => {
      stubEdgeFunction("odoo-po-ipas", (body) => odooPo({ name: body.poNumber }))
      await raise({ poNumber: "P01101" })
      // The database formats `TGIPAS_` + the sequence value, three digits at least and
      // never truncated (migration 20261013101000, proven in 64-ipas-review-fixes); the
      // stub mirrors it, and nothing here may read TGIPAS_100 for the thousandth.
      db.internal.rowsOf("ipas")[0].number = "TGIPAS_999"
      const thousandth = await raise({ poNumber: "P01102" })
      const next = await raise({ poNumber: "P01103" })

      expect([thousandth.number, next.number]).toEqual(["TGIPAS_1000", "TGIPAS_1001"])
      expect(new Set(db.rows("ipas").map((row) => row.number)).size).toBe(3)
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

    it("gives only the reference, project and Stage, never the customer", async () => {
      const stage = makeFlowStage({ name: "Quotation" })
      const sor = makeOpportunity({
        registered_by: salesperson.id,
        sales_reference: "S07930",
        project_title: "Staged",
        client_name: "Zorblax Holdings",
        flow_stage_id: stage.id,
      })

      const [suggestion] = await ipasService.suggestSors(odooPo({ origin: "S07930 Staged" }))
      expect(Object.keys(suggestion).sort()).toEqual(["current_stage_name", "found_in", "id", "project_title", "sales_reference"])
      expect(suggestion).toMatchObject({ id: sor.id, current_stage_name: "Quotation" })

      const [found] = await ipasService.searchSors("S07930")
      expect(Object.keys(found).sort()).toEqual(["current_stage_name", "id", "project_title", "sales_reference"])
    })

    it("searches by reference or project, and no longer by customer", async () => {
      makeOpportunity({
        registered_by: salesperson.id,
        sales_reference: "S07931",
        project_title: "Harbour Rescue",
        client_name: "Zorblax Holdings",
      })

      expect((await ipasService.searchSors("harbour")).map((s) => s.sales_reference)).toEqual(["S07931"])
      expect((await ipasService.searchSors("S07931")).map((s) => s.sales_reference)).toEqual(["S07931"])
      expect(await ipasService.searchSors("zorblax")).toEqual([])
    })

    it("suggests nothing when the copy names no SOR, and ignores an S number no SOR has", async () => {
      expect(await ipasService.suggestSors(odooPo({ origin: "Stock replenishment" }))).toEqual([])
      expect(await ipasService.suggestSors(odooPo({ origin: "S00001 Nobody" }))).toEqual([])
    })
  })

  describe("change and cancel", () => {
    let sor

    beforeEach(() => {
      stubEdgeFunction("odoo-po-ipas", odooPo())
      sor = makeOpportunity({ registered_by: salesperson.id, sales_reference: "S07920", project_title: "Capas LGU" })
    })

    it("changes the Purpose, keeps the change in history, and leaves the SOR list alone", async () => {
      const row = await raise({ purpose: "inventory" })

      const updated = await ipasService.setPurpose(row.id, "supplies")
      expect(updated.purpose).toBe("supplies")
      expect(db.rows("ipas_events").map((e) => e.kind)).toEqual(["created", "purpose_sors_changed"])
    })

    it("refuses a Purpose that doesn't fit the SORs it has, and changes nothing", async () => {
      const stock = await raise({ purpose: "inventory" })
      await expect(ipasService.setPurpose(stock.id, "project")).rejects.toMatchObject({ code: REFUSAL.INVALID })
      expect(db.rows("ipas")[0].purpose).toBe("inventory")
    })

    it("keeps a Project's SORs: its Purpose can't move away from them", async () => {
      const project = await raise({ purpose: "project", sorIds: [sor.id] })
      await expect(ipasService.setPurpose(project.id, "events")).rejects.toMatchObject({ code: REFUSAL.INVALID })
      expect(db.rows("ipas")[0].purpose).toBe("project")
      expect(db.rows("ipas_sors")).toHaveLength(1)
    })

    it("refuses a change to a filed IPAS", async () => {
      const row = await raise()
      db.internal.rowsOf("ipas").find((r) => r.id === row.id).state = "filed"

      await expect(ipasService.setPurpose(row.id, "events")).rejects.toMatchObject({
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
      const stage = makeFlowStage({ name: "Quotation" })
      const sor = makeOpportunity({
        registered_by: salesperson.id,
        sales_reference: "S07920",
        project_title: "Capas LGU",
        flow_stage_id: stage.id,
      })
      await raise({ poNumber: "P01001", purpose: "project", sorIds: [sor.id] })
      db.setClock("2099-01-01T00:00:00.000Z")
      await raise({ poNumber: "P01002" })

      const rows = await ipasService.list()

      expect(rows.map((r) => r.po_number)).toEqual(["P01002", "P01001"])
      expect(rows[1]).toMatchObject({ entity: "T3ck Trading", supplier: "Scorpe Technologies", currency: "Php" })
      expect(rows[1].sors).toEqual([
        { id: sor.id, salesReference: "S07920", projectTitle: "Capas LGU", stageName: "Quotation" },
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

  /**
   * #243: opening an IPAS refreshes the stored copy. `odoo` is the PO as Odoo
   * answers right now; a test changes it between opens, as Odoo would.
   */
  describe("keeping the Odoo copy current", () => {
    const line = (id, over = {}) => ({
      line_id: id,
      product_id: id * 10,
      name: `Item ${id}`,
      quantity: 2,
      unit: "Unit",
      price_unit: 100,
      price_subtotal: 200,
      taxes: [],
      analytic: [],
      brand: null,
      ...over,
    })

    let odoo
    let row
    const setOdoo = (over = {}) => {
      odoo = { ...odooPo({ lines: [line(1), line(2)] }), ...over }
      return odoo
    }
    const stored = () => db.internal.rowsOf("ipas").find((r) => r.id === row.id)
    const kinds = () => db.rows("ipas_events").map((e) => e.kind)

    beforeEach(async () => {
      setOdoo()
      stubEdgeFunction("odoo-po-ipas", () => odoo)
      row = await raise({ poNumber: "P02552" })
    })

    describe("refreshing", () => {
      it("shows new lines and a note listing each addition, removal and quantity or price change", async () => {
        odoo = {
          ...odoo,
          lines: [
            line(1, { quantity: 5, price_subtotal: 500 }), // quantity changed
            line(3, { price_unit: 40, price_subtotal: 80 }), // added; line 2 removed
          ],
        }

        const read = await ipasService.get(row.id)

        expect(read.lines.map((l) => l.line_id)).toEqual([1, 3])
        expect(read.refresh).toMatchObject({ ok: true, changed: true })
        expect(read.changeNote.added).toEqual([expect.objectContaining({ line_id: 3, name: "Item 3" })])
        expect(read.changeNote.removed).toEqual([expect.objectContaining({ line_id: 2 })])
        expect(read.changeNote.changed).toEqual([
          expect.objectContaining({ line_id: 1, quantity_from: 2, quantity_to: 5, price_unit_from: 100, price_unit_to: 100 }),
        ])
        expect(read.changeNote).toMatchObject({ totalFrom: 400, totalTo: 580 })
        expect(kinds()).toEqual(["created", "odoo_copy_changed"])
      })

      it("notes a price change on a line that kept its quantity", async () => {
        odoo = { ...odoo, lines: [line(1, { price_unit: 120, price_subtotal: 240 }), line(2)] }

        const read = await ipasService.get(row.id)

        expect(read.changeNote.changed).toEqual([
          expect.objectContaining({ line_id: 1, price_unit_from: 100, price_unit_to: 120 }),
        ])
        expect(read.changeNote.added).toEqual([])
        expect(read.changeNote.removed).toEqual([])
      })

      it("stores nothing new and writes no note when the PO hasn't changed", async () => {
        const read = await ipasService.get(row.id)

        expect(read.refresh).toMatchObject({ ok: true, changed: false })
        expect(read.changeNote).toBeNull()
        expect(kinds()).toEqual(["created"])
      })

      it("keeps the last note until a newer change replaces it", async () => {
        odoo = { ...odoo, lines: [line(1), line(2), line(3)] }
        await ipasService.get(row.id)
        const first = (await ipasService.get(row.id)).changeNote
        expect(first.added.map((l) => l.line_id)).toEqual([3])

        odoo = { ...odoo, lines: [line(1), line(2)] }
        const second = (await ipasService.get(row.id)).changeNote
        expect(second.removed.map((l) => l.line_id)).toEqual([3])
        expect(second.added).toEqual([])
      })

      it("moves the fetch time forward on every successful refresh", async () => {
        const before = stored().odoo_fetched_at

        const read = await ipasService.get(row.id)

        expect(read.refresh.fetchedAt).toBe(stored().odoo_fetched_at)
        expect(stored().odoo_fetched_at >= before).toBe(true)
      })

      it("returns the last copy with its fetch time when Odoo doesn't answer", async () => {
        const fetchedAt = stored().odoo_fetched_at
        stubEdgeFunction("odoo-po-ipas", { success: false, message: "Odoo is rate-limiting requests" })

        const read = await ipasService.get(row.id)

        expect(read.refresh).toMatchObject({ ok: false, reason: IPAS_ERROR.ODOO_UNAVAILABLE, fetchedAt })
        expect(read.odoo_fetched_at).toBe(fetchedAt)
        expect(read.lines.map((l) => l.line_id)).toEqual([1, 2])
        expect(kinds()).toEqual(["created"])
      })

      it("also falls back when Odoo no longer finds the PO", async () => {
        const fetchedAt = stored().odoo_fetched_at
        stubEdgeFunction("odoo-po-ipas", { success: true, found: false })

        const read = await ipasService.get(row.id)

        expect(read.refresh).toMatchObject({ ok: false, reason: IPAS_ERROR.PO_NOT_FOUND, fetchedAt })
        expect(read.lines).toHaveLength(2)
      })

      it("reads the stored copy without asking Odoo when told not to refresh", async () => {
        let asked = 0
        stubEdgeFunction("odoo-po-ipas", () => {
          asked += 1
          return odoo
        })

        const read = await ipasService.get(row.id, { refresh: false })

        expect(asked).toBe(0)
        expect(read.refresh).toBeNull()
        expect(read.lines).toHaveLength(2)
      })

      it("leaves a cancelled IPAS with the copy it had", async () => {
        await ipasService.cancel(row.id, "Dropped")
        let asked = 0
        stubEdgeFunction("odoo-po-ipas", () => {
          asked += 1
          return odooPo({ lines: [line(9)] })
        })

        const read = await ipasService.get(row.id)

        expect(asked).toBe(0)
        expect(read.refresh).toMatchObject({ ok: true, skipped: true })
        expect(read.lines.map((l) => l.line_id)).toEqual([1, 2])
      })

      it("refuses a refresh by someone who can't read IPAS", async () => {
        stubIpasRpcs({ actorId: salesperson.id, reader: false })
        odoo = { ...odoo, lines: [line(1)] }

        const outcome = await ipasService.refresh(row.id)

        expect(outcome).toMatchObject({ ok: false, reason: IPAS_ERROR.REFRESH_FAILED })
        expect(stored().odoo_copy.lines).toHaveLength(2)
      })
    })

    describe("overrides", () => {
      it("survives a refresh, shows Odoo's value beside it, and resets in one action", async () => {
        await ipasService.overrideField(row.id, "entity", " TG Enterprise ")
        odoo = { ...odoo, po: { ...odoo.po, company: "T3ck Trading Inc" } }

        const read = await ipasService.get(row.id)

        expect(read.entity).toBe("TG Enterprise")
        expect(read.overrides.entity).toMatchObject({
          overridden: true,
          override: "TG Enterprise",
          odoo: "T3ck Trading Inc",
          value: "TG Enterprise",
        })

        await ipasService.resetOverride(row.id, "entity")
        const reset = await ipasService.get(row.id)

        expect(reset.entity).toBe("T3ck Trading Inc")
        expect(reset.overrides.entity).toMatchObject({ overridden: false, override: null, value: "T3ck Trading Inc" })
      })

      it("overrides Source Doc. and Analytic Dist. the same way", async () => {
        odoo = { ...odoo, po: { ...odoo.po, origin: "S07920 Capas" }, lines: [line(1, { analytic: ["S07920 Capas", "Ops"] }), line(2)] }
        await ipasService.get(row.id)

        await ipasService.overrideField(row.id, "source_doc", "S07920 Capas LGU")
        await ipasService.overrideField(row.id, "analytic", "S07920 Capas LGU · Ops")
        const read = await ipasService.get(row.id)

        expect(read.overrides.source_doc).toMatchObject({ override: "S07920 Capas LGU", odoo: "S07920 Capas" })
        expect(read.overrides.analytic).toMatchObject({
          override: "S07920 Capas LGU · Ops",
          odoo: "S07920 Capas · Ops",
        })
      })

      it("keeps every override and reset in history, with Odoo's value at the time", async () => {
        await ipasService.overrideField(row.id, "entity", "TG Enterprise")
        await ipasService.overrideField(row.id, "entity", "TG Marine")
        await ipasService.resetOverride(row.id, "entity")

        const events = db.rows("ipas_events").filter((e) => e.kind.startsWith("override"))

        expect(events.map((e) => [e.kind, e.detail.field, e.detail.from ?? null, e.detail.to ?? null])).toEqual([
          ["override_set", "entity", null, "TG Enterprise"],
          ["override_set", "entity", "TG Enterprise", "TG Marine"],
          ["override_reset", "entity", "TG Marine", null],
        ])
        expect(events.every((e) => e.detail.odoo === "T3ck Trading")).toBe(true)
        expect(events.every((e) => e.actor_id === buyer.id)).toBe(true)
      })

      it("writes no history for an override that changes nothing, or a reset of a field that isn't overridden", async () => {
        await ipasService.overrideField(row.id, "entity", "TG Enterprise")
        await ipasService.overrideField(row.id, "entity", "TG Enterprise")
        await ipasService.resetOverride(row.id, "source_doc")

        expect(kinds()).toEqual(["created", "override_set"])
      })

      it.each(["currency", "supplier", "lines", "brand", "purchase_order", "received_in_odoo", "create_bill"])(
        "refuses to override %s, in the service and at the database",
        async (field) => {
          await expect(ipasService.overrideField(row.id, field, "Anything")).rejects.toMatchObject({
            code: IPAS_ERROR.INVALID,
          })
          await expect(ipasService.resetOverride(row.id, field)).rejects.toMatchObject({ code: IPAS_ERROR.INVALID })

          const direct = await supabase.rpc("ipas_override_field", { p_ipas_id: row.id, p_field: field, p_value: "x" })
          expect(direct.error?.code).toBe("22023")
          expect(stored().odoo_copy.po.currency).toBe("Php")
        },
      )

      it("needs a value to override, and is refused to a caller without Purchasing access", async () => {
        await expect(ipasService.overrideField(row.id, "entity", "   ")).rejects.toMatchObject({
          code: IPAS_ERROR.INVALID,
        })

        stubIpasRpcs({ actorId: salesperson.id, purchasing: false })
        await expect(ipasService.overrideField(row.id, "entity", "TG Enterprise")).rejects.toMatchObject({ code: "42501" })
        await expect(ipasService.resetOverride(row.id, "entity")).rejects.toMatchObject({ code: "42501" })
        expect(stored().entity_override ?? null).toBeNull()
      })

      it("refuses an override on a filed or cancelled IPAS", async () => {
        stored().state = "filed"
        await expect(ipasService.overrideField(row.id, "entity", "TG")).rejects.toMatchObject({ code: "55000" })
        stored().state = "cancelled"
        await expect(ipasService.overrideField(row.id, "entity", "TG")).rejects.toMatchObject({ code: "55000" })
      })

      it("filters the list by the entity in force, override included", async () => {
        await ipasService.overrideField(row.id, "entity", "TG Enterprise")

        expect((await ipasService.list({ entity: "TG Enterprise" })).map((r) => r.id)).toEqual([row.id])
        expect(await ipasService.list({ entity: "T3ck Trading" })).toEqual([])
      })
    })

    describe("contact and P.I #", () => {
      it("fill from Odoo while blank, on raising and on refresh", async () => {
        // Raised with Odoo's contact, and no vendor reference yet.
        expect(stored()).toMatchObject({ supplier_contact: "Ms. K. Tan", pi_number: null })

        odoo = { ...odoo, po: { ...odoo.po, partner_ref: "PI-2026-77" } }
        const read = await ipasService.get(row.id)

        expect(read).toMatchObject({ contact: "Ms. K. Tan", piNumber: "PI-2026-77", contactFromOdoo: true, piNumberFromOdoo: true })
        expect(db.rows("ipas_events").find((e) => e.kind === "filled_from_odoo").detail.fields).toEqual(["pi_number"])
      })

      it("are never overwritten once typed", async () => {
        await ipasService.setHeader(row.id, { supplierContact: "Mr. R. Cruz", piNumber: "PI-TYPED" })
        odoo = {
          ...odoo,
          po: { ...odoo.po, partner_ref: "PI-FROM-ODOO" },
          supplier: { ...odoo.supplier, contact: "Someone Else" },
        }

        const read = await ipasService.get(row.id)

        expect(read).toMatchObject({ contact: "Mr. R. Cruz", piNumber: "PI-TYPED", contactFromOdoo: false, piNumberFromOdoo: false })
      })

      it("fill again from the next copy once cleared", async () => {
        await ipasService.setHeader(row.id, { supplierContact: "   " })
        expect(stored().supplier_contact).toBeNull()

        const read = await ipasService.get(row.id)

        expect(read.contact).toBe("Ms. K. Tan")
      })

      it("keep a typed change in history, and refuse anything else in the header", async () => {
        await ipasService.setHeader(row.id, { piNumber: "PI-1" })
        expect(db.rows("ipas_events").at(-1)).toMatchObject({
          kind: "header_changed",
          detail: { fields: { pi_number: { from: null, to: "PI-1" } } },
        })

        const direct = await supabase.rpc("ipas_set_header", { p_ipas_id: row.id, p_fields: { purpose: "x" } })
        expect(direct.error?.code).toBe("22023")
        await expect(ipasService.setHeader(row.id, {})).rejects.toMatchObject({ code: IPAS_ERROR.INVALID })
      })
    })

    describe("statuses and warnings", () => {
      it("stamps Purchase Order, Received in Odoo and Create Bill from the copy, marked as from Odoo", async () => {
        odoo = { ...odoo, receipts: { status: "full", done: 2, total: 2 }, bills: { count: 1, draft: 0 } }

        const { statuses } = await ipasService.get(row.id)

        expect(statuses.purchaseOrder).toMatchObject({ ticked: true, stampedFromOdoo: true })
        expect(statuses.receivedInOdoo).toMatchObject({ ticked: true, partial: false, stampedFromOdoo: true })
        expect(statuses.createBill).toMatchObject({ ticked: true, draftsOnly: false, stampedFromOdoo: true })
      })

      it("says Partly received while only some receipts are done", async () => {
        odoo = { ...odoo, receipts: { status: "partial", done: 1, total: 2 } }

        const { statuses } = await ipasService.get(row.id)

        expect(statuses.receivedInOdoo).toMatchObject({ ticked: false, partial: true, receiptsDone: 1, receiptsTotal: 2 })
      })

      it("counts draft bills for Create Bill", async () => {
        odoo = { ...odoo, bills: { count: 1, draft: 1 } }

        const { statuses } = await ipasService.get(row.id)

        expect(statuses.createBill).toMatchObject({ ticked: true, count: 1, drafts: 1, draftsOnly: true })
      })

      it("leaves them unticked for an RFQ with no receipt or bill", async () => {
        odoo = { ...odoo, po: { ...odoo.po, state: "draft" }, receipts: { status: "pending", done: 0, total: 0 }, bills: { count: 0, draft: 0 } }

        const { statuses } = await ipasService.get(row.id)

        expect(statuses.purchaseOrder.ticked).toBe(false)
        expect(statuses.receivedInOdoo).toMatchObject({ ticked: false, partial: false })
        expect(statuses.createBill.ticked).toBe(false)
      })

      it("can't be ticked by hand: the service offers no way, and the database ignores the columns", async () => {
        // The computation status (#244) and the buyer track's typed and stamped statuses (#246,
        // Import Clearance, Delivered, Actual Checking) and document ticks are people's to set; the
        // three Odoo statuses (Purchase Order, Received in Odoo, Create Bill) are nobody's.
        const offered = Object.keys(ipasService).filter((name) => /status|tick|stamp|received|bill/i.test(name))
        expect(offered.sort()).toEqual(["setComputationStatus", "setTypedStatus", "stampActualChecking", "tickDocument"])
        expect(offered.filter((name) => /purchaseOrder|received|bill|createBill/i.test(name))).toEqual([])
        const direct = await supabase.rpc("ipas_set_header", {
          p_ipas_id: row.id,
          p_fields: { received_in_odoo: true },
        })
        expect(direct.error?.code).toBe("22023")
      })

      it("shows 'Odoo PO cancelled' and leaves the IPAS open", async () => {
        odoo = { ...odoo, po: { ...odoo.po, state: "cancel" } }

        const read = await ipasService.get(row.id)

        expect(read.state).toBe("open")
        expect(read.poCancelledInOdoo).toBe(true)
        expect(read.warnings.map((w) => w.code)).toContain(IPAS_WARNING.PO_CANCELLED_IN_ODOO)
        expect(read.warnings.find((w) => w.code === IPAS_WARNING.PO_CANCELLED_IN_ODOO).message).toBe("Odoo PO cancelled")
        expect(stored().state).toBe("open")
        expect(stored().cancelled_at ?? null).toBeNull()
        expect(read.statuses.purchaseOrder.ticked).toBe(false)
      })

      it("warns when Odoo's S numbers differ from the SORs, and changes nothing", async () => {
        const sor = makeOpportunity({ registered_by: salesperson.id, sales_reference: "S07920" })

        odoo = { ...odoo, po: { ...odoo.po, name: "P04000", origin: "S07920 Capas" } }
        const project = await raise({ poNumber: "P04000", purpose: "project", sorIds: [sor.id] })
        expect((await ipasService.get(project.id)).warnings.map((w) => w.code)).not.toContain(IPAS_WARNING.SOR_MISMATCH)

        odoo = { ...odoo, po: { ...odoo.po, origin: "S07920 Capas & S06070 Las Nieves" } }
        const read = await ipasService.get(project.id)

        const warning = read.warnings.find((w) => w.code === IPAS_WARNING.SOR_MISMATCH)
        expect(warning).toMatchObject({ onlyInOdoo: ["S06070"], onlyInIpas: [] })
        expect(read.purpose).toBe("project")
        expect(read.sors.map((s) => s.salesReference)).toEqual(["S07920"])
        expect(db.rows("ipas_sors").filter((s) => s.ipas_id === project.id)).toHaveLength(1)
      })

      it("says nothing when Odoo names no S number to compare", async () => {
        const read = await ipasService.get(row.id)
        expect(read.warnings).toEqual([])
      })
    })

    describe("when the lines or total change", () => {
      it("clears the live section 1 and 3 approvals and notifies the preparer", async () => {
        const preparer = makeEmployee({ name: "Prepared It" })
        const approver = makeEmployee({ name: "Approved It" })
        db.seed("ipas_signoffs", [
          { ipas_id: row.id, section: 1, role: "prepared", signed_by: preparer.id },
          { ipas_id: row.id, section: 1, role: "approved", signed_by: approver.id },
          { ipas_id: row.id, section: 3, role: "prepared", signed_by: preparer.id },
          { ipas_id: row.id, section: 3, role: "approved", signed_by: approver.id },
          // Section 7 isn't undone by an Odoo change.
          { ipas_id: row.id, section: 7, role: "received", signed_by: approver.id },
        ])
        const signoffs = () => db.rows("ipas_signoffs")
        stubIpasRpcs({ actorId: buyer.id })
        odoo = { ...odoo, lines: [line(1), line(2), line(3)] }

        const read = await ipasService.get(row.id)
        await waitForNetworkIdle()

        expect(read.refresh).toMatchObject({ ok: true, changed: true, approvalsCleared: [1, 3] })
        expect(signoffs().filter((s) => s.cleared_at).map((s) => [s.section, s.role])).toEqual([
          [1, "approved"],
          [3, "approved"],
        ])
        expect(signoffs().find((s) => s.section === 7).cleared_at).toBeNull()
        expect(signoffs().filter((s) => s.cleared_reason).every((s) => s.cleared_reason === "PO changed in Odoo")).toBe(true)
        expect(kinds()).toContain("approvals_cleared")

        const sent = db.rows("notifications").filter((n) => n.type === IPAS_NOTIFICATION.PO_CHANGED)
        expect(sent).toHaveLength(1)
        expect(sent[0]).toMatchObject({ recipient_id: preparer.id, reference_id: row.id })
        expect(sent[0].message).toContain(row.number)
      })

      it("clears nothing, and notifies nobody, when nothing had been approved", async () => {
        stubIpasRpcs({ actorId: buyer.id })
        odoo = { ...odoo, lines: [line(1)] }

        const read = await ipasService.get(row.id)
        await waitForNetworkIdle()

        expect(read.refresh).toMatchObject({ ok: true, changed: true, approvalsCleared: [] })
        expect(db.rows("notifications").filter((n) => n.type === IPAS_NOTIFICATION.PO_CHANGED)).toEqual([])
        expect(kinds()).not.toContain("approvals_cleared")
      })

      it("leaves approvals alone when only the receipts and bills moved", async () => {
        const preparer = makeEmployee({ name: "Prepared It" })
        db.seed("ipas_signoffs", [
          { ipas_id: row.id, section: 1, role: "prepared", signed_by: preparer.id },
          { ipas_id: row.id, section: 1, role: "approved", signed_by: preparer.id },
        ])
        stubIpasRpcs({ actorId: buyer.id })
        odoo = { ...odoo, receipts: { status: "full", done: 1, total: 1 }, bills: { count: 1, draft: 1 } }

        const read = await ipasService.get(row.id)

        expect(read.refresh.changed).toBe(false)
        expect(db.rows("ipas_signoffs").every((s) => !s.cleared_at)).toBe(true)
      })
    })

    describe("after filing", () => {
      beforeEach(() => {
        stored().state = "filed"
        stored().filed_at = "2026-10-14T00:00:00.000Z"
      })

      it("stores no new copy, and says 'Odoo has changed since filing' when the PO differs", async () => {
        const frozen = stored().odoo_copy
        const fetchedAt = stored().odoo_fetched_at
        odoo = { ...odoo, lines: [line(1), line(2, { quantity: 9, price_subtotal: 900 })] }

        const read = await ipasService.get(row.id)

        expect(read.refresh).toMatchObject({ ok: true, filed: true, changed: false })
        expect(stored().odoo_copy).toEqual(frozen)
        expect(stored().odoo_fetched_at).toBe(fetchedAt)
        expect(read.lines.map((l) => l.quantity)).toEqual([2, 2])
        expect(read.odoo_changed_since_filing).toBe(true)
        expect(read.warnings.map((w) => w.code)).toEqual([IPAS_WARNING.ODOO_CHANGED_SINCE_FILING])
        expect(kinds()).toEqual(["created", "odoo_changed_since_filing"])
      })

      it("shows no banner while the PO still matches the frozen copy", async () => {
        const read = await ipasService.get(row.id)

        expect(read.odoo_changed_since_filing).toBe(false)
        expect(read.warnings).toEqual([])
        expect(kinds()).toEqual(["created"])
      })

      it("doesn't fill a blank contact or P.I # on a frozen copy", async () => {
        stored().supplier_contact = null
        odoo = { ...odoo, po: { ...odoo.po, partner_ref: "PI-LATE" } }

        const read = await ipasService.get(row.id)

        expect(read.contact).toBeNull()
        expect(read.piNumber).toBeNull()
      })
    })

    /**
     * #250: printing refreshes the copy first, and doesn't on a filed IPAS,
     * which prints the frozen copy and never asks Odoo.
     */
    describe("printing", () => {
      const asked = () => {
        const calls = { count: 0 }
        stubEdgeFunction("odoo-po-ipas", () => {
          calls.count += 1
          return odoo
        })
        return calls
      }

      it("refreshes an unfiled IPAS's Odoo copy first, so the print is as current as Odoo allows", async () => {
        const calls = asked()
        odoo = { ...odoo, lines: [line(1), line(2), line(3, { quantity: 4, price_subtotal: 400 })] }

        const read = await ipasService.getForPrint(row.id)

        expect(calls.count).toBe(1)
        expect(read.lines.map((l) => l.line_id)).toEqual([1, 2, 3])
        expect(stored().odoo_copy.lines).toHaveLength(3)
        expect(read.refresh).toMatchObject({ ok: true, changed: true })
        expect(read.odoo_fetched_at).toBe(stored().odoo_fetched_at)
        expect(kinds()).toEqual(["created", "odoo_copy_changed"])
      })

      it("doesn't refresh a filed IPAS: it prints the frozen copy and never asks Odoo", async () => {
        stored().state = "filed"
        stored().filed_at = "2026-10-14T00:00:00.000Z"
        const frozen = stored().odoo_copy
        const fetchedAt = stored().odoo_fetched_at
        const calls = asked()
        odoo = { ...odoo, lines: [line(1, { quantity: 9, price_subtotal: 900 })] }

        const read = await ipasService.getForPrint(row.id)

        expect(calls.count).toBe(0)
        expect(stored().odoo_copy).toEqual(frozen)
        expect(stored().odoo_fetched_at).toBe(fetchedAt)
        expect(read.lines.map((l) => l.quantity)).toEqual([2, 2])
        expect(read.refresh).toMatchObject({ ok: true, skipped: true, filed: true, fetchedAt })
        // Printing didn't open a "changed since filing" question either.
        expect(read.odoo_changed_since_filing).toBe(false)
        expect(kinds()).toEqual(["created"])
      })

      it("prints the last copy, and says Odoo didn't answer, when the refresh can't happen", async () => {
        const fetchedAt = stored().odoo_fetched_at
        stubEdgeFunction("odoo-po-ipas", { success: false, message: "Odoo is rate-limiting requests" })

        const read = await ipasService.getForPrint(row.id)

        expect(read.refresh).toMatchObject({ ok: false, reason: IPAS_ERROR.ODOO_UNAVAILABLE, fetchedAt })
        expect(read.lines.map((l) => l.line_id)).toEqual([1, 2])
      })

      it("leaves a cancelled IPAS alone", async () => {
        await ipasService.cancel(row.id, "Dropped")
        const calls = asked()

        const read = await ipasService.getForPrint(row.id)

        expect(calls.count).toBe(0)
        expect(read.state).toBe("cancelled")
        expect(read.refresh).toMatchObject({ ok: true, skipped: true })
      })

      it("answers null for an IPAS that isn't there", async () => {
        expect(await ipasService.getForPrint(db.nextUuid())).toBeNull()
        expect(await ipasService.getForPrint(null)).toBeNull()
      })
    })

    it("keeps working when the refresh function itself fails", async () => {
      stubEdgeFunction("odoo-po-ipas", () => {
        throw new Error("boom")
      })

      const read = await ipasService.get(row.id)

      expect(read.refresh).toMatchObject({ ok: false, reason: IPAS_ERROR.ODOO_UNAVAILABLE })
      expect(read.lines).toHaveLength(2)
    })

    it("a signed-in caller can't store a copy of their own making", async () => {
      await expect(
        supabase.rpc("ipas_record_odoo_copy", { p_ipas_id: row.id, p_odoo_copy: odooPo({ lines: [line(9)] }) }),
      ).resolves.toMatchObject({ error: { code: "42501" } })
    })
  })
})
