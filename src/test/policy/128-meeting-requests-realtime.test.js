/**
 * #627 (spec #609): Meeting Request changes reach everyone with the Calendar open through a Broadcast
 * trigger on both tables (the shared useTableRealtime hook). Time Off tables are not live.
 */
import { describe, it, expect, afterAll } from "vitest"
import { closeSql, isInRealtimePublication, sql } from "./support/stack.js"

afterAll(async () => {
    await closeSql()
})

async function hasBroadcastTrigger(table) {
    const { rows } = await sql().query(
        `select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
          where c.relnamespace = 'public'::regnamespace and c.relname = $1
            and t.tgname = $1 || '_broadcast_change_trigger' and not t.tgisinternal`,
        [table],
    )
    return rows.length > 0
}

describe("Meeting Requests realtime", () => {
    it.each(["meeting_requests", "meeting_request_participants"])("%s broadcasts a change signal", async (table) => {
        expect(await hasBroadcastTrigger(table)).toBe(true)
    })

    it("Time Off tables stay out of it", async () => {
        expect(await hasBroadcastTrigger("offset_leaves")).toBe(false)
        expect(await isInRealtimePublication("offset_leaves")).toBe(false)
    })
})
