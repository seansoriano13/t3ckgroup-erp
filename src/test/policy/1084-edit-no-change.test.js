/**
 * Edit an Activity with nothing changed (#1084, spec #1083, tracker A1).
 *
 *   an edit that differs in no field is a no-op: the status stays (an APPROVED Activity stays APPROVED),
 *   no event row is written, no column moves, and the answer says "no change"
 *   a real change (the end time) still goes back to HR, with one EDITED event
 *   a value the function refuses is still refused when nothing else changed
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER } from "./support/rows.js"
import { ahead } from "./support/dates.js"

const svc = () => serviceClient()
const created = []
let venue

// One Manila day per slot number, 09:00 to 10:00, so no two requests clash at a Venue.
const slot = (n, hours = 1) => {
    const d = Date.UTC(...ahead(210 + n), 1, 0, 0)
    return { p_starts_at: new Date(d).toISOString(), p_ends_at: new Date(d + hours * 3_600_000).toISOString() }
}
let n = 0

/** An ordinary person's room Meeting with a Participant and a Guest, approved by HR. */
const approvedRoomMeeting = async () => {
    n += 1
    const { data, error } = await (await clientFor("ordinary")).rpc("file_meeting_request", {
        p_venue_id: venue,
        ...slot(n),
        p_facilitator_id: ids.head,
        p_purpose: `${MARKER} no change`,
        p_guests: ["Mr. Visitor"],
        p_guest_emails: ["visitor@example.test"],
        p_participant_ids: [ids.outsider],
        p_activity_type: "MEETING",
        p_meeting_type: "ONSITE",
    })
    if (error) throw new Error(error.message)
    created.push(data)
    const { error: approveError } = await svc()
        .from("meeting_requests")
        .update({ status: "APPROVED", hr_decided_by: ids.hr, hr_decided_at: new Date().toISOString(), hr_note: "ok" })
        .eq("id", data)
    if (approveError) throw new Error(approveError.message)
    return data
}

const row = async (id) => (await svc().from("meeting_requests").select("*").eq("id", id).single()).data
const events = async (id) => (await svc().from("meeting_request_events").select("*").eq("request_id", id).order("created_at")).data
const people = async (id) =>
    ((await svc().from("meeting_request_participants").select("employee_id").eq("request_id", id)).data ?? []).map((p) => p.employee_id)

/** The saved values sent back as they are, as the form does when nothing was touched. */
const edit = async (id, over = {}) => {
    const r = await row(id)
    return (await clientFor("ordinary")).rpc("edit_meeting_request", {
        p_request_id: id,
        p_venue_id: r.venue_id,
        p_starts_at: r.starts_at,
        p_ends_at: r.ends_at,
        p_facilitator_id: r.facilitator_id,
        p_purpose: r.purpose,
        p_guests: r.guests,
        p_guest_emails: r.guest_emails,
        p_participant_ids: await people(id),
        p_head_id: r.head_id,
        p_meeting_type: r.meeting_type,
        p_meeting_link: r.meeting_link,
        p_activity_type: r.activity_type,
        ...over,
    })
}

beforeAll(async () => {
    await ensureCastLoaded()
    const { data } = await svc().from("calendar_venues").select("id, name").eq("name", "Admin Office")
    venue = data[0].id
})

afterAll(async () => {
    if (created.length) {
        await svc().from("notifications").delete().in("reference_id", created)
        await svc().from("meeting_requests").delete().in("id", created)
    }
})

