/**
 * An SOR product line keeps the Odoo S0 line's own id (#677, spec #675;
 * 20261104110000_sor_lines_keep_odoo_line_id.sql).
 *
 * `sor_replace_items` matches the lines it is given to the stored ones by
 * `odoo_line_id`: the same id updates the line in place, a new id adds one, a
 * missing id marks the line `removed_from_s0` and keeps it. An older line with
 * no Odoo line id is matched once by Odoo product id. Estimated Value leaves
 * out a removed line.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

const svc = () => serviceClient()
let sorId

const row = (name, odooLineId, quantity, unitPrice, odooProductId = null) => ({
    product_name: `${MARKER} ${name}`,
    unit: "pc",
    quantity,
    unit_price: unitPrice,
    odoo_product_id: odooProductId,
    odoo_line_id: odooLineId,
})

async function save(items) {
    const { error } = await (await clientFor("dealOwner")).rpc("sor_replace_items", { p_opportunity_id: sorId, p_items: items })
    if (error) throw error
}

async function stored() {
    const { data, error } = await svc().from("sales_opportunity_items").select("*").eq("opportunity_id", sorId).order("sort_order")
    if (error) throw error
    return data
}

async function estimatedValue() {
    const { data, error } = await svc().from("sales_opportunities").select("expected_value").eq("id", sorId).single()
    if (error) throw error
    return Number(data.expected_value)
}

beforeAll(async () => {
    await ensureCastLoaded()
    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
})

afterAll(async () => {
    await svc().from("sales_opportunity_items").delete().eq("opportunity_id", sorId)
    await svc().from("sales_opportunities").delete().eq("id", sorId)
})

describe("sor_replace_items keeps a line's id", () => {
    const S0 = [row("Rope", 801, 10, 100, 55), row("Rope again", 802, 4, 90, 55), row("Harness", 803, 2, 500, 56)]

    it("opening twice with no change in Odoo leaves every line id and every row as it was", async () => {
        await save(S0)
        const first = await stored()
        expect(first.map((l) => l.odoo_line_id)).toEqual([801, 802, 803])

        await save(S0)
        const second = await stored()
        expect(second).toEqual(first)
    })

    it("lists the same product on two lines as two distinct lines, each matched by its own id", async () => {
        const before = await stored()
        await save([row("Rope", 801, 10, 100, 55), row("Rope again", 802, 7, 90, 55), row("Harness", 803, 2, 500, 56)])
        const after = await stored()
        expect(after.map((l) => l.id)).toEqual(before.map((l) => l.id))
        expect(after.map((l) => Number(l.quantity))).toEqual([10, 7, 2])
    })

    it("adds a new S0 line", async () => {
        await save([...S0.slice(0, 1), row("Rope again", 802, 7, 90, 55), row("Harness", 803, 2, 500, 56), row("Helmet", 804, 3, 200, 57)])
        const lines = await stored()
        expect(lines).toHaveLength(4)
        expect(lines[3]).toMatchObject({ odoo_line_id: 804, removed_from_s0: false })
    })

    it("keeps a line the S0 dropped, marks it removed, and leaves it out of Estimated Value", async () => {
        const before = await stored()
        const harnessId = before.find((l) => l.odoo_line_id === 803).id
        await save([row("Rope", 801, 10, 100, 55), row("Rope again", 802, 7, 90, 55), row("Helmet", 804, 3, 200, 57)])

        const after = await stored()
        expect(after).toHaveLength(4)
        expect(after.find((l) => l.id === harnessId)).toMatchObject({ removed_from_s0: true })
        expect(after.filter((l) => l.removed_from_s0)).toHaveLength(1)
        expect(await estimatedValue()).toBe(10 * 100 + 7 * 90 + 3 * 200)
    })

    it("brings a removed line back when the S0 lists it again", async () => {
        await save([row("Rope", 801, 10, 100, 55), row("Rope again", 802, 7, 90, 55), row("Harness", 803, 2, 500, 56), row("Helmet", 804, 3, 200, 57)])
        expect((await stored()).filter((l) => l.removed_from_s0)).toHaveLength(0)
        expect(await estimatedValue()).toBe(10 * 100 + 7 * 90 + 2 * 500 + 3 * 200)
    })

    it("returns the lines as they were, for the change log", async () => {
        const { data, error } = await (await clientFor("dealOwner")).rpc("sor_replace_items", { p_opportunity_id: sorId, p_items: [row("Rope", 801, 11, 100, 55)] })
        expect(error).toBeNull()
        expect(data).toHaveLength(4)
    })
})

describe("older lines without an Odoo line id", () => {
    let legacySorId

    beforeAll(async () => {
        legacySorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
        await svc()
            .from("sales_opportunity_items")
            .insert([
                { opportunity_id: legacySorId, product_name: `${MARKER} Old rope`, quantity: 1, unit_price: 10, sort_order: 0, odoo_product_id: 61 },
                { opportunity_id: legacySorId, product_name: `${MARKER} Typed by hand`, quantity: 1, unit_price: 5, sort_order: 1 },
            ])
    })

    afterAll(async () => {
        await svc().from("sales_opportunity_items").delete().eq("opportunity_id", legacySorId)
        await svc().from("sales_opportunities").delete().eq("id", legacySorId)
    })

    it("are matched once by Odoo product id, then carry the Odoo line id", async () => {
        const { data: before } = await svc().from("sales_opportunity_items").select("id, odoo_product_id").eq("opportunity_id", legacySorId)
        const oldRope = before.find((l) => l.odoo_product_id === 61)

        const items = [row("Old rope", 901, 2, 10, 61)]
        const { error } = await (await clientFor("dealOwner")).rpc("sor_replace_items", { p_opportunity_id: legacySorId, p_items: items })
        expect(error).toBeNull()

        const { data: after } = await svc().from("sales_opportunity_items").select("id, odoo_line_id").eq("opportunity_id", legacySorId)
        // The old line is the same row, now bound to the Odoo line; the hand-typed line, not sent again, is gone.
        expect(after).toEqual([{ id: oldRope.id, odoo_line_id: 901 }])
    })
})

describe("two overlapping saves", () => {
    it("never double the list", async () => {
        const items = [row("Rope", 801, 10, 100, 55), row("Rope again", 802, 7, 90, 55)]
        const dealOwner = await clientFor("dealOwner")
        const results = await Promise.all([
            dealOwner.rpc("sor_replace_items", { p_opportunity_id: sorId, p_items: items }),
            dealOwner.rpc("sor_replace_items", { p_opportunity_id: sorId, p_items: items }),
        ])
        for (const { error } of results) expect(error).toBeNull()
        const lines = (await stored()).filter((l) => !l.removed_from_s0)
        expect(lines.map((l) => l.odoo_line_id)).toEqual([801, 802])
    })
})
