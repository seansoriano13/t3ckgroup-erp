import { describe, expect, it } from "vitest"

import { brandProposal, canPickWinner, slotsCovered, supplierSlots, isExpired, moreOffersWarning, needsMoreOffers, normaliseSupplierName, offerCurrency, phpFigure, supplierMismatch } from "./canvassMath"

// The prototype's sample (#236): CNV_0142 against 1.2 of S07983.
const redleaf = { supplier_name: "Redleaf Inc.", currency: "PHP", unit_price: 78000 }
const ferno = { supplier_name: "Ferno", currency: "PHP", unit_price: "82500.00" }
const hongKong = { supplier_name: "Hong Kong", currency: "USD", unit_price: 1280, comparison_rate: 56.5625 }

describe("phpFigure", () => {
  it("is the price itself for a PHP Offer, to the centavo", () => {
    expect(phpFigure(redleaf)).toBe(78000)
    expect(phpFigure(ferno)).toBe(82500)
  })

  it("is the price at the comparison rate for a foreign Offer", () => {
    expect(phpFigure(hongKong)).toBe(72400)
  })

  it("rounds half up to the centavo only on return", () => {
    expect(phpFigure({ currency: "USD", unit_price: 10.005, comparison_rate: 1 })).toBe(10.01)
    expect(phpFigure({ currency: "EUR", unit_price: 3, comparison_rate: 61.115 })).toBe(183.35)
  })

  it("is null for a foreign Offer with no rate", () => {
    expect(phpFigure({ currency: "USD", unit_price: 1280 })).toBeNull()
    expect(phpFigure({ currency: "USD", unit_price: 1280, comparison_rate: null })).toBeNull()
  })

  it("is null with no price, which is not zero", () => {
    expect(phpFigure({ currency: "PHP" })).toBeNull()
    expect(phpFigure({ currency: "PHP", unit_price: null })).toBeNull()
    expect(phpFigure({ currency: "PHP", unit_price: 0 })).toBe(0)
    expect(phpFigure(null)).toBeNull()
  })

  it("reads an Offer with no currency as PHP", () => {
    expect(offerCurrency({})).toBe("PHP")
    expect(phpFigure({ unit_price: 100 })).toBe(100)
  })
})

describe("needsMoreOffers", () => {
  it("is true below three and false from three", () => {
    expect(needsMoreOffers([redleaf, ferno, hongKong])).toBe(false)
    expect(needsMoreOffers([redleaf, ferno])).toBe(true)
    expect(needsMoreOffers([])).toBe(true)
    expect(needsMoreOffers()).toBe(true)
  })

  it("words the warning, and has none when there are enough", () => {
    expect(moreOffersWarning([redleaf, ferno, hongKong])).toBeNull()
    expect(moreOffersWarning([redleaf, hongKong])).toBe("Two offers only — below the three-offer minimum")
    expect(moreOffersWarning([redleaf])).toBe("One offer only — below the three-offer minimum")
    expect(moreOffersWarning([])).toBe("No offers yet — below the three-offer minimum")
  })
})

describe("isExpired", () => {
  const offer = { valid_until: "2026-11-30" }

  it("is false before the date, true on it and after it", () => {
    expect(isExpired(offer, "2026-11-29")).toBe(false)
    expect(isExpired(offer, "2026-11-30")).toBe(true)
    expect(isExpired(offer, "2026-12-01")).toBe(true)
  })

  it("takes a Date or a timestamp for today", () => {
    expect(isExpired(offer, new Date(2026, 10, 30, 8, 0))).toBe(true)
    expect(isExpired(offer, "2026-11-29T23:59:00+08:00")).toBe(false)
  })

  it("never expires with no date", () => {
    expect(isExpired({ valid_until: null }, "2099-01-01")).toBe(false)
    expect(isExpired({}, "2099-01-01")).toBe(false)
  })
})

