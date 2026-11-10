/**
 * Meeting reminders (#629, spec #609): send_meeting_reminders() reminds only approved,
 * due, not-yet-reminded meetings, once per person, and a second run sends nothing.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER } from "./support/rows.js"

const svc = () => serviceClient()
const created = []
const venues = []

const QUARTER = 15 * 60_000
// The next quarter hour: between 5 seconds and 15 minutes ahead.
const nextQuarter = () => Math.ceil((Date.now() + 5_000) / QUARTER) * QUARTER

// A meeting cannot span Manila midnight (meeting_requests_same_manila_day), and these
// meetings must start within the next quarter hour, so the last 45 minutes of the
// Manila day cannot seat them (the +2 quarter case ends 45 minutes out).
const MANILA_OFFSET = 8 * 60 * 60_000
const DAY = 24 * 60 * 60_000
const nearManilaMidnight = () => DAY - ((Date.now() + MANILA_OFFSET) % DAY) < 3 * QUARTER + 5_000

// Each request gets its own Venue so slots never clash with each other.
const seed = async ({ status = "APPROVED", offsetQuarters = 0, facilitator = ids.head, participants = [] } = {}) => {
    const { data: v, error: ve } = await svc()
        .from("calendar_venues")
        .insert({ name: `${MARKER} reminder room ${venues.length}`, active: true, sort_order: 99 })
        .select("id")
        .single()
    if (ve) throw new Error(ve.message)
    venues.push(v.id)
    const start = new Date(nextQuarter() + offsetQuarters * QUARTER)
    const end = new Date(start.getTime() + QUARTER)
    const { data, error } = await svc()
        .from("meeting_requests")
        .insert({
            applicant_id: ids.ordinary,
            venue_id: v.id,
            starts_at: start.toISOString(),
            ends_at: end.toISOString(),
            facilitator_id: facilitator,
            purpose: `${MARKER} reminder`,
            status,
        })
        .select("id")
        .single()
    if (error) throw new Error(error.message)
    created.push(data.id)
    if (participants.length) {
        const { error: pe } = await svc()
            .from("meeting_request_participants")
            .insert(participants.map((employee_id) => ({ request_id: data.id, employee_id })))
        if (pe) throw new Error(pe.message)
    }
    return data.id
}

const run = async () => {
    const { error } = await svc().rpc("send_meeting_reminders")
    if (error) throw new Error(error.message)
}
const notes = async (id) =>
    (await svc().from("notifications").select("recipient_id, type").eq("reference_id", id).eq("type", "MEETING_REMINDER")).data
const stamp = async (id) =>
    (await svc().from("meeting_requests").select("reminder_sent_at").eq("id", id).single()).data.reminder_sent_at

beforeAll(async () => {
    await ensureCastLoaded()
})

afterAll(async () => {
    if (created.length) {
        await svc().from("notifications").delete().in("reference_id", created)
        await svc().from("meeting_requests").delete().in("id", created)
    }
    if (venues.length) await svc().from("calendar_venues").delete().in("id", venues)
})

describe.skipIf(nearManilaMidnight())("send_meeting_reminders", () => {
    it("reminds an approved due meeting once per person, even with two roles, and stamps it", async () => {
        // the facilitator and the applicant are also listed as participants
        const id = await seed({ participants: [ids.head, ids.ordinary, ids.hr] })
        await run()
        const rows = await notes(id)
        expect(rows.map((r) => r.recipient_id).sort()).toEqual([ids.head, ids.hr, ids.ordinary].sort())
        expect(await stamp(id)).not.toBeNull()
    })

    it("sends nothing the second time", async () => {
        const id = await seed({ facilitator: ids.hr })
        await run()
        expect((await notes(id)).length).toBe(2)
        await run()
        expect((await notes(id)).length).toBe(2)
    })

    it("skips pending, returned, declined, cancelled and far-away meetings", async () => {
        const skipped = []
        for (const status of ["PENDING_HEAD", "PENDING_HR", "RETURNED", "DECLINED", "CANCELLED"]) {
            skipped.push(await seed({ status }))
        }
        skipped.push(await seed({ offsetQuarters: 2 })) // approved but 30+ minutes away
        await run()
        for (const id of skipped) {
            expect(await notes(id)).toEqual([])
            expect(await stamp(id)).toBeNull()
        }
    })
})
