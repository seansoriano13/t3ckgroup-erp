import { readFileSync } from "node:fs"
import { beforeEach, describe, expect, it } from "vitest"

import { canvassService } from "./canvassService"
import { db } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { seedCanvass, stubCanvassMoneyRpc } from "@/test/stubs/canvassRpc"
import { stubEdgeFunction, stubRpc } from "@/test/msw/server"
import { containsPattern } from "../../supabase/functions/_shared/ilikePattern.ts"

/**
 * The Canvass (#276), through the service's public methods on the fake PostgREST. What is asserted
 * is what a purchaser and a Stage Participant read back: one Canvass per Component, its number,
 * the Offers with their PHP figures, and no price keys at all for a reader without money. Who may
 * write what is the policy tier's (90-canvass-tables.test.js).
 */
describe("canvassService", () => {
  let purchaser
  let component
  let other

  beforeEach(() => {
    stubCanvassMoneyRpc({ money: true })
    purchaser = makeEmployee({ name: "Marco Dizon", has_purchasing_flow: true })
    const deal = makeOpportunity({ registered_by: purchaser.id, sales_reference: "S07983" })
    const matrix = db.seed("costing_matrices", { opportunity_id: deal.id })
    const line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1 })
    component = db.seed("costing_components", { tender_line_id: line.id, position: 2, name: "Ambulance Folding Stretcher" })
    other = db.seed("costing_components", { tender_line_id: line.id, position: 3, name: "Spine board" })
  })

  // The prototype's CNV_0142: Redleaf and Ferno in PHP, Hong Kong in USD at a comparison rate.
  const sample = async (canvass) => {
    await canvassService.addOffer(canvass.id, { supplierName: "Redleaf Inc.", brand: "Redleaf", unitPrice: 78000, leadTime: "14 days" }, purchaser.id)
    await canvassService.addOffer(canvass.id, { supplierName: "Ferno", brand: "Ferno", unitPrice: 82500 }, purchaser.id)
    await canvassService.addOffer(
      canvass.id,
      { supplierName: "Hong Kong", currency: "USD", unitPrice: 1280, comparisonRate: 56.5625, leadTime: "45 days", validUntil: "2026-11-30" },
      purchaser.id,
    )
  }

  describe("starting (ADR 0034: the first Offer gives the number)", () => {
    it("has no Canvass, and reading writes none, until the first Offer is saved", async () => {
      expect(await canvassService.getForComponent(component.id)).toBeNull()
      expect(await canvassService.get({})).toBeNull()
      expect(db.rows("sor_canvasses")).toHaveLength(0)
    })

    it("starts one Canvass with a CNV_ number when the first Offer is saved", async () => {
      const started = await canvassService.start({ componentId: component.id }, {}, { supplierName: "Ferno" }, purchaser.id)
      expect(started.number).toBe("CNV_0001")
      const canvass = await canvassService.getForComponent(component.id)
      expect(canvass).toMatchObject({ id: started.canvassId, number: "CNV_0001", component_id: component.id, created_by: purchaser.id })
      expect(canvass.offers.map((o) => o.supplier_name)).toEqual(["Ferno"])
    })

    it("a second first Offer on the same subject joins the same Canvass", async () => {
      const first = await canvassService.start({ componentId: component.id }, {}, { supplierName: "Ferno" }, purchaser.id)
      const second = await canvassService.start({ componentId: component.id }, {}, { supplierName: "Redleaf" }, purchaser.id)
      expect(second.canvassId).toBe(first.canvassId)
      expect(db.rows("sor_canvasses")).toHaveLength(1)
      expect(db.rows("sor_canvass_offers")).toHaveLength(2)
    })

    it("numbers each Component's Canvass in turn", async () => {
      await canvassService.start({ componentId: component.id }, {}, { supplierName: "Ferno" }, purchaser.id)
      const second = await canvassService.start({ componentId: other.id }, {}, { supplierName: "Ferno" }, purchaser.id)
      expect(second.number).toBe("CNV_0002")
    })

    it("starts a Canvass with no subject when it says what is being bought, and its starter is the Canvasser", async () => {
      const started = await canvassService.start({}, { productName: " Printer toner " }, { supplierName: "Octagon" }, purchaser.id)
      const canvass = await canvassService.get({ canvassId: started.canvassId })
      expect(canvass).toMatchObject({ product_name: "Printer toner", component_id: null, requested_item_id: null, canvasser_id: purchaser.id })
    })

    it("refuses a Canvass with no subject that doesn't say what it is for, and one with both subjects", async () => {
      await expect(canvassService.start({}, {}, { supplierName: "Octagon" }, purchaser.id)).rejects.toThrow(/what is being bought/)
      await expect(
        canvassService.start({ componentId: component.id, requestedItemId: "x" }, {}, { supplierName: "Ferno" }, purchaser.id),
      ).rejects.toThrow(/never both/)
      expect(db.rows("sor_canvasses")).toHaveLength(0)
    })

    it("an empty first Offer starts nothing", async () => {
      await expect(canvassService.start({ componentId: component.id }, {}, {}, purchaser.id)).rejects.toThrow(/at least a supplier/)
      expect(db.rows("sor_canvasses")).toHaveLength(0)
    })
  })

  describe("recording Offers", () => {
    let canvass

    beforeEach(async () => {
      canvass = await seedCanvass({ componentId: component.id }, purchaser.id)
    })

    it("gives each Offer its PHP figure, and the foreign one at its rate", async () => {
      await sample(canvass)
      const { offers, needsMoreOffers, moreOffersWarning } = await canvassService.getForComponent(component.id)
      expect(offers.map((o) => o.supplier_name)).toEqual(["Redleaf Inc.", "Ferno", "Hong Kong"])
      expect(offers.map((o) => o.php_figure)).toEqual([78000, 82500, 72400])
      expect(offers[2]).toMatchObject({ currency: "USD", unit_price: 1280, comparison_rate: 56.5625, valid_until: "2026-11-30" })
      expect(offers[0].currency).toBe("PHP")
      expect(needsMoreOffers).toBe(false)
      expect(moreOffersWarning).toBeNull()
    })

    it("warns under three Offers and never blocks", async () => {
      await canvassService.addOffer(canvass.id, { supplierName: "Redleaf Inc.", unitPrice: 78000 }, purchaser.id)
      const read = await canvassService.getForComponent(component.id)
      expect(read.needsMoreOffers).toBe(true)
      expect(read.moreOffersWarning).toBe("One offer only — below the three-offer minimum")
    })

    it("has no PHP figure for a foreign Offer without a rate", async () => {
      await canvassService.addOffer(canvass.id, { supplierName: "Hong Kong", currency: "USD", unitPrice: 1280 }, purchaser.id)
      const { offers } = await canvassService.getForComponent(component.id)
      expect(offers[0].php_figure).toBeNull()
      expect(offers[0].comparison_rate).toBeNull()
    })

    it("flags an Offer past its validity date", async () => {
      await canvassService.addOffer(canvass.id, { supplierName: "Old quote", unitPrice: 1, validUntil: "2020-01-01" }, purchaser.id)
      await canvassService.addOffer(canvass.id, { supplierName: "Fresh quote", unitPrice: 1, validUntil: "2999-01-01" }, purchaser.id)
      const { offers } = await canvassService.getForComponent(component.id)
      expect(offers.map((o) => o.expired)).toEqual([true, false])
    })

    it("writes the Offer and its prices through one call, so a failure leaves neither", async () => {
      const calls = []
      stubRpc("canvass_add_offer", (args) => {
        calls.push(args)
        throw Object.assign(new Error("prices refused"), { code: "23514" })
      })
      await expect(
        canvassService.addOffer(canvass.id, { supplierName: "Redleaf Inc.", unitPrice: 78000, currency: "usd", comparisonRate: 56 }, purchaser.id),
      ).rejects.toMatchObject({ message: expect.stringMatching(/prices refused/) })

      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({
        p_canvass_id: canvass.id,
        p_offer: { supplier_name: "Redleaf Inc.", currency: "USD", created_by: purchaser.id },
        p_price: { unit_price: 78000, comparison_rate: 56 },
      })
      expect(db.rows("sor_canvass_offers")).toHaveLength(0)
      expect(db.rows("sor_canvass_offer_prices")).toHaveLength(0)
    })

    it("refuses an Offer with nothing to name it, and a rate on a PHP Offer", async () => {
      await expect(canvassService.addOffer(canvass.id, { unitPrice: 5 }, purchaser.id)).rejects.toThrow(/at least a supplier/)
      await expect(
        canvassService.addOffer(canvass.id, { supplierName: "A", unitPrice: 5, comparisonRate: 2 }, purchaser.id),
      ).rejects.toThrow(/PHP offer takes no comparison rate/)
    })

    it("edits an Offer's price and supplier, touching only what was named", async () => {
      const offer = await canvassService.addOffer(canvass.id, { supplierName: "Redleaf", brand: "RL", unitPrice: 78000 }, purchaser.id)
      await canvassService.updateOffer(offer.id, { unitPrice: 76000, odooSupplierId: 412 })
      const [read] = (await canvassService.getForComponent(component.id)).offers
      expect(read).toMatchObject({ supplier_name: "Redleaf", brand: "RL", unit_price: 76000, odoo_supplier_id: 412 })
    })

    it("takes the rate when an Offer turns foreign, and drops it when it turns back to PHP", async () => {
      const offer = await canvassService.addOffer(canvass.id, { supplierName: "Hong Kong", unitPrice: 1280 }, purchaser.id)
      await canvassService.updateOffer(offer.id, { currency: "USD", comparisonRate: 56 })
      let [read] = (await canvassService.getForComponent(component.id)).offers
      expect(read).toMatchObject({ currency: "USD", comparison_rate: 56, php_figure: 71680 })

      await canvassService.updateOffer(offer.id, { currency: "PHP" })
      ;[read] = (await canvassService.getForComponent(component.id)).offers
      expect(read).toMatchObject({ currency: "PHP", comparison_rate: null, php_figure: 1280 })
      await expect(canvassService.updateOffer(offer.id, { comparisonRate: 3 })).rejects.toThrow(/PHP offer/)
    })

    it("removes an Offer, and arranges the rest", async () => {
      await sample(canvass)
      const { offers } = await canvassService.getForComponent(component.id)
      await canvassService.removeOffer(offers[0].id)
      await canvassService.reorderOffers(canvass.id, [offers[2].id, offers[1].id])
      const after = await canvassService.getForComponent(component.id)
      expect(after.offers.map((o) => o.supplier_name)).toEqual(["Hong Kong", "Ferno"])
    })

    it("keeps the reason as written, and the working sheet", async () => {
      await canvassService.setReason(canvass.id, "  Redleaf is 5% dearer but holds stock.  ")
      const sheet = [{ url: "https://example.com/sheet.xlsx", name: "sheet.xlsx", type: "xlsx", bytes: 2048 }]
      await canvassService.setAttachments(canvass.id, sheet)
      const read = await canvassService.getForComponent(component.id)
      expect(read.reason).toBe("Redleaf is 5% dearer but holds stock.")
      expect(read.attachments).toEqual(sheet)

      await canvassService.setReason(canvass.id, "   ")
      expect((await canvassService.getForComponent(component.id)).reason).toBeNull()
    })
  })

  describe("for a reader without money", () => {
    it("carries the Offers without any price key", async () => {
      const canvass = await seedCanvass({ componentId: component.id }, purchaser.id)
      await sample(canvass)

      stubCanvassMoneyRpc({ money: false })
      const read = await canvassService.getForComponent(component.id)
      expect(read.canReadMoney).toBe(false)
      expect(read.offers).toHaveLength(3)
      for (const offer of read.offers) {
        expect(offer).not.toHaveProperty("unit_price")
        expect(offer).not.toHaveProperty("comparison_rate")
        expect(offer).not.toHaveProperty("php_figure")
      }
      expect(read.offers[0]).toMatchObject({ supplier_name: "Redleaf Inc.", brand: "Redleaf", lead_time: "14 days" })
    })
  })

  describe("the chip on a Component row", () => {
    it("lists a light row for each Component that has a Canvass", async () => {
      const canvass = await seedCanvass({ componentId: component.id }, purchaser.id)
      await sample(canvass)
      const rows = await canvassService.listForComponents([component.id, other.id])
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ number: "CNV_0001", component_id: component.id, offerCount: 3 })
      expect(rows[0]).not.toHaveProperty("offers")
      expect(await canvassService.listForComponents([])).toEqual([])
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
      const canvass = await seedCanvass({ componentId: component.id }, purchaser.id)
      const offer = await canvassService.addOffer(
        canvass.id,
        { supplierName: suppliers[0].name, odooSupplierId: suppliers[0].id, unitPrice: 78000 },
        purchaser.id,
      )
      expect(offer).toMatchObject({ supplier_name: "Redleaf Inc.", odoo_supplier_id: 41 })
    })

    it("saves a typed supplier that Odoo does not know with a null id", async () => {
      stubEdgeFunction("odoo-supplier-search", { success: true, suppliers: [] })
      expect(await canvassService.searchSuppliers("Brand New Supplier")).toEqual([])

      const canvass = await seedCanvass({ componentId: component.id }, purchaser.id)
      const offer = await canvassService.addOffer(canvass.id, { supplierName: "Brand New Supplier" }, purchaser.id)
      expect(offer.supplier_name).toBe("Brand New Supplier")
      expect(offer.odoo_supplier_id ?? null).toBeNull()
    })

    it("clears the id when the name is edited afterwards", async () => {
      const canvass = await seedCanvass({ componentId: component.id }, purchaser.id)
      const offer = await canvassService.addOffer(
        canvass.id,
        { supplierName: "Redleaf Inc.", odooSupplierId: 41 },
        purchaser.id,
      )
      const edited = await canvassService.updateOffer(offer.id, { supplierName: "Redleaf Philippines", odooSupplierId: null })
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
