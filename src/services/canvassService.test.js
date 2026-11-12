import { readFileSync } from "node:fs"
import { beforeEach, describe, expect, it } from "vitest"

import { canvassService } from "./canvassService"
import { db } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { seedCanvass, stubCanvassMoneyRpc } from "@/test/stubs/canvassRpc"
import { stubEdgeFunction } from "@/test/msw/server"
import { containsPattern } from "../../supabase/functions/_shared/ilikePattern.ts"

/**
 * The Canvass (#967, spec #956), through the service's public methods on the fake PostgREST. What
 * is asserted is what a purchaser and a reader without money read back: one Canvass per Purchase
 * Request, its number, the suppliers and the quotes with their PHP figures, the line winners, and
 * no money keys at all for a reader without money. Who may write what is the policy tier's
 * (90-canvass-tables.test.js).
 */
describe("canvassService", () => {
  let purchaser
  let request
  let lineA
  let lineB
  let otherRequest

  beforeEach(() => {
    stubCanvassMoneyRpc({ money: true })
    purchaser = makeEmployee({ name: "Marco Dizon", has_purchasing_flow: true })
    const deal = makeOpportunity({ registered_by: purchaser.id, sales_reference: "S07983" })
    request = db.seed("purchase_requests", { opportunity_id: deal.id, created_by: purchaser.id, title: "S07983 supplies" })
    otherRequest = db.seed("purchase_requests", { created_by: purchaser.id, title: "Other" })
    const line = (name, requestId = request.id) =>
      db.seed("purchase_request_items", { request_id: requestId, name, quantity: 1, source: "new", requested_by: purchaser.id })
    lineA = line("Ambulance Folding Stretcher")
    lineB = line("Spine board")
  })

  // The prototype's CNV_0142: Redleaf and Ferno in PHP, Hong Kong in USD at a comparison rate, on two lines.
  const sample = async () => {
    const redleaf = await canvassService.addSupplier(request.id, { supplierName: "Redleaf Inc.", leadTime: "14 days" }, purchaser.id)
    const ferno = await canvassService.addSupplier(request.id, { supplierName: "Ferno" }, purchaser.id)
    const hk = await canvassService.addSupplier(
      request.id,
      { supplierName: "Hong Kong", currency: "USD", comparisonRate: 56.5625, leadTime: "45 days", validUntil: "2026-11-30" },
      purchaser.id,
    )
    await canvassService.saveQuote(redleaf.supplier.id, lineA.id, { brand: "Redleaf", unitPrice: 78000 })
    await canvassService.saveQuote(ferno.supplier.id, lineA.id, { brand: "Ferno", unitPrice: 82500 })
    await canvassService.saveQuote(hk.supplier.id, lineA.id, { brand: "HK", unitPrice: 1280 })
    await canvassService.saveQuote(redleaf.supplier.id, lineB.id, { brand: "Redleaf", unitPrice: 4500 })
    return { redleaf: redleaf.supplier, ferno: ferno.supplier, hk: hk.supplier }
  }

  describe("starting (the first supplier gives the number)", () => {
    it("has no Canvass, and reading writes none, until the first supplier is saved", async () => {
      expect(await canvassService.getForRequest(request.id)).toBeNull()
      expect(await canvassService.get({})).toBeNull()
      expect(db.rows("request_canvasses")).toHaveLength(0)
    })

    it("starts one Canvass with a CNV_ number when the first supplier is saved", async () => {
      const started = await canvassService.addSupplier(request.id, { supplierName: "Ferno" }, purchaser.id)
      expect(started.number).toBe("CNV_0001")
      const canvass = await canvassService.getForRequest(request.id)
      expect(canvass).toMatchObject({ id: started.canvassId, number: "CNV_0001", request_id: request.id, created_by: purchaser.id })
      expect(canvass.suppliers.map((s) => s.supplier_name)).toEqual(["Ferno"])
    })

    it("a second supplier joins the same Canvass, after the first", async () => {
      const first = await canvassService.addSupplier(request.id, { supplierName: "Ferno" }, purchaser.id)
      const second = await canvassService.addSupplier(request.id, { supplierName: "Redleaf" }, purchaser.id)
      expect(second.canvassId).toBe(first.canvassId)
      expect(db.rows("request_canvasses")).toHaveLength(1)
      expect((await canvassService.getForRequest(request.id)).suppliers.map((s) => s.supplier_name)).toEqual(["Ferno", "Redleaf"])
    })

    it("numbers each request's Canvass in turn", async () => {
      await canvassService.addSupplier(request.id, { supplierName: "Ferno" }, purchaser.id)
      const second = await canvassService.addSupplier(otherRequest.id, { supplierName: "Ferno" }, purchaser.id)
      expect(second.number).toBe("CNV_0002")
    })

    it("reads a Canvass by its id as well as by its request", async () => {
      const started = await canvassService.addSupplier(request.id, { supplierName: "Ferno" }, purchaser.id)
      expect((await canvassService.get({ canvassId: started.canvassId })).request_id).toBe(request.id)
    })

    it("refuses a supplier with no name, and starts nothing", async () => {
      await expect(canvassService.addSupplier(request.id, { supplierName: "  " }, purchaser.id)).rejects.toThrow(/needs a name/)
      await expect(canvassService.addSupplier(null, { supplierName: "Ferno" }, purchaser.id)).rejects.toThrow(/Purchase Request id/)
      expect(db.rows("request_canvasses")).toHaveLength(0)
    })

    it("an empty Canvass made for a test reads with no suppliers", async () => {
      const canvass = await seedCanvass(request.id, purchaser.id)
      expect(canvass).toMatchObject({ request_id: request.id, suppliers: [], quotes: [], winners: [], noOtherSupplier: null })
    })
  })

  describe("suppliers", () => {
    it("keeps currency, how long the quote holds, lead time and quality note on the supplier", async () => {
      await canvassService.addSupplier(
        request.id,
        { supplierName: " Hong Kong ", currency: "usd", comparisonRate: 56, validUntil: "2026-11-30", leadTime: "45 days", qualityNote: "ISO 9001" },
        purchaser.id,
      )
      const [supplier] = (await canvassService.getForRequest(request.id)).suppliers
      expect(supplier).toMatchObject({
        supplier_name: "Hong Kong",
        currency: "USD",
        comparison_rate: 56,
        valid_until: "2026-11-30",
        lead_time: "45 days",
        quality_note: "ISO 9001",
        sort_order: 0,
      })
    })

    it("refuses a rate on a PHP supplier, and a currency that is not a code", async () => {
      await expect(
        canvassService.addSupplier(request.id, { supplierName: "A", comparisonRate: 2 }, purchaser.id),
      ).rejects.toThrow(/PHP supplier takes no comparison rate/)
      await expect(canvassService.addSupplier(request.id, { supplierName: "A", currency: "dollars" }, purchaser.id)).rejects.toThrow(/not a currency code/)
      await expect(
        canvassService.addSupplier(request.id, { supplierName: "A", currency: "USD", comparisonRate: 0 }, purchaser.id),
      ).rejects.toThrow(/more than zero/)
    })

    it("flags a supplier whose quote has lapsed", async () => {
      await canvassService.addSupplier(request.id, { supplierName: "Old", validUntil: "2020-01-01" }, purchaser.id)
      await canvassService.addSupplier(request.id, { supplierName: "New", validUntil: "2999-01-01" }, purchaser.id)
      const { suppliers } = await canvassService.getForRequest(request.id)
      expect(suppliers.map((s) => s.expired)).toEqual([true, false])
    })

    it("edits a supplier, touching only what was named", async () => {
      const { supplier } = await canvassService.addSupplier(request.id, { supplierName: "Redleaf", leadTime: "14 days" }, purchaser.id)
      await canvassService.updateSupplier(supplier.id, { qualityNote: "Reliable", odooSupplierId: 412 })
      const [read] = (await canvassService.getForRequest(request.id)).suppliers
      expect(read).toMatchObject({ supplier_name: "Redleaf", lead_time: "14 days", quality_note: "Reliable", odoo_supplier_id: 412 })
      await expect(canvassService.updateSupplier(supplier.id, { supplierName: " " })).rejects.toThrow(/needs a name/)
    })

    it("takes the rate when a supplier turns foreign, and drops it when it turns back to PHP", async () => {
      const { supplier } = await canvassService.addSupplier(request.id, { supplierName: "Hong Kong" }, purchaser.id)
      await canvassService.updateSupplier(supplier.id, { currency: "USD", comparisonRate: 56 })
      let [read] = (await canvassService.getForRequest(request.id)).suppliers
      expect(read).toMatchObject({ currency: "USD", comparison_rate: 56 })

      await canvassService.updateSupplier(supplier.id, { currency: "PHP" })
      ;[read] = (await canvassService.getForRequest(request.id)).suppliers
      expect(read).toMatchObject({ currency: "PHP", comparison_rate: null })
      await expect(canvassService.updateSupplier(supplier.id, { comparisonRate: 3 })).rejects.toThrow(/PHP supplier/)
    })

    it("removes a supplier, and arranges the rest (its quotes going with it is the database's, proven in 90-canvass-tables)", async () => {
      const { redleaf, ferno, hk } = await sample()
      await canvassService.removeSupplier(redleaf.id)
      await canvassService.reorderSuppliers(redleaf.canvass_id, [hk.id, ferno.id])
      const after = await canvassService.getForRequest(request.id)
      expect(after.suppliers.map((s) => s.supplier_name)).toEqual(["Hong Kong", "Ferno"])
    })
  })

  describe("quotes", () => {
    it("gives each quote its PHP figure, and the foreign one at its supplier's rate", async () => {
      const { redleaf, hk } = await sample()
      const { quotes } = await canvassService.getForRequest(request.id)
      const on = (supplier, line) => quotes.find((q) => q.supplier_id === supplier.id && q.item_id === line.id)
      expect(on(redleaf, lineA)).toMatchObject({ brand: "Redleaf", unit_price: 78000, php_figure: 78000 })
      expect(on(hk, lineA)).toMatchObject({ unit_price: 1280, php_figure: 72400 })
    })

    it("lets a supplier skip a line", async () => {
      const { ferno } = await sample()
      const { quotes } = await canvassService.getForRequest(request.id)
      expect(quotes.filter((q) => q.supplier_id === ferno.id).map((q) => q.item_id)).toEqual([lineA.id])
    })

    it("has no PHP figure for a foreign supplier without a rate, or a quote without a price", async () => {
      const { supplier } = await canvassService.addSupplier(request.id, { supplierName: "Hong Kong", currency: "USD" }, purchaser.id)
      await canvassService.saveQuote(supplier.id, lineA.id, { unitPrice: 1280 })
      await canvassService.saveQuote(supplier.id, lineB.id, { brand: "No price" })
      const { quotes } = await canvassService.getForRequest(request.id)
      expect(quotes.map((q) => q.php_figure)).toEqual([null, null])
    })

    it("edits a quote on the same line instead of making another, touching only what was named", async () => {
      const { supplier } = await canvassService.addSupplier(request.id, { supplierName: "Redleaf" }, purchaser.id)
      await canvassService.saveQuote(supplier.id, lineA.id, { brand: "RL", description: "Folding", unitPrice: 78000 })
      await canvassService.saveQuote(supplier.id, lineA.id, { unitPrice: 76000, sourceLink: " https://example.com/rl " })
      const { quotes } = await canvassService.getForRequest(request.id)
      expect(quotes).toHaveLength(1)
      expect(quotes[0]).toMatchObject({ brand: "RL", description: "Folding", unit_price: 76000, source_link: "https://example.com/rl" })
    })

    it("refuses a negative or non-numeric price", async () => {
      const { supplier } = await canvassService.addSupplier(request.id, { supplierName: "Redleaf" }, purchaser.id)
      await expect(canvassService.saveQuote(supplier.id, lineA.id, { unitPrice: -1 })).rejects.toThrow(/can't be negative/)
      await expect(canvassService.saveQuote(supplier.id, lineA.id, { unitPrice: "abc" })).rejects.toThrow(/has to be a number/)
    })

    it("refuses a line that is not on the Canvass's request", async () => {
      const { supplier } = await canvassService.addSupplier(request.id, { supplierName: "Redleaf" }, purchaser.id)
      const foreign = db.seed("purchase_request_items", { request_id: otherRequest.id, name: "Foreign", quantity: 1, source: "new", requested_by: purchaser.id })
      await expect(canvassService.saveQuote(supplier.id, foreign.id, { brand: "x" })).rejects.toThrow(/not on this Canvass/)
    })

    it("takes a quote off a line", async () => {
      const { redleaf } = await sample()
      const { quotes } = await canvassService.getForRequest(request.id)
      const quote = quotes.find((q) => q.supplier_id === redleaf.id && q.item_id === lineB.id)
      await canvassService.removeQuote(quote.id)
      expect((await canvassService.getForRequest(request.id)).quotes.some((q) => q.id === quote.id)).toBe(false)
    })
  })

  describe("winners and the No other supplier note", () => {
    it("keeps one winner and reason per line, and replaces it", async () => {
      const { redleaf, ferno } = await sample()
      await canvassService.setWinner(lineA.id, redleaf.id, "  Cheapest  ", purchaser.id)
      await canvassService.setWinner(lineA.id, ferno.id, "Faster", purchaser.id)
      await canvassService.setWinner(lineB.id, redleaf.id, null, purchaser.id)
      const { winners } = await canvassService.getForRequest(request.id)
      expect(winners.map((w) => [w.item_id, w.supplier_id, w.reason])).toEqual([
        [lineA.id, ferno.id, "Faster"],
        [lineB.id, redleaf.id, null],
      ])
    })

    it("changes a winner's reason on its own, and clears a winner", async () => {
      const { redleaf } = await sample()
      await canvassService.setWinner(lineA.id, redleaf.id, "Cheapest", purchaser.id)
      await canvassService.setWinnerReason(lineA.id, "  Holds stock.  ")
      expect((await canvassService.getForRequest(request.id)).winners[0].reason).toBe("Holds stock.")
      await canvassService.clearWinner(lineA.id)
      expect((await canvassService.getForRequest(request.id)).winners).toEqual([])
    })

    it("writes one No other supplier note per Canvass, with a reason", async () => {
      const canvass = await seedCanvass(request.id, purchaser.id)
      await expect(canvassService.markNoOtherSupplier(canvass.id, "  ", purchaser.id)).rejects.toThrow(/Say why/)
      await canvassService.markNoOtherSupplier(canvass.id, "Sole distributor", purchaser.id)
      await canvassService.markNoOtherSupplier(canvass.id, " Sole distributor in the region ", purchaser.id)
      expect(db.rows("request_canvass_no_other_supplier")).toHaveLength(1)
      expect((await canvassService.get({ canvassId: canvass.id })).noOtherSupplier).toMatchObject({ reason: "Sole distributor in the region", actor_id: purchaser.id })
      await canvassService.clearNoOtherSupplier(canvass.id)
      expect((await canvassService.get({ canvassId: canvass.id })).noOtherSupplier).toBeNull()
    })

    it("keeps the working sheet", async () => {
      const canvass = await seedCanvass(request.id, purchaser.id)
      const sheet = [{ url: "https://example.com/sheet.xlsx", name: "sheet.xlsx", type: "xlsx", bytes: 2048 }]
      await canvassService.setAttachments(canvass.id, sheet)
      expect((await canvassService.getForRequest(request.id)).attachments).toEqual(sheet)
    })
  })

  describe("for a reader without money", () => {
    it("carries suppliers and quotes without any money key", async () => {
      await sample()
      stubCanvassMoneyRpc({ money: false })
      const read = await canvassService.getForRequest(request.id)
      expect(read.canReadMoney).toBe(false)
      expect(read.suppliers).toHaveLength(3)
      expect(read.quotes).toHaveLength(4)
      for (const supplier of read.suppliers) expect(Object.keys(supplier)).not.toContain("comparison_rate")
      for (const quote of read.quotes) {
        expect(Object.keys(quote)).not.toContain("unit_price")
        expect(Object.keys(quote)).not.toContain("php_figure")
      }
      expect(read.suppliers.map((s) => s.supplier_name)).toEqual(["Redleaf Inc.", "Ferno", "Hong Kong"])
    })
  })

  describe("the Canvasses list", () => {
    it("maps a row to one Canvass per request, with counts and no money", async () => {
      const { stubCanvassListRpcs } = await import("@/test/stubs/canvassRpc")
      stubCanvassListRpcs()
      const { redleaf } = await sample()
      await canvassService.setWinner(lineA.id, redleaf.id, "Cheapest", purchaser.id)
      const [row, ...rest] = await canvassService.list()
      expect(rest).toEqual([])
      expect(row).toMatchObject({
        number: "CNV_0001",
        requestId: request.id,
        requestLabel: "S07983 supplies",
        canvasserId: purchaser.id,
        supplierCount: 3,
        lineCount: 2,
        quotedLineCount: 2,
        winnerCount: 1,
      })
      expect(Object.keys(row).some((key) => /price|rate/i.test(key))).toBe(false)
    })
  })

  describe("supplier search (Odoo stubbed)", () => {
    const suppliers = [
      { id: 41, name: "Redleaf Inc." },
      { id: 52, name: "Redleaf Medical Corp." },
    ]

    it("suggests Odoo suppliers for what was typed", async () => {
      let asked
      stubEdgeFunction("odoo-supplier-search", (body) => {
        asked = body
        return { success: true, suppliers }
      })
      expect(await canvassService.searchSuppliers("  redleaf ")).toEqual(suppliers)
      expect(asked).toEqual({ query: "redleaf" })
    })

    it("does not ask Odoo for a one-letter query", async () => {
      let called = false
      stubEdgeFunction("odoo-supplier-search", () => {
        called = true
        return { success: true, suppliers }
      })
      expect(await canvassService.searchSuppliers("r")).toEqual([])
      expect(await canvassService.searchSuppliers("  ")).toEqual([])
      expect(called).toBe(false)
    })

    it("gives no suggestions when Odoo does not answer", async () => {
      stubEdgeFunction("odoo-supplier-search", { success: false, message: "down" })
      expect(await canvassService.searchSuppliers("redleaf")).toEqual([])
    })

    it("stores the Odoo id of a picked supplier", async () => {
      const { supplier } = await canvassService.addSupplier(
        request.id,
        { supplierName: suppliers[0].name, odooSupplierId: suppliers[0].id },
        purchaser.id,
      )
      expect(supplier).toMatchObject({ supplier_name: "Redleaf Inc.", odoo_supplier_id: 41 })
    })

    it("saves a typed supplier that Odoo does not know with a null id", async () => {
      stubEdgeFunction("odoo-supplier-search", { success: true, suppliers: [] })
      expect(await canvassService.searchSuppliers("Brand New Supplier")).toEqual([])

      const { supplier } = await canvassService.addSupplier(request.id, { supplierName: "Brand New Supplier" }, purchaser.id)
      expect(supplier.supplier_name).toBe("Brand New Supplier")
      expect(supplier.odoo_supplier_id ?? null).toBeNull()
    })

    it("clears the id when the name is edited afterwards", async () => {
      const { supplier } = await canvassService.addSupplier(request.id, { supplierName: "Redleaf Inc.", odooSupplierId: 41 }, purchaser.id)
      const edited = await canvassService.updateSupplier(supplier.id, { supplierName: "Redleaf Philippines", odooSupplierId: null })
      expect(edited).toMatchObject({ supplier_name: "Redleaf Philippines", odoo_supplier_id: null })
    })
  })

  describe("the odoo-supplier-search function", () => {
    const source = readFileSync("supabase/functions/odoo-supplier-search/index.ts", "utf8")
    const config = readFileSync("supabase/config.toml", "utf8")

    it("keeps the gateway's JWT check on, so an unauthenticated call is refused", () => {
      const block = config.split("[functions.odoo-supplier-search]")[1]?.split("[functions.")[0]
      expect(block).toBeDefined()
      expect(block).not.toMatch(/verify_jwt/)
    })

    it("matches a typed %, _ or backslash as itself", () => {
      expect(containsPattern("50% off")).toBe("%50\\% off%")
      expect(containsPattern("A_B")).toBe("%A\\_B%")
      expect(containsPattern("C:\\depot")).toBe("%C:\\\\depot%")
      expect(containsPattern("Redleaf")).toBe("%Redleaf%")
    })

    it("builds the search pattern with that escaping", () => {
      expect(source).toContain('["name", "=ilike", containsPattern(name)]')
    })

    it("only reads from Odoo", () => {
      const methods = [...source.matchAll(/"(search_read|search|read|create|write|unlink)"/g)].map((m) => m[1])
      expect(methods).toEqual(["search_read"])
    })
  })
})
