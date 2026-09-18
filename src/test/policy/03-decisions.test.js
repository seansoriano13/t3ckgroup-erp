/**
 * The atomic decision functions, executed.
 *
 * The rest of the suite asserts that a service *called* these with the right
 * arguments — `src/test/msw/postgrest.js` answers `rpc()` from a stub map, so
 * the function bodies have never run in a test. Everything below is what
 * happens after the call: the balance arithmetic, the locking, the approval
 * hash, and the eligibility gate that decides whether a refund is paid.
 *
 * Calls go through a signed-in HR officer, not the service role. These
 * functions are SECURITY INVOKER, so the caller's own policies apply to every
 * row they touch — running them as the service role would prove the arithmetic
 * while saying nothing about whether the officer who uses the screen may
 * actually invoke them.
 *
 * These are the functions that move an employee's leave hours. A mistake in
 * one of them is a mistake in somebody's pay.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest"
import { createHash } from "node:crypto"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"

/** Seeding and teardown only. */
const svc = () => serviceClient()

/** The officer every decision below is made by. */
let hr

async function readEmployee(id) {
    const { data, error } = await svc()
        .from("employees")
        .select("offset_hours_balance, sil_hours_balance, employment_status")
        .eq("id", id)
        .single()
    if (error) throw new Error(error.message)
    return data
}

async function expectOffsetBalance(id, hours) {
    expect(Number((await readEmployee(id)).offset_hours_balance)).toBe(hours)
}

async function expectSilBalance(id, hours) {
    expect(Number((await readEmployee(id)).sil_hours_balance)).toBe(hours)
}

async function setBalances(id, { offset = 0, sil = 0, status = "Regular" } = {}) {
    const { error } = await svc()
        .from("employees")
        .update({
            offset_hours_balance: offset,
            sil_hours_balance: sil,
            employment_status: status,
        })
        .eq("id", id)
    if (error) throw new Error(error.message)
}

/** Calls a decision function as a given cast member, failing loudly on error. */
async function rpcAs(key, name, args) {
    const client = await clientFor(key)
    const { data, error } = await client.rpc(name, args)
    if (error) throw new Error(`${name} as ${key}: ${error.message}`)
    return data
}

/** Calls one expecting it to raise, and returns the message. */
async function rpcExpectingFailure(key, name, args) {
    const client = await clientFor(key)
    const { error } = await client.rpc(name, args)
    if (!error) throw new Error(`${name} was expected to raise and did not`)
    return error.message
}

const APPLICATION_HASH = "seeded-application-hash"

async function makeOvertime({ employeeId, hours, date = "2026-03-04" }) {
    const { data, error } = await svc()
        .from("overtime_requests")
        .insert({
            employee_id: employeeId,
            date,
            hours,
            status: "PENDING",
            reason: "[policy-tier] Overtime",
            application_hash: APPLICATION_HASH,
        })
        .select("id")
        .single()
    if (error) throw new Error(`Seeding overtime: ${error.message}`)
    return data.id
}

/** A multi-day leave: several rows sharing one leave_group_id. */
async function makeLeaveGroup(table, { employeeId, dates, hoursPerDay }) {
    const groupId = crypto.randomUUID()
    const rows = dates.map((date) => ({
        employee_id: employeeId,
        date,
        hours: hoursPerDay,
        status: "PENDING",
        reason: "[policy-tier] Leave",
        leave_group_id: groupId,
        application_hash: `seeded-${date}`,
    }))
    const { error } = await svc().from(table).insert(rows)
    if (error) throw new Error(`Seeding ${table}: ${error.message}`)
    return groupId
}

const cleanup = []
afterEach(async () => {
    while (cleanup.length) await cleanup.pop()()
})

beforeAll(async () => {
    await ensureCastLoaded()
    hr = "hr"
})

// ===========================================================================

