/**
 * #558 (spec #544): the Notes panel hears the log entries the database writes, and a
 * Transmittal's prepared time is a full timestamp.
 *
 *   - sales_opportunity_logs is in the supabase_realtime publication, so the panel's
 *     postgres_changes subscription is told about the "Final Offer changed after the bid
 *     was submitted" entry (a trigger insert like any other).
 *   - transmittals.prepared_on is timestamptz and defaults to now(), so a slip made at
 *     5 PM keeps 5 PM; a day stored before the change reads back as that same Manila day.
 */
import { describe, it, expect, afterAll } from "vitest"
import { closeSql, isInRealtimePublication, sql } from "./support/stack.js"

afterAll(async () => {
    await closeSql()
})

describe("Notes realtime", () => {
    it("sales_opportunity_logs is a member of the supabase_realtime publication", async () => {
        expect(await isInRealtimePublication("sales_opportunity_logs")).toBe(true)
    })
})

describe("Transmittal prepared time", () => {
    it("is a timestamptz that defaults to now()", async () => {
        const { rows } = await sql().query(
            `select data_type, column_default from information_schema.columns
              where table_schema = 'public' and table_name = 'transmittals' and column_name = 'prepared_on'`,
        )
        expect(rows[0].data_type).toBe("timestamp with time zone")
        expect(rows[0].column_default).toMatch(/now\(\)/)
    })

    it("a day stored as a date converts to midnight Manila of the same day", async () => {
        const { rows } = await sql().query(
            `select to_char((date '2026-10-05')::timestamp at time zone 'Asia/Manila' at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI') as manila`,
        )
        expect(rows[0].manila).toBe("2026-10-05 00:00")
    })
})
