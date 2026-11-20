/**
 * Spec #1133 / #1136 (tracker A4): the Dashboard quote is limited to 100 characters in the database.
 * The box on My Profile stops at 100, but the API once saved 5,000.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, ensureCastLoaded } from "./support/cast.js"
import { sql } from "./support/stack.js"

let before
beforeAll(async () => {
    await ensureCastLoaded()
    const { rows } = await sql().query(`select dashboard_quote from public.employees where id = $1`, [ids.ordinary])
    before = rows[0].dashboard_quote
})

afterAll(async () => {
    await sql().query(`update public.employees set dashboard_quote = $2 where id = $1`, [ids.ordinary, before])
})

const setQuote = (q) =>
    sql().query(`update public.employees set dashboard_quote = $2 where id = $1`, [ids.ordinary, q])

describe("employees.dashboard_quote", () => {
    it("saves a 100-character quote", async () => {
        await setQuote("a".repeat(100))
        const { rows } = await sql().query(`select char_length(dashboard_quote) n from public.employees where id = $1`, [ids.ordinary])
        expect(rows[0].n).toBe(100)
    })

    it("refuses a 101-character quote", async () => {
        await expect(setQuote("a".repeat(101))).rejects.toThrow(/dashboard_quote_length|check|at most 100/i)
    })

    it("still allows no quote", async () => {
        await setQuote(null)
    })
})