describe("who may decide", () => {
    it("an HR officer can decide an overtime request", async () => {
        await setBalances(ids.ordinary, { offset: 0 })
        const id = await makeOvertime({ employeeId: ids.ordinary, hours: 2 })
        cleanup.push(() => svc().from("overtime_requests").delete().eq("id", id))

        const row = await rpcAs(hr, "decide_overtime_request", {
            p_request_id: id,
            p_status: "APPROVED_PAID",
            p_approved_hours: 2,
            p_hr_notes: null,
            p_hr_id: ids.hr,
        })
        expect(row.status).toBe("APPROVED_PAID")
    })

    it("a leave manager holding only the narrow capability can decide one too", async () => {
        // The reason `can_manage_leaves` exists: an HR assistant who is not
        // HR. If the policies did not honour it, this is where that shows.
        await setBalances(ids.ordinary, { offset: 0 })
        const id = await makeOvertime({ employeeId: ids.ordinary, hours: 2, date: "2026-03-05" })
        cleanup.push(() => svc().from("overtime_requests").delete().eq("id", id))

        const row = await rpcAs("leaveManager", "decide_overtime_request", {
            p_request_id: id,
            p_status: "APPROVED_PAID",
            p_approved_hours: 2,
            p_hr_notes: null,
            p_hr_id: ids.leaveManager,
        })
        expect(row.status).toBe("APPROVED_PAID")
    })

    it("an ordinary employee cannot approve their own overtime or credit their own balance (#180)", async () => {
        // Found by this tier on its first run: a live privilege escalation.
        //
        // `decide_overtime_request` is SECURITY INVOKER, so the caller's own
        // policies decide what it may touch. `overtime_requests_update` used to
        // permit `employee_id = get_employee_id()`, which — with "Employees can
        // update their own profile" covering the balance write — let an employee
        // award themselves Offset hours with no HR involvement and still end up
        // with a valid approval hash and an hr_processed_by of their choosing.
        //
        // #180 narrowed the decision policies to the HR capabilities, so the
        // function's UPDATE now violates RLS and the whole call is refused. The
        // request stays PENDING and no hours move.
        await setBalances(ids.ordinary, { offset: 0 })
        const id = await makeOvertime({ employeeId: ids.ordinary, hours: 4, date: "2026-03-06" })
        cleanup.push(async () => {
            await svc().from("overtime_requests").delete().eq("id", id)
            await setBalances(ids.ordinary, { offset: 0 })
        })

        await rpcExpectingFailure("ordinary", "decide_overtime_request", {
            p_request_id: id,
            p_status: "APPROVED_OFFSET",
            p_approved_hours: 4,
            p_hr_notes: "approved by the applicant",
            p_hr_id: ids.ordinary,
        })

        await expectOffsetBalance(ids.ordinary, 0)
        const { data: after } = await svc()
            .from("overtime_requests")
            .select("status, approval_hash")
            .eq("id", id)
            .single()
        expect(after.status).toBe("PENDING")
        expect(after.approval_hash).toBeNull()
    })

    it("an employee cannot approve their own Offset leave without HR (#180)", async () => {
        // The same hole, one table over: `offset_leaves_update` used to permit
        // an update on one's own row. Spending your own balance is less
        // lucrative than awarding it, but it still produced a leave the system
        // recorded as approved and a TG-11 that printed as authorised. The
        // narrowed policy refuses the function's UPDATE, so nothing is spent.
        await setBalances(ids.ordinary, { offset: 16 })
        const group = await makeLeaveGroup("offset_leaves", {
            employeeId: ids.ordinary,
            dates: ["2026-03-07"],
            hoursPerDay: 4,
        })
        cleanup.push(async () => {
            await svc().from("offset_leaves").delete().eq("leave_group_id", group)
            await setBalances(ids.ordinary, { offset: 0 })
        })

        await rpcExpectingFailure("ordinary", "decide_offset_leave_decision", {
            p_group_id: group,
            p_status: "APPROVED",
            p_hr_notes: "approved by the applicant",
            p_hr_id: ids.ordinary,
        })

        await expectOffsetBalance(ids.ordinary, 16)
        const { data: after } = await svc()
            .from("offset_leaves")
            .select("status")
            .eq("leave_group_id", group)
        expect(after.map((r) => r.status)).toEqual(["PENDING"])
    })

    it("an employee cannot approve their own SIL leave without HR (#180)", async () => {
        // `sil_leaves_update` carried the identical policy shape and is narrowed
        // with the other two.
        await setBalances(ids.ordinary, { sil: 16, status: "Regular" })
        const group = await makeLeaveGroup("sil_leaves", {
            employeeId: ids.ordinary,
            dates: ["2026-03-07"],
            hoursPerDay: 4,
        })
        cleanup.push(async () => {
            await svc().from("sil_leaves").delete().eq("leave_group_id", group)
            await setBalances(ids.ordinary, { sil: 0, status: "Regular" })
        })

        await rpcExpectingFailure("ordinary", "decide_sil_leave_decision", {
            p_group_id: group,
            p_status: "APPROVED",
            p_hr_notes: "approved by the applicant",
            p_hr_id: ids.ordinary,
        })

        await expectSilBalance(ids.ordinary, 16)
        const { data: after } = await svc()
            .from("sil_leaves")
            .select("status")
            .eq("leave_group_id", group)
        expect(after.map((r) => r.status)).toEqual(["PENDING"])
    })

    it("an employee can still withdraw their own pending overtime (#180)", async () => {
        // The narrowing must not take the applicant's legitimate path with it:
        // `overtime_requests_withdraw` keeps own-row -> CANCELLED open.
        await setBalances(ids.ordinary, { offset: 0 })
        const id = await makeOvertime({ employeeId: ids.ordinary, hours: 4, date: "2026-03-06" })
        cleanup.push(() => svc().from("overtime_requests").delete().eq("id", id))

        const client = await clientFor("ordinary")
        const { data, error } = await client
            .from("overtime_requests")
            .update({ status: "CANCELLED" })
            .eq("id", id)
            .eq("status", "PENDING")
            .select()
        expect(error).toBeNull()
        expect(data).toHaveLength(1)
        expect(data[0].status).toBe("CANCELLED")
    })

    it("an employee can still withdraw their own Offset and SIL leave (#180)", async () => {
        // `withdraw_offset_leave` and `cancel_sil_leave` are SECURITY INVOKER
        // and move the group's rows to CANCELLED as the applicant — the
        // `_withdraw` policies are what keep that working after the narrowing.
        await setBalances(ids.ordinary, { offset: 8, sil: 8, status: "Regular" })
        const offsetGroup = await makeLeaveGroup("offset_leaves", {
            employeeId: ids.ordinary,
            dates: ["2026-03-09"],
            hoursPerDay: 4,
        })
        const silGroup = await makeLeaveGroup("sil_leaves", {
            employeeId: ids.ordinary,
            dates: ["2026-03-09"],
            hoursPerDay: 4,
        })
        cleanup.push(async () => {
            await svc().from("offset_leaves").delete().eq("leave_group_id", offsetGroup)
            await svc().from("sil_leaves").delete().eq("leave_group_id", silGroup)
            await setBalances(ids.ordinary, { offset: 0, sil: 0, status: "Regular" })
        })

        const { data: offsetRow } = await svc()
            .from("offset_leaves").select("id").eq("leave_group_id", offsetGroup).single()
        const { data: silRow } = await svc()
            .from("sil_leaves").select("id").eq("leave_group_id", silGroup).single()

        await rpcAs("ordinary", "withdraw_offset_leave", {
            p_leave_id: offsetRow.id,
            p_employee_id: ids.ordinary,
        })
        await rpcAs("ordinary", "cancel_sil_leave", {
            p_leave_id: silRow.id,
            p_employee_id: ids.ordinary,
        })

        const { data: offsetAfter } = await svc()
            .from("offset_leaves").select("status").eq("leave_group_id", offsetGroup)
        const { data: silAfter } = await svc()
            .from("sil_leaves").select("status").eq("leave_group_id", silGroup)
        expect(offsetAfter.map((r) => r.status)).toEqual(["CANCELLED"])
        expect(silAfter.map((r) => r.status)).toEqual(["CANCELLED"])
    })

    it("a stranger cannot decide somebody else's overtime", async () => {
        // The refusal that does hold: the policy is scoped to *your own* row or
        // an HR capability, so an unrelated employee is filtered out and the
        // function finds nothing to update.
        await setBalances(ids.ordinary, { offset: 0 })
        const id = await makeOvertime({ employeeId: ids.ordinary, hours: 4, date: "2026-03-08" })
        cleanup.push(() => svc().from("overtime_requests").delete().eq("id", id))

        const client = await clientFor("outsider")
        const { data, error } = await client.rpc("decide_overtime_request", {
            p_request_id: id,
            p_status: "APPROVED_OFFSET",
            p_approved_hours: 4,
            p_hr_notes: null,
            p_hr_id: ids.outsider,
        })

        expect(error !== null || data === null).toBe(true)
        await expectOffsetBalance(ids.ordinary, 0)

        const { data: after } = await svc()
            .from("overtime_requests")
            .select("status")
            .eq("id", id)
            .single()
        expect(after.status).toBe("PENDING")
    })
})

