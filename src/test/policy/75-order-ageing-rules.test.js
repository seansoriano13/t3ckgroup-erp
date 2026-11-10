/**
 * Order ageing rules (#262, spec #261): the database rules, against the real
 * stack. Read by any authenticated employee; written by Purchasing access and
 * Super Admins, as the IPAS option lists are. Never deleted.
 *
 * `outsider` gets Purchasing access here (as 74 does); `ordinary` and `finance`
 * hold no Purchasing flag; `superAdmin` is a Super Admin and on no list.
 * Every refusal is proven as the signed-in employee. The seeded rows are read
 * through the service role, which bypasses row level security and proves only
 * what is stored.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"

const svc = () => serviceClient()

// The shared helpers in support/access.js read back an `id`, and this table is
// keyed by `step`. Same contract: a refusal reports zero rows, not an error.
const RLS_VIOLATION = "42501"

async function tryInsert(client, table, row) {
    const { data, error } = await client.from(table).insert(row).select("step")
    if (error) return { ok: false, code: error.code, message: error.message }
    return { ok: true, affected: data.length }
}

async function tryUpdate(client, table, step, patch) {
    const { data, error } = await client.from(table).update(patch).eq("step", step).select("step")
    if (error) return { ok: false, affected: 0, code: error.code, message: error.message }
    return { ok: true, affected: data.length }
}

async function tryDelete(client, table, step) {
    const { data, error } = await client.from(table).delete().eq("step", step).select("step")
    if (error) return { ok: false, affected: 0, code: error.code, message: error.message }
    return { ok: true, affected: data.length }
}

const STEPS = [
    "purchase_order",
    "with_pop",
    "import_clearance",
    "delivered",
    "received_in_odoo",
    "create_bill",
    "actual_checking",
    "no_transmittal",
    "check_open",
    "section_3_approval",
    "ready_to_file",
]

const CHECK_VIOLATION = "23514"

async function storedDays(step) {
    const { data, error } = await svc().from("order_ageing_rules").select("days").eq("step", step).single()
    if (error) throw new Error(`reading ${step}: ${error.message}`)
    return data.days
}

async function clearAll() {
    const { error } = await svc().from("order_ageing_rules").update({ days: null }).in("step", STEPS)
    if (error) throw new Error(`clearing rules: ${error.message}`)
}

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
})

afterAll(async () => {
    await clearAll()
    const flag = await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
})

describe("order_ageing_rules: seeding", () => {
    it("is seeded with every step and no rule", async () => {
        const { data, error } = await svc().from("order_ageing_rules").select("step, days")
        if (error) throw error

        expect(data.map((row) => row.step).sort()).toEqual([...STEPS].sort())
        expect(data.every((row) => row.days === null)).toBe(true)
    })
})

describe("order_ageing_rules: reads", () => {
    it("lets a plain employee read every rule", async () => {
        const client = await clientFor("ordinary")
        const { data, error } = await client.from("order_ageing_rules").select("step, days")
        if (error) throw error

        expect(data).toHaveLength(STEPS.length)
    })

    it("lets a Finance officer read every rule", async () => {
        const client = await clientFor("finance")
        const { data, error } = await client.from("order_ageing_rules").select("step")
        if (error) throw error

        expect(data).toHaveLength(STEPS.length)
    })
})

describe("order_ageing_rules: writes", () => {
    it("lets Purchasing access set and clear a rule", async () => {
        const client = await clientFor("outsider")

        expect(await tryUpdate(client, "order_ageing_rules", "import_clearance", { days: 3 })).toEqual({ ok: true, affected: 1 })
        expect(await storedDays("import_clearance")).toBe(3)

        expect(await tryUpdate(client, "order_ageing_rules", "import_clearance", { days: null })).toEqual({ ok: true, affected: 1 })
        expect(await storedDays("import_clearance")).toBeNull()
    })

    it("lets a Super Admin set and clear a rule", async () => {
        const client = await clientFor("superAdmin")

        expect(await tryUpdate(client, "order_ageing_rules", "create_bill", { days: 7 })).toEqual({ ok: true, affected: 1 })
        expect(await storedDays("create_bill")).toBe(7)

        expect(await tryUpdate(client, "order_ageing_rules", "create_bill", { days: null })).toEqual({ ok: true, affected: 1 })
        expect(await storedDays("create_bill")).toBeNull()
    })

    it("refuses a Finance officer, who holds no Purchasing access", async () => {
        const client = await clientFor("finance")
        const result = await tryUpdate(client, "order_ageing_rules", "delivered", { days: 5 })

        expect(result.affected).toBe(0)
        expect(await storedDays("delivered")).toBeNull()
    })

    it("refuses a plain employee", async () => {
        const client = await clientFor("ordinary")
        const result = await tryUpdate(client, "order_ageing_rules", "delivered", { days: 5 })

        expect(result.affected).toBe(0)
        expect(await storedDays("delivered")).toBeNull()
    })

    it("refuses a plain employee inserting a rule", async () => {
        const client = await clientFor("ordinary")
        const result = await tryInsert(client, "order_ageing_rules", { step: "ready_to_file", days: 2 })

        expect(result).toMatchObject({ ok: false, code: RLS_VIOLATION })
    })

    it("refuses a deleted rule for everyone, Super Admins included", async () => {
        const client = await clientFor("superAdmin")
        const result = await tryDelete(client, "order_ageing_rules", "check_open")

        expect(result.ok).toBe(false)
        expect(await storedDays("check_open")).toBeNull()
    })
})

describe("order_ageing_rules: the database's own checks", () => {
    it("refuses an unknown step", async () => {
        const client = await clientFor("superAdmin")
        const result = await tryInsert(client, "order_ageing_rules", { step: "not_a_step", days: 3 })

        expect(result).toMatchObject({ ok: false, code: CHECK_VIOLATION })
    })

    it("refuses zero and negative days", async () => {
        const client = await clientFor("superAdmin")

        expect(await tryUpdate(client, "order_ageing_rules", "with_pop", { days: 0 })).toMatchObject({ ok: false, code: CHECK_VIOLATION })
        expect(await tryUpdate(client, "order_ageing_rules", "with_pop", { days: -4 })).toMatchObject({ ok: false, code: CHECK_VIOLATION })
        expect(await storedDays("with_pop")).toBeNull()
    })
})
