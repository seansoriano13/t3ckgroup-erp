/**
 * LWOP (#616, spec #609): the table's policies, the head-stage guard, and the decide / undo /
 * withdraw functions, run against a real database.
 *
 * LWOP is a record only, so every path also asserts that no balance column moved.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"

const svc = () => serviceClient()
const cleanup = []

afterEach(async () => {
    while (cleanup.length) await cleanup.pop()()
})

beforeAll(async () => {
    await ensureCastLoaded()
})

async function manilaDates() {
    const { rows } = await sql().query(
        `select manila_today()::text as today, (manila_today() - 1)::text as yesterday, (manila_today() + 1)::text as tomorrow`,
    )
    return rows[0]
}

async function readBalances(id) {
    const { data, error } = await svc()
        .from("employees")
        .select("offset_hours_balance, sil_hours_balance")
        .eq("id", id)
        .single()
    if (error) throw new Error(error.message)
    return data
}

/** Seeds a group with the service role (the insert policy is covered separately). */
async function seedGroup({ dates, status = "PENDING", headStatus = "APPROVED", headId = null, hrOverride = false }) {
    const groupId = crypto.randomUUID()
    const { data, error } = await svc()
        .from("lwop_leaves")
        .insert(
            dates.map((date) => ({
                employee_id: ids.ordinary,
                date,
                hours: 8,
                status,
                reason: "[policy-tier] LWOP",
                leave_group_id: groupId,
                application_hash: `seeded-lwop-${date}`,
                head_id: headId,
                head_status: headStatus,
                hr_override: hrOverride,
            })),
        )
        .select("id")
    if (error) throw new Error(`Seeding lwop_leaves: ${error.message}`)
    cleanup.push(async () => {
        await svc().from("lwop_leaves").delete().eq("leave_group_id", groupId)
    })
    return { groupId, firstId: data[0].id }
}

const statusesOf = async (groupId) => {
    const { data } = await svc().from("lwop_leaves").select("status").eq("leave_group_id", groupId)
    return data.map((r) => r.status)
}

describe("lwop_leaves row-level security", () => {
    it("an employee reads their own rows and not a colleague's", async () => {
        const { today } = await manilaDates()
        const { groupId } = await seedGroup({ dates: [today] })

        const own = await (await clientFor("ordinary")).from("lwop_leaves").select("id").eq("leave_group_id", groupId)
        expect(own.data).toHaveLength(1)

        const other = await (await clientFor("outsider")).from("lwop_leaves").select("id").eq("leave_group_id", groupId)
        expect(other.data).toHaveLength(0)
    })

    it("HR reads everyone's rows", async () => {
        const { today } = await manilaDates()
        const { groupId } = await seedGroup({ dates: [today] })
        const res = await (await clientFor("hr")).from("lwop_leaves").select("id").eq("leave_group_id", groupId)
        expect(res.data).toHaveLength(1)
    })

    it("an employee can file for themselves but not for a colleague", async () => {
        const { tomorrow } = await manilaDates()
        const client = await clientFor("ordinary")
        const mine = await client
            .from("lwop_leaves")
            .insert({ employee_id: ids.ordinary, date: tomorrow, hours: 8, reason: "[policy-tier] LWOP", head_status: "PENDING" })
            .select("leave_group_id")
            .single()
        expect(mine.error).toBeNull()
        cleanup.push(async () => {
            await svc().from("lwop_leaves").delete().eq("leave_group_id", mine.data.leave_group_id)
        })

        const theirs = await client
            .from("lwop_leaves")
            .insert({ employee_id: ids.outsider, date: tomorrow, hours: 8, reason: "[policy-tier] LWOP" })
        expect(theirs.error).not.toBeNull()
    })
})

describe("the head-stage guard", () => {
    it("refuses the applicant approving their own head stage", async () => {
        const { tomorrow } = await manilaDates()
        const { groupId } = await seedGroup({ dates: [tomorrow], headStatus: "PENDING", headId: ids.head })

        const client = await clientFor("ordinary")
        await client.from("lwop_leaves").update({ head_status: "APPROVED" }).eq("leave_group_id", groupId)

        const { data } = await svc().from("lwop_leaves").select("head_status").eq("leave_group_id", groupId)
        expect(data.map((r) => r.head_status)).toEqual(["PENDING"])
    })

    it("lets the routed head clear the head stage", async () => {
        const { tomorrow } = await manilaDates()
        const { groupId } = await seedGroup({ dates: [tomorrow], headStatus: "PENDING", headId: ids.head })

        const client = await clientFor("head")
        const res = await client.from("lwop_leaves").update({ head_status: "APPROVED" }).eq("leave_group_id", groupId).select("head_status")
        expect(res.error).toBeNull()
        expect(res.data.map((r) => r.head_status)).toEqual(["APPROVED"])
    })
})