// ===========================================================================

describe("deciding an overtime request", () => {
    it("credits the employee's Offset balance by exactly the approved hours", async () => {
        await setBalances(ids.ordinary, { offset: 10 })
        const id = await makeOvertime({ employeeId: ids.ordinary, hours: 4 })
        cleanup.push(() => svc().from("overtime_requests").delete().eq("id", id))

        await rpcAs(hr, "decide_overtime_request", {
            p_request_id: id,
            p_status: "APPROVED_OFFSET",
            p_approved_hours: 4,
            p_hr_notes: null,
            p_hr_id: ids.hr,
        })

        await expectOffsetBalance(ids.ordinary, 14)
    })

    it("credits the hours HR approved, not the hours the employee asked for", async () => {
        await setBalances(ids.ordinary, { offset: 0 })
        const id = await makeOvertime({ employeeId: ids.ordinary, hours: 8 })
        cleanup.push(() => svc().from("overtime_requests").delete().eq("id", id))

        await rpcAs(hr, "decide_overtime_request", {
            p_request_id: id,
            p_status: "APPROVED_OFFSET",
            p_approved_hours: 3,
            p_hr_notes: "Only three were authorised",
            p_hr_id: ids.hr,
        })

        await expectOffsetBalance(ids.ordinary, 3)
    })

    it("leaves the Offset balance alone when the overtime is paid rather than offset", async () => {
        await setBalances(ids.ordinary, { offset: 7 })
        const id = await makeOvertime({ employeeId: ids.ordinary, hours: 5 })
        cleanup.push(() => svc().from("overtime_requests").delete().eq("id", id))

        await rpcAs(hr, "decide_overtime_request", {
            p_request_id: id,
            p_status: "APPROVED_PAID",
            p_approved_hours: 5,
            p_hr_notes: null,
            p_hr_id: ids.hr,
        })

        await expectOffsetBalance(ids.ordinary, 7)
    })

    it("leaves the balance alone when the request is rejected", async () => {
        await setBalances(ids.ordinary, { offset: 7 })
        const id = await makeOvertime({ employeeId: ids.ordinary, hours: 5 })
        cleanup.push(() => svc().from("overtime_requests").delete().eq("id", id))

        await rpcAs(hr, "decide_overtime_request", {
            p_request_id: id,
            p_status: "REJECTED",
            p_approved_hours: null,
            p_hr_notes: "Not authorised",
            p_hr_id: ids.hr,
        })

        await expectOffsetBalance(ids.ordinary, 7)
    })

    it("refuses to approve zero hours", async () => {
        await setBalances(ids.ordinary, { offset: 0 })
        const id = await makeOvertime({ employeeId: ids.ordinary, hours: 4 })
        cleanup.push(() => svc().from("overtime_requests").delete().eq("id", id))

        const message = await rpcExpectingFailure(hr, "decide_overtime_request", {
            p_request_id: id,
            p_status: "APPROVED_OFFSET",
            p_approved_hours: 0,
            p_hr_notes: null,
            p_hr_id: ids.hr,
        })
        expect(message).toMatch(/greater than zero/i)
        await expectOffsetBalance(ids.ordinary, 0)
    })

    it("refuses a request that does not exist", async () => {
        const message = await rpcExpectingFailure(hr, "decide_overtime_request", {
            p_request_id: crypto.randomUUID(),
            p_status: "APPROVED_OFFSET",
            p_approved_hours: 2,
            p_hr_notes: null,
            p_hr_id: ids.hr,
        })
        expect(message).toMatch(/not found/i)
    })

    it("records which officer decided it", async () => {
        await setBalances(ids.ordinary, { offset: 0 })
        const id = await makeOvertime({ employeeId: ids.ordinary, hours: 1 })
        cleanup.push(() => svc().from("overtime_requests").delete().eq("id", id))

        const row = await rpcAs(hr, "decide_overtime_request", {
            p_request_id: id,
            p_status: "APPROVED_PAID",
            p_approved_hours: 1,
            p_hr_notes: null,
            p_hr_id: ids.leaveManager,
        })
        expect(row.hr_processed_by).toBe(ids.leaveManager)
    })
})

