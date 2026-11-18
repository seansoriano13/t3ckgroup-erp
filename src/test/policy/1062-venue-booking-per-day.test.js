/**
 * Venue double-booking is checked per day (#1062 review fix).
 *
 *   a multi-day room Meeting holds its Venue only on the days it lists, at the times it lists
 *   another Activity can use that Venue overnight and on a skipped day
 *   two days that overlap at the same Venue are still refused (23P01)
 *   the holder lookup names the day that clashes
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER } from "./support/rows.js"

const svc = () => serviceClient()
const created = []
let venue

// Manila 09:00 to 10:00 on a day, as UTC instants.
const day = (offset, startH = 1, hours = 1) => {
    const d = Date.UTC(2038, 0, 1 + offset, startH, 0, 0)
    return { starts_at: new Date(d).toISOString(), ends_at: new Date(d + hours * 3_600_000).toISOString() }
}

const file = async (days) => {
    const { data, error } = await (await clientFor("head")).rpc("file_meeting_request", {
        p_venue_id: venue,
        p_starts_at: days[0].starts_at,
        p_ends_at: days[0].ends_at,
        p_days: days,
        p_facilitator_id: ids.head,
        p_purpose: `${MARKER} per day`,
        p_guests: [],
        p_participant_ids: [],
        p_activity_type: "MEETING",
        p_meeting_type: "ONSITE",
    })
    if (data) created.push(data)
    return { id: data, error }
}

beforeAll(async () => {
    await ensureCastLoaded()
    const { data } = await svc().from("calendar_venues").select("id, name").eq("name", "Admin Office").single()
    venue = data.id
    await svc().from("activity_type_settings").update({ multi_day: true }).eq("activity_type", "MEETING")
})
afterAll(async () => {
    await svc().from("activity_type_settings").update({ multi_day: false }).eq("activity_type", "MEETING")
    if (created.length) {
        await svc().from("notifications").delete().in("reference_id", created)
        await svc().from("meeting_requests").delete().in("id", created)
    }
})

describe("a Venue is held per day", () => {
    it("lets another Activity use it on a skipped day and outside the day's hours", async () => {
        // Days 100 and 102, 09:00 to 10:00. Day 101 is skipped.
        expect((await file([day(100), day(102)])).error).toBeNull()
        expect((await file([day(101)])).error).toBeNull()
        expect((await file([day(100, 3, 1)])).error).toBeNull()
    })

    it("refuses a day that overlaps a listed day at the same Venue", async () => {
        expect((await file([day(110), day(112)])).error).toBeNull()
        const clash = await file([day(112, 1, 2)])
        expect(clash.error?.code).toBe("23P01")
    })

    it("names the day that holds the slot", async () => {
        expect((await file([day(120), day(122)])).error).toBeNull()
        const second = day(122)
        const { data } = await (await clientFor("outsider")).rpc("meeting_request_holder", {
            p_venue_id: venue,
            p_starts_at: second.starts_at,
            p_ends_at: second.ends_at,
        })
        expect(data).toHaveLength(1)
        expect(new Date(data[0].starts_at).toISOString()).toBe(second.starts_at)
        const skipped = day(121)
        const none = await (await clientFor("outsider")).rpc("meeting_request_holder", {
            p_venue_id: venue,
            p_starts_at: skipped.starts_at,
            p_ends_at: skipped.ends_at,
        })
        expect(none.data).toHaveLength(0)
    })
})
