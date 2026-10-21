/**
 * #627 (spec #609): Meeting Request changes reach everyone with the Calendar open, so both tables are
 * in the supabase_realtime publication. Time Off tables are not.
 */
import { describe, it, expect, afterAll } from "vitest"
import { closeSql, isInRealtimePublication } from "./support/stack.js"

afterAll(async () => {
    await closeSql()
})

describe("Meeting Requests realtime", () => {
    it.each(["meeting_requests", "meeting_request_participants"])("%s is in the publication", async (table) => {
        expect(await isInRealtimePublication(table)).toBe(true)
    })

    it("Time Off tables stay out of it", async () => {
        expect(await isInRealtimePublication("offset_leaves")).toBe(false)
    })
})
