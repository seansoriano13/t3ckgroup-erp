/**
 * Issue #1272 (spec #1271) — retail_orders holds one row per Odoo order.
 *
 * The service role plays the sync: it is the only writer. A second row for an Odoo id that is
 * already stored is refused, and rows with no Odoo id yet do not clash. Made-up values only.
 */
import { describe, it, expect, afterAll } from "vitest"
import { serviceClient } from "./support/stack.js"

const svc = () => serviceClient()
const ODOO_ID = 987001
const NUMBERS = ["S9870001", "S9870002", "S9870003", "S9870004"]

const order = (number, odooId) => ({
    odoo_so_number: number,
    odoo_so_id: odooId,
    marketplace: "Test Shop",
    partner_name: "Test Shop",
    amount: 100,
})

afterAll(async () => {
    await svc().from("retail_orders").delete().in("odoo_so_number", NUMBERS)
})

describe("retail_orders: one row per Odoo order (#1272)", () => {
    it("refuses a second row for an Odoo id that is already stored", async () => {
        const first = await svc().from("retail_orders").insert(order(NUMBERS[0], ODOO_ID))
        expect(first.error).toBeNull()

        const second = await svc().from("retail_orders").insert(order(NUMBERS[1], ODOO_ID))
        expect(second.error?.code).toBe("23505")

        const { data } = await svc().from("retail_orders").select("odoo_so_number").eq("odoo_so_id", ODOO_ID)
        expect(data).toHaveLength(1)
    })

    it("lets the sync upsert on the Odoo id, so a re-read updates the row", async () => {
        const { error } = await svc()
            .from("retail_orders")
            .upsert({ ...order(NUMBERS[0], ODOO_ID), amount: 250 }, { onConflict: "odoo_so_id" })
        expect(error).toBeNull()

        const { data } = await svc().from("retail_orders").select("amount").eq("odoo_so_id", ODOO_ID)
        expect(data).toHaveLength(1)
        expect(Number(data[0].amount)).toBe(250)
    })

    it("allows several rows that have no Odoo id yet", async () => {
        const { error } = await svc()
            .from("retail_orders")
            .insert([order(NUMBERS[2], null), order(NUMBERS[3], null)])
        expect(error).toBeNull()
    })
})
