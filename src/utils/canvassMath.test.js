import { describe, expect, it } from "vitest"

import { isExpired, moreOffersWarning, needsMoreOffers, offerCurrency, phpFigure } from "./canvassMath"

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