describe("the approval hash", () => {
    it("is the digest of the application, the outcome, the officer and the balance the decision produced", async () => {
        // Recomputed here rather than compared against a sibling record, so the
        // test discriminates the *post-decision* snapshot from the pre-decision
        // one. `verify_form_token` mirrors this formula, which is what makes a
        // printed form verifiable against the live record; if the function's
        // hash and this one ever diverge, every printed form stops verifying.
        await setBalances(ids.ordinary, { offset: 10 })
        const id = await makeOvertime({ employeeId: ids.ordinary, hours: 4 })
        cleanup.push(() => svc().from("overtime_requests").delete().eq("id", id))

        const row = await rpcAs(hr, "decide_overtime_request", {
            p_request_id: id,
            p_status: "APPROVED_OFFSET",
            p_approved_hours: 4,
            p_hr_notes: null,
            p_hr_id: ids.hr,
        })

        // Balance was 10, approved 4, so the snapshot committed to is 14 —
        // not the 10 it was before the decision.
        expect(Number(row.approval_credits_snapshot)).toBe(14)

        const expected = createHash("sha256")
            .update(`${APPLICATION_HASH}|APPROVED_OFFSET|${ids.hr}|14`)
            .digest("hex")
        expect(row.approval_hash).toBe(expected)
    })

    it("commits to no balance at all when the outcome moved none", async () => {
        await setBalances(ids.ordinary, { offset: 10 })
        const id = await makeOvertime({ employeeId: ids.ordinary, hours: 4 })
        cleanup.push(() => svc().from("overtime_requests").delete().eq("id", id))

        const row = await rpcAs(hr, "decide_overtime_request", {
            p_request_id: id,
            p_status: "REJECTED",
            p_approved_hours: null,
            p_hr_notes: null,
            p_hr_id: ids.hr,
        })

        const expected = createHash("sha256")
            .update(`${APPLICATION_HASH}|REJECTED|${ids.hr}|`)
            .digest("hex")
        expect(row.approval_hash).toBe(expected)
        expect(row.approval_credits_snapshot).toBeNull()
    })
})

