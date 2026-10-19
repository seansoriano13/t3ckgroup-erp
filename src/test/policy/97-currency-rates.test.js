/**
 * Reference Rate (#317): the PHP value of one unit of a foreign currency on a given day.
 *
 *   currency_rate_currencies   which currencies are fetched (USD, EUR seeded), and each one's
 *                              divergence threshold for the IPAS payment check
 *   currency_rates             one row per currency per day; everyone signed in reads, nobody writes
 *   record_currency_rate       the daily fetch's write (service role only); never overwrites an override
 *   override_currency_rate     a Super Admin's correction, recorded with who, when, and what it replaced
 *   reference_rate             the latest rate on or before a day — a failed fetch leaves the last good
 *                              row under its own, older date; never today's date, never zero
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"

const CUR = "ZZT" // a test-only currency, so the seeded USD/EUR rows are never touched
const svc = () => serviceClient()

beforeAll(async () => {
    await ensureCastLoaded()
    await sql().query(`delete from public.currency_rates where currency = $1`, [CUR])
    await sql().query(
        `insert into public.currency_rate_currencies (currency) values ($1) on conflict do nothing`,
        [CUR],
    )
})

afterAll(async () => {
    await sql().query(`delete from public.currency_rates where currency = $1`, [CUR])
    await sql().query(`delete from public.currency_rate_currencies where currency = $1`, [CUR])
})

describe("currency_rates", () => {
    it("seeds USD and EUR as fetched currencies", async () => {
        const { rows } = await sql().query(
            `select currency from public.currency_rate_currencies where currency in ('USD','EUR') order by 1`,
        )
        expect(rows.map((r) => r.currency)).toEqual(["EUR", "USD"])
    })

    it("allows one row per currency per day", async () => {
        await sql().query(
            `insert into public.currency_rates (currency, rate_date, php_per_unit, source) values ($1, '2026-09-01', 58, 'test')`,
            [CUR],
        )
        await expect(
            sql().query(
                `insert into public.currency_rates (currency, rate_date, php_per_unit, source) values ($1, '2026-09-01', 59, 'test')`,
                [CUR],
            ),
        ).rejects.toThrow(/unique|duplicate/i)
        await expect(
            sql().query(
                `insert into public.currency_rates (currency, rate_date, php_per_unit, source) values ($1, '2026-09-02', 0, 'test')`,
                [CUR],
            ),
        ).rejects.toThrow(/check/i)
    })

    it("is readable by anyone signed in and writable by no one directly", async () => {
        const ordinary = await clientFor("ordinary")
        const { data } = await ordinary.from("currency_rates").select("php_per_unit").eq("currency", CUR)
        expect(data.length).toBeGreaterThan(0)

        const superAdmin = await clientFor("superAdmin")
        const { error } = await superAdmin
            .from("currency_rates")
            .insert({ currency: CUR, rate_date: "2026-09-03", php_per_unit: 1, source: "x" })
        expect(error).not.toBeNull()
    })
})

describe("record_currency_rate", () => {
    it("is the service role's alone", async () => {
        const superAdmin = await clientFor("superAdmin")
        const { error } = await superAdmin.rpc("record_currency_rate", {
            p_currency: CUR, p_rate_date: "2026-09-04", p_php_per_unit: 1, p_source: "x",
        })
        expect(error).not.toBeNull()
    })

    it("writes a day and refreshes it on a re-fetch", async () => {
        for (const rate of [57.5, 57.6]) {
            const { error } = await svc().rpc("record_currency_rate", {
                p_currency: CUR, p_rate_date: "2026-09-05", p_php_per_unit: rate, p_source: "feed",
            })
            expect(error).toBeNull()
        }
        const { rows } = await sql().query(
            `select php_per_unit from public.currency_rates where currency = $1 and rate_date = '2026-09-05'`,
            [CUR],
        )
        expect(Number(rows[0].php_per_unit)).toBe(57.6)
    })
})

describe("override_currency_rate", () => {
    it("refuses anyone but a Super Admin", async () => {
        const outsider = await clientFor("outsider")
        const { error } = await outsider.rpc("override_currency_rate", {
            p_currency: CUR, p_rate_date: "2026-09-05", p_php_per_unit: 60,
        })
        expect(error?.message).toMatch(/super admin/i)
    })

    it("records who overrode it and what it replaced, and a later fetch leaves it alone", async () => {
        const superAdmin = await clientFor("superAdmin")
        const { error } = await superAdmin.rpc("override_currency_rate", {
            p_currency: CUR, p_rate_date: "2026-09-05", p_php_per_unit: 60,
        })
        expect(error).toBeNull()

        await svc().rpc("record_currency_rate", {
            p_currency: CUR, p_rate_date: "2026-09-05", p_php_per_unit: 57.7, p_source: "feed",
        })

        const { rows } = await sql().query(
            `select php_per_unit, source, overridden_by, overridden_at, replaced_php_per_unit
               from public.currency_rates where currency = $1 and rate_date = '2026-09-05'`,
            [CUR],
        )
        expect(Number(rows[0].php_per_unit)).toBe(60)
        expect(rows[0].source).toBe("override")
        expect(rows[0].overridden_by).toBe(ids.superAdmin)
        expect(rows[0].overridden_at).not.toBeNull()
        expect(Number(rows[0].replaced_php_per_unit)).toBe(57.6)
    })

    it("adds a new currency on demand", async () => {
        const superAdmin = await clientFor("superAdmin")
        await sql().query(`delete from public.currency_rates where currency = 'ZZN'`)
        await sql().query(`delete from public.currency_rate_currencies where currency = 'ZZN'`)
        const { error } = await superAdmin.rpc("override_currency_rate", {
            p_currency: "zzn", p_rate_date: "2026-09-05", p_php_per_unit: 3,
        })
        expect(error).toBeNull()
        const { rows } = await sql().query(`select 1 from public.currency_rate_currencies where currency = 'ZZN'`)
        expect(rows).toHaveLength(1)
        await sql().query(`delete from public.currency_rates where currency = 'ZZN'`)
        await sql().query(`delete from public.currency_rate_currencies where currency = 'ZZN'`)
    })

    it("refuses a rate of zero or less", async () => {
        const superAdmin = await clientFor("superAdmin")
        const { error } = await superAdmin.rpc("override_currency_rate", {
            p_currency: CUR, p_rate_date: "2026-09-06", p_php_per_unit: 0,
        })
        expect(error).not.toBeNull()
    })
})

describe("reference_rate", () => {
    it("returns the latest rate on or before the day, under its own date", async () => {
        const ordinary = await clientFor("ordinary")
        const { data, error } = await ordinary.rpc("reference_rate", { p_currency: CUR, p_on: "2026-09-20" })
        expect(error).toBeNull()
        const row = Array.isArray(data) ? data[0] : data
        expect(row.rate_date).toBe("2026-09-05")
        expect(Number(row.php_per_unit)).toBe(60)
        expect(Number(row.divergence_pct)).toBeGreaterThan(0)
    })

    it("returns nothing when there is no rate on or before the day", async () => {
        const ordinary = await clientFor("ordinary")
        const { data, error } = await ordinary.rpc("reference_rate", { p_currency: CUR, p_on: "2020-01-01" })
        expect(error).toBeNull()
        expect(Array.isArray(data) ? data.length : data).toBeFalsy()
    })
})
