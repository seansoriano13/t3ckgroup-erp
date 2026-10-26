import { describe, expect, it } from "vitest"

import { linePlay, matrixPlay } from "./costingPlayground"

const line = (overrides = {}) => ({
    id: "l1",
    quantity: 4,
    abc_unit: 95000,
    components: [{ acquire_unit: 78000, quantity: 4, markup_factor: null }],
    ...overrides,
})

describe("linePlay", () => {
    it("prices a line from its product at the factor being tried", () => {
        // 78,000 x 1.20 = 93,600 a unit, under the ABC of 95,000
        expect(linePlay(line(), 1.2)).toEqual({ priceTotal: 374400, offerUnit: 93600, capped: false })
    })

    it("keeps the offer at the ABC when asked, and lets it go over when not", () => {
        expect(linePlay(line(), 1.35)).toEqual({ priceTotal: 421200, offerUnit: 95000, capped: true })
        expect(linePlay(line(), 1.35, { capAtAbc: false })).toEqual({ priceTotal: 421200, offerUnit: 105300, capped: false })
    })

    it("adds a broken-down line's parts, each at its own factor when it has one", () => {
        const parts = line({
            quantity: 1,
            abc_unit: 2950000,
            components: [
                { acquire_unit: 1980000, quantity: 1, markup_factor: 1.3 },
                { acquire_unit: 165000, quantity: 1, markup_factor: null },
            ],
        })
        // 1,980,000 x 1.30 + 165,000 x 1.50
        expect(linePlay(parts, 1.5).priceTotal).toBe(2821500)
    })

    it("prices every part at the factor being tried when asked to ignore their own", () => {
        const own = line({ components: [{ acquire_unit: 78000, quantity: 4, markup_factor: 1 }] })
        expect(linePlay(own, 1.2).offerUnit).toBe(78000)
        expect(linePlay(own, 1.2, { ignoreOwn: true }).offerUnit).toBe(93600)
    })

    it("leaves a line blank while any part has no Acquire, or when it has no part", () => {
        expect(linePlay(line({ components: [{ acquire_unit: null, quantity: 4 }] }), 1.35).offerUnit).toBeNull()
        expect(linePlay(line({ components: [] }), 1.35).offerUnit).toBeNull()
    })
})

describe("matrixPlay", () => {
    it("adds the offers, the cost with the cost-only rows, and the margin", () => {
        const matrix = {
            tenderLines: [line(), line({ id: "l2", quantity: 2, abc_unit: 120000, components: [{ acquire_unit: 88200, quantity: 2 }] })],
            costRows: [{ acquire_unit: 25000, quantity: 1 }],
        }
        const play = matrixPlay(matrix, 1.2)
        // 4 x 93,600 + 2 x 105,840
        expect(play.offerTotal).toBe(586080)
        // 312,000 + 176,400 + 25,000
        expect(play.cost).toBe(513400)
        expect(play.margin).toBe(72680)
        expect(play.unpriced).toBe(0)
        // of an ABC of 4 x 95,000 + 2 x 120,000 = 620,000
        expect(play.percentOfAbc).toBe(94.53)
    })

    it("gives no total while a line cannot be priced, and counts it", () => {
        const play = matrixPlay({ tenderLines: [line(), line({ id: "l2", components: [] })], costRows: [] }, 1.2)
        expect(play.offerTotal).toBeNull()
        expect(play.unpriced).toBe(1)
        expect(play.cost).toBeNull()
    })
})
