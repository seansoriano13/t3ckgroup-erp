import { describe, expect, it } from "vitest"
import { shapeMatrix } from "./costingMatrixService"

/** An S0 line priced at ₱0 is included in the line before it (#700): ABC and Final Offer read ₱0, not blank. */
const read = (tier, quoted) => ({
  tier,
  bands: [],
  matrix_id: "m1",
  tables: {
    costing_matrices: [{ id: "m1" }],
    costing_tender_lines: [
      { id: "tower", source: "sor_line", quantity: 1 },
      { id: "battery", source: "sor_line", quantity: 2 },
      { id: "typed", source: "typed", quantity: 1 },
    ],
    costing_tender_line_prices: [
      { tender_line_id: "tower", abc_unit: 1000, final_offer_unit: 900, quotation_price_unit: quoted[0] },
      { tender_line_id: "battery", abc_unit: null, final_offer_unit: null, quotation_price_unit: quoted[1] },
      { tender_line_id: "typed", abc_unit: 50, final_offer_unit: 40, quotation_price_unit: null },
    ],
  },
})

describe("shapeMatrix, included S0 lines", () => {
  it("marks a ₱0 line as included in the line above, with ABC and Final Offer at ₱0", () => {
    const { tenderLines, totals } = shapeMatrix(read("price", [5000, 0]))
    const [tower, battery, typed] = tenderLines
    expect(tower.included).toBe(false)
    expect(battery.included).toBe(true)
    expect(battery.includedIn).toBe("tower")
    expect(battery.abc_unit).toBe(0)
    expect(battery.final_offer_unit).toBe(0)
    expect(typed.included).toBe(false)
    expect(totals.missingAbc).toBe(0)
    expect(totals.finalOfferTotal).toBe(940)
  })

  it("leaves the first line and a tier that was not sent the S0 price alone", () => {
    expect(shapeMatrix(read("price", [0, 0])).tenderLines[0].included).toBe(false)
    const blind = shapeMatrix(read("cost", [undefined, undefined]))
    expect(blind.tenderLines[1].included).toBe(false)
    expect(blind.tenderLines[1].abc_unit).toBeNull()
  })
})
