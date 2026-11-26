/**
 * Group Task on the Calendar (#1250, spec #1246): a fifth Activity type, filed from a Group Task.
 *
 *   the type and the Group Task link come together
 *   anyone who can open the Group Task may file it; someone who cannot is refused
 *   one live Activity per Group Task; a declined or cancelled one frees it (pending and returned count as live)
 *   no Venue, meeting type or meeting link
 *   refused when the type is off and when the Group Task is Cancelled
 *   the title is the Group Task's, on filing and after a rename; an edit cannot change it
 *   Waits for HR follows the type's own setting
 *   calendar_entries carries group_task_id
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeGroupTask } from "./support/rows.js"
import { ahead } from "./support/dates.js"

const svc = () => serviceClient()
const created = []
const tasks = []

const slot = (n) => {
    const d = Date.UTC(...ahead(200 + (n % 120)), 1, 0, 0)
    return { starts_at: new Date(d).toISOString(), ends_at: new Date(d + 3_600_000).toISOString() }
}
let n = 0
const newTask = async (memberKey = "ordinary", createdBy = "head") => {
    const { taskId } = await makeGroupTask({ createdBy: ids[createdBy], memberId: memberKey ? ids[memberKey] : null })
    tasks.push(taskId)
    return taskId
}
const file = async (who, taskId, over = {}) => {
    n += 1
    const s = slot(n)
    const { data, error } = await (await clientFor(who)).rpc("file_meeting_request", {
        p_venue_id: null,
        p_starts_at: s.starts_at,
        p_ends_at: s.ends_at,
        p_facilitator_id: ids[who],
        p_purpose: "typed by the browser",
        p_guests: [],
        p_participant_ids: [ids[who]],
        p_activity_type: "GROUP_TASK",
        p_group_task_id: taskId,
        ...over,
    })
    if (data) created.push(data)
    return { id: data, error }
}
const row = async (id) => (await svc().from("meeting_requests").select("*").eq("id", id).single()).data

beforeAll(async () => {
    await ensureCastLoaded()
})
afterEach(async () => {
    await svc().from("activity_type_settings").update({ active: true, needs_hr: false }).eq("activity_type", "GROUP_TASK")
})
afterAll(async () => {
    if (created.length) {
        await svc().from("notifications").delete().in("reference_id", created)
        await svc().from("meeting_requests").delete().in("id", created)
    }
    if (tasks.length) {
        await svc().from("committee_task_members").delete().in("committee_task_id", tasks)
        await svc().from("committee_tasks").delete().in("id", tasks)
    }
})

describe("the type", () => {
    it("is seeded on, several days, not waiting for HR", async () => {
        const { data } = await svc().from("activity_type_settings").select("*").eq("activity_type", "GROUP_TASK").single()
        expect(data).toMatchObject({ name: "Group Task", active: true, needs_hr: false, multi_day: true })
        const others = await svc().from("activity_type_settings").select("color").neq("activity_type", "GROUP_TASK")
        expect(others.data.map((r) => r.color)).not.toContain(data.color)
    })
})

describe("filing", () => {
    it("a member files it: approved, the Group Task's title, linked, no venue", async () => {
        const task = await newTask()
        const { id, error } = await file("ordinary", task)
        expect(error).toBeNull()
        const r = await row(id)
        expect(r).toMatchObject({ activity_type: "GROUP_TASK", group_task_id: task, status: "APPROVED", venue_id: null, meeting_type: null, meeting_link: null })
        expect(r.purpose).toBe(`${MARKER} Trade show stand`)
    })

    it("cuts a long title to 500 characters", async () => {
        const task = await newTask()
        await svc().from("committee_tasks").update({ title: "x".repeat(600) }).eq("id", task)
        const { id, error } = await file("ordinary", task)
        expect(error).toBeNull()
        expect((await row(id)).purpose).toHaveLength(500)
    })

    it("refuses a Group Task Activity with no Group Task", async () => {
        const { error } = await file("ordinary", null)
        expect(error?.message).toMatch(/needs a Group Task/)
    })

    it("refuses a Group Task link on any other type", async () => {
        const task = await newTask()
        const { error } = await file("head", task, { p_activity_type: "OPERATIONS_TASK" })
        expect(error?.message).toMatch(/Only a Group Task Activity/)
    })

    it("refuses someone who cannot open the Group Task", async () => {
        const task = await newTask()
        const { error } = await file("outsider", task)
        expect(error?.code).toBe("42501")
    })

    it("refuses a Venue, a meeting type or a meeting link", async () => {
        const task = await newTask()
        const venue = (await svc().from("calendar_venues").select("id").eq("active", true).limit(1)).data?.[0]
        const a = await file("ordinary", task, { p_venue_id: venue?.id ?? ids.ordinary })
        const b = await file("ordinary", task, { p_meeting_type: "ONLINE" })
        const c = await file("ordinary", task, { p_meeting_link: "https://example.com/x" })
        for (const r of [a, b, c]) expect(r.error?.message).toMatch(/Only a Meeting has/)
    })

    it("refuses filing while the type is switched off", async () => {
        const task = await newTask()
        await svc().from("activity_type_settings").update({ active: false }).eq("activity_type", "GROUP_TASK")
        const { error } = await file("ordinary", task)
        expect(error?.message).toMatch(/switched off/)
    })

    it("refuses a Cancelled Group Task", async () => {
        const task = await newTask()
        await svc().from("committee_tasks").update({ status: "CANCELLED" }).eq("id", task)
        const { error } = await file("ordinary", task)
        expect(error?.message).toMatch(/cancelled Group Task/)
    })

    it("waits for HR only when the type says so, and never for HR itself", async () => {
        await svc().from("activity_type_settings").update({ needs_hr: true }).eq("activity_type", "GROUP_TASK")
        const t1 = await newTask("ordinary")
        const t2 = await newTask("hr")
        expect((await row((await file("ordinary", t1)).id)).status).toBe("PENDING_HR")
        expect((await row((await file("hr", t2)).id)).status).toBe("APPROVED")
    })
})

describe("one live Activity per Group Task", () => {
    it("refuses a second, until the first is declined or cancelled", async () => {
        const task = await newTask()
        const first = await file("ordinary", task)
        expect(first.error).toBeNull()
        expect((await file("ordinary", task)).error?.message).toMatch(/already on the Calendar/)

        await svc().from("meeting_requests").update({ status: "DECLINED" }).eq("id", first.id)
        const second = await file("ordinary", task)
        expect(second.error).toBeNull()
        await svc().from("meeting_requests").update({ status: "CANCELLED" }).eq("id", second.id)
        expect((await file("ordinary", task)).error).toBeNull()
    })

    it("counts a returned Activity as live", async () => {
        const task = await newTask()
        const first = await file("ordinary", task)
        await svc().from("meeting_requests").update({ status: "RETURNED" }).eq("id", first.id)
        expect((await file("ordinary", task)).error?.message).toMatch(/already on the Calendar/)
    })
})

describe("the title", () => {
    it("follows a rename of the Group Task without notifying anyone", async () => {
        const task = await newTask()
        const { id } = await file("ordinary", task)
        await svc().from("committee_tasks").update({ title: `${MARKER} Renamed stand` }).eq("id", task)
        const r = await row(id)
        expect(r.purpose).toBe(`${MARKER} Renamed stand`)
        expect(r.status).toBe("APPROVED")
    })

    it("an edit refuses a changed purpose but accepts the same one", async () => {
        const task = await newTask()
        const { id } = await file("ordinary", task)
        const r = await row(id)
        const base = {
            p_request_id: id,
            p_venue_id: null,
            p_starts_at: r.starts_at,
            p_ends_at: r.ends_at,
            p_facilitator_id: ids.ordinary,
            p_participant_ids: [ids.ordinary, ids.head],
            p_activity_type: "GROUP_TASK",
        }
        const c = await clientFor("ordinary")
        const bad = await c.rpc("edit_meeting_request", { ...base, p_purpose: "something else" })
        expect(bad.error?.message).toMatch(/Group Task's title/)
        const ok = await c.rpc("edit_meeting_request", { ...base, p_purpose: r.purpose })
        expect(ok.error).toBeNull()
        const other = await c.rpc("edit_meeting_request", { ...base, p_purpose: r.purpose, p_activity_type: "EVENT" })
        expect(other.error?.message).toMatch(/cannot be changed/)
    })
})

describe("the Calendar", () => {
    it("carries group_task_id in the entry details", async () => {
        const task = await newTask()
        const { id } = await file("ordinary", task)
        const r = await row(id)
        const day = r.starts_at.slice(0, 10)
        const { data, error } = await (await clientFor("ordinary")).rpc("calendar_entries", {
            p_from: day,
            p_to: new Date(Date.parse(day) + 2 * 86_400_000).toISOString().slice(0, 10),
            p_include_pending: true,
        })
        expect(error).toBeNull()
        const entry = data.find((e) => e.details?.activity_type === "GROUP_TASK" && e.details?.group_task_id === task)
        expect(entry).toBeTruthy()
    })
})
