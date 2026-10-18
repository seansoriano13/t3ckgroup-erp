import { beforeEach, describe, expect, it } from "vitest"

import { canvassService } from "./canvassService"
import { db } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { stubCanvassMoneyRpc } from "@/test/stubs/canvassRpc"

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

  describe("opening", () => {
    it("has no Canvass until somebody opens one", async () => {
      expect(await canvassService.getForComponent(component.id)).toBeNull()
    })

    it("opens one Canvass with a CNV_ number", async () => {
      const canvass = await canvassService.open({ componentId: component.id }, purchaser.id)
      expect(canvass.number).toBe("CNV_0001")
      expect(canvass.component_id).toBe(component.id)
      expect(canvass.created_by).toBe(purchaser.id)
      expect(canvass.offers).toEqual([])
    })

    it("opened twice returns the same Canvass with the same number", async () => {
      const first = await canvassService.open({ componentId: component.id }, purchaser.id)
      const second = await canvassService.open({ componentId: component.id }, purchaser.id)
      expect(second.id).toBe(first.id)
      expect(second.number).toBe(first.number)
      expect(db.rows("sor_canvasses")).toHaveLength(1)
    })

    it("numbers each Component's Canvass in turn", async () => {
      await canvassService.open({ componentId: component.id }, purchaser.id)
      const second = await canvassService.open({ componentId: other.id }, purchaser.id)
      expect(second.number).toBe("CNV_0002")
    })

    it("refuses a subject that is neither a Component nor a Requested Item, or both", async () => {
      await expect(canvassService.open({}, purchaser.id)).rejects.toThrow(/exactly one/)
      await expect(
        canvassService.open({ componentId: component.id, requestedItemId: "x" }, purchaser.id),
      ).rejects.toThrow(/exactly one/)
    })
  })

  describe("recording Offers", () => {
    let canvass

    beforeEach(async () => {
      canvass = await canvassService.open({ componentId: component.id }, purchaser.id)
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
      const canvass = await canvassService.open({ componentId: component.id }, purchaser.id)
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
      const canvass = await canvassService.open({ componentId: component.id }, purchaser.id)
      await sample(canvass)
      const rows = await canvassService.listForComponents([component.id, other.id])
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ number: "CNV_0001", component_id: component.id, offerCount: 3 })
      expect(rows[0]).not.toHaveProperty("offers")
      expect(await canvassService.listForComponents([])).toEqual([])
    })
  })
})