describe("undoing an overtime decision", () => {
    it("restores the exact balance the employee had before", async () => {
        await setBalances(ids.ordinary, { offset: 6.5 })
        const id = await makeOvertime({ employeeId: ids.ordinary, hours: 2.5 })
        cleanup.push(() => svc().from("overtime_requests").delete().eq("id", id))

        await rpcAs(hr, "decide_overtime_request", {
            p_request_id: id,
            p_status: "APPROVED_OFFSET",
            p_approved_hours: 2.5,
            p_hr_notes: null,
            p_hr_id: ids.hr,
        })
        await expectOffsetBalance(ids.ordinary, 9)

        await rpcAs(hr, "undo_overtime_decision", { p_request_id: id, p_hr_id: ids.hr })
        await expectOffsetBalance(ids.ordinary, 6.5)
    })

    it("returns the request to pending and forgets who decided it", async () => {
        await setBalances(ids.ordinary, { offset: 0 })
        const id = await makeOvertime({ employeeId: ids.ordinary, hours: 1 })
        cleanup.push(() => svc().from("overtime_requests").delete().eq("id", id))

        await rpcAs(hr, "decide_overtime_request", {
            p_request_id: id,
            p_status: "APPROVED_OFFSET",
            p_approved_hours: 1,
            p_hr_notes: null,
            p_hr_id: ids.hr,
        })
        const row = await rpcAs(hr, "undo_overtime_decision", {
            p_request_id: id,
            p_hr_id: ids.hr,
        })

        expect(row.status).toBe("PENDING")
        expect(row.hr_processed_by).toBeNull()
        expect(row.approval_hash).toBeNull()
    })

    it("refuses rather than driving the balance negative when the credit has been spent", async () => {
        // The employee earned the hours and then used them. Reversing the
        // credit would owe hours that no longer exist, so the function raises
        // instead of clamping — the discrepancy stays visible.
        await setBalances(ids.ordinary, { offset: 0 })
        const id = await makeOvertime({ employeeId: ids.ordinary, hours: 4 })
        cleanup.push(() => svc().from("overtime_requests").delete().eq("id", id))

        await rpcAs(hr, "decide_overtime_request", {
            p_request_id: id,
            p_status: "APPROVED_OFFSET",
            p_approved_hours: 4,
            p_hr_notes: null,
            p_hr_id: ids.hr,
        })
        await setBalances(ids.ordinary, { offset: 1 }) // spent elsewhere

        await rpcExpectingFailure(hr, "undo_overtime_decision", {
            p_request_id: id,
            p_hr_id: ids.hr,
        })
        await expectOffsetBalance(ids.ordinary, 1)
    })
})

// ===========================================================================

describe("two officers deciding at the same moment", () => {
    it("does not lose a credit when two requests for one employee are approved concurrently", async () => {
        // This is what the employee-row lock is for. Both calls read the same
        // starting balance; without `FOR UPDATE` serialising them, the second
        // write overwrites the first and one approval silently vanishes.
        //
        // Two separate HTTP requests means two separate database sessions, so
        // this is a real race rather than a sequential pair.
        await setBalances(ids.ordinary, { offset: 0 })
        const first = await makeOvertime({ employeeId: ids.ordinary, hours: 3, date: "2026-06-01" })
        const second = await makeOvertime({ employeeId: ids.ordinary, hours: 5, date: "2026-06-02" })
        cleanup.push(() => svc().from("overtime_requests").delete().in("id", [first, second]))

        const officer = await clientFor("hr")
        const assistant = await clientFor("leaveManager")

        const results = await Promise.all([
            officer.rpc("decide_overtime_request", {
                p_request_id: first,
                p_status: "APPROVED_OFFSET",
                p_approved_hours: 3,
                p_hr_notes: null,
                p_hr_id: ids.hr,
            }),
            assistant.rpc("decide_overtime_request", {
                p_request_id: second,
                p_status: "APPROVED_OFFSET",
                p_approved_hours: 5,
                p_hr_notes: null,
                p_hr_id: ids.leaveManager,
            }),
        ])

        for (const r of results) expect(r.error, r.error?.message).toBeNull()
        await expectOffsetBalance(ids.ordinary, 8)
    })

    it("lets only one of two concurrent decisions on the same leave application through", async () => {
        // The group's day-rows are locked together, so the loser finds the
        // application already decided rather than spending the balance twice.
        await setBalances(ids.ordinary, { offset: 40 })
        const group = await makeLeaveGroup("offset_leaves", {
            employeeId: ids.ordinary,
            dates: ["2026-06-08", "2026-06-09"],
            hoursPerDay: 4,
        })
        cleanup.push(() => svc().from("offset_leaves").delete().eq("leave_group_id", group))

        const officer = await clientFor("hr")
        const assistant = await clientFor("leaveManager")
        const call = (client, hrId) =>
            client.rpc("decide_offset_leave_decision", {
                p_group_id: group,
                p_status: "APPROVED",
                p_hr_notes: null,
                p_hr_id: hrId,
            })

        const results = await Promise.all([
            call(officer, ids.hr),
            call(assistant, ids.leaveManager),
        ])

        const failures = results.filter((r) => r.error)
        expect(failures).toHaveLength(1)
        expect(failures[0].error.message).toMatch(/already been decided/i)

        // Eight hours spent once, not twice.
        await expectOffsetBalance(ids.ordinary, 32)
    })
})

