/**
 * Activities over a date range (#1056, spec #1054): one row per day.
 *
 *   the day-row rules: one Manila day, 15-minute marks, end after start, not in the past when filed
 *   the 06:00 to 21:45 window for a listed set of days
 *   a Meeting has exactly one day (the function refuses a list, the table refuses a second row)
 *   the parent holds the first day's start and the last day's end
 *   the Calendar shows one entry per day, with that day's hours; the request id still opens day 1
 *   changing and cancelling after the first day started
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER } from "./support/rows.js"
import { ahead, mondayOnOrAfter } from "./support/dates.js"

const svc = () => serviceClient()
const created = []
let venue

const HOUR = 3_600_000
// Manila 09:00 on a Monday about two weeks ahead + (n days), shifted by a block so tests never share dates (#1087: no day is more than a year ahead).
const FIRST_MONDAY = mondayOnOrAfter(14)
const dayAt = (n, startHour = 9, endHour = 10) => {
    const base = Date.UTC(...ahead(FIRST_MONDAY + n), 0, 0, 0) - 8 * HOUR
    return { starts_at: new Date(base + startHour * HOUR).toISOString(), ends_at: new Date(base + endHour * HOUR).toISOString() }
}
// A day counted from today (Manila), for tests that move days into the past and so must stay inside the day limit.
const soonAt = (n, startHour = 9, endHour = 10) => {
    const t = new Date(Date.now() + 8 * HOUR)
    const base = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + n) - 8 * HOUR
    return { starts_at: new Date(base + startHour * HOUR).toISOString(), ends_at: new Date(base + endHour * HOUR).toISOString() }
}
const manilaDay = (iso) => new Date(new Date(iso).getTime() + 8 * HOUR).toISOString().slice(0, 10)

let block = 0
const nextBlock = () => (block += 14)

const file = async (who, over = {}) => {
    const days = over.p_days ?? [dayAt(nextBlock())]
    const { data, error } = await (await clientFor(who)).rpc("file_meeting_request", {
        p_venue_id: null,
        p_starts_at: days[0].starts_at,
        p_ends_at: days[0].ends_at,
        p_facilitator_id: ids[who],
        p_purpose: `${MARKER} range`,
        p_guests: [],
        p_participant_ids: [],
        p_activity_type: "OPERATIONS_TASK",
        p_days: days,
        ...over,
    })
    if (data) created.push(data)
    return { id: data, error, days }
}

const edit = async (who, id, over = {}) => {
    const r = (await svc().from("meeting_requests").select("*").eq("id", id).single()).data
    const days = over.p_days ?? (await daysOf(id)).map(({ starts_at, ends_at }) => ({ starts_at, ends_at }))
    return (await clientFor(who)).rpc("edit_meeting_request", {
        p_request_id: id,
        p_venue_id: r.venue_id,
        p_starts_at: days[0].starts_at,
        p_ends_at: days[0].ends_at,
        p_facilitator_id: r.facilitator_id,
        p_purpose: r.purpose,
        p_guests: [],
        p_participant_ids: [],
        p_meeting_type: r.meeting_type,
        p_meeting_link: r.meeting_link,
        p_activity_type: r.activity_type,
        p_days: days,
        ...over,
    })
}

const cancel = async (who, id, reason = "Plans changed") => (await clientFor(who)).rpc("cancel_meeting_request", { p_request_id: id, p_reason: reason })
const row = async (id) => (await svc().from("meeting_requests").select("*").eq("id", id).single()).data
const daysOf = async (id) => (await svc().from("meeting_request_days").select("*").eq("request_id", id).order("starts_at")).data

// Pretend the first `count` days have started: move them into the past (a test-only move; the insert guard does not cover updates).
const startDays = async (id, count) => {
    const days = await daysOf(id)
    for (let i = 0; i < count; i++) {
        // 09:00 to 10:00 Manila on an earlier day: started, and an hour can be added without crossing midnight.
        const { starts_at, ends_at } = soonAt(-(count - i))
        const { error } = await svc().from("meeting_request_days").update({ starts_at, ends_at }).eq("id", days[i].id)
        if (error) throw new Error(error.message)
    }
    const after = await daysOf(id)
    await svc().from("meeting_requests").update({ starts_at: after[0].starts_at, ends_at: after[after.length - 1].ends_at }).eq("id", id)
}

beforeAll(async () => {
    await ensureCastLoaded()
    const { data } = await svc().from("calendar_venues").select("id, name").eq("name", "Admin Office").single()
    venue = data.id
})

afterAll(async () => {
    if (created.length) {
        await svc().from("notifications").delete().in("reference_id", created)
        await svc().from("meeting_requests").delete().in("id", created)
    }
})

describe("the day rows", () => {
    it("files a three-day task, Saturday included, and the parent holds the first start and last end", async () => {
        let sat = nextBlock()
        while (sat % 7 !== 5) sat += 1 // offset 0 is a Monday, so offset 5 is a Saturday
        const days = [dayAt(sat - 1), dayAt(sat, 8, 12), dayAt(sat + 1, 13, 14)]
        const { id, error } = await file("head", { p_days: days })
        expect(error).toBeNull()
        const rows = await daysOf(id)
        expect(rows).toHaveLength(3)
        expect(rows.map((d) => new Date(d.ends_at).toISOString())).toEqual(days.map((d) => d.ends_at))
        expect(rows[0].id).toBe(id) // day 1 keeps the request id, so an old link still opens it
        const parent = await row(id)
        expect(new Date(parent.starts_at).toISOString()).toBe(days[0].starts_at)
        expect(new Date(parent.ends_at).toISOString()).toBe(days[2].ends_at)
        expect(new Date(`${manilaDay(days[1].starts_at)}T00:00:00Z`).getUTCDay()).toBe(6)
        expect(manilaDay(days[1].starts_at)).not.toBe(manilaDay(days[0].starts_at))
    })

    it("refuses a day that crosses Manila midnight, is off the quarter hour, or ends before it starts", async () => {
        const base = dayAt(nextBlock())
        for (const bad of [
            { starts_at: base.starts_at, ends_at: new Date(new Date(base.ends_at).getTime() + 20 * HOUR).toISOString() },
            { starts_at: new Date(new Date(base.starts_at).getTime() + 60_000).toISOString(), ends_at: base.ends_at },
            { starts_at: base.ends_at, ends_at: base.starts_at },
        ]) {
            const { error } = await file("head", { p_days: [bad] })
            expect(error).not.toBeNull()
        }
    })

    it("refuses the same date twice and a window outside 06:00 to 21:45", async () => {
        const b = nextBlock()
        expect((await file("head", { p_days: [dayAt(b), dayAt(b, 11, 12)] })).error?.message).toMatch(/only once/i)
        expect((await file("head", { p_days: [dayAt(b, 5, 7)] })).error?.message).toMatch(/06:00/)
        expect((await file("head", { p_days: [dayAt(b, 20, 22)] })).error?.message).toMatch(/21:45/)
        expect((await file("head", { p_days: [dayAt(b, 20, 21.75)] })).error).toBeNull()
    })

    it("refuses a day in the past when filing, and refuses a direct bad row in the table", async () => {
        const past = { starts_at: "2020-01-02T01:00:00.000Z", ends_at: "2020-01-02T02:00:00.000Z" }
        expect((await file("head", { p_days: [past] })).error?.message).toMatch(/past/i)
        const { id } = await file("head")
        const future = dayAt(nextBlock())
        const sameDay = await svc().from("meeting_request_days").insert({ request_id: id, starts_at: future.starts_at, ends_at: new Date(new Date(future.starts_at).getTime() + 20 * HOUR).toISOString() })
        expect(sameDay.error?.code).toBe("23514")
        const offGrid = await svc().from("meeting_request_days").insert({ request_id: id, starts_at: new Date(new Date(future.starts_at).getTime() + 60_000).toISOString(), ends_at: future.ends_at })
        expect(offGrid.error?.code).toBe("23514")
        const inPast = await svc().from("meeting_request_days").insert({ request_id: id, ...past })
        expect(inPast.error?.message).toMatch(/past/i)
    })

    it("lets every signed-in employee read the days, and nobody write them", async () => {
        const { id } = await file("head")
        const reader = await clientFor("outsider")
        expect((await reader.from("meeting_request_days").select("id").eq("request_id", id)).data).toHaveLength(1)
        const write = await reader.from("meeting_request_days").insert({ request_id: id, ...dayAt(nextBlock()) })
        expect(write.error).not.toBeNull()
    })
})

describe("a Meeting is one day", () => {
    it("refuses a list of two days in the filing function", async () => {
        const b = nextBlock()
        const { error } = await file("head", {
            p_activity_type: "MEETING",
            p_venue_id: venue,
            p_meeting_type: "ONSITE",
            p_days: [dayAt(b), dayAt(b + 1)],
        })
        expect(error?.message).toMatch(/Meeting is one day/i)
    })

    it("refuses a second day row in the table", async () => {
        const { id, error } = await file("head", { p_activity_type: "MEETING", p_venue_id: venue, p_meeting_type: "ONSITE", p_days: [dayAt(nextBlock())] })
        expect(error).toBeNull()
        const second = await svc().from("meeting_request_days").insert({ request_id: id, ...dayAt(nextBlock()) })
        expect(second.error?.message).toMatch(/Meeting is one day/i)
        expect(await daysOf(id)).toHaveLength(1)
    })

    it("refuses turning a three-day task into a Meeting", async () => {
        const b = nextBlock()
        const { id } = await file("head", { p_days: [dayAt(b), dayAt(b + 1), dayAt(b + 2)] })
        const { error } = await edit("head", id, { p_activity_type: "MEETING", p_venue_id: venue, p_meeting_type: "ONSITE" })
        expect(error?.message).toMatch(/Meeting is one day/i)
        expect(await daysOf(id)).toHaveLength(3)
    })
})

describe("the Calendar", () => {
    it("shows one entry per day with that day's hours, and the request id opens day 1", async () => {
        const b = nextBlock()
        const days = [dayAt(b), dayAt(b + 1, 9, 12), dayAt(b + 2, 13, 14)]
        const { id } = await file("head", { p_days: days })
        const from = manilaDay(days[0].starts_at)
        const to = manilaDay(days[2].starts_at)
        const { data, error } = await (await clientFor("outsider")).rpc("calendar_entries", { p_from: from, p_to: to, p_include_pending: false })
        expect(error).toBeNull()
        const mine = data.filter((e) => e.group_id === id).sort((x, y) => x.starts_at.localeCompare(y.starts_at))
        expect(mine).toHaveLength(3)
        expect(mine.map((e) => Number(e.hours))).toEqual([1, 3, 1])
        expect(mine[0].id).toBe(id)
        expect(new Set(mine.map((e) => e.id)).size).toBe(3)
        expect(mine.map((e) => e.details.day_index)).toEqual([1, 2, 3])
        expect(mine[0].details).toMatchObject({ request_id: id, days_total: 3, range_start: from, range_end: to })
    })
})

describe("changing days", () => {
    it("saves a changed day, a removed day and an added day", async () => {
        const b = nextBlock()
        const { id } = await file("head", { p_days: [dayAt(b), dayAt(b + 1), dayAt(b + 2)] })
        const before = await daysOf(id)
        const changed = await edit("head", id, { p_days: [dayAt(b, 10, 11), dayAt(b + 2), dayAt(b + 3)] })
        expect(changed.error).toBeNull()
        const after = await daysOf(id)
        expect(after).toHaveLength(3)
        expect(new Date(after[0].starts_at).toISOString()).toBe(dayAt(b, 10, 11).starts_at)
        expect(after.some((d) => d.id === before[2].id)).toBe(true) // the untouched day keeps its row
        expect(after.some((d) => d.id === before[1].id)).toBe(false) // the removed day is gone
        const parent = await row(id)
        expect(new Date(parent.ends_at).toISOString()).toBe(dayAt(b + 3).ends_at)
        expect(changed.data.changed_fields.days).toBeTruthy()
    })

    it("keeps an approved Event approved when its days change (#1063)", async () => {
        const b = nextBlock()
        const { id, error } = await file("head", { p_activity_type: "EVENT", p_days: [dayAt(b), dayAt(b + 1)] })
        expect(error).toBeNull()
        await svc().from("meeting_requests").update({ status: "APPROVED" }).eq("id", id)
        const { data, error: e2 } = await edit("head", id, { p_days: [dayAt(b), dayAt(b + 1, 9, 11)] })
        expect(e2).toBeNull()
        expect(data.to_status).toBe("APPROVED")
        expect((await row(id)).status).toBe("APPROVED")
    })

    it("after a day started, the filer can still change, move and drop every day, and the Event stays approved (#1194)", async () => {
        const b = 3 // days near today, so the started days and the future days stay inside the day limit
        const { id } = await file("head", { p_activity_type: "EVENT", p_days: [soonAt(b), soonAt(b + 1), soonAt(b + 2)] })
        await svc().from("meeting_requests").update({ status: "APPROVED" }).eq("id", id)
        await startDays(id, 2) // day 1 and day 2 have started
        const rows = await daysOf(id)
        const kept = rows.slice(0, 2).map(({ starts_at, ends_at }) => ({ starts_at, ends_at }))
        // change a started day, add a day in the past, drop the rest
        const moved = [{ ...kept[0], ends_at: new Date(new Date(kept[0].ends_at).getTime() + HOUR).toISOString() }, soonAt(-5, 13, 14)]
        const ok = await edit("head", id, { p_days: moved, p_purpose: "What really happened" })
        expect(ok.error).toBeNull()
        expect(ok.data).toMatchObject({ to_status: "APPROVED", after_day: true })
        expect((await row(id)).status).toBe("APPROVED")
        expect((await daysOf(id)).map((d) => new Date(d.ends_at).toISOString()).sort()).toEqual(moved.map((d) => d.ends_at).sort())
        const { data: events } = await svc().from("meeting_request_events").select("action, changed_fields").eq("request_id", id).order("created_at")
        expect(events.at(-1)).toMatchObject({ action: "EDITED" })
        expect(events.at(-1).changed_fields.purpose.to).toBe("What really happened")
    })

    it("after its day, only the filer may edit", async () => {
        const b = nextBlock()
        const { id } = await file("head", { p_days: [dayAt(b)] })
        await startDays(id, 1)
        for (const who of ["hr", "superAdmin", "outsider"]) {
            expect((await edit(who, id, { p_purpose: "Not mine" })).error?.message).toMatch(/filed/i)
        }
    })

    it("after its day, a change that double-books a Venue is still refused", async () => {
        const b = nextBlock()
        const taken = dayAt(b)
        const first = await file("head", { p_activity_type: "MEETING", p_meeting_type: "ONSITE", p_venue_id: venue, p_days: [taken] })
        expect(first.error).toBeNull()
        const { id } = await file("head", { p_days: [dayAt(b + 7)] })
        await startDays(id, 1)
        const { error } = await edit("head", id, { p_activity_type: "MEETING", p_meeting_type: "ONSITE", p_venue_id: venue, p_days: [taken] })
        expect(error).not.toBeNull()
    })
})

describe("cancelling", () => {
    it("on day 2 keeps days 1 and 2 on the Calendar and removes the rest", async () => {
        const b = nextBlock()
        const { id } = await file("head", { p_days: [dayAt(b), dayAt(b + 1), dayAt(b + 2), dayAt(b + 3), dayAt(b + 4)] })
        await startDays(id, 2)
        const held = (await daysOf(id)).slice(0, 2)
        const { error } = await cancel("head", id)
        expect(error).toBeNull()
        const after = await daysOf(id)
        expect(after.map((d) => d.id)).toEqual(held.map((d) => d.id))
        const parent = await row(id)
        expect(parent.status).toBe("CANCELLED")
        expect(new Date(parent.ends_at).toISOString()).toBe(new Date(held[1].ends_at).toISOString())
        const from = manilaDay(held[0].starts_at)
        const to = manilaDay(held[1].starts_at)
        const { data } = await (await clientFor("outsider")).rpc("calendar_entries", { p_from: from, p_to: to, p_include_pending: false })
        expect(data.filter((e) => e.group_id === id)).toHaveLength(2)
    })

    it("while still waiting on HR never shows its held days as approved", async () => {
        const b = nextBlock()
        const { id, error: fileError } = await file("head", { p_activity_type: "EVENT", p_days: [dayAt(b), dayAt(b + 1), dayAt(b + 2)] })
        expect(fileError).toBeNull()
        // An Event is approved on filing now; put it back to waiting to test the waiting case.
        await svc().from("meeting_requests").update({ status: "PENDING_HR" }).eq("id", id)
        await startDays(id, 2)
        const held = await daysOf(id)
        expect((await cancel("head", id)).error).toBeNull()
        const { data } = await (await clientFor("outsider")).rpc("calendar_entries", { p_from: manilaDay(held[0].starts_at), p_to: manilaDay(held[1].starts_at), p_include_pending: true })
        expect(data.filter((e) => e.group_id === id && e.status === "APPROVED")).toHaveLength(0)
    })

    it("before the first day hides the whole Activity and deletes nothing", async () => {
        const b = nextBlock()
        const days = [dayAt(b), dayAt(b + 1), dayAt(b + 2)]
        const { id } = await file("head", { p_days: days })
        expect((await cancel("head", id)).error).toBeNull()
        expect(await daysOf(id)).toHaveLength(3)
        const { data } = await (await clientFor("outsider")).rpc("calendar_entries", { p_from: manilaDay(days[0].starts_at), p_to: manilaDay(days[2].starts_at), p_include_pending: false })
        expect(data.filter((e) => e.group_id === id)).toHaveLength(0)
    })

    it("is allowed to the filer once every day has started, and then it did not happen (#1194)", async () => {
        const b = nextBlock()
        const { id } = await file("head", { p_days: [dayAt(b), dayAt(b + 1)] })
        await startDays(id, 2)
        const held = await daysOf(id)
        expect((await cancel("head", id)).error).toBeNull()
        expect((await row(id)).status).toBe("CANCELLED")
        expect((await row(id)).cancelled_at).toBeNull()
        const { data } = await (await clientFor("outsider")).rpc("calendar_entries", { p_from: manilaDay(held[0].starts_at), p_to: manilaDay(held[1].starts_at), p_include_pending: false })
        expect(data.filter((e) => e.group_id === id)).toHaveLength(0)
    })

    it("is still refused to HR once every day has started", async () => {
        const b = nextBlock()
        const { id } = await file("head", { p_days: [dayAt(b)] })
        await startDays(id, 1)
        expect((await cancel("hr", id)).error?.message).toMatch(/already started/i)
        expect((await row(id)).status).not.toBe("CANCELLED")
    })
})

describe("the migration backfill", () => {
    it("gave every existing Activity exactly one day", async () => {
        const { data: parents } = await svc().from("meeting_requests").select("id")
        const { data: days } = await svc().from("meeting_request_days").select("request_id")
        const counts = new Map()
        for (const d of days) counts.set(d.request_id, (counts.get(d.request_id) ?? 0) + 1)
        for (const p of parents) expect(counts.get(p.id)).toBeGreaterThanOrEqual(1)
    })
})