describe("brandProposal (#278)", () => {
  it("proposes the winner's brand when it differs from the Component's", () => {
    expect(brandProposal({ brand: "Generic" }, { brand: "Toyota" })).toBe("Toyota")
    expect(brandProposal({ brand: null }, { brand: "  Toyota " })).toBe("Toyota")
  })

  it("proposes nothing with no winner, no winning brand, or the brand already there", () => {
    expect(brandProposal({ brand: "Generic" }, null)).toBeNull()
    expect(brandProposal({ brand: "Generic" }, { brand: " " })).toBeNull()
    expect(brandProposal({ brand: "Generic" }, {})).toBeNull()
    expect(brandProposal({ brand: "Toyota" }, { brand: "toyota" })).toBeNull()
    expect(brandProposal({ brand: "Land  Cruiser" }, { brand: "land cruiser" })).toBeNull()
  })
})

describe("supplierMismatch (#281)", () => {
  const winner = { supplierName: "Redleaf Inc.", odooSupplierId: null }

  it("matches the same supplier despite case, spacing, punctuation and a trailing Inc", () => {
    expect(supplierMismatch(winner, { name: "REDLEAF INC" })).toBeNull()
    expect(supplierMismatch(winner, { name: "  redleaf,  inc. " })).toBeNull()
    expect(supplierMismatch(winner, { name: "Redleaf" })).toBeNull()
    expect(supplierMismatch({ supplierName: "Flywheel Co., Ltd." }, { name: "Flywheel" })).toBeNull()
  })

  it("flags a different supplier, with the names to show", () => {
    expect(supplierMismatch(winner, { name: "Flywheel Corp." })).toEqual({ poSupplier: "Flywheel Corp.", winner: "Redleaf Inc." })
  })

  it("lets the Odoo id win over the name when both sides have one", () => {
    expect(supplierMismatch({ supplierName: "Redleaf Inc.", odooSupplierId: 553 }, { id: "553", name: "Something Else Corp." })).toBeNull()
    expect(supplierMismatch({ supplierName: "Redleaf Inc.", odooSupplierId: 553 }, { id: 700, name: "Redleaf Inc." })).toEqual({
      poSupplier: "Redleaf Inc.",
      winner: "Redleaf Inc.",
    })
  })

  it("falls back to the name when only one side has an id", () => {
    expect(supplierMismatch({ supplierName: "Redleaf Inc.", odooSupplierId: 553 }, { id: null, name: "REDLEAF INC" })).toBeNull()
    expect(supplierMismatch({ supplierName: "Redleaf Inc." }, { id: 553, name: "Flywheel Corp." })).not.toBeNull()
  })

  it("says nothing with no PO supplier or no winner", () => {
    expect(supplierMismatch(winner, null)).toBeNull()
    expect(supplierMismatch(winner, undefined)).toBeNull()
    expect(supplierMismatch(winner, { id: null, name: "  " })).toBeNull()
    expect(supplierMismatch(null, { name: "Flywheel Corp." })).toBeNull()
    expect(supplierMismatch({ supplierName: "" }, { name: "Flywheel Corp." })).toBeNull()
  })

  it("normalises a name for comparing", () => {
    expect(normaliseSupplierName("Acme Co., Ltd.")).toBe("acme")
    expect(normaliseSupplierName("Co-Op Supplies")).toBe("co op supplies")
  })
})

describe("supplier slots (#721)", () => {
  const mark = (slot) => ({ slot, reason: "Sole distributor" })

  it("counts Offers plus explained empty slots", () => {
    expect(slotsCovered([redleaf], [mark(2)])).toBe(2)
    expect(slotsCovered([redleaf], [mark(2), mark(3)])).toBe(3)
    expect(slotsCovered([redleaf, ferno, hongKong, redleaf])).toBe(4)
  })

  it("ignores a mark on a slot that has an Offer", () => {
    expect(slotsCovered([redleaf, ferno], [mark(2)])).toBe(2)
    expect(supplierSlots([redleaf, ferno], [mark(2)]).slots[1].kind).toBe("offer")
  })

  it("allows a winner from three covered slots", () => {
    expect(canPickWinner([redleaf], [mark(2)])).toBe(false)
    expect(canPickWinner([redleaf], [mark(2), mark(3)])).toBe(true)
    expect(canPickWinner([redleaf, ferno, hongKong, redleaf])).toBe(true)
  })

  it("drops the warning once the slots are explained", () => {
    expect(moreOffersWarning([redleaf], [mark(2), mark(3)])).toBeNull()
    expect(moreOffersWarning([redleaf], [mark(2)])).toBe("One offer only — below the three-offer minimum")
  })
})
