/**
 * Meeting Request decisions (#624, spec #609, ADR 0013): the head step, the HR step and the HR override.
 *
 *   routed head  -> decides PENDING_HEAD; refused at PENDING_HR
 *   unrouted head, ordinary, outsider -> refused at both steps
 *   HR / Super Admin -> decide either step; HR may skip a pending head with a reason
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
const seed = async (status = "PENDING_HEAD", { applicant = "ordinary", head = ids.head } = {}) => {
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
            head_id: status === "PENDING_HEAD" ? head : null,
        })
        .select("id")
        .single()
    if (error) throw new Error(error.message)
    created.push(data.id)
    return data.id
}

const decide = async (who, id, decision, note) =>
    (await clientFor(who)).rpc("decide_meeting_request", { p_request_id: id, p_decision: decision, p_note: note ?? null })
const override = async (who, id, reason) =>
    (await clientFor(who)).rpc("override_meeting_request_head", { p_request_id: id, p_reason: reason ?? null })
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

describe("the head step", () => {
    it("lets the routed head approve, which moves it to HR", async () => {
        const id = await seed()
        const { data, error } = await decide("head", id, "APPROVE")
        expect(error).toBeNull()
        expect(data).toMatchObject({ from_status: "PENDING_HEAD", to_status: "PENDING_HR", applicant_id: ids.ordinary })
        const r = await row(id)
        expect(r.status).toBe("PENDING_HR")
        expect(r.head_decided_at).toBeTruthy()
        expect(r.hr_override).toBe(false)
    })

    it("lets the routed head decline with a note", async () => {
        const id = await seed()
        expect((await decide("head", id, "DECLINE", "Room is needed for a client")).error).toBeNull()
        expect(await row(id)).toMatchObject({ status: "DECLINED", head_note: "Room is needed for a client" })
    })

    it("lets the routed head return with a note", async () => {
        const id = await seed()
        expect((await decide("head", id, "RETURN", "Please add the agenda")).error).toBeNull()
        expect(await row(id)).toMatchObject({ status: "RETURNED", return_note: "Please add the agenda", returned_by: ids.head })
    })

    it("refuses a decline or a return without a note", async () => {
        const id = await seed()
        for (const decision of ["DECLINE", "RETURN"]) {
            for (const note of [null, "", "   "]) {
                expect((await decide("head", id, decision, note)).error?.message).toMatch(/note/i)
            }
        }
        expect((await row(id)).status).toBe("PENDING_HEAD")
    })

    it("refuses a head the request was not routed to", async () => {
        const id = await seed()
        const { error } = await decide("subHead", id, "APPROVE")
        expect(error?.message).toMatch(/routed/i)
        expect((await row(id)).status).toBe("PENDING_HEAD")
    })

    it("refuses an ordinary employee and an outsider", async () => {
        const id = await seed()
        expect((await decide("outsider", id, "APPROVE")).error).toBeTruthy()
        expect((await decide("ordinary", id, "APPROVE")).error).toBeTruthy()
        expect((await row(id)).status).toBe("PENDING_HEAD")
    })

    it("refuses the applicant on their own request, even a head routed to themselves", async () => {
        const id = await seed("PENDING_HEAD", { applicant: "subHead", head: ids.subHead })
        const { error } = await decide("subHead", id, "APPROVE")
        expect(error?.message).toMatch(/own/i)
        expect((await row(id)).status).toBe("PENDING_HEAD")
    })

    it("lets HR and a Super Admin decide the head step", async () => {
        const a = await seed()
        const b = await seed()
        expect((await decide("hr", a, "APPROVE")).error).toBeNull()
        expect((await decide("superAdmin", b, "APPROVE")).error).toBeNull()
        expect((await row(a)).status).toBe("PENDING_HR")
        expect((await row(b)).status).toBe("PENDING_HR")
    })
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
        expect((await decide("head", id, "MAYBE")).error?.message).toMatch(/unsupported/i)
    })
})

describe("the HR override", () => {
    it("lets HR skip a pending head step with a reason, and records who and why", async () => {
        const id = await seed()
        const { data, error } = await override("hr", id, "Head is on leave this week")
        expect(error).toBeNull()
        expect(data).toMatchObject({ from_status: "PENDING_HEAD", to_status: "PENDING_HR" })
        expect(await row(id)).toMatchObject({ status: "PENDING_HR", hr_override: true, hr_decided_by: ids.hr, hr_note: "Head is on leave this week" })
        const log = await events(id)
        expect(log.at(-1)).toMatchObject({
            action: "HR_OVERRIDE", actor_id: ids.hr, from_status: "PENDING_HEAD", to_status: "PENDING_HR", note: "Head is on leave this week",
        })
    })

    it("lets a Super Admin override", async () => {
        const id = await seed()
        expect((await override("superAdmin", id, "Urgent")).error).toBeNull()
        expect((await row(id)).hr_override).toBe(true)
    })

    it("refuses an override without a reason", async () => {
        const id = await seed()
        expect((await override("hr", id, null)).error?.message).toMatch(/reason/i)
        expect((await override("hr", id, "  ")).error?.message).toMatch(/reason/i)
        expect((await row(id)).status).toBe("PENDING_HEAD")
    })

    it("refuses everyone who is not HR, including the routed head", async () => {
        const id = await seed()
        for (const who of ["head", "subHead", "ordinary", "outsider"]) {
            expect((await override(who, id, "Because")).error?.message).toMatch(/only hr/i)
        }
        expect((await row(id)).hr_override).toBe(false)
    })

    it("refuses an override outside the head step and on HR's own request", async () => {
        const waitingHr = await seed("PENDING_HR")
        expect((await override("hr", waitingHr, "Because")).error?.message).toMatch(/waiting for its head/i)
        const own = await seed("PENDING_HEAD", { applicant: "hr" })
        expect((await override("hr", own, "Because")).error?.message).toMatch(/own/i)
    })
})

describe("the event log", () => {
    it("writes one event row per transition, with the actor and note", async () => {
        const id = await seed()
        await decide("head", id, "APPROVE", "Fine by me")
        await decide("hr", id, "RETURN", "Move it to the afternoon")
        const log = await events(id)
        expect(log.map((e) => [e.action, e.from_status, e.to_status, e.actor_id, e.note])).toEqual([
            ["HEAD_APPROVED", "PENDING_HEAD", "PENDING_HR", ids.head, "Fine by me"],
            ["HR_RETURNED", "PENDING_HR", "RETURNED", ids.hr, "Move it to the afternoon"],
        ])
    })

    it("writes nothing when a decision is refused", async () => {
        const id = await seed()
        await decide("outsider", id, "APPROVE")
        await decide("head", id, "DECLINE")
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
