/**
 * OPEX Report hand-edit tables (#1245, spec #1241): only Finance access and Super Admins
 * read or write them; a P0, a line price and a left-out expense are each stored once per report.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"

const svc = () => serviceClient()
const S0 = "S9124501"
let reportId

beforeAll(async () => {
    await ensureCastLoaded()
    await svc().from("opex_reports").delete().eq("s0_number", S0)
    const made = await svc().from("opex_reports").insert({ s0_number: S0 }).select().single()
    reportId = made.data.id
})

afterAll(async () => {
    await svc().from("opex_reports").delete().eq("s0_number", S0)
})

const rows = (n = 91245) => ({
    opex_report_p0s: { report_id: reportId, p0_number: `P${n}` },
    opex_typed_costs: { report_id: reportId, description: "Made-up cost", amount: 10, cost_group: "marketing" },
    opex_line_prices: { report_id: reportId, odoo_line_id: n, unit_price: 5 },
    opex_left_out_expenses: { report_id: reportId, analytic_line_id: n, note: "made up" },
})

describe("OPEX Report hand-edit tables (#1245)", () => {
    it("lets Finance access write and read all four", async () => {
        const finance = await clientFor("finance")
        for (const [table, row] of Object.entries(rows())) {
            const made = await finance.from(table).insert(row)
            expect(made.error, table).toBeNull()
            const read = await finance.from(table).select("id").eq("report_id", reportId)
            expect(read.data, table).toHaveLength(1)
        }
    })

    it("lets a Super Admin read them", async () => {
        const admin = await clientFor("superAdmin")
        for (const table of Object.keys(rows())) {
            const read = await admin.from(table).select("id").eq("report_id", reportId)
            expect(read.data, table).toHaveLength(1)
        }
    })

    it("refuses a second P0, line price or left-out row for the same thing", async () => {
        const finance = await clientFor("finance")
        const r = rows()
        for (const table of ["opex_report_p0s", "opex_line_prices", "opex_left_out_expenses"]) {
            expect((await finance.from(table).insert(r[table])).error?.code, table).toBe("23505")
        }
    })

    it("shows nothing to everyone else and refuses their writes", async () => {
        for (const who of ["ordinary", "outsider", "dealOwner"]) {
            const client = await clientFor(who)
            for (const [table, row] of Object.entries(rows(92))) {
                const read = await client.from(table).select("id")
                expect(read.data ?? [], `${who} ${table}`).toHaveLength(0)
                const write = await client.from(table).insert(row)
                expect(write.error, `${who} ${table}`).not.toBeNull()
            }
        }
    })

    it("refuses a typed cost with a group that is not one of the three", async () => {
        const finance = await clientFor("finance")
        const bad = await finance.from("opex_typed_costs").insert({ ...rows().opex_typed_costs, cost_group: "other" })
        expect(bad.error).not.toBeNull()
    })
})
