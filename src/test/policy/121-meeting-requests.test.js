/**
 * Meeting Requests (#619, spec #609, ADR 0038): the database refuses a double-booked Venue and bad
 * times, accepts writes only through file_meeting_request(), routes by the applicant, and shows every
 * pending meeting to everyone on the Calendar.
 *
 *   ordinary -> files; request lands in PENDING_HEAD with the chosen head
 *   head     -> files; request skips the head and lands in PENDING_HR
 *   anyone   -> may read requests, Participants, Venues and events; may not write them directly
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { tryInsert, tryUpdate, tryDelete, RLS_VIOLATION } from "./support/access.js"
import { MARKER } from "./support/rows.js"

const svc = () => serviceClient()
const DAY = "2031-04-14"
const at = (hhmm, day = DAY) => new Date(`${day}T${hhmm}:00+08:00`).toISOString()
const OVERLAP_CODE = "23P01"
const CHECK_CODE = "23514"

let conference
let adminOffice
const created = []

const insertRaw = async (venueId, start, end, status = "PENDING_HEAD", day = DAY) => {
    const { data, error } = await svc()
        .from("meeting_requests")
        .insert({
            applicant_id: ids.ordinary,
            venue_id: venueId,
            starts_at: at(start, day),
            ends_at: at(end, day),
            facilitator_id: ids.head,
            purpose: `${MARKER} raw`,
            status,
            head_id: ids.head,
        })
        .select("id")
        .single()
    if (error) return { error }
    created.push(data.id)
    return { id: data.id }
}

const file = async (who, venueId, start, end, extra = {}) => {
    const { data, error } = await (await clientFor(who)).rpc("file_meeting_request", {
        p_venue_id: venueId,
        p_starts_at: at(start, extra.day),
        p_ends_at: at(end, extra.day),
        p_facilitator_id: ids.head,
        p_purpose: `${MARKER} filed`,
        p_guests: ["Mr. Visitor", "  "],
        p_participant_ids: [ids.outsider],
        p_head_id: who === "ordinary" ? ids.head : null,
        ...extra.args,
    })
    if (data) created.push(data)
    return { id: data, error }
}

beforeAll(async () => {
    await ensureCastLoaded()
    const { data } = await svc().from("calendar_venues").select("id, name")
    conference = data.find((v) => v.name === "Conference Room").id
    adminOffice = data.find((v) => v.name === "Admin Office").id
})

afterAll(async () => {
    if (created.length) await svc().from("meeting_requests").delete().in("id", created)
})

describe("the Venues", () => {
    it("are seeded, and every signed-in employee can read them", async () => {
        const { data } = await (await clientFor("ordinary")).from("calendar_venues").select("name, active")
        expect(data.map((v) => v.name)).toEqual(expect.arrayContaining(["Conference Room", "Admin Office"]))
        expect(data.every((v) => v.active)).toBe(true)
    })

    it("cannot be deleted while a request uses them", async () => {
        await insertRaw(conference, "07:00", "07:15", "PENDING_HEAD", "2031-04-20")
        const { error } = await svc().from("calendar_venues").delete().eq("id", conference)
        expect(error?.code).toBe("23503")
    })
})

describe("no double-booking (ADR 0038)", () => {
    it("refuses an overlapping request at the same Venue", async () => {
        expect((await insertRaw(conference, "09:00", "10:00")).id).toBeTruthy()
        expect((await insertRaw(conference, "09:30", "10:30")).error?.code).toBe(OVERLAP_CODE)
        expect((await insertRaw(conference, "08:00", "09:15")).error?.code).toBe(OVERLAP_CODE)
        expect((await insertRaw(conference, "09:15", "09:45")).error?.code).toBe(OVERLAP_CODE)
    })

    it("accepts the same time at the other Venue", async () => {
        expect((await insertRaw(adminOffice, "09:00", "10:00")).id).toBeTruthy()
    })

    it("accepts back-to-back meetings", async () => {
        expect((await insertRaw(conference, "10:00", "11:00")).id).toBeTruthy()
        expect((await insertRaw(conference, "08:00", "09:00")).id).toBeTruthy()
    })

    it("ignores declined and cancelled requests, and frees their slot", async () => {
        expect((await insertRaw(conference, "13:00", "14:00", "DECLINED")).id).toBeTruthy()
        expect((await insertRaw(conference, "13:00", "14:00", "CANCELLED")).id).toBeTruthy()
        expect((await insertRaw(conference, "13:00", "14:00", "APPROVED")).id).toBeTruthy()
    })

    it("holds the slot for returned and pending-HR requests too", async () => {
        expect((await insertRaw(conference, "15:00", "16:00", "RETURNED")).id).toBeTruthy()
        expect((await insertRaw(conference, "15:30", "16:30", "PENDING_HR")).error?.code).toBe(OVERLAP_CODE)
    })

    it("names the request holding the slot", async () => {
        const { data } = await (await clientFor("outsider")).rpc("meeting_request_holder", {
            p_venue_id: conference,
            p_starts_at: at("09:30"),
            p_ends_at: at("09:45"),
        })
        expect(data).toHaveLength(1)
        expect(data[0]).toMatchObject({ purpose: `${MARKER} raw`, venue_name: "Conference Room" })
        expect(data[0].applicant_name).toBeTruthy()
    })

    it("refuses a clash through the filing function as well", async () => {
        const { error } = await file("ordinary", conference, "09:00", "09:30")
        expect(error?.code).toBe(OVERLAP_CODE)
    })
})

describe("the time rules", () => {
    it("refuses a request that ends on another Manila day", async () => {
        const { error } = await svc().from("meeting_requests").insert({
            applicant_id: ids.ordinary, venue_id: adminOffice,
            starts_at: at("23:00"), ends_at: at("01:00", "2031-04-15"),
            facilitator_id: ids.head, purpose: `${MARKER} x`,
        })
        expect(error?.code).toBe(CHECK_CODE)
    })

    it("refuses times off the 15-minute steps", async () => {
        expect((await insertRaw(adminOffice, "16:10", "17:00")).error?.code).toBe(CHECK_CODE)
        expect((await insertRaw(adminOffice, "16:00", "16:50")).error?.code).toBe(CHECK_CODE)
    })

    it("refuses an end that is not after the start", async () => {
        expect((await insertRaw(adminOffice, "17:00", "17:00")).error?.code).toBe(CHECK_CODE)
        expect((await insertRaw(adminOffice, "17:00", "16:00")).error?.code).toBe(CHECK_CODE)
    })

    it("refuses a start in the past when filing", async () => {
        const { error } = await file("ordinary", adminOffice, "09:00", "10:00", { day: "2020-01-06" })
        expect(error).toBeTruthy()
        expect(error.message).toMatch(/past/i)
    })
})

describe("direct writes are refused", () => {
    it("refuses an insert that bypasses the function", async () => {
        const result = await tryInsert(await clientFor("ordinary"), "meeting_requests", {
            applicant_id: ids.ordinary, venue_id: adminOffice,
            starts_at: at("18:00"), ends_at: at("19:00"),
            facilitator_id: ids.head, purpose: `${MARKER} sneaky`,
        })
        expect(result.ok).toBe(false)
        expect(result.code).toBe("42501")
    })

    it("refuses direct updates and deletes, even from the applicant", async () => {
        const { id } = await file("ordinary", adminOffice, "11:00", "12:00")
        const client = await clientFor("ordinary")
        expect((await tryUpdate(client, "meeting_requests", id, { status: "APPROVED" })).affected).toBe(0)
        expect((await tryDelete(client, "meeting_requests", id)).affected).toBe(0)
        const { data } = await svc().from("meeting_requests").select("status").eq("id", id).single()
        expect(data.status).toBe("PENDING_HEAD")
    })

    it("refuses direct writes to Participants, events and Venues", async () => {
        const { id } = await file("ordinary", adminOffice, "12:00", "13:00")
        const client = await clientFor("ordinary")
        expect((await tryInsert(client, "meeting_request_participants", { request_id: id, employee_id: ids.ordinary })).ok).toBe(false)
        expect((await tryInsert(client, "meeting_request_events", { request_id: id, action: "FORGED" })).ok).toBe(false)
        expect((await tryInsert(client, "calendar_venues", { name: `${MARKER} Roof` })).ok).toBe(false)
        const result = await tryInsert(await clientFor("hr"), "calendar_venues", { name: `${MARKER} Roof` })
        expect(result.ok).toBe(false)
    })
})

describe("file_meeting_request()", () => {
    it("routes an ordinary applicant's request to the chosen head", async () => {
        const { id, error } = await file("ordinary", adminOffice, "14:00", "15:00")
        expect(error).toBeNull()
        const { data } = await svc().from("meeting_requests").select("*").eq("id", id).single()
        expect(data).toMatchObject({ status: "PENDING_HEAD", applicant_id: ids.ordinary, head_id: ids.head, facilitator_id: ids.head })
        expect(data.guests).toEqual(["Mr. Visitor"])
    })

    it("routes a head applicant's request straight to HR", async () => {
        const { id, error } = await file("head", adminOffice, "16:00", "17:00")
        expect(error).toBeNull()
        const { data } = await svc().from("meeting_requests").select("status, head_id").eq("id", id).single()
        expect(data).toEqual({ status: "PENDING_HR", head_id: null })
    })

    it("saves the Participants and an event row", async () => {
        const { id } = await file("ordinary", adminOffice, "17:00", "18:00")
        const { data: people } = await svc().from("meeting_request_participants").select("employee_id").eq("request_id", id)
        expect(people.map((p) => p.employee_id)).toEqual([ids.outsider])
        const { data: events } = await svc().from("meeting_request_events").select("*").eq("request_id", id)
        expect(events).toHaveLength(1)
        expect(events[0]).toMatchObject({ action: "FILED", from_status: null, to_status: "PENDING_HEAD", actor_id: ids.ordinary })
    })

    it("refuses a Facilitator who is not a department head", async () => {
        const { error } = await file("ordinary", adminOffice, "18:00", "19:00", { args: { p_facilitator_id: ids.outsider } })
        expect(error?.message).toMatch(/department head/i)
    })

    it("refuses an ordinary applicant who names no approving head", async () => {
        const { error } = await file("ordinary", adminOffice, "19:00", "20:00", { args: { p_head_id: null } })
        expect(error?.message).toMatch(/head/i)
    })

    it("refuses a blank purpose", async () => {
        const { error } = await file("ordinary", adminOffice, "20:00", "21:00", { args: { p_purpose: "   " } })
        expect(error?.message).toMatch(/purpose/i)
    })

    it("lets every signed-in employee read requests, Participants and events", async () => {
        const { id } = await file("ordinary", adminOffice, "21:00", "22:00")
        const reader = await clientFor("outsider")
        expect((await reader.from("meeting_requests").select("id").eq("id", id)).data).toHaveLength(1)
        expect((await reader.from("meeting_request_participants").select("request_id").eq("request_id", id)).data).toHaveLength(1)
        expect((await reader.from("meeting_request_events").select("id").eq("request_id", id)).data).toHaveLength(1)
    })
})

describe("calendar_entries() MEETING branch", () => {
    it("shows a pending meeting, with its details, to an ordinary colleague", async () => {
        const { id } = await file("ordinary", adminOffice, "10:00", "10:30", { day: "2031-04-16" })
        const { data, error } = await (await clientFor("outsider")).rpc("calendar_entries", {
            p_from: "2031-04-16", p_to: "2031-04-16", p_include_pending: false,
        })
        expect(error).toBeNull()
        const row = data.find((r) => r.kind === "MEETING" && r.id === id)
        expect(row).toMatchObject({ status: "PENDING", venue: "Admin Office", manila_date: "2031-04-16" })
        expect(row.details).toMatchObject({ stage: "PENDING_HEAD", purpose: `${MARKER} filed`, venue: "Admin Office", guests: ["Mr. Visitor"] })
        expect(row.details.facilitator.id).toBe(ids.head)
        expect(row.details.participants.map((p) => p.id)).toEqual([ids.outsider])
    })

    it("drops declined and cancelled meetings", async () => {
        const declined = await insertRaw(adminOffice, "11:00", "11:30", "DECLINED", "2031-04-17")
        const { data } = await (await clientFor("outsider")).rpc("calendar_entries", {
            p_from: "2031-04-17", p_to: "2031-04-17", p_include_pending: true,
        })
        expect(data.some((r) => r.id === declined.id)).toBe(false)
    })
})