describe("decide_lwop_leave_decision", () => {
    it("approves the whole group, stamps HR, and moves no balance", async () => {
        const { tomorrow } = await manilaDates()
        const before = await readBalances(ids.ordinary)
        const { groupId } = await seedGroup({ dates: [tomorrow, tomorrow] })

        const client = await clientFor("hr")
        const { data, error } = await client.rpc("decide_lwop_leave_decision", {
            p_group_id: groupId,
            p_status: "APPROVED",
            p_hr_notes: null,
            p_hr_id: ids.hr,
        })
        expect(error).toBeNull()
        expect(data.rows).toHaveLength(2)
        expect(await statusesOf(groupId)).toEqual(["APPROVED", "APPROVED"])

        const { data: stamped } = await svc().from("lwop_leaves").select("hr_processed_by, hr_processed_at, approval_hash").eq("leave_group_id", groupId)
        for (const row of stamped) {
            expect(row.hr_processed_by).toBe(ids.hr)
            expect(row.hr_processed_at).not.toBeNull()
            expect(row.approval_hash).not.toBeNull()
        }
        expect(await readBalances(ids.ordinary)).toEqual(before)
    })

    it("refuses a group whose head stage is not cleared, and accepts it once HR overrides", async () => {
        const { tomorrow } = await manilaDates()
        const { groupId } = await seedGroup({ dates: [tomorrow], headStatus: "PENDING", headId: ids.head })
        const client = await clientFor("hr")
        const args = { p_group_id: groupId, p_status: "APPROVED", p_hr_notes: null, p_hr_id: ids.hr }

        const refused = await client.rpc("decide_lwop_leave_decision", args)
        expect(refused.error?.message).toMatch(/department head has not approved/)

        await svc().from("lwop_leaves").update({ hr_override: true }).eq("leave_group_id", groupId)
        const ok = await client.rpc("decide_lwop_leave_decision", args)
        expect(ok.error).toBeNull()
    })

    it("refuses a group that is not pending", async () => {
        const { tomorrow } = await manilaDates()
        const { groupId } = await seedGroup({ dates: [tomorrow], status: "APPROVED" })
        const client = await clientFor("hr")
        const { error } = await client.rpc("decide_lwop_leave_decision", {
            p_group_id: groupId,
            p_status: "REJECTED",
            p_hr_notes: null,
            p_hr_id: ids.hr,
        })
        expect(error?.message).toMatch(/already been decided/)
    })

    it("an ordinary employee cannot decide their own LWOP", async () => {
        const { tomorrow } = await manilaDates()
        const { groupId } = await seedGroup({ dates: [tomorrow] })
        const client = await clientFor("ordinary")
        await client.rpc("decide_lwop_leave_decision", {
            p_group_id: groupId,
            p_status: "APPROVED",
            p_hr_notes: null,
            p_hr_id: ids.ordinary,
        })
        expect(await statusesOf(groupId)).toEqual(["PENDING"])
    })
})

describe("undo_lwop_leave_decision", () => {
    it("returns an approved group to pending and clears the HR stamps", async () => {
        const { tomorrow } = await manilaDates()
        const { groupId } = await seedGroup({ dates: [tomorrow, tomorrow] })
        const client = await clientFor("hr")
        await client.rpc("decide_lwop_leave_decision", { p_group_id: groupId, p_status: "APPROVED", p_hr_notes: "ok", p_hr_id: ids.hr })

        const { error } = await client.rpc("undo_lwop_leave_decision", { p_group_id: groupId, p_hr_id: ids.hr })
        expect(error).toBeNull()

        const { data } = await svc().from("lwop_leaves").select("status, hr_notes, hr_processed_by, hr_processed_at, approval_hash").eq("leave_group_id", groupId)
        for (const row of data) {
            expect(row).toEqual({ status: "PENDING", hr_notes: null, hr_processed_by: null, hr_processed_at: null, approval_hash: null })
        }
    })

    it("refuses a group that is already pending", async () => {
        const { tomorrow } = await manilaDates()
        const { groupId } = await seedGroup({ dates: [tomorrow] })
        const { error } = await (await clientFor("hr")).rpc("undo_lwop_leave_decision", { p_group_id: groupId, p_hr_id: ids.hr })
        expect(error?.message).toMatch(/already pending/)
    })
})

describe("cancel_lwop_leave (withdraw)", () => {
    const withdraw = async (leaveId, key = "ordinary", employeeId = ids.ordinary) =>
        (await clientFor(key)).rpc("cancel_lwop_leave", { p_leave_id: leaveId, p_employee_id: employeeId })

    it("withdraws a pending group at any time, even one dated in the past", async () => {
        const { yesterday } = await manilaDates()
        const before = await readBalances(ids.ordinary)
        const { groupId, firstId } = await seedGroup({ dates: [yesterday] })
        const { error } = await withdraw(firstId)
        expect(error).toBeNull()
        expect(await statusesOf(groupId)).toEqual(["CANCELLED"])
        expect(await readBalances(ids.ordinary)).toEqual(before)
    })

    it("withdraws an approved group whose first date is today (Manila)", async () => {
        const { today } = await manilaDates()
        const { groupId, firstId } = await seedGroup({ dates: [today], status: "APPROVED" })
        const { error } = await withdraw(firstId)
        expect(error).toBeNull()
        expect(await statusesOf(groupId)).toEqual(["CANCELLED"])
    })

    it("refuses an approved group whose first date has passed in Manila time", async () => {
        const { yesterday } = await manilaDates()
        const { firstId } = await seedGroup({ dates: [yesterday], status: "APPROVED" })
        const { error } = await withdraw(firstId)
        expect(error?.message).toMatch(/has already been taken/)
    })

    it("refuses a colleague withdrawing someone else's LWOP", async () => {
        const { tomorrow } = await manilaDates()
        const { groupId, firstId } = await seedGroup({ dates: [tomorrow] })
        const { error } = await withdraw(firstId, "outsider", ids.outsider)
        expect(error?.message).toMatch(/Unauthorized/)
        expect(await statusesOf(groupId)).toEqual(["PENDING"])
    })
})
