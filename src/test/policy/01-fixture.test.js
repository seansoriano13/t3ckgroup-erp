/**
 * The cast, asserted before anything leans on it.
 *
 * Numbered 01 because it runs first on purpose. Every other file in this tier
 * is meaningless if the identity link is broken: policies resolve the caller
 * through `get_employee_id()`, which matches the **email claim on the token**
 * against `employees.email`. Break that and the helper returns null, every
 * policy denies, and a matrix of refusals passes while proving nothing.
 */
import { describe, it, expect, beforeAll } from "vitest"
import {
    CAST,
    CAST_KEYS,
    ids,
    clientFor,
    castEmail,
    anonymousClient,
    ensureCastLoaded,
} from "./support/cast.js"
import { serviceClient } from "./support/stack.js"

describe("the seeded cast", () => {
    let employees

    beforeAll(async () => {
        await ensureCastLoaded()
        const { data, error } = await serviceClient()
            .from("employees")
            .select("*")
            .in(
                "id",
                CAST_KEYS.map((k) => ids[k]),
            )
        if (error) throw new Error(error.message)
        employees = Object.fromEntries(data.map((e) => [e.email, e]))
    })

    it("creates every one of the nineteen identities the matrix discriminates on", () => {
        // #295 (ADR 0021) added `stageParticipant` — called into a single
        // Stage's work with no Deal Team role and no Always-sees grant. #242
        // (IPAS) added `finance` (Finance access alone) and `ipasSigner` (a
        // plain employee a test puts on a sign-off list). #252 (Transmittals)
        // added `warehouse`, `technical`, `logistics` and a second `checkByTwo`,
        // all flag-free and put on their lists by the test that needs them.
        expect(CAST_KEYS).toHaveLength(19)
        for (const key of CAST_KEYS) {
            expect(employees[castEmail(key)], `missing employee row for ${key}`).toBeTruthy()
        }
    })

    it("gives every employee row an auth user with the same id and the same email", () => {
        for (const key of CAST_KEYS) {
            const row = employees[castEmail(key)]
            expect(row.id, `${key} employee id does not match its auth user`).toBe(ids[key])
            expect(row.email).toBe(castEmail(key))
        }
    })

    it.each(CAST_KEYS)("resolves %s's token back to their own employee record", async (key) => {
        // The load-bearing assertion of this whole tier. `get_employee_id()` is
        // what every policy calls; if it returns null here the rest of the run
        // is theatre.
        const client = await clientFor(key)
        const { data, error } = await client.rpc("get_employee_id")
        expect(error, `get_employee_id() failed for ${key}: ${error?.message}`).toBeNull()
        expect(data, `get_employee_id() did not resolve ${key}`).toBe(ids[key])
    })

    it("resolves nobody for a caller who is not signed in", async () => {
        const { data } = await anonymousClient().rpc("get_employee_id")
        expect(data).toBeNull()
    })

    it("grants each capability flag to exactly the identities that should hold it", () => {
        const holders = (flag) =>
            CAST_KEYS.filter((k) => employees[castEmail(k)][flag]).sort()

        expect(holders("is_super_admin")).toEqual(["superAdmin"])
        expect(holders("is_hr")).toEqual(["hr"])
        expect(holders("can_manage_leaves")).toEqual(["leaveManager"])
        expect(holders("is_head")).toEqual(["head", "subHead"])
        expect(holders("is_deleted")).toEqual(["deleted"])
        expect(holders("has_finance_flow")).toEqual(["finance"])
    })

    it("distinguishes a department head from a sub-department head", () => {
        // The unwritten rule reimplemented in several places: a head with no
        // sub_department owns the whole department, a sub-department head
        // shadows them for their own team.
        expect(employees[castEmail("head")].sub_department).toBeNull()
        expect(employees[castEmail("subHead")].sub_department).toBe("NGO")
        expect(employees[castEmail("head")].department).toBe(
            employees[castEmail("subHead")].department,
        )
    })

    it("puts one identity in a different department from the sales cast", () => {
        expect(employees[castEmail("outsider")].department).not.toBe(
            employees[castEmail("ordinary")].department,
        )
    })

    it("marks the soft-deleted employee deleted rather than removing them", () => {
        const row = employees[castEmail("deleted")]
        expect(row.is_deleted).toBe(true)
        expect(row.employment_status).not.toBe("Regular")
    })

    it("gives the leave manager the narrow capability without the broad HR flag", () => {
        // The reason `can_manage_leaves` exists at all: it is granted on its
        // own rather than by making somebody HR.
        const row = employees[castEmail("leaveManager")]
        expect(row.can_manage_leaves).toBe(true)
        expect(row.is_hr).toBe(false)
        expect(row.is_super_admin).toBe(false)
    })

    it("declares the same flags the cast definition promised", () => {
        for (const key of CAST_KEYS) {
            const spec = CAST[key]
            const row = employees[castEmail(key)]
            expect(row.is_head).toBe(spec.is_head ?? false)
            expect(row.is_hr).toBe(spec.is_hr ?? false)
            expect(row.is_super_admin).toBe(spec.is_super_admin ?? false)
            expect(row.can_manage_leaves).toBe(spec.can_manage_leaves ?? false)
            expect(row.has_sales_flow).toBe(spec.has_sales_flow ?? false)
            expect(row.has_finance_flow).toBe(spec.has_finance_flow ?? false)
        }
    })
})