describe("an edit with no differing field", () => {
    it("keeps an APPROVED Activity approved, writes no event and moves no column", async () => {
        const id = await approvedRoomMeeting()
        const before = await row(id)
        const eventsBefore = (await events(id)).length

        const { data, error } = await edit(id)
        expect(error).toBeNull()
        expect(data).toMatchObject({ id, action: "NO_CHANGE", no_change: true, from_status: "APPROVED", to_status: "APPROVED", changed_fields: {} })

        expect(await row(id)).toEqual(before)
        expect(await people(id)).toEqual([ids.outsider])
        expect((await events(id)).length).toBe(eventsBefore)
    })

    it("is a no-op for a pending or returned one too, and for a head's multi-day Activity", async () => {
        const id = await approvedRoomMeeting()
        for (const status of ["PENDING_HR", "RETURNED"]) {
            await svc().from("meeting_requests").update({ status }).eq("id", id)
            const eventsBefore = (await events(id)).length
            const { data, error } = await edit(id)
            expect(error).toBeNull()
            expect(data).toMatchObject({ action: "NO_CHANGE", to_status: status })
            expect((await row(id)).status).toBe(status)
            expect((await events(id)).length).toBe(eventsBefore)
        }

        n += 1
        const base = Date.UTC(...ahead(260 + n), 1, 0, 0)
        const days = [0, 1, 2].map((k) => ({ starts_at: new Date(base + k * 86_400_000).toISOString(), ends_at: new Date(base + k * 86_400_000 + 3_600_000).toISOString() }))
        const filed = await (await clientFor("head")).rpc("file_meeting_request", {
            p_venue_id: null,
            p_starts_at: days[0].starts_at,
            p_ends_at: days[0].ends_at,
            p_facilitator_id: ids.head,
            p_purpose: `${MARKER} multi-day no change`,
            p_activity_type: "ADMIN_TASK",
            p_days: days,
        })
        expect(filed.error).toBeNull()
        created.push(filed.data)
        const eventsBefore = (await events(filed.data)).length
        const r = await row(filed.data)
        const same = await (await clientFor("head")).rpc("edit_meeting_request", {
            p_request_id: filed.data,
            p_venue_id: null,
            p_starts_at: r.starts_at,
            p_ends_at: r.ends_at,
            p_facilitator_id: r.facilitator_id,
            p_purpose: r.purpose,
            p_days: days,
            p_activity_type: "ADMIN_TASK",
        })
        expect(same.error).toBeNull()
        expect(same.data).toMatchObject({ action: "NO_CHANGE", to_status: "APPROVED" })
        expect((await events(filed.data)).length).toBe(eventsBefore)
    })

    it("is a no-op when the saved head_id is not null, because an edit never compares the head", async () => {
        const id = await approvedRoomMeeting()
        const { error: headError } = await svc().from("meeting_requests").update({ head_id: ids.head }).eq("id", id)
        expect(headError).toBeNull()
        const before = await row(id)
        const eventsBefore = (await events(id)).length

        const { data, error } = await edit(id)
        expect(error).toBeNull()
        expect(data).toMatchObject({ id, action: "NO_CHANGE", no_change: true, from_status: "APPROVED", to_status: "APPROVED", changed_fields: {} })

        expect(await row(id)).toEqual(before)
        expect((await events(id)).length).toBe(eventsBefore)
    })

    it("still refuses a value the function refuses", async () => {
        const id = await approvedRoomMeeting()
        const { error } = await edit(id, { p_purpose: "   " })
        expect(error?.message).toMatch(/purpose/i)
        expect((await row(id)).status).toBe("APPROVED")
    })
})

describe("an edit with a differing field", () => {
    it("sends an APPROVED Activity back to HR for a changed end time, with one EDITED event", async () => {
        const id = await approvedRoomMeeting()
        const r = await row(id)
        const eventsBefore = (await events(id)).length
        const longer = new Date(new Date(r.ends_at).getTime() + 3_600_000).toISOString()

        const { data, error } = await edit(id, { p_ends_at: longer })
        expect(error).toBeNull()
        expect(data).toMatchObject({ action: "EDITED", from_status: "APPROVED", to_status: "PENDING_HR" })
        expect(Object.keys(data.changed_fields)).toEqual(expect.arrayContaining(["ends_at", "days"]))

        expect((await row(id)).status).toBe("PENDING_HR")
        const all = await events(id)
        expect(all.length).toBe(eventsBefore + 1)
        expect(all.at(-1)).toMatchObject({ action: "EDITED", from_status: "APPROVED", to_status: "PENDING_HR" })
    })

    it("counts a changed Guest or Participant as a difference too", async () => {
        const id = await approvedRoomMeeting()
        const guest = await edit(id, { p_guests: ["Mr. Visitor", "Ms. Other"], p_guest_emails: ["visitor@example.test", ""] })
        expect(guest.error).toBeNull()
        expect(guest.data.action).toBe("EDITED")

        const id2 = await approvedRoomMeeting()
        const person = await edit(id2, { p_participant_ids: [] })
        expect(person.error).toBeNull()
        expect(person.data.action).toBe("EDITED")
    })
})
