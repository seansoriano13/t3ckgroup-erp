/**
 * Activities (#1063, spec #1062): heads file the task types, approvers do not wait.
 *
 *   who files: anyone a Meeting; only a department head an Admin Task, an Operations Task or an Event
 *   who approves: only a room Meeting waits for HR, and never one filed by HR or a Super Admin
 *   the rule runs again on every edit, so an approver's own Activity stays approved
 *   an Admin Task a non-head filed before can still be changed and cancelled, but nobody who is not a head
 *     can turn an Activity into one
 *   one time: waiting requests filed by approvers, and waiting Events filed by heads, are approved with a
 *     history row, and the people on them are told
 */
import { readFileSync } from "node:fs"
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { MARKER } from "./support/rows.js"
import { ahead } from "./support/dates.js"

const svc = () => serviceClient()
const created = []
let venue
let otherVenue

// One Manila day per slot number, 9:00 to 10:00, so no two requests ever clash at a Venue.
const slot = (n, h = 1) => {
    const d = Date.UTC(...ahead(150 + n), 1, 0, 0)
    return { p_starts_at: new Date(d).toISOString(), p_ends_at: new Date(d + h * 3_600_000).toISOString() }
}
const rawSlot = (k) => {
    const s = slot(k)
    return { starts_at: s.p_starts_at, ends_at: s.p_ends_at }
}

let n = 0
const file = async (who, over = {}) => {
    n += 1
    const { data, error } = await (await clientFor(who)).rpc("file_meeting_request", {
        p_venue_id: null,
        ...slot(n),
        p_facilitator_id: ids[who],
        p_purpose: `${MARKER} rules`,
        p_guests: [],
        p_participant_ids: [],
        p_activity_type: "ADMIN_TASK",
        ...over,
    })
    if (data) created.push(data)
    return { id: data, error }
}
const room = (who, over = {}) => file(who, { p_activity_type: "MEETING", p_meeting_type: "ONSITE", p_venue_id: venue, ...over })

const row = async (id) => (await svc().from("meeting_requests").select("*").eq("id", id).single()).data

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