// ===========================================================================

describe("deciding a multi-day Offset leave", () => {
    it("spends the total across every day of the application, in one transaction", async () => {
        await setBalances(ids.ordinary, { offset: 24 })
        const group = await makeLeaveGroup("offset_leaves", {
            employeeId: ids.ordinary,
            dates: ["2026-03-09", "2026-03-10", "2026-03-11"],
            hoursPerDay: 4,
        })
        cleanup.push(() => svc().from("offset_leaves").delete().eq("leave_group_id", group))

        await rpcAs(hr, "decide_offset_leave_decision", {
            p_group_id: group,
            p_status: "APPROVED",
            p_hr_notes: null,
            p_hr_id: ids.hr,
        })

        await expectOffsetBalance(ids.ordinary, 12)
    })

    it("decides every day of the application, not just the first", async () => {
        await setBalances(ids.ordinary, { offset: 24 })
        const group = await makeLeaveGroup("offset_leaves", {
            employeeId: ids.ordinary,
            dates: ["2026-03-16", "2026-03-17", "2026-03-18"],
            hoursPerDay: 4,
        })
        cleanup.push(() => svc().from("offset_leaves").delete().eq("leave_group_id", group))

        await rpcAs(hr, "decide_offset_leave_decision", {
            p_group_id: group,
            p_status: "APPROVED",
            p_hr_notes: null,
            p_hr_id: ids.hr,
        })

        const { data } = await svc()
            .from("offset_leaves")
            .select("status")
            .eq("leave_group_id", group)
        expect(data.map((r) => r.status)).toEqual(["APPROVED", "APPROVED", "APPROVED"])
    })

    it("refuses an application the employee cannot afford, and spends nothing", async () => {
        await setBalances(ids.ordinary, { offset: 5 })
        const group = await makeLeaveGroup("offset_leaves", {
            employeeId: ids.ordinary,
            dates: ["2026-03-23", "2026-03-24"],
            hoursPerDay: 4,
        })
        cleanup.push(() => svc().from("offset_leaves").delete().eq("leave_group_id", group))

        const message = await rpcExpectingFailure(hr, "decide_offset_leave_decision", {
            p_group_id: group,
            p_status: "APPROVED",
            p_hr_notes: null,
            p_hr_id: ids.hr,
        })
        expect(message).toMatch(/only has/i)
        await expectOffsetBalance(ids.ordinary, 5)
    })

    it("refuses to decide the same application twice", async () => {
        await setBalances(ids.ordinary, { offset: 16 })
        const group = await makeLeaveGroup("offset_leaves", {
            employeeId: ids.ordinary,
            dates: ["2026-03-30"],
            hoursPerDay: 4,
        })
        cleanup.push(() => svc().from("offset_leaves").delete().eq("leave_group_id", group))

        await rpcAs(hr, "decide_offset_leave_decision", {
            p_group_id: group,
            p_status: "APPROVED",
            p_hr_notes: null,
            p_hr_id: ids.hr,
        })
        const message = await rpcExpectingFailure(hr, "decide_offset_leave_decision", {
            p_group_id: group,
            p_status: "APPROVED",
            p_hr_notes: null,
            p_hr_id: ids.hr,
        })
        expect(message).toMatch(/already been decided/i)
    })

    it("rejects a leave without spending anything", async () => {
        await setBalances(ids.ordinary, { offset: 16 })
        const group = await makeLeaveGroup("offset_leaves", {
            employeeId: ids.ordinary,
            dates: ["2026-04-06"],
            hoursPerDay: 4,
        })
        cleanup.push(() => svc().from("offset_leaves").delete().eq("leave_group_id", group))

        await rpcAs(hr, "decide_offset_leave_decision", {
            p_group_id: group,
            p_status: "REJECTED",
            p_hr_notes: "Not this week",
            p_hr_id: ids.hr,
        })
        await expectOffsetBalance(ids.ordinary, 16)
    })

    it("refuses a status it does not understand", async () => {
        const group = await makeLeaveGroup("offset_leaves", {
            employeeId: ids.ordinary,
            dates: ["2026-04-13"],
            hoursPerDay: 4,
        })
        cleanup.push(() => svc().from("offset_leaves").delete().eq("leave_group_id", group))

        const message = await rpcExpectingFailure(hr, "decide_offset_leave_decision", {
            p_group_id: group,
            p_status: "CANCELLED",
            p_hr_notes: null,
            p_hr_id: ids.hr,
        })
        expect(message).toMatch(/unsupported/i)
    })
})

