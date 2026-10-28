/**
 * Meeting Request decisions (#748, spec #735, ADR 0013): HR is the only approver.
 *
 *   HR / Super Admin -> approve, decline or return a PENDING_HR request
 *   a head, even the Facilitator, an ordinary employee and an outsider -> refused
 *   the applicant -> never decides their own request (not even as HR)
 *   decline and return need a note; every transition writes one event row
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER } from "./support/rows.js"

const svc = () => serviceClient()
const created = []
let venue
let slot = 0

// One 15-minute slot per request, on a day no other file uses, so nothing ever clashes.
const seed = async (status = "PENDING_HR", { applicant = "ordinary" } = {}) => {
    slot += 1
    const start = new Date(Date.UTC(2032, 5, 1, 1, 0, 0) + slot * 15 * 60_000)
    const end = new Date(start.getTime() + 15 * 60_000)
    const { data, error } = await svc()
        .from("meeting_requests")
        .insert({
            applicant_id: ids[applicant],
            venue_id: venue,
            starts_at: start.toISOString(),
            ends_at: end.toISOString(),
            facilitator_id: ids.head,
            purpose: `${MARKER} decision`,
            status,
            head_id: null,
        })
        .select("id")
        .single()
    if (error) throw new Error(error.message)
    created.push(data.id)
    return data.id
}

const decide = async (who, id, decision, note) =>
    (await clientFor(who)).rpc("decide_meeting_request", { p_request_id: id, p_decision: decision, p_note: note ?? null })
const row = async (id) => (await svc().from("meeting_requests").select("*").eq("id", id).single()).data
const events = async (id) =>
    (await svc().from("meeting_request_events").select("*").eq("request_id", id).order("created_at")).data

beforeAll(async () => {
    await ensureCastLoaded()
    const { data } = await svc().from("calendar_venues").select("id").eq("name", "Admin Office").single()
    venue = data.id
})

afterAll(async () => {
    if (created.length) await svc().from("meeting_requests").delete().in("id", created)
})

describe("the HR step", () => {
    it("lets HR approve, which makes it APPROVED", async () => {
        const id = await seed("PENDING_HR")
        const { data, error } = await decide("hr", id, "APPROVE")
        expect(error).toBeNull()
        expect(data).toMatchObject({ from_status: "PENDING_HR", to_status: "APPROVED" })
        expect(await row(id)).toMatchObject({ status: "APPROVED", hr_decided_by: ids.hr })
        expect((await row(id)).hr_decided_at).toBeTruthy()
    })

    it("lets a Super Admin approve", async () => {
        const id = await seed("PENDING_HR")
        expect((await decide("superAdmin", id, "APPROVE")).error).toBeNull()
        expect((await row(id)).status).toBe("APPROVED")
    })

    it("lets HR decline and return with a note, and refuses them without one", async () => {
        const a = await seed("PENDING_HR")
        const b = await seed("PENDING_HR")
        expect((await decide("hr", a, "DECLINE")).error?.message).toMatch(/note/i)
        expect((await decide("hr", b, "RETURN", " ")).error?.message).toMatch(/note/i)
        expect((await decide("hr", a, "DECLINE", "Double-booked by a client visit")).error).toBeNull()
        expect((await decide("hr", b, "RETURN", "Shorten it to one hour")).error).toBeNull()
        expect(await row(a)).toMatchObject({ status: "DECLINED", hr_note: "Double-booked by a client visit" })
        expect(await row(b)).toMatchObject({ status: "RETURNED", return_note: "Shorten it to one hour", returned_by: ids.hr })
    })

    it("refuses the routed head, an unrouted head, an ordinary employee and an outsider", async () => {
        const id = await seed("PENDING_HR")
        for (const who of ["head", "subHead", "ordinary", "outsider"]) {
            expect((await decide(who, id, "APPROVE")).error).toBeTruthy()
        }
        expect((await row(id)).status).toBe("PENDING_HR")
    })

    it("refuses an HR applicant approving their own request", async () => {
        const id = await seed("PENDING_HR", { applicant: "hr" })
        const { error } = await decide("hr", id, "APPROVE")
        expect(error?.message).toMatch(/own/i)
        expect((await row(id)).status).toBe("PENDING_HR")
    })

    it("refuses a decision on a request that is already settled", async () => {
        for (const status of ["APPROVED", "DECLINED", "CANCELLED", "RETURNED"]) {
            const id = await seed(status)
            expect((await decide("hr", id, "APPROVE")).error?.message).toMatch(/not waiting/i)
        }
    })

    it("refuses an unknown decision", async () => {
        const id = await seed()
        expect((await decide("hr", id, "MAYBE")).error?.message).toMatch(/unsupported/i)
    })
})

describe("the retired head step", () => {
    it("refuses a decision on a legacy PENDING_HEAD request, even from HR", async () => {
        const id = await seed("PENDING_HEAD")
        expect((await decide("hr", id, "APPROVE")).error?.message).toMatch(/not waiting/i)
        expect((await row(id)).status).toBe("PENDING_HEAD")
    })

    it("has no override function any more", async () => {
        const { error } = await (await clientFor("hr")).rpc("override_meeting_request_head", { p_request_id: ids.hr, p_reason: "x" })
        expect(error).toBeTruthy()
    })
})

describe("the event log", () => {
    it("writes one event row per transition, with the actor and note", async () => {
        const id = await seed()
        await decide("hr", id, "RETURN", "Move it to the afternoon")
        const log = await events(id)
        expect(log.map((e) => [e.action, e.from_status, e.to_status, e.actor_id, e.note])).toEqual([
            ["HR_RETURNED", "PENDING_HR", "RETURNED", ids.hr, "Move it to the afternoon"],
        ])
    })

    it("writes nothing when a decision is refused", async () => {
        const id = await seed()
        await decide("outsider", id, "APPROVE")
        await decide("ordinary", id, "DECLINE")
        expect(await events(id)).toHaveLength(0)
    })

    it("cannot be called by an anonymous client", async () => {
        const id = await seed()
        const { createClient } = await import("@supabase/supabase-js")
        const { API_URL, ANON_KEY } = await import("./support/stack.js")
        const anon = createClient(API_URL, ANON_KEY)
        expect((await anon.rpc("decide_meeting_request", { p_request_id: id, p_decision: "APPROVE" })).error).toBeTruthy()
    })
})