/** A row written straight into the table, as the old rules left it. */
const seedRaw = async (over) => {
    n += 1
    const { data, error } = await svc()
        .from("meeting_requests")
        .insert({ facilitator_id: ids.head, purpose: `${MARKER} seeded`, ...rawSlot(500 + n), ...(over.activity_type && over.activity_type !== "MEETING" ? { meeting_type: null } : {}), ...over })
        .select("id")
        .single()
    if (error) throw new Error(error.message)
    created.push(data.id)
    return data.id
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

describe("who files each type", () => {
    it("lets anyone file a Meeting", async () => {
        for (const who of ["ordinary", "head", "hr", "superAdmin"]) {
            const { error } = await file(who, { p_activity_type: "MEETING", p_meeting_type: "ONLINE", p_meeting_link: "https://x.test/m" })
            expect(error).toBeNull()
        }
    })

    it("refuses an Admin Task, an Operations Task and an Event from a non-head, and says why", async () => {
        for (const type of ["ADMIN_TASK", "OPERATIONS_TASK", "EVENT"]) {
            const { error } = await file("ordinary", { p_activity_type: type })
            expect(error?.message).toMatch(/department head/i)
        }
    })

    it("refuses them from HR and a Super Admin who are not heads either", async () => {
        for (const who of ["hr", "superAdmin"]) {
            expect((await file(who, { p_activity_type: "ADMIN_TASK" })).error?.message).toMatch(/department head/i)
        }
    })

    it("lets a department head file all three, straight onto the Calendar", async () => {
        for (const type of ["ADMIN_TASK", "OPERATIONS_TASK", "EVENT"]) {
            const { id, error } = await file("head", { p_activity_type: type })
            expect(error).toBeNull()
            expect(await row(id)).toMatchObject({ status: "APPROVED", activity_type: type })
        }
    })
})

describe("who approves, on filing", () => {
    it("holds an ordinary person's room Meeting for HR", async () => {
        const { id, error } = await room("ordinary")
        expect(error).toBeNull()
        expect((await row(id)).status).toBe("PENDING_HR")
    })

    it("holds a department head's room Meeting for HR too", async () => {
        expect((await row((await room("head")).id)).status).toBe("PENDING_HR")
    })

    it("approves a room Meeting HR or a Super Admin files themselves, at once", async () => {
        for (const who of ["hr", "superAdmin"]) {
            const { id, error } = await room(who)
            expect(error).toBeNull()
            expect((await row(id)).status).toBe("APPROVED")
        }
    })

    it("approves an Online Meeting at once for anyone", async () => {
        const { id } = await file("ordinary", { p_activity_type: "MEETING", p_meeting_type: "ONLINE", p_meeting_link: "https://x.test/o" })
        expect((await row(id)).status).toBe("APPROVED")
    })
})

describe("who approves, on every edit", () => {
    it("keeps an approver's own approved room Meeting approved after they change it", async () => {
        for (const who of ["hr", "superAdmin"]) {
            const { id } = await room(who)
            const { data, error } = await edit(who, id, { p_purpose: "Changed", p_venue_id: otherVenue })
            expect(error).toBeNull()
            expect(data).toMatchObject({ from_status: "APPROVED", to_status: "APPROVED" })
            expect((await row(id)).status).toBe("APPROVED")
        }
    })

    it("sends an ordinary person's approved Online Meeting back to HR when it takes a room", async () => {
        const { id } = await file("ordinary", { p_activity_type: "MEETING", p_meeting_type: "ONLINE", p_meeting_link: "https://x.test/o" })
        const { data, error } = await edit("ordinary", id, { p_venue_id: venue, p_meeting_type: "ONSITE", p_meeting_link: null })
        expect(error).toBeNull()
        expect(data.to_status).toBe("PENDING_HR")
    })

    it("keeps a head's Event approved after it changes", async () => {
        const { id } = await file("head", { p_activity_type: "EVENT" })
        const { data, error } = await edit("head", id, { p_purpose: "Changed" })
        expect(error).toBeNull()
        expect(data.to_status).toBe("APPROVED")
    })
})

describe("a task a non-head filed before", () => {
    it("can still be changed and cancelled by its filer", async () => {
        const id = await seedRaw({ applicant_id: ids.ordinary, activity_type: "ADMIN_TASK", status: "APPROVED" })
        const changed = await edit("ordinary", id, { p_purpose: "Still mine" })
        expect(changed.error).toBeNull()
        expect((await row(id)).purpose).toBe("Still mine")
        const cancelled = await (await clientFor("ordinary")).rpc("cancel_meeting_request", { p_request_id: id })
        expect(cancelled.error).toBeNull()
        expect((await row(id)).status).toBe("CANCELLED")
    })

    it("cannot be turned into another task type by a non-head", async () => {
        const id = await seedRaw({ applicant_id: ids.ordinary, activity_type: "ADMIN_TASK", status: "APPROVED" })
        const { error } = await edit("ordinary", id, { p_activity_type: "OPERATIONS_TASK" })
        expect(error?.message).toMatch(/department head/i)
        expect((await row(id)).activity_type).toBe("ADMIN_TASK")
    })

    it("cannot be made out of a Meeting by a non-head", async () => {
        const { id } = await file("ordinary", { p_activity_type: "MEETING", p_meeting_type: "ONLINE", p_meeting_link: "https://x.test/o" })
        for (const type of ["ADMIN_TASK", "OPERATIONS_TASK", "EVENT"]) {
            const { error } = await edit("ordinary", id, { p_activity_type: type, p_meeting_type: null, p_meeting_link: null })
            expect(error?.message).toMatch(/department head/i)
        }
        expect((await row(id)).activity_type).toBe("MEETING")
    })

    it("can be made out of a Meeting by a head", async () => {
        const { id } = await file("head", { p_activity_type: "MEETING", p_meeting_type: "ONLINE", p_meeting_link: "https://x.test/o" })
        const { data, error } = await edit("head", id, { p_activity_type: "ADMIN_TASK", p_meeting_type: null, p_meeting_link: null })
        expect(error).toBeNull()
        expect(data.to_status).toBe("APPROVED")
    })
})

describe("the one-time approval", () => {
    // The block of the migration that moves what the old rules left waiting. Run here against seeded rows.
    const migration = readFileSync(new URL("../../../supabase/migrations/20261217130000_1063_activity_filing_rules.sql", import.meta.url), "utf8")
    const oneTime = migration.slice(migration.indexOf("-- ---- One time"))

    it("approves waiting requests filed by approvers and waiting Events filed by heads, and nothing else", async () => {
        const approver = await seedRaw({ applicant_id: ids.hr, venue_id: venue, meeting_type: "ONSITE", status: "PENDING_HR" })
        const superAdmin = await seedRaw({ applicant_id: ids.superAdmin, venue_id: otherVenue, meeting_type: "ONSITE", status: "PENDING_HR" })
        const headEvent = await seedRaw({ applicant_id: ids.head, activity_type: "EVENT", status: "PENDING_HR" })
        const ordinaryRoom = await seedRaw({ applicant_id: ids.ordinary, venue_id: venue, meeting_type: "ONSITE", status: "PENDING_HR" })
        const headRoom = await seedRaw({ applicant_id: ids.head, venue_id: otherVenue, meeting_type: "ONSITE", status: "PENDING_HR" })
        const alreadyApproved = await seedRaw({ applicant_id: ids.hr, activity_type: "ADMIN_TASK", status: "APPROVED" })
        await svc().from("meeting_request_participants").insert({ request_id: headEvent, employee_id: ids.outsider })

        await sql().query(oneTime)

        for (const id of [approver, superAdmin, headEvent]) expect((await row(id)).status).toBe("APPROVED")
        for (const id of [ordinaryRoom, headRoom]) expect((await row(id)).status).toBe("PENDING_HR")
        expect((await row(alreadyApproved)).status).toBe("APPROVED")

        const events = (await svc().from("meeting_request_events").select("request_id, action, from_status, to_status").in("request_id", [approver, superAdmin, headEvent, ordinaryRoom, headRoom, alreadyApproved])).data
        const byRule = events.filter((e) => e.action === "APPROVED_BY_RULE")
        expect(byRule.map((e) => e.request_id).sort()).toEqual([approver, superAdmin, headEvent].sort())
        expect(byRule.every((e) => e.from_status === "PENDING_HR" && e.to_status === "APPROVED")).toBe(true)

        // The Lead and Participants are told; the filer is not.
        const notes = (await svc().from("notifications").select("recipient_id, type, title, message, reference_id").eq("reference_id", headEvent)).data
        expect(notes.map((x) => x.recipient_id)).toEqual([ids.outsider])
        expect(notes[0]).toMatchObject({ type: "MEETING_APPROVED", title: "You're on an Activity" })
        expect(notes[0].message).toMatch(/^Event: /)
        expect(notes[0].message).toMatch(/Scheduled by /)
        expect(notes[0].message).toMatch(/\d{1,2}:\d{2} [AP]M to \d{1,2}:\d{2} [AP]M: /)

        // Decided by the rule: a time, and no person.
        const decided = await row(headEvent)
        expect(decided.hr_decided_at).not.toBeNull()
        expect(decided.hr_decided_by).toBeNull()
    })

    it("does nothing a second time", async () => {
        const id = await seedRaw({ applicant_id: ids.hr, activity_type: "ADMIN_TASK", status: "PENDING_HR" })
        await sql().query(oneTime)
        await sql().query(oneTime)
        const events = (await svc().from("meeting_request_events").select("action").eq("request_id", id).eq("action", "APPROVED_BY_RULE")).data
        expect(events).toHaveLength(1)
    })
})
