/**
 * Meeting type, link and Guest emails (#749, spec #735, ADR 0038).
 *
 *   Onsite needs a Venue and no link; Online needs a link and no Venue; Hybrid needs both
 *   the database refuses a request that breaks these rules
 *   an Online meeting never clashes with a room booking, and two Online meetings at once are fine
 *   Guests save with an email, and a bad email is refused
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER } from "./support/rows.js"

const svc = () => serviceClient()
const created = []
let venue

const at = (n) => new Date(Date.UTC(2034, 5, 1, 1, 0, 0) + n * 15 * 60_000).toISOString()

const insert = async (over = {}) => {
    const { data, error } = await svc()
        .from("meeting_requests")
        .insert({
            applicant_id: ids.ordinary,
            starts_at: at(0),
            ends_at: at(4),
            facilitator_id: ids.head,
            purpose: `${MARKER} type`,
            status: "PENDING_HR",
            ...over,
        })
        .select("id")
        .single()
    if (data) created.push(data.id)
    return { data, error }
}

const file = async (over = {}) =>
    (await clientFor("ordinary")).rpc("file_meeting_request", {
        p_venue_id: venue,
        p_starts_at: at(100),
        p_ends_at: at(104),
        p_facilitator_id: ids.head,
        p_purpose: `${MARKER} type`,
        p_guests: [],
        p_participant_ids: [],
        ...over,
    })

beforeAll(async () => {
    await ensureCastLoaded()
    const { data } = await svc().from("calendar_venues").select("id").eq("name", "Admin Office").single()
    venue = data.id
})

afterAll(async () => {
    if (created.length) await svc().from("meeting_requests").delete().in("id", created)
})

describe("type rules in the database", () => {
    it("refuses an Onsite meeting without a Venue, or with a link", async () => {
        expect((await insert({ meeting_type: "ONSITE", venue_id: null })).error).not.toBeNull()
        expect((await insert({ meeting_type: "ONSITE", venue_id: venue, meeting_link: "https://x.test/a", starts_at: at(8), ends_at: at(9) })).error).not.toBeNull()
    })

    it("refuses an Online meeting with a Venue or without a link", async () => {
        expect((await insert({ meeting_type: "ONLINE", venue_id: venue, meeting_link: "https://x.test/a", starts_at: at(12), ends_at: at(13) })).error).not.toBeNull()
        expect((await insert({ meeting_type: "ONLINE", venue_id: null, meeting_link: null })).error).not.toBeNull()
    })

    it("refuses a Hybrid meeting missing either part", async () => {
        expect((await insert({ meeting_type: "HYBRID", venue_id: venue, meeting_link: null, starts_at: at(16), ends_at: at(17) })).error).not.toBeNull()
        expect((await insert({ meeting_type: "HYBRID", venue_id: null, meeting_link: "https://x.test/a" })).error).not.toBeNull()
    })

    it("explains the rule in plain words when filing", async () => {
        const { error } = await file({ p_meeting_type: "ONLINE", p_venue_id: null, p_meeting_link: null })
        expect(error.message).toMatch(/meeting link/i)
        const hybrid = await file({ p_meeting_type: "HYBRID", p_meeting_link: null })
        expect(hybrid.error.message).toMatch(/meeting link/i)
    })
})

describe("room booking", () => {
    it("lets Online meetings overlap each other and a room booking", async () => {
        const room = await insert({ meeting_type: "ONSITE", venue_id: venue, starts_at: at(200), ends_at: at(204) })
        expect(room.error).toBeNull()
        const a = await insert({ meeting_type: "ONLINE", venue_id: null, meeting_link: "https://x.test/a", starts_at: at(200), ends_at: at(204) })
        const b = await insert({ meeting_type: "ONLINE", venue_id: null, meeting_link: "https://x.test/b", starts_at: at(201), ends_at: at(203) })
        expect(a.error).toBeNull()
        expect(b.error).toBeNull()
    })

    it("still refuses a second booking of the same Venue, Hybrid included", async () => {
        const first = await insert({ meeting_type: "ONSITE", venue_id: venue, starts_at: at(300), ends_at: at(304) })
        expect(first.error).toBeNull()
        const clash = await insert({ meeting_type: "HYBRID", venue_id: venue, meeting_link: "https://x.test/h", starts_at: at(301), ends_at: at(303) })
        expect(clash.error?.code).toBe("23P01")
    })
})

describe("Guests", () => {
    it("saves each Guest's email beside the name", async () => {
        const { data: id, error } = await file({
            p_starts_at: at(400),
            p_ends_at: at(404),
            p_guests: ["Ana", "Ben"],
            p_guest_emails: ["ana@example.com", ""],
        })
        expect(error).toBeNull()
        created.push(id)
        const { data } = await svc().from("meeting_requests").select("guests, guest_emails").eq("id", id).single()
        expect(data.guests).toEqual(["Ana", "Ben"])
        expect(data.guest_emails).toEqual(["ana@example.com", ""])
    })

    it("refuses a malformed email", async () => {
        const { error } = await file({ p_starts_at: at(410), p_ends_at: at(414), p_guests: ["Ana"], p_guest_emails: ["not-an-email"] })
        expect(error.message).toMatch(/Guest email/i)
    })
})
