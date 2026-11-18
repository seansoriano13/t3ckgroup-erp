/**
 * Settings > Activities (#1064, spec #1062): the rules #1063 and #1056 had in code are rows HR and Super Admins change.
 *
 *   who changes them: HR and Super Admins; everyone signed in reads; anyone else is refused
 *   a type that is off cannot be filed, but its existing Activities stay (and an edit may keep the type)
 *   who files and whether it waits for HR change what happens on the next filing
 *   at least one type stays on
 *   hours, time step, longest range, meeting types and Guests are held by the database
 *   the reminder goes out at the lead time set
 *   a change never rewrites an Activity already filed
 * Every test puts the settings back the way the migration seeds them.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER } from "./support/rows.js"

const svc = () => serviceClient()
const created = []

const SEED_TYPES = [
    { activity_type: "MEETING", name: "Meeting", color: "teal", active: true, who_files: "EVERYONE", needs_hr: true, multi_day: false },
    { activity_type: "ADMIN_TASK", name: "Admin Task", color: "indigo", active: true, who_files: "HEADS", needs_hr: false, multi_day: true },
    { activity_type: "OPERATIONS_TASK", name: "Operations Task", color: "orange", active: true, who_files: "HEADS", needs_hr: false, multi_day: true },
    { activity_type: "EVENT", name: "Event", color: "plum", active: true, who_files: "HEADS", needs_hr: false, multi_day: true },
]
const SEED_GENERAL = {
    meeting_onsite: true,
    meeting_online: true,
    meeting_hybrid: true,
    earliest_start: "06:00",
    latest_end: "21:45",
    time_step_minutes: 15,
    default_start: "09:00",
    default_end: "10:00",
    reminder_minutes: 15,
    max_days: 31,
    guests_allowed: true,
}

const restore = async () => {
    for (const row of SEED_TYPES) await svc().from("activity_type_settings").update(row).eq("activity_type", row.activity_type)
    await svc().from("activity_general_settings").update(SEED_GENERAL).eq("id", true)
}
const setType = async (type, patch) => {
    const { error } = await svc().from("activity_type_settings").update(patch).eq("activity_type", type)
    if (error) throw new Error(error.message)
}
const setGeneral = async (patch) => {
    const { error } = await svc().from("activity_general_settings").update(patch).eq("id", true)
    if (error) throw new Error(error.message)
}

// One Manila day per slot number, 09:00 to 10:00, so no two requests clash at a Venue.
const day = (n, startH = 1, hours = 1) => {
    const d = Date.UTC(2037, 0, 1 + n, startH, 0, 0)
    return { starts_at: new Date(d).toISOString(), ends_at: new Date(d + hours * 3_600_000).toISOString() }
}
let n = 0
const file = async (who, over = {}) => {
    n += 1
    const slot = day(n)
    const { data, error } = await (await clientFor(who)).rpc("file_meeting_request", {
        p_venue_id: null,
        p_starts_at: slot.starts_at,
        p_ends_at: slot.ends_at,
        p_facilitator_id: ids[who],
        p_purpose: `${MARKER} settings`,
        p_guests: [],
        p_participant_ids: [],
        p_activity_type: "ADMIN_TASK",
        ...over,
    })
    if (data) created.push(data)
    return { id: data, error }
}
const row = async (id) => (await svc().from("meeting_requests").select("*").eq("id", id).single()).data

beforeAll(async () => {
    await ensureCastLoaded()
})
afterEach(restore)
afterAll(async () => {
    await restore()
    if (created.length) {
        await svc().from("notifications").delete().in("reference_id", created)
        await svc().from("meeting_requests").delete().in("id", created)
    }
})

describe("who reads and who changes the settings", () => {
    it("lets everyone signed in read both tables", async () => {
        for (const who of ["ordinary", "head", "hr", "superAdmin"]) {
            const c = await clientFor(who)
            expect((await c.from("activity_type_settings").select("activity_type")).data).toHaveLength(4)
            expect((await c.from("activity_general_settings").select("id")).data).toHaveLength(1)
        }
    })

    it("lets HR and a Super Admin change a type and the general settings", async () => {
        for (const who of ["hr", "superAdmin"]) {
            const c = await clientFor(who)
            const a = await c.from("activity_type_settings").update({ name: `${who} Event` }).eq("activity_type", "EVENT").select("activity_type")
            expect(a.data).toHaveLength(1)
            const b = await c.from("activity_general_settings").update({ max_days: 20 }).eq("id", true).select("id")
            expect(b.data).toHaveLength(1)
        }
    })

    it("refuses an employee and a department head, and leaves the rows as they were", async () => {
        for (const who of ["ordinary", "head"]) {
            const c = await clientFor(who)
            const a = await c.from("activity_type_settings").update({ name: "Nope" }).eq("activity_type", "EVENT").select("activity_type")
            expect(a.data ?? []).toHaveLength(0)
            const b = await c.from("activity_general_settings").update({ max_days: 3 }).eq("id", true).select("id")
            expect(b.data ?? []).toHaveLength(0)
        }
        expect((await svc().from("activity_type_settings").select("name").eq("activity_type", "EVENT").single()).data.name).toBe("Event")
        expect((await svc().from("activity_general_settings").select("max_days").single()).data.max_days).toBe(31)
    })

    it("lets nobody add a fifth type or delete one", async () => {
        const c = await clientFor("superAdmin")
        const add = await c.from("activity_type_settings").insert({ activity_type: "PARTY", name: "Party", color: "pink" })
        expect(add.error).not.toBeNull()
        const del = await c.from("activity_type_settings").delete().eq("activity_type", "EVENT").select("activity_type")
        expect(del.error || (del.data ?? []).length === 0).toBeTruthy()
    })

    it("keeps at least one type on", async () => {
        for (const t of ["ADMIN_TASK", "OPERATIONS_TASK", "EVENT"]) await setType(t, { active: false })
        const { error } = await svc().from("activity_type_settings").update({ active: false }).eq("activity_type", "MEETING")
        expect(error?.message).toMatch(/at least one/i)
    })

    it("keeps one meeting type on and the times in order", async () => {
        expect((await svc().from("activity_general_settings").update({ meeting_onsite: false, meeting_online: false, meeting_hybrid: false }).eq("id", true)).error).not.toBeNull()
        expect((await svc().from("activity_general_settings").update({ earliest_start: "12:00", latest_end: "11:00" }).eq("id", true)).error).not.toBeNull()
        expect((await svc().from("activity_general_settings").update({ time_step_minutes: 20 }).eq("id", true)).error).not.toBeNull()
        expect((await svc().from("activity_general_settings").update({ time_step_minutes: 60, default_start: "09:15" }).eq("id", true)).error).not.toBeNull()
    })
})

describe("a type that is switched off", () => {
    it("cannot be filed, but its existing Activities stay and an edit may keep the type", async () => {
        const { id } = await file("head", { p_activity_type: "EVENT" })
        expect(id).toBeTruthy()
        await setType("EVENT", { active: false })

        const refused = await file("head", { p_activity_type: "EVENT" })
        expect(refused.error?.message).toMatch(/switched off/i)

        expect(await row(id)).toMatchObject({ activity_type: "EVENT", status: "APPROVED" })
        const r = await row(id)
        const edited = await (await clientFor("head")).rpc("edit_meeting_request", {
            p_request_id: id,
            p_venue_id: null,
            p_starts_at: r.starts_at,
            p_ends_at: r.ends_at,
            p_facilitator_id: r.facilitator_id,
            p_purpose: `${r.purpose} again`,
            p_guests: [],
            p_participant_ids: [],
            p_meeting_type: null,
            p_meeting_link: null,
            p_activity_type: "EVENT",
        })
        expect(edited.error).toBeNull()
    })
})

describe("who files and who approves", () => {
    it("lets anyone file a type once its setting says everyone, and refuses a Meeting for non-heads when it says heads", async () => {
        expect((await file("ordinary", { p_activity_type: "ADMIN_TASK" })).error?.message).toMatch(/department head/i)
        await setType("ADMIN_TASK", { who_files: "EVERYONE" })
        expect((await file("ordinary", { p_activity_type: "ADMIN_TASK" })).error).toBeNull()

        await setType("MEETING", { who_files: "HEADS" })
        const online = { p_activity_type: "MEETING", p_meeting_type: "ONLINE", p_meeting_link: "https://x.test/m" }
        expect((await file("ordinary", online)).error?.message).toMatch(/department head/i)
        expect((await file("head", online)).error).toBeNull()
    })

    it("holds a task for HR when the type says so, never one HR files, and approves a Meeting with no Venue", async () => {
        await setType("ADMIN_TASK", { needs_hr: true })
        const waiting = await file("head", { p_activity_type: "ADMIN_TASK" })
        expect((await row(waiting.id)).status).toBe("PENDING_HR")

        await setType("ADMIN_TASK", { who_files: "EVERYONE" })
        const own = await file("hr", { p_activity_type: "ADMIN_TASK" })
        expect((await row(own.id)).status).toBe("APPROVED")

        await setType("MEETING", { needs_hr: false })
        const { data: venue } = await svc().from("calendar_venues").select("id").eq("name", "Admin Office").single()
        const room = await file("ordinary", { p_activity_type: "MEETING", p_meeting_type: "ONSITE", p_venue_id: venue.id })
        expect((await row(room.id)).status).toBe("APPROVED")
    })
})

describe("the times, the range and Guests", () => {
    const listed = (...days) => ({ p_days: days, p_starts_at: days[0].starts_at, p_ends_at: days[0].ends_at })

    it("holds a listed day to the earliest start and latest end", async () => {
        await setGeneral({ earliest_start: "08:00", latest_end: "18:00", default_start: "09:00", default_end: "10:00" })
        // 07:00 Manila is 23:00 UTC the day before.
        const early = await file("head", listed(day(900, -1, 1)))
        expect(early.error?.message).toMatch(/between 08:00 and 18:00/)
        expect((await file("head", listed(day(901, 1, 1)))).error).toBeNull()
    })

    it("holds the hours even when no day list is sent", async () => {
        await setGeneral({ earliest_start: "08:00", latest_end: "18:00", default_start: "09:00", default_end: "10:00" })
        const early = day(905, -1, 1)
        const refused = await file("head", { p_starts_at: early.starts_at, p_ends_at: early.ends_at })
        expect(refused.error?.message).toMatch(/between 08:00 and 18:00/)
        const ok = day(906, 1, 1)
        expect((await file("head", { p_starts_at: ok.starts_at, p_ends_at: ok.ends_at })).error).toBeNull()
    })

    it("holds times to the time step", async () => {
        await setGeneral({ latest_end: "21:30", time_step_minutes: 30 }) // the window ends on a 30-minute mark too
        const odd = day(910)
        const off = { starts_at: new Date(Date.parse(odd.starts_at) + 15 * 60_000).toISOString(), ends_at: new Date(Date.parse(odd.ends_at) + 15 * 60_000).toISOString() }
        expect((await file("head", listed(off))).error?.message).toMatch(/30-minute marks/)
        expect((await file("head", listed(day(911)))).error).toBeNull()
    })

    it("holds a range to the longest range", async () => {
        await setGeneral({ max_days: 2 })
        const three = await file("head", listed(day(920), day(921), day(922)))
        expect(three.error?.message).toMatch(/at most 2 days/)
        expect((await file("head", listed(day(930), day(931)))).error).toBeNull()
    })

    it("lets a Meeting run over several days only when its setting says so", async () => {
        const online = { p_activity_type: "MEETING", p_meeting_type: "ONLINE", p_meeting_link: "https://x.test/m" }
        expect((await file("head", { ...online, ...listed(day(940), day(941)) })).error?.message).toMatch(/Meeting is one day/i)
        await setType("MEETING", { multi_day: true })
        expect((await file("head", { ...online, ...listed(day(942), day(943)) })).error).toBeNull()
    })

    it("refuses a meeting type that is off", async () => {
        await setGeneral({ meeting_online: false })
        const { error } = await file("head", { p_activity_type: "MEETING", p_meeting_type: "ONLINE", p_meeting_link: "https://x.test/m" })
        expect(error?.message).toMatch(/online meetings are switched off/i)
    })

    it("refuses Guests when they are not allowed, but an edit may keep the ones already there", async () => {
        const { id } = await file("head", { p_guests: ["Visiting Auditor"], p_guest_emails: [""] })
        expect(id).toBeTruthy()
        await setGeneral({ guests_allowed: false })
        expect((await file("head", { p_guests: ["Another Guest"], p_guest_emails: [""] })).error?.message).toMatch(/guests are not allowed/i)
        expect((await file("head")).error).toBeNull()

        const r = await row(id)
        const edit = await (await clientFor("head")).rpc("edit_meeting_request", {
            p_request_id: id,
            p_venue_id: null,
            p_starts_at: r.starts_at,
            p_ends_at: r.ends_at,
            p_facilitator_id: r.facilitator_id,
            p_purpose: r.purpose,
            p_guests: r.guests,
            p_guest_emails: r.guest_emails,
            p_participant_ids: [],
            p_meeting_type: null,
            p_meeting_link: null,
            p_activity_type: "ADMIN_TASK",
        })
        expect(edit.error).toBeNull()
    })

    it("never rewrites an Activity already filed", async () => {
        const { id } = await file("head", { p_guests: ["Kept Guest"], p_guest_emails: [""] })
        const before = await row(id)
        await setType("ADMIN_TASK", { name: "Chores", active: false, who_files: "HEADS", needs_hr: true })
        await setGeneral({ max_days: 1, guests_allowed: false, earliest_start: "10:00", default_start: "10:00", default_end: "11:00" })
        const after = await row(id)
        expect(after).toMatchObject({ status: before.status, activity_type: "ADMIN_TASK", starts_at: before.starts_at, ends_at: before.ends_at, guests: ["Kept Guest"] })
    })
})

describe("the reminder lead time", () => {
    const QUARTER = 15 * 60_000
    const seedStartingIn = async (minutes) => {
        const start = new Date(Math.ceil((Date.now() + minutes * 60_000) / QUARTER) * QUARTER)
        const { data, error } = await svc()
            .from("meeting_requests")
            .insert({
                applicant_id: ids.ordinary,
                facilitator_id: ids.head,
                purpose: `${MARKER} reminder lead`,
                status: "APPROVED",
                activity_type: "ADMIN_TASK",
                starts_at: start.toISOString(),
                ends_at: new Date(start.getTime() + QUARTER).toISOString(),
            })
            .select("id")
            .single()
        if (error) throw new Error(error.message)
        created.push(data.id)
        return { id: data.id, start }
    }
    const reminders = async (id) => (await svc().from("notifications").select("id").eq("reference_id", id).eq("type", "MEETING_REMINDER")).data

    it("does not remind one that starts later than the lead time, and does once the lead time covers it", async () => {
        // About 45 to 60 minutes away: out of the 15-minute lead, inside a 120-minute one.
        const { id, start } = await seedStartingIn(45)
        expect(start.getTime() - Date.now()).toBeGreaterThan(20 * 60_000)
        await svc().rpc("send_meeting_reminders")
        expect(await reminders(id)).toHaveLength(0)
        await setGeneral({ reminder_minutes: 120 })
        await svc().rpc("send_meeting_reminders")
        expect((await reminders(id)).length).toBeGreaterThan(0)
    })
})