describe("approving Offset leave with edited hours (#328)", () => {
    it("spends the hours HR approved, spread across the days, and saves them", async () => {
        await setBalances(ids.ordinary, { offset: 20 })
        const group = await makeLeaveGroup("offset_leaves", {
            employeeId: ids.ordinary,
            dates: ["2026-05-04", "2026-05-05"],
            hoursPerDay: 4,
        })
        cleanup.push(() => svc().from("offset_leaves").delete().eq("leave_group_id", group))

        await rpcAs(hr, "decide_offset_leave_decision", {
            p_group_id: group,
            p_status: "APPROVED",
            p_approved_hours: 6,
            p_hr_notes: null,
            p_hr_id: ids.hr,
        })

        await expectOffsetBalance(ids.ordinary, 14)
        const { data } = await svc()
            .from("offset_leaves")
            .select("hours, approved_hours")
            .eq("leave_group_id", group)
        expect(data.map((r) => Number(r.approved_hours))).toEqual([3, 3])
        expect(data.map((r) => Number(r.hours))).toEqual([4, 4])

        // Undo refunds what was spent, not what was asked for.
        await rpcAs(hr, "undo_offset_leave_decision", { p_group_id: group, p_hr_id: ids.hr })
        await expectOffsetBalance(ids.ordinary, 20)
    })

    it("refuses more hours than were requested", async () => {
        await setBalances(ids.ordinary, { offset: 20 })
        const group = await makeLeaveGroup("offset_leaves", {
            employeeId: ids.ordinary,
            dates: ["2026-05-11"],
            hoursPerDay: 4,
        })
        cleanup.push(() => svc().from("offset_leaves").delete().eq("leave_group_id", group))

        const message = await rpcExpectingFailure(hr, "decide_offset_leave_decision", {
            p_group_id: group,
            p_status: "APPROVED",
            p_approved_hours: 5,
            p_hr_notes: null,
            p_hr_id: ids.hr,
        })
        expect(message).toMatch(/cannot exceed/i)
        await expectOffsetBalance(ids.ordinary, 20)
    })

    it("still refuses an applicant approving their own leave, even with hours", async () => {
        await setBalances(ids.ordinary, { offset: 16 })
        const group = await makeLeaveGroup("offset_leaves", {
            employeeId: ids.ordinary,
            dates: ["2026-05-18"],
            hoursPerDay: 4,
        })
        cleanup.push(async () => {
            await svc().from("offset_leaves").delete().eq("leave_group_id", group)
            await setBalances(ids.ordinary, { offset: 0 })
        })

        await rpcExpectingFailure("ordinary", "decide_offset_leave_decision", {
            p_group_id: group,
            p_status: "APPROVED",
            p_approved_hours: 2,
            p_hr_notes: null,
            p_hr_id: ids.ordinary,
        })
        await expectOffsetBalance(ids.ordinary, 16)
    })

    it("refuses while the department head has not approved, unless HR overrides", async () => {
        await setBalances(ids.ordinary, { offset: 16 })
        const group = await makeLeaveGroup("offset_leaves", {
            employeeId: ids.ordinary,
            dates: ["2026-05-25"],
            hoursPerDay: 4,
        })
        cleanup.push(() => svc().from("offset_leaves").delete().eq("leave_group_id", group))
        await svc().from("offset_leaves").update({ head_status: "PENDING" }).eq("leave_group_id", group)

        const message = await rpcExpectingFailure(hr, "decide_offset_leave_decision", {
            p_group_id: group,
            p_status: "APPROVED",
            p_approved_hours: 4,
            p_hr_notes: null,
            p_hr_id: ids.hr,
        })
        expect(message).toMatch(/department head has not approved/i)
        await expectOffsetBalance(ids.ordinary, 16)

        await svc().from("offset_leaves").update({ hr_override: true }).eq("leave_group_id", group)
        await rpcAs(hr, "decide_offset_leave_decision", {
            p_group_id: group,
            p_status: "APPROVED",
            p_approved_hours: 4,
            p_hr_notes: null,
            p_hr_id: ids.hr,
        })
        await expectOffsetBalance(ids.ordinary, 12)
    })
})

describe("undoing an Offset leave decision", () => {
    it("returns the exact hours the application had spent", async () => {
        await setBalances(ids.ordinary, { offset: 20 })
        const group = await makeLeaveGroup("offset_leaves", {
            employeeId: ids.ordinary,
            dates: ["2026-04-20", "2026-04-21"],
            hoursPerDay: 4.5,
        })
        cleanup.push(() => svc().from("offset_leaves").delete().eq("leave_group_id", group))

        await rpcAs(hr, "decide_offset_leave_decision", {
            p_group_id: group,
            p_status: "APPROVED",
            p_hr_notes: null,
            p_hr_id: ids.hr,
        })
        await expectOffsetBalance(ids.ordinary, 11)

        await rpcAs(hr, "undo_offset_leave_decision", { p_group_id: group, p_hr_id: ids.hr })
        await expectOffsetBalance(ids.ordinary, 20)
    })
})

// ===========================================================================

