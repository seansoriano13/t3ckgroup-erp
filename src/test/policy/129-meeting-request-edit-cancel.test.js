/**
 * Edit, send again and cancel a Meeting Request (#628, spec #609, ADR 0013).
 *
 *   edit    applicant only, before the start; PENDING_HR / APPROVED go back to PENDING_HEAD;
 *           a time change clears reminder_sent_at; a clash is refused; the event row holds the changed fields
 *   resend  applicant, RETURNED -> PENDING_HEAD (PENDING_HR for a head applicant)
 *   cancel  applicant: any non-final request before the start; HR / Super Admin: any upcoming one, reason required
 *   a cancelled request frees its slot; anything at or past its start is read-only
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER } from "./support/rows.js"

const svc = () => serviceClient()
const created = []
let venue
let otherVenue
let slot = 0

const iso = (n) => new Date(Date.UTC(2033, 5, 1, 1, 0, 0) + n * 15 * 60_000).toISOString()

// Each request gets its own 15-minute slot far in the future, so nothing clashes unless a test makes it.
const seed = async (status = "PENDING_HEAD", { applicant = "ordinary", head = ids.head, startsAt, endsAt } = {}) => {
    slot += 1
    const { data, error } = await svc()
        .from("meeting_requests")
        .insert({
            applicant_id: ids[applicant],
            venue_id: venue,
            starts_at: startsAt ?? iso(slot * 4),
            ends_at: endsAt ?? iso(slot * 4 + 1),
            facilitator_id: ids.head,
            purpose: `${MARKER} edit`,
            status,
            head_id: applicant === "head" || applicant === "subHead" || status === "PENDING_HR" ? null : head,
        })
        .select("id")
        .single()
    if (error) throw new Error(error.message)
    created.push(data.id)
    return data.id
}

const row = async (id) => (await svc().from("meeting_requests").select("*").eq("id", id).single()).data
const events = async (id) =>
    (await svc().from("meeting_request_events").select("*").eq("request_id", id).order("created_at")).data
const people = async (id) =>
    ((await svc().from("meeting_request_participants").select("employee_id").eq("request_id", id)).data ?? []).map((p) => p.employee_id)

const edit = async (who, id, over = {}) => {
    const r = await row(id)
    return (await clientFor(who)).rpc("edit_meeting_request", {
        p_request_id: id,
        p_venue_id: r.venue_id,
        p_starts_at: r.starts_at,
        p_ends_at: r.ends_at,
        p_facilitator_id: r.facilitator_id,
        p_purpose: r.purpose,
        p_guests: r.guests,
        p_participant_ids: [],
        p_head_id: r.head_id,
        ...over,
    })
}
const resend = async (who, id) => (await clientFor(who)).rpc("resend_meeting_request", { p_request_id: id })
const cancel = async (who, id, reason) =>
    (await clientFor(who)).rpc("cancel_meeting_request", { p_request_id: id, p_reason: reason ?? null })

// Moves a seeded request's start into the past (the insert-only trigger would refuse it at insert).
const startNow = async (id) => {
    const past = new Date(Date.now() - 3600_000)
    past.setUTCMinutes(Math.floor(past.getUTCMinutes() / 15) * 15, 0, 0)
    const end = new Date(past.getTime() + 900_000)
    await svc().from("meeting_requests").update({ starts_at: past.toISOString(), ends_at: end.toISOString() }).eq("id", id)
}

beforeAll(async () => {
    await ensureCastLoaded()
    const { data } = await svc().from("calendar_venues").select("id, name").in("name", ["Admin Office", "Conference Room"])
    venue = data.find((v) => v.name === "Admin Office").id
    otherVenue = data.find((v) => v.name === "Conference Room").id
})

afterAll(async () => {
    if (created.length) await svc().from("meeting_requests").delete().in("id", created)
})

describe("edit", () => {
    it("keeps a pending-head request pending-head and records what changed", async () => {
        const id = await seed("PENDING_HEAD")
        const { data, error } = await edit("ordinary", id, { p_purpose: "A better purpose", p_participant_ids: [ids.outsider] })
        expect(error).toBeNull()
        expect(data).toMatchObject({ from_status: "PENDING_HEAD", to_status: "PENDING_HEAD", action: "EDITED" })
        expect(await row(id)).toMatchObject({ status: "PENDING_HEAD", purpose: "A better purpose" })
        expect(await people(id)).toEqual([ids.outsider])
        const last = (await events(id)).at(-1)
        expect(last).toMatchObject({ action: "EDITED", actor_id: ids.ordinary, from_status: "PENDING_HEAD", to_status: "PENDING_HEAD" })
        expect(last.changed_fields.purpose).toEqual({ from: `${MARKER} edit`, to: "A better purpose" })
        expect(last.changed_fields.participant_ids).toBeTruthy()
    })

    it("sends a pending-HR or approved request back to pending-head, so approval starts over", async () => {
        for (const status of ["PENDING_HR", "APPROVED"]) {
            const id = await seed(status)
            await svc().from("meeting_requests").update({ head_id: ids.head, head_decided_at: new Date().toISOString(), hr_note: "ok" }).eq("id", id)
            const { error } = await edit("ordinary", id, { p_purpose: "Changed", p_head_id: ids.head })
            expect(error).toBeNull()
            expect(await row(id)).toMatchObject({ status: "PENDING_HEAD", head_decided_at: null, hr_note: null, hr_override: false })
        }
    })

    it("sends an edited head applicant's request to pending-HR, never to a head step", async () => {
        const id = await seed("APPROVED", { applicant: "head" })
        const { error } = await edit("head", id, { p_purpose: "Head edit", p_head_id: null })
        expect(error).toBeNull()
        expect((await row(id)).status).toBe("PENDING_HR")
    })

    it("keeps a returned request returned until it is sent again", async () => {
        const id = await seed("RETURNED")
        expect((await edit("ordinary", id, { p_purpose: "Fixed" })).error).toBeNull()
        expect(await row(id)).toMatchObject({ status: "RETURNED", purpose: "Fixed" })
    })

    it("clears the reminder-sent time when the time changes, and keeps it when it does not", async () => {
        const a = await seed("APPROVED")
        const b = await seed("APPROVED")
        const stamp = new Date().toISOString()
        await svc().from("meeting_requests").update({ reminder_sent_at: stamp }).in("id", [a, b])
        const rb = await row(b)
        expect((await edit("ordinary", b, { p_purpose: "Same time" })).error).toBeNull()
        expect((await row(b)).reminder_sent_at).toBeTruthy()
        const ra = await row(a)
        const later = new Date(new Date(ra.starts_at).getTime() + 3 * 3600_000).toISOString()
        const laterEnd = new Date(new Date(ra.ends_at).getTime() + 3 * 3600_000).toISOString()
        expect((await edit("ordinary", a, { p_starts_at: later, p_ends_at: laterEnd })).error).toBeNull()
        expect((await row(a)).reminder_sent_at).toBeNull()
        expect(rb.id).toBe(b)
    })

    it("refuses anyone but the applicant, including HR and the routed head", async () => {
        const id = await seed("PENDING_HEAD")
        for (const who of ["hr", "superAdmin", "head", "outsider"]) {
            const { error } = await edit(who, id, { p_purpose: "Not mine" })
            expect(error?.message).toMatch(/filed/i)
        }
        expect((await row(id)).purpose).toBe(`${MARKER} edit`)
    })

    it("refuses an edit at or after the start time", async () => {
        const id = await seed("APPROVED")
        await startNow(id)
        const { error } = await edit("ordinary", id, { p_purpose: "Too late", p_starts_at: iso(900), p_ends_at: iso(901) })
        expect(error?.message).toMatch(/already started/i)
        expect((await row(id)).purpose).toBe(`${MARKER} edit`)
    })

    it("refuses moving the meeting into the past", async () => {
        const id = await seed("PENDING_HEAD")
        const { error } = await edit("ordinary", id, { p_starts_at: "2020-01-01T01:00:00.000Z", p_ends_at: "2020-01-01T02:00:00.000Z" })
        expect(error?.message).toMatch(/past/i)
    })

    it("refuses a declined or cancelled request: both are final", async () => {
        for (const status of ["DECLINED", "CANCELLED"]) {
            const id = await seed(status)
            expect((await edit("ordinary", id, { p_purpose: "Nope" })).error?.message).toMatch(/cannot be edited/i)
        }
    })

    it("refuses a clash with another request at the same Venue, but not at the other Venue", async () => {
        const holder = await seed("APPROVED")
        const mine = await seed("PENDING_HEAD")
        const h = await row(holder)
        const clash = await edit("ordinary", mine, { p_starts_at: h.starts_at, p_ends_at: h.ends_at })
        expect(clash.error?.code).toBe("23P01")
        const elsewhere = await edit("ordinary", mine, { p_starts_at: h.starts_at, p_ends_at: h.ends_at, p_venue_id: otherVenue })
        expect(elsewhere.error).toBeNull()
    })

    it("keeps the time rules: quarter hours, same day, end after start", async () => {
        const id = await seed("PENDING_HEAD")
        const r = await row(id)
        const odd = new Date(new Date(r.starts_at).getTime() + 5 * 60_000).toISOString()
        expect((await edit("ordinary", id, { p_starts_at: odd })).error).toBeTruthy()
        expect((await edit("ordinary", id, { p_ends_at: r.starts_at })).error).toBeTruthy()
        const nextDay = new Date(new Date(r.starts_at).getTime() + 24 * 3600_000).toISOString()
        expect((await edit("ordinary", id, { p_ends_at: nextDay })).error).toBeTruthy()
    })
})

describe("send again", () => {
    it("moves a returned request to pending-head and writes an event", async () => {
        const id = await seed("RETURNED")
        await svc().from("meeting_requests").update({ return_note: "Add an agenda" }).eq("id", id)
        const { data, error } = await resend("ordinary", id)
        expect(error).toBeNull()
        expect(data).toMatchObject({ from_status: "RETURNED", to_status: "PENDING_HEAD", action: "RESENT" })
        expect((await row(id)).status).toBe("PENDING_HEAD")
        expect((await events(id)).at(-1)).toMatchObject({ action: "RESENT", actor_id: ids.ordinary, to_status: "PENDING_HEAD" })
    })

    it("sends a head applicant's returned request straight to pending-HR", async () => {
        const id = await seed("RETURNED", { applicant: "head" })
        expect((await resend("head", id)).error).toBeNull()
        expect((await row(id)).status).toBe("PENDING_HR")
    })

    it("refuses anyone else, a request that is not returned, and one already started", async () => {
        const id = await seed("RETURNED")
        expect((await resend("hr", id)).error?.message).toMatch(/filed/i)
        const pending = await seed("PENDING_HEAD")
        expect((await resend("ordinary", pending)).error?.message).toMatch(/returned/i)
        await startNow(id)
        expect((await resend("ordinary", id)).error?.message).toMatch(/already started/i)
    })
})

describe("cancel", () => {
    it("lets the applicant cancel any non-final request before it starts, without a reason", async () => {
        for (const status of ["PENDING_HEAD", "PENDING_HR", "RETURNED", "APPROVED"]) {
            const id = await seed(status)
            const { data, error } = await cancel("ordinary", id)
            expect(error).toBeNull()
            expect(data).toMatchObject({ to_status: "CANCELLED", action: "CANCELLED" })
            expect(await row(id)).toMatchObject({ status: "CANCELLED", cancelled_by: ids.ordinary })
            expect((await events(id)).at(-1)).toMatchObject({ action: "CANCELLED", from_status: status, to_status: "CANCELLED" })
        }
    })

    it("lets HR and a Super Admin cancel any upcoming request with a reason, and refuses them without one", async () => {
        const a = await seed("APPROVED")
        const b = await seed("PENDING_HEAD")
        for (const reason of [null, "", "   "]) {
            expect((await cancel("hr", a, reason)).error?.message).toMatch(/reason/i)
        }
        expect((await row(a)).status).toBe("APPROVED")
        const done = await cancel("hr", a, "Room needed for an audit")
        expect(done.error).toBeNull()
        expect(done.data.action).toBe("HR_CANCELLED")
        expect(await row(a)).toMatchObject({ status: "CANCELLED", cancel_reason: "Room needed for an audit", cancelled_by: ids.hr })
        expect((await cancel("superAdmin", b, "Policy change")).error).toBeNull()
    })

    it("refuses a head who is not the applicant, an outsider and a stranger", async () => {
        const id = await seed("PENDING_HEAD")
        for (const who of ["head", "subHead", "outsider"]) {
            expect((await cancel(who, id, "No")).error?.message).toMatch(/applicant, HR/i)
        }
        expect((await row(id)).status).toBe("PENDING_HEAD")
    })

    it("refuses everyone at or after the start time, HR included", async () => {
        const id = await seed("APPROVED")
        await startNow(id)
        expect((await cancel("ordinary", id)).error?.message).toMatch(/already started/i)
        expect((await cancel("hr", id, "Late")).error?.message).toMatch(/already started/i)
        expect((await row(id)).status).toBe("APPROVED")
    })

    it("refuses a declined or cancelled request: both are final", async () => {
        for (const status of ["DECLINED", "CANCELLED"]) {
            const id = await seed(status)
            expect((await cancel("ordinary", id)).error?.message).toMatch(/final/i)
        }
    })

    it("frees the slot at once for a new request", async () => {
        const id = await seed("APPROVED")
        const r = await row(id)
        expect((await cancel("ordinary", id)).error).toBeNull()
        const { error } = await clientFor("outsider").then((c) =>
            c.rpc("file_meeting_request", {
                p_venue_id: r.venue_id,
                p_starts_at: r.starts_at,
                p_ends_at: r.ends_at,
                p_facilitator_id: ids.head,
                p_purpose: `${MARKER} reuse`,
                p_guests: [],
                p_participant_ids: [],
                p_head_id: ids.head,
            }),
        )
        expect(error).toBeNull()
        const { data } = await svc().from("meeting_requests").select("id").eq("purpose", `${MARKER} reuse`)
        created.push(...data.map((d) => d.id))
    })
})
