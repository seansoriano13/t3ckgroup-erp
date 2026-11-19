/**
 * The limits on an Activity (#1087, spec #1083, tracker B2 and B3). file_meeting_request and
 * edit_meeting_request both refuse:
 *
 *   a meeting link that does not start with http:// or https://
 *   a purpose longer than 500 characters (after trimming)
 *   a day more than one year ahead (Manila dates)
 *
 * with a plain message, and still accept the values at the edge. An edit keeps a day that is already saved,
 * so an old far-off Activity can still be edited.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER } from "./support/rows.js"
import { ahead } from "./support/dates.js"

const svc = () => serviceClient()
const created = []
const LINK_MESSAGE = /The meeting link must start with http:\/\/ or https:\/\//
const FAR_MESSAGE = /cannot be more than one year ahead/i
const LENGTH_MESSAGE = /purpose can be at most 500 characters/i

// One Manila day per slot number, 09:00 to 10:00, counted from today (this file keeps to days 40 and up).
const dayAt = (daysAhead, hours = 1) => {
    const d = Date.UTC(...ahead(daysAhead), 1, 0, 0)
    return { starts_at: new Date(d).toISOString(), ends_at: new Date(d + hours * 3_600_000).toISOString() }
}
let n = 0
const nextDay = () => dayAt(40 + (n += 1))

const fileArgs = (over = {}) => {
    const day = over.day ?? nextDay()
    return {
        p_venue_id: null,
        p_starts_at: day.starts_at,
        p_ends_at: day.ends_at,
        p_facilitator_id: ids.head,
        p_purpose: `${MARKER} limits`,
        p_activity_type: "MEETING",
        p_meeting_type: "ONLINE",
        p_meeting_link: "https://meet.example.test/ok",
        ...over,
        day: undefined,
    }
}

const file = async (who, over = {}) => (await clientFor(who)).rpc("file_meeting_request", fileArgs(over))

/** An approved Online Meeting that `ordinary` filed, ready to edit. */
const filed = async (over = {}) => {
    const { data, error } = await file("ordinary", over)
    if (error) throw new Error(error.message)
    created.push(data)
    return data
}

const row = async (id) => (await svc().from("meeting_requests").select("*").eq("id", id).single()).data
const people = async (id) =>
    ((await svc().from("meeting_request_participants").select("employee_id").eq("request_id", id)).data ?? []).map((p) => p.employee_id)

/** The saved values sent back as they are, with `over` on top. */
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
})

afterAll(async () => {
    if (created.length) {
        await svc().from("notifications").delete().in("reference_id", created)
        await svc().from("meeting_requests").delete().in("id", created)
    }
})

describe("the meeting link", () => {
    it("refuses a link that is not a web link when filing, for an Online and a Hybrid Meeting", async () => {
        for (const link of ["javascript:alert(1)", "not a url", "meet.example.test/x", "ftp://files.example.test/x", "https://", "mailto:a@example.test", "https://meet.example.test/a b", "https:// meet.example.test", "https://meet.example.test/a\tb"]) {
            const { error } = await file("ordinary", { p_meeting_link: link })
            expect(error?.message, link).toMatch(LINK_MESSAGE)
        }
        const { data: venues } = await svc().from("calendar_venues").select("id").eq("active", true).limit(1)
        const hybrid = await file("ordinary", { p_meeting_type: "HYBRID", p_venue_id: venues[0].id, p_meeting_link: "javascript:alert(1)" })
        expect(hybrid.error?.message).toMatch(LINK_MESSAGE)
    })

    it("accepts http and https links, in any capitals, and keeps the link as typed", async () => {
        for (const link of ["https://meet.google.com/x", "http://intranet.example.test/room", "  HTTPS://Meet.Example.test/X  "]) {
            const { data, error } = await file("ordinary", { p_meeting_link: link })
            expect(error, link).toBeNull()
            created.push(data)
            expect((await row(data)).meeting_link).toBe(link.trim())
        }
    })

    it("still asks for a link when the box is empty", async () => {
        const { error } = await file("ordinary", { p_meeting_link: "   " })
        expect(error?.message).toMatch(/link/i)
        expect(error?.message).not.toMatch(LINK_MESSAGE)
    })

    it("refuses the same values when editing, and leaves the Activity as it was", async () => {
        const id = await filed()
        const before = await row(id)
        for (const link of ["javascript:alert(1)", "not a url"]) {
            const { error } = await edit(id, { p_meeting_link: link })
            expect(error?.message, link).toMatch(LINK_MESSAGE)
        }
        expect(await row(id)).toEqual(before)
    })

    it("lets an edit change to another web link", async () => {
        const id = await filed()
        const { data, error } = await edit(id, { p_meeting_link: "https://meet.example.test/other" })
        expect(error).toBeNull()
        expect(data).toMatchObject({ action: "EDITED" })
        expect((await row(id)).meeting_link).toBe("https://meet.example.test/other")
    })
})

