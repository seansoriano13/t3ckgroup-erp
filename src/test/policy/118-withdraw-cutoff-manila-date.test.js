/**
 * The withdraw cutoff follows the Manila date (#613, spec #609, ADR 0039; rule from ADR 0015).
 *
 * An approved Offset or SIL leave can be withdrawn until its first day has passed. "Passed" is
 * decided against manila_today(), not CURRENT_DATE (UTC), so between midnight and 8 AM Manila the
 * cutoff is no longer one day lenient. A leave whose first day is today stays withdrawable.
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
        `select manila_today()::text as today,
                (manila_today() - 1)::text as yesterday,
                ((now() at time zone 'Asia/Manila')::date)::text as expected`,
    )
    return rows[0]
}

async function approvedGroup(table, date) {
    const groupId = crypto.randomUUID()
    const { data, error } = await svc()
        .from(table)
        .insert({
            employee_id: ids.ordinary,
            date,
            hours: 8,
            status: "APPROVED",
            reason: "[policy-tier] Leave",
            leave_group_id: groupId,
            application_hash: `seeded-${table}-${date}`,
        })
        .select("id")
        .single()
    if (error) throw new Error(`Seeding ${table}: ${error.message}`)
    cleanup.push(async () => {
        await svc().from(table).delete().eq("leave_group_id", groupId)
        await svc()
            .from("employees")
            .update({ offset_hours_balance: 0, sil_hours_balance: 0 })
            .eq("id", ids.ordinary)
    })
    return data.id
}

async function withdraw(fn, leaveId) {
    const client = await clientFor("ordinary")
    return client.rpc(fn, { p_leave_id: leaveId, p_employee_id: ids.ordinary })
}

const CASES = [
    ["offset_leaves", "withdraw_offset_leave"],
    ["sil_leaves", "cancel_sil_leave"],
]

describe("manila_today()", () => {
    it("returns the Manila date", async () => {
        const { today, expected } = await manilaDates()
        expect(today).toBe(expected)
    })
})

describe.each(CASES)("%s withdraw cutoff", (table, fn) => {
    it("lets an approved leave starting today (Manila) be withdrawn", async () => {
        const { today } = await manilaDates()
        await svc()
            .from("employees")
            .update({ employment_status: "Regular" })
            .eq("id", ids.ordinary)
        const id = await approvedGroup(table, today)
        const { error } = await withdraw(fn, id)
        expect(error).toBeNull()
    })

    it("refuses an approved leave that started the day before (Manila)", async () => {
        const { yesterday } = await manilaDates()
        const id = await approvedGroup(table, yesterday)
        const { error } = await withdraw(fn, id)
        expect(error?.message).toMatch(/has already been taken, so its hours cannot be withdrawn/)
    })
})