describe("SIL leave and the eligibility rule", () => {
    it("spends SIL hours when the employee is Regular", async () => {
        await setBalances(ids.ordinary, { sil: 16, status: "Regular" })
        const group = await makeLeaveGroup("sil_leaves", {
            employeeId: ids.ordinary,
            dates: ["2026-05-04", "2026-05-05"],
            hoursPerDay: 4,
        })
        cleanup.push(() => svc().from("sil_leaves").delete().eq("leave_group_id", group))

        await rpcAs(hr, "decide_sil_leave_decision", {
            p_group_id: group,
            p_status: "APPROVED",
            p_hr_notes: null,
            p_hr_id: ids.hr,
        })

        await expectSilBalance(ids.ordinary, 8)
    })

    it("refuses to approve SIL for an employee who is no longer Regular", async () => {
        await setBalances(ids.ordinary, { sil: 16, status: "Probationary" })
        const group = await makeLeaveGroup("sil_leaves", {
            employeeId: ids.ordinary,
            dates: ["2026-05-11"],
            hoursPerDay: 4,
        })
        cleanup.push(async () => {
            await svc().from("sil_leaves").delete().eq("leave_group_id", group)
            await setBalances(ids.ordinary, { sil: 0, status: "Regular" })
        })

        await rpcExpectingFailure(hr, "decide_sil_leave_decision", {
            p_group_id: group,
            p_status: "APPROVED",
            p_hr_notes: null,
            p_hr_id: ids.hr,
        })
        await expectSilBalance(ids.ordinary, 16)
    })

    it("withholds the refund when an approved SIL leave is undone after the employee stops being Regular", async () => {
        // The case the eligibility gate exists for: the hours were spent while
        // they were entitled to them, and undoing must not hand back credit
        // they are no longer eligible to hold. The function reports the
        // withholding rather than silently skipping it.
        await setBalances(ids.ordinary, { sil: 16, status: "Regular" })
        const group = await makeLeaveGroup("sil_leaves", {
            employeeId: ids.ordinary,
            dates: ["2026-05-18"],
            hoursPerDay: 8,
        })
        cleanup.push(async () => {
            await svc().from("sil_leaves").delete().eq("leave_group_id", group)
            await setBalances(ids.ordinary, { sil: 0, status: "Regular" })
        })

        await rpcAs(hr, "decide_sil_leave_decision", {
            p_group_id: group,
            p_status: "APPROVED",
            p_hr_notes: null,
            p_hr_id: ids.hr,
        })
        await expectSilBalance(ids.ordinary, 8)

        await setBalances(ids.ordinary, { sil: 8, status: "Resigned" })

        const result = await rpcAs(hr, "undo_sil_leave_decision", {
            p_group_id: group,
            p_hr_id: ids.hr,
        })

        expect(result.refund_withheld).toBe(true)
        expect(result.employment_status).toBe("Resigned")
        await expectSilBalance(ids.ordinary, 8)
    })

    it("pays the refund back when the employee is still Regular", async () => {
        await setBalances(ids.ordinary, { sil: 16, status: "Regular" })
        const group = await makeLeaveGroup("sil_leaves", {
            employeeId: ids.ordinary,
            dates: ["2026-05-25"],
            hoursPerDay: 8,
        })
        cleanup.push(async () => {
            await svc().from("sil_leaves").delete().eq("leave_group_id", group)
            await setBalances(ids.ordinary, { sil: 0, status: "Regular" })
        })

        await rpcAs(hr, "decide_sil_leave_decision", {
            p_group_id: group,
            p_status: "APPROVED",
            p_hr_notes: null,
            p_hr_id: ids.hr,
        })
        const result = await rpcAs(hr, "undo_sil_leave_decision", {
            p_group_id: group,
            p_hr_id: ids.hr,
        })

        expect(result.refund_withheld).toBe(false)
        await expectSilBalance(ids.ordinary, 16)
    })
})

// ===========================================================================

describe("the functions the decisions rely on", () => {
    it("all six exist with the argument lists the services call them by", async () => {
        // A renamed parameter is invisible to the rest of the suite, because
        // the stub map answers by function name alone.
        const { rows } = await sql().query(
            `select p.proname, pg_get_function_identity_arguments(p.oid) as args
               from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('decide_overtime_request','undo_overtime_decision',
                                  'decide_offset_leave_decision','undo_offset_leave_decision',
                                  'decide_sil_leave_decision','undo_sil_leave_decision')
              order by p.proname`,
        )
        expect(rows.map((r) => r.proname)).toEqual([
            "decide_offset_leave_decision",
            "decide_overtime_request",
            "decide_sil_leave_decision",
            "undo_offset_leave_decision",
            "undo_overtime_decision",
            "undo_sil_leave_decision",
        ])
        expect(rows.find((r) => r.proname === "decide_offset_leave_decision").args).toBe(
            "p_group_id uuid, p_status text, p_hr_notes text, p_hr_id uuid, p_approved_hours numeric",
        )
        expect(rows.find((r) => r.proname === "decide_overtime_request").args).toBe(
            "p_request_id uuid, p_status text, p_approved_hours numeric, p_hr_notes text, p_hr_id uuid",
        )
    })
})
