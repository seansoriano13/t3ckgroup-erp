/**
 * Recording an LWOP as already approved (#620, spec #609): HR and Super Admin only, the group
 * ends approved with the head stage approved and recorded_by_hr set, no balance moves, and undo
 * (#616) returns it to pending.
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

async function tomorrow() {
    const { rows } = await sql().query(`select (manila_today() + 1)::text as tomorrow`)
    return rows[0].tomorrow
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

/** A pending group with the head stage still open, as HR would file it on someone's behalf. */
async function seedPendingGroup() {
    const date = await tomorrow()
    const groupId = crypto.randomUUID()
    const { error } = await svc()
        .from("lwop_leaves")
        .insert({
            employee_id: ids.ordinary,
            date,
            hours: 8,
            status: "PENDING",
            reason: "[policy-tier] recorded LWOP",
            leave_group_id: groupId,
            application_hash: `seeded-lwop-record-${groupId}`,
            head_id: ids.head,
            head_status: "PENDING",
        })
    if (error) throw new Error(`Seeding lwop_leaves: ${error.message}`)
    cleanup.push(async () => {
        await svc().from("lwop_leaves").delete().eq("leave_group_id", groupId)
    })
    return groupId
}

const record = async (key, groupId) => {
    const client = await clientFor(key)
    return client.rpc("record_lwop_leave_as_approved", { p_group_id: groupId, p_hr_id: ids[key] })
}

const rowsOf = async (groupId) => {
    const { data } = await svc().from("lwop_leaves").select("*").eq("leave_group_id", groupId)
    return data
}

describe("record_lwop_leave_as_approved", () => {
    for (const key of ["hr", "superAdmin"]) {
        it(`${key} records the group as approved, head stage approved, and moves no balance`, async () => {
            const before = await readBalances(ids.ordinary)
            const groupId = await seedPendingGroup()

            const { data, error } = await record(key, groupId)
            expect(error).toBeNull()
            expect(data.rows).toHaveLength(1)

            for (const row of await rowsOf(groupId)) {
                expect(row.status).toBe("APPROVED")
                expect(row.head_status).toBe("APPROVED")
                expect(row.recorded_by_hr).toBe(true)
                expect(row.hr_processed_by).toBe(ids[key])
                expect(row.hr_processed_at).not.toBeNull()
            }
            expect(await readBalances(ids.ordinary)).toEqual(before)
        })
    }

    it("is refused for an ordinary employee", async () => {
        const groupId = await seedPendingGroup()
        const { error } = await record("ordinary", groupId)
        expect(error).not.toBeNull()
        expect((await rowsOf(groupId))[0]).toMatchObject({ status: "PENDING", recorded_by_hr: false })
    })

    it("is refused for a department head", async () => {
        const groupId = await seedPendingGroup()
        const { error } = await record("head", groupId)
        expect(error).not.toBeNull()
        expect((await rowsOf(groupId))[0]).toMatchObject({ status: "PENDING", recorded_by_hr: false })
    })

    it("refuses a group that is already decided", async () => {
        const groupId = await seedPendingGroup()
        expect((await record("hr", groupId)).error).toBeNull()
        const second = await record("hr", groupId)
        expect(second.error?.message).toMatch(/already been decided/i)
    })

    it("can be undone like any LWOP: back to pending, HR stamps cleared", async () => {
        const groupId = await seedPendingGroup()
        expect((await record("hr", groupId)).error).toBeNull()

        const client = await clientFor("hr")
        const { error } = await client.rpc("undo_lwop_leave_decision", { p_group_id: groupId, p_hr_id: ids.hr })
        expect(error).toBeNull()

        const [row] = await rowsOf(groupId)
        expect(row.status).toBe("PENDING")
        expect(row.hr_processed_by).toBeNull()
        expect(row.hr_processed_at).toBeNull()
    })
})
