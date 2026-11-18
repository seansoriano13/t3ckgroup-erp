/**
 * The Unit dropdown of a Purchasing Request is a list the business edits (request_units): the database rules.
 *
 *   everyone signed in reads it; the migration seeds the nine units that were in code
 *   Purchasing access and Super Admins add, rename, reorder and switch units off
 *   anyone else is refused (an update they are not allowed comes back with no rows)
 *   a unit is never deleted, by anyone through the API
 *   two units cannot share a name, ignoring case and spaces
 *   the last unit that is on cannot be switched off
 * `outsider` is given Purchasing access for the run; `ordinary` has none. Every row a test adds is removed again.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { tryDelete, tryInsert, tryUpdate, RLS_VIOLATION } from "./support/access.js"

const svc = () => serviceClient()
const NAME = `zz-test-${Date.now().toString(36)}`
const created = []

const SEED = ["unit", "pc", "set", "box", "roll", "meter", "kg", "pair", "lot"]

beforeAll(async () => {
    await ensureCastLoaded()
    const { error } = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (error) throw new Error(error.message)
})

afterAll(async () => {
    if (created.length) await svc().from("request_units").delete().in("id", created)
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
})

describe("request_units (the Unit dropdown of a Purchasing Request)", () => {
    it("starts with the nine units that were in code, readable by anyone signed in", async () => {
        const { data, error } = await (await clientFor("ordinary")).from("request_units").select("label, sort, active").order("sort")
        expect(error).toBeNull()
        const labels = data.map((u) => u.label)
        for (const unit of SEED) expect(labels).toContain(unit)
        expect(data.filter((u) => SEED.includes(u.label)).every((u) => u.active)).toBe(true)
    })

    it("lets Purchasing access add, rename and switch off a unit", async () => {
        const client = await clientFor("outsider")
        const added = await tryInsert(client, "request_units", { label: NAME, sort: 9990 })
        expect(added.ok).toBe(true)
        created.push(added.id)

        expect((await tryUpdate(client, "request_units", added.id, { label: `${NAME}-b` })).affected).toBe(1)
        expect((await tryUpdate(client, "request_units", added.id, { active: false })).affected).toBe(1)
    })

    it("lets a Super Admin add a unit", async () => {
        const added = await tryInsert(await clientFor("superAdmin"), "request_units", { label: `${NAME}-sa`, sort: 9991 })
        expect(added.ok).toBe(true)
        created.push(added.id)
    })

    it("refuses anyone else an add or a change", async () => {
        const client = await clientFor("ordinary")
        const refused = await tryInsert(client, "request_units", { label: `${NAME}-no`, sort: 9992 })
        expect(refused).toMatchObject({ ok: false, code: RLS_VIOLATION })

        const { data } = await svc().from("request_units").select("id").eq("label", "unit").single()
        expect((await tryUpdate(client, "request_units", data.id, { label: "changed" })).affected).toBe(0)
        const { data: after } = await svc().from("request_units").select("label").eq("id", data.id).single()
        expect(after.label).toBe("unit")
    })

    it("never lets anyone delete a unit through the API", async () => {
        const added = await tryInsert(await clientFor("outsider"), "request_units", { label: `${NAME}-del`, sort: 9993 })
        created.push(added.id)
        for (const who of ["outsider", "superAdmin", "ordinary"]) {
            const result = await tryDelete(await clientFor(who), "request_units", added.id)
            expect(result.affected).toBe(0)
        }
        const { data } = await svc().from("request_units").select("id").eq("id", added.id)
        expect(data).toHaveLength(1)
    })

    it("refuses a second unit with the same name, ignoring case and spaces", async () => {
        const client = await clientFor("outsider")
        const first = await tryInsert(client, "request_units", { label: `${NAME}-dup`, sort: 9994 })
        created.push(first.id)
        const second = await tryInsert(client, "request_units", { label: `  ${NAME.toUpperCase()}-DUP `, sort: 9995 })
        expect(second.ok).toBe(false)
        expect(second.code).toBe("23505")
    })

    it("refuses a blank name", async () => {
        const blank = await tryInsert(await clientFor("outsider"), "request_units", { label: "   ", sort: 9996 })
        expect(blank.ok).toBe(false)
    })

    it("keeps at least one unit on", async () => {
        const { data: on } = await svc().from("request_units").select("id, active").eq("active", true)
        const [keep, ...others] = on
        // Switch every other unit off, then the last one is refused.
        for (const unit of others) await svc().from("request_units").update({ active: false }).eq("id", unit.id)
        try {
            const result = await tryUpdate(await clientFor("outsider"), "request_units", keep.id, { active: false })
            expect(result.ok).toBe(false)
            expect(result.message).toMatch(/at least one unit must stay on/i)
        } finally {
            await svc().from("request_units").update({ active: true }).in("id", on.map((u) => u.id))
        }
    })
})
