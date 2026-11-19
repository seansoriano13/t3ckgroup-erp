/**
 * Activities (#1055, spec #1054): four types, anyone can lead, HR approves only room Meetings and Events.
 *
 *   the approval rule: an Event, or a Meeting with a Venue, is PENDING_HR; everything else is APPROVED at once
 *   Event is for department heads only
 *   the Lead can be any employee
 *   only a Meeting may have a Venue, a meeting type or a meeting link
 *   an edit runs the approval rule again
 *   the 15-minute reminder reads right for an Online Meeting and a task
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER } from "./support/rows.js"
import { ahead } from "./support/dates.js"

const svc = () => serviceClient()
const created = []
let venue
let otherVenue

// One Manila day per slot number, 9:00 to 10:00, so no two requests ever clash at a Venue.
const slot = (n, h = 1) => {
    const d = Date.UTC(...ahead(90 + n), 1, 0, 0)
    return { p_starts_at: new Date(d).toISOString(), p_ends_at: new Date(d + h * 3_600_000).toISOString() }
}

let n = 0
const file = async (who, over = {}) => {
    n += 1
    const { data, error } = await (await clientFor(who)).rpc("file_meeting_request", {
        p_venue_id: null,
        ...slot(n),
        p_facilitator_id: ids[who],
        p_purpose: `${MARKER} activity`,
        p_guests: [],
        p_participant_ids: [],
        p_activity_type: "ADMIN_TASK",
        ...over,
    })
    if (data) created.push(data)
    return { id: data, error }
}

const row = async (id) =>
    (await svc().from("meeting_requests").select("*").eq("id", id).single()).data

const edit = async (who, id, over = {}) => {
    const r = await row(id)
    return (await clientFor(who)).rpc("edit_meeting_request", {
        p_request_id: id,
        p_venue_id: r.venue_id,
        p_starts_at: r.starts_at,
        p_ends_at: r.ends_at,
        p_facilitator_id: r.facilitator_id,
        p_purpose: r.purpose,
        p_guests: [],
        p_participant_ids: [],
        p_meeting_type: r.meeting_type,
        p_meeting_link: r.meeting_link,
        p_activity_type: r.activity_type,
        ...over,
    })
}

beforeAll(async () => {
    await ensureCastLoaded()
    const { data } = await svc().from("calendar_venues").select("id, name").in("name", ["Admin Office", "Conference Room"])
    venue = data.find((v) => v.name === "Admin Office").id
    otherVenue = data.find((v) => v.name === "Conference Room").id
})

afterAll(async () => {
    if (created.length) {
        await svc().from("notifications").delete().in("reference_id", created)
        await svc().from("meeting_requests").delete().in("id", created)
    }
})

describe("who approves", () => {
    it("approves an Admin Task and an Operations Task at once, without HR", async () => {
        for (const type of ["ADMIN_TASK", "OPERATIONS_TASK"]) {
            const { id, error } = await file("head", { p_activity_type: type })
            expect(error).toBeNull()
            expect(await row(id)).toMatchObject({ status: "APPROVED", activity_type: type, venue_id: null, meeting_type: null })
        }
    })

    it("approves an Online Meeting at once", async () => {
        const { id, error } = await file("ordinary", {
            p_activity_type: "MEETING",
            p_meeting_type: "ONLINE",
            p_meeting_link: "https://x.test/a",
        })
        expect(error).toBeNull()
        expect(await row(id)).toMatchObject({ status: "APPROVED", activity_type: "MEETING", meeting_type: "ONLINE" })
        const events = (await svc().from("meeting_request_events").select("action, to_status").eq("request_id", id)).data
        expect(events).toEqual([{ action: "FILED", to_status: "APPROVED" }])
    })

    it("sends an Onsite or Hybrid Meeting to HR", async () => {
        const onsite = await file("ordinary", { p_activity_type: "MEETING", p_meeting_type: "ONSITE", p_venue_id: venue })
        expect((await row(onsite.id)).status).toBe("PENDING_HR")
        const hybrid = await file("ordinary", {
            p_activity_type: "MEETING",
            p_meeting_type: "HYBRID",
            p_venue_id: venue,
            p_meeting_link: "https://x.test/h",
        })
        expect((await row(hybrid.id)).status).toBe("PENDING_HR")
    })

    it("approves an Event a head files at once (#1063)", async () => {
        const { id, error } = await file("head", { p_activity_type: "EVENT" })
        expect(error).toBeNull()
        expect(await row(id)).toMatchObject({ status: "APPROVED", activity_type: "EVENT" })
    })

    it("treats a call without a type as an Onsite Meeting, like before", async () => {
        const { id, error } = await file("ordinary", { p_activity_type: undefined, p_venue_id: venue })
        expect(error).toBeNull()
        expect(await row(id)).toMatchObject({ status: "PENDING_HR", activity_type: "MEETING", meeting_type: "ONSITE" })
    })

    it("reads a row written without a type as a Meeting (the backfill for old rows)", async () => {
        const { data, error } = await svc()
            .from("meeting_requests")
            .insert({ applicant_id: ids.ordinary, facilitator_id: ids.head, purpose: `${MARKER} old`, status: "APPROVED", venue_id: venue, ...rawSlot(960) })
            .select("id, activity_type, meeting_type")
            .single()
        expect(error).toBeNull()
        created.push(data.id)
        expect(data).toMatchObject({ activity_type: "MEETING", meeting_type: "ONSITE" })
    })
})

describe("Event is for heads only", () => {
    it("refuses an Event from a non-head, and says why", async () => {
        const { error } = await file("ordinary", { p_activity_type: "EVENT" })
        expect(error?.message).toMatch(/department head/i)
    })

    it("refuses an Event written straight into the table by a non-head client", async () => {
        const { error } = await (await clientFor("ordinary"))
            .from("meeting_requests")
            .insert({ applicant_id: ids.ordinary, starts_at: slot(900).p_starts_at, ends_at: slot(900).p_ends_at, facilitator_id: ids.ordinary, purpose: "x", activity_type: "EVENT" })
        expect(error).not.toBeNull()
    })

    it("refuses an edit that turns a Meeting into an Event for a non-head", async () => {
        const { id } = await file("ordinary", { p_activity_type: "MEETING", p_meeting_type: "ONLINE", p_meeting_link: "https://x.test/e" })
        const { error } = await edit("ordinary", id, { p_activity_type: "EVENT", p_meeting_type: null, p_meeting_link: null })
        expect(error?.message).toMatch(/department head/i)
        expect((await row(id)).activity_type).toBe("MEETING")
    })
})

describe("the Lead", () => {
    it("can be any employee, head or not", async () => {
        const { id, error } = await file("head", { p_facilitator_id: ids.outsider })
        expect(error).toBeNull()
        expect((await row(id)).facilitator_id).toBe(ids.outsider)
    })

    it("must be a real employee", async () => {
        const { error } = await file("head", { p_facilitator_id: "00000000-0000-0000-0000-000000000000" })
        expect(error?.message).toMatch(/Lead/)
    })
})

describe("Meeting-only fields", () => {
    it("refuses a Venue, a meeting type or a link on any other Activity", async () => {
        for (const type of ["ADMIN_TASK", "OPERATIONS_TASK"]) {
            expect((await file("head", { p_activity_type: type, p_venue_id: venue })).error?.message).toMatch(/Only a Meeting/)
            expect((await file("head", { p_activity_type: type, p_meeting_type: "ONLINE" })).error?.message).toMatch(/Only a Meeting/)
            expect((await file("head", { p_activity_type: type, p_meeting_link: "https://x.test/a" })).error?.message).toMatch(/Only a Meeting/)
        }
        expect((await file("head", { p_activity_type: "EVENT", p_venue_id: venue })).error?.message).toMatch(/Only a Meeting/)
    })

    it("refuses an unknown Activity type", async () => {
        expect((await file("head", { p_activity_type: "PARTY" })).error?.message).toMatch(/Activity type/)
    })

    it("is enforced by the table itself, not only the function", async () => {
        const base = { applicant_id: ids.ordinary, facilitator_id: ids.ordinary, purpose: `${MARKER} raw`, status: "APPROVED" }
        const venueOnTask = await svc().from("meeting_requests").insert({ ...base, ...rawSlot(901), activity_type: "ADMIN_TASK", venue_id: venue, meeting_type: null })
        expect(venueOnTask.error).not.toBeNull()
        const typeOnTask = await svc().from("meeting_requests").insert({ ...base, ...rawSlot(902), activity_type: "EVENT", venue_id: null, meeting_type: "ONLINE" })
        expect(typeOnTask.error).not.toBeNull()
        const badType = await svc().from("meeting_requests").insert({ ...base, ...rawSlot(903), activity_type: "PARTY", venue_id: null, meeting_type: null })
        expect(badType.error).not.toBeNull()
        const plain = await svc().from("meeting_requests").insert({ ...base, ...rawSlot(904), activity_type: "ADMIN_TASK", venue_id: null, meeting_type: null }).select("id").single()
        expect(plain.error).toBeNull()
        created.push(plain.data.id)
    })
})

const rawSlot = (k) => {
    const s = slot(k)
    return { starts_at: s.p_starts_at, ends_at: s.p_ends_at }
}

describe("an edit runs the approval rule again", () => {
    it("keeps a room Meeting changed to Online approved", async () => {
        const { id } = await file("ordinary", { p_activity_type: "MEETING", p_meeting_type: "ONSITE", p_venue_id: venue })
        expect((await row(id)).status).toBe("PENDING_HR")
        const { data, error } = await edit("ordinary", id, { p_venue_id: null, p_meeting_type: "ONLINE", p_meeting_link: "https://x.test/o" })
        expect(error).toBeNull()
        expect(data).toMatchObject({ from_status: "PENDING_HR", to_status: "APPROVED" })
        expect(await row(id)).toMatchObject({ status: "APPROVED", venue_id: null, meeting_type: "ONLINE" })
    })

    it("sends an Online Meeting changed to Onsite to HR", async () => {
        const { id } = await file("ordinary", { p_activity_type: "MEETING", p_meeting_type: "ONLINE", p_meeting_link: "https://x.test/o" })
        expect((await row(id)).status).toBe("APPROVED")
        const { data, error } = await edit("ordinary", id, { p_venue_id: otherVenue, p_meeting_type: "ONSITE", p_meeting_link: null })
        expect(error).toBeNull()
        expect(data).toMatchObject({ from_status: "APPROVED", to_status: "PENDING_HR" })
        expect((await row(id)).status).toBe("PENDING_HR")
    })

    it("keeps an edited task approved, and an edited pending-HR Online row approved", async () => {
        const { id } = await file("head")
        const { data, error } = await edit("head", id, { p_purpose: "Changed" })
        expect(error).toBeNull()
        expect(data.to_status).toBe("APPROVED")
        // a legacy Online row that was left pending HR at ship time
        const legacy = await svc()
            .from("meeting_requests")
            .insert({ applicant_id: ids.ordinary, facilitator_id: ids.head, purpose: `${MARKER} legacy`, status: "PENDING_HR", meeting_type: "ONLINE", meeting_link: "https://x.test/l", ...rawSlot(950) })
            .select("id")
            .single()
        created.push(legacy.data.id)
        expect((await row(legacy.data.id)).status).toBe("PENDING_HR")
        const e = await edit("ordinary", legacy.data.id, { p_purpose: "Legacy edit" })
        expect(e.data.to_status).toBe("APPROVED")
    })

    it("lets a department head change a task into an Event, which stays approved", async () => {
        const { id } = await file("head")
        const { data, error } = await edit("head", id, { p_activity_type: "EVENT" })
        expect(error).toBeNull()
        expect(data.to_status).toBe("APPROVED")
    })
})

const QUARTER = 15 * 60_000
const MANILA_OFFSET = 8 * 60 * 60_000
const DAY = 24 * 60 * 60_000
const nearManilaMidnight = () => DAY - ((Date.now() + MANILA_OFFSET) % DAY) < 3 * QUARTER + 5_000

describe.skipIf(nearManilaMidnight())("the 15-minute reminder", () => {
    const seedDue = async (over) => {
        const start = new Date(Math.ceil((Date.now() + 5_000) / QUARTER) * QUARTER)
        const { data, error } = await svc()
            .from("meeting_requests")
            .insert({
                applicant_id: ids.ordinary,
                facilitator_id: ids.head,
                purpose: `${MARKER} soon`,
                status: "APPROVED",
                starts_at: start.toISOString(),
                ends_at: new Date(start.getTime() + QUARTER).toISOString(),
                ...over,
            })
            .select("id")
            .single()
        if (error) throw new Error(error.message)
        created.push(data.id)
        return data.id
    }
    const messages = async (id) =>
        (await svc().from("notifications").select("title, message").eq("reference_id", id).eq("type", "MEETING_REMINDER")).data

    it("does not say Venue for an Online Meeting", async () => {
        const id = await seedDue({ meeting_type: "ONLINE", meeting_link: "https://x.test/r" })
        await svc().rpc("send_meeting_reminders")
        const [first] = await messages(id)
        expect(first.title).toBe("Activity starts soon")
        expect(first.message).toMatch(/^Online, .+: .*soon$/)
        expect(first.message).not.toMatch(/Venue/)
    })

    it("reminds for a task, with no place in the text", async () => {
        const id = await seedDue({ activity_type: "ADMIN_TASK", meeting_type: null })
        await svc().rpc("send_meeting_reminders")
        const [first] = await messages(id)
        expect(first.message).toMatch(/^[A-Z][a-z]{2} \d+, .+: .*soon$/)
        expect(first.message).not.toMatch(/Venue|Online/)
    })
})