describe("the purpose", () => {
    it("accepts 500 characters, with spaces around it trimmed, and refuses 501", async () => {
        const full = "a".repeat(500)
        for (const purpose of [full, `   ${full}   `]) {
            const { data, error } = await file("ordinary", { p_purpose: purpose })
            expect(error).toBeNull()
            created.push(data)
            expect((await row(data)).purpose).toBe(full)
        }
        const { error } = await file("ordinary", { p_purpose: "a".repeat(501) })
        expect(error?.message).toMatch(LENGTH_MESSAGE)
    })

    it("counts a character outside the basic plane once", async () => {
        const { data, error } = await file("ordinary", { p_purpose: "😀".repeat(500) })
        expect(error).toBeNull()
        created.push(data)
    })

    it("holds an edit to the same limit", async () => {
        const id = await filed()
        const tooLong = await edit(id, { p_purpose: "a".repeat(501) })
        expect(tooLong.error?.message).toMatch(LENGTH_MESSAGE)
        const full = await edit(id, { p_purpose: "b".repeat(500) })
        expect(full.error).toBeNull()
        expect((await row(id)).purpose).toBe("b".repeat(500))
    })
})

describe("the date", () => {
    it("accepts a day a year ahead and refuses one a little later, and 13 months ahead", async () => {
        const ok = await file("ordinary", { day: dayAt(365) })
        expect(ok.error).toBeNull()
        created.push(ok.data)
        for (const days of [368, 395, 400, 365 * 8]) {
            const { error } = await file("ordinary", { day: dayAt(days) })
            expect(error?.message, `${days} days`).toMatch(FAR_MESSAGE)
        }
    })

    it("refuses a year 9999 date outright", async () => {
        const { error } = await file("ordinary", { day: { starts_at: "9999-12-30T01:00:00Z", ends_at: "9999-12-30T02:00:00Z" } })
        expect(error).not.toBeNull()
    })

    it("looks at every day of a range, not only the first", async () => {
        const days = [dayAt(350), dayAt(351), dayAt(370)]
        const { error } = await file("head", {
            p_activity_type: "ADMIN_TASK",
            p_meeting_type: null,
            p_meeting_link: null,
            p_days: days,
            day: days[0],
        })
        expect(error?.message).toMatch(FAR_MESSAGE)
        const near = [dayAt(350), dayAt(351), dayAt(352)]
        const ok = await file("head", { p_activity_type: "ADMIN_TASK", p_meeting_type: null, p_meeting_link: null, p_days: near, day: near[0] })
        expect(ok.error).toBeNull()
        created.push(ok.data)
    })

    it("refuses an edit that moves a day more than a year ahead", async () => {
        const id = await filed()
        const before = await row(id)
        const far = dayAt(400)
        const { error } = await edit(id, { p_starts_at: far.starts_at, p_ends_at: far.ends_at })
        expect(error?.message).toMatch(FAR_MESSAGE)
        expect(await row(id)).toEqual(before)
        const near = dayAt(360)
        const ok = await edit(id, { p_starts_at: near.starts_at, p_ends_at: near.ends_at })
        expect(ok.error).toBeNull()
    })

    it("lets an Activity already saved far ahead be edited, as the saved day is kept", async () => {
        const id = await filed()
        const far = dayAt(900)
        // Seeded straight into the table, as an Activity filed before this rule would be.
        await svc().from("meeting_request_days").delete().eq("request_id", id)
        await svc().from("meeting_requests").update({ starts_at: far.starts_at, ends_at: far.ends_at }).eq("id", id)
        await svc().from("meeting_request_days").insert({ request_id: id, starts_at: far.starts_at, ends_at: far.ends_at })
        const { data, error } = await edit(id, { p_purpose: `${MARKER} reworded`, p_days: [far] })
        expect(error).toBeNull()
        expect(data).toMatchObject({ action: "EDITED" })
    })
})
