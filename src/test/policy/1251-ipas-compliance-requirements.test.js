/**
 * Compliance Requirements on the IPAS (#1251, spec #1247): the database rules.
 *
 * `outsider` holds Purchasing access and raises; `ipasSigner` is given Logistics access for the file;
 * `superAdmin` is a Super Admin with neither flag; `ordinary` and `finance` are nobody to this feature.
 *
 * Everything runs through the real `ipas_set_compliance`, `ipas_tick_compliance` and
 * `ipas_untick_compliance`. Filing is simulated by moving the state, as `ipas_sign` does on section 7.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { CAST_KEYS, FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { makeSor } from "./support/rows.js"
import { purgeFixtureIpas, raiseAsPurchaser } from "./support/ipas.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

let poSeq = 0

const manilaDay = (offsetDays = 0) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + offsetDays * 86_400_000))

const copyFor = (po) => ({
    po: { id: 1251000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: { id: 9_251_000 + poSeq, name: "Compliance Supplier", contact: null },
    lines: [{ line_id: 1251500 + poSeq * 10, product_id: 7720, name: "Item 1", quantity: 10, unit: "Unit", price_unit: 100, price_subtotal: 1000, taxes: [], analytic: [], brand: null }],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

async function raise(purpose = "inventory", sorIds = []) {
    const po = `P9${String(125100 + (poSeq += 1)).padStart(6, "0")}`
    const { data, error } = await raiseAsPurchaser({
        p_po_number: po,
        p_priority: "high",
        p_source: "local",
        p_purpose: purpose,
        p_sor_ids: sorIds,
        p_remarks: null,
        p_odoo_copy: copyFor(po),
    })
    if (error) throw new Error(`raise ${po}: ${error.message}`)
    return data
}

const kindId = async (label) =>
    (await svc().from("ipas_options").select("id").eq("list", "compliance_kind").eq("label", label).single()).data.id
const setCompliance = (who, ipasId, needed, kindIds = []) =>
    rpc(who, "ipas_set_compliance", { p_ipas_id: ipasId, p_needed: needed, p_kind_ids: kindIds })
const rowsOf = async (ipasId) =>
    (await svc().from("ipas_compliance_requirements").select("id, kind_id, done_on, note, done_by, kind:ipas_options!ipas_compliance_requirements_kind_id_fkey(label)").eq("ipas_id", ipasId)).data
const labelsOf = async (ipasId) => (await rowsOf(ipasId)).map((r) => r.kind.label).sort()
const events = async (ipasId) =>
    (await svc().from("ipas_events").select("*").eq("ipas_id", ipasId).like("kind", "compliance_%").order("created_at", { ascending: true })).data
const ipasRow = async (ipasId) => (await svc().from("ipas").select("*").eq("id", ipasId).single()).data
const requirementFor = async (ipasId, label) => (await rowsOf(ipasId)).find((r) => r.kind.label === label)

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
    const logistics = await svc().from("employees").update({ has_logistics_flow: true }).eq("id", ids.ipasSigner)
    if (logistics.error) throw logistics.error
})

afterAll(async () => {
    await svc().from("employees").update({ has_logistics_flow: false }).eq("id", ids.ipasSigner)
    await sql().query(`update public.ipas_options set active = true where list = 'compliance_kind'`)
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
    // Flagging Purchasing access adds the person to every existing purchase request; on a stack with real
    // data that would stop the next run's cast teardown.
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await sql().query(`delete from public.purchase_request_members where employee_id = $1`, [ids.outsider])
})

describe("the kinds", () => {
    it("are DENR, MARINA, OMB, NTC and FDA, in that order", async () => {
        const { data } = await svc().from("ipas_options").select("label, active").eq("list", "compliance_kind").order("sort")
        expect(data.map((o) => o.label)).toEqual(["DENR", "MARINA", "OMB", "NTC", "FDA"])
        expect(data.every((o) => o.active)).toBe(true)
    })

    it("follow the same edit rule as the other IPAS lists: Purchasing and a Super Admin add, nobody else", async () => {
        const stamp = Date.now()
        for (const who of ["outsider", "superAdmin"]) {
            const { error } = await (await clientFor(who)).from("ipas_options").insert({ list: "compliance_kind", label: `Test ${who} ${stamp}`, sort: 900 })
            expect(error, who).toBeNull()
        }
        for (const who of CAST_KEYS.filter((k) => !["outsider", "superAdmin"].includes(k))) {
            const { error } = await (await clientFor(who)).from("ipas_options").insert({ list: "compliance_kind", label: `Nope ${who} ${stamp}`, sort: 901 })
            expect(error, `${who} added a kind`).not.toBeNull()
        }
        await sql().query(`delete from public.ipas_options where list = 'compliance_kind' and (label like 'Test %' or label like 'Nope %')`)
    })
})

describe("who asks", () => {
    it("a new IPAS asks and starts unanswered", async () => {
        const ipas = await raise()
        const row = await ipasRow(ipas.id)
        expect(row.compliance_asked).toBe(true)
        expect(row.compliance_needed).toBeNull()
    })

    it("an IPAS that existed before the change never asks, and refuses an answer", async () => {
        const ipas = await raise()
        await sql().query(`update public.ipas set compliance_asked = false where id = $1`, [ipas.id])
        const { error } = await setCompliance("outsider", ipas.id, false)
        expect(error?.code).toBe("22023")
        expect(error.message).toMatch(/does not ask/)
        expect((await ipasRow(ipas.id)).compliance_needed).toBeNull()
    })
})

describe("who answers", () => {
    it("lets Purchasing, Logistics access and a Super Admin", async () => {
        for (const who of ["outsider", "ipasSigner", "superAdmin"]) {
            const ipas = await raise()
            const { error } = await setCompliance(who, ipas.id, false)
            expect(error, who).toBeNull()
            expect((await ipasRow(ipas.id)).compliance_needed).toBe(false)
        }
    })

    it("refuses everyone else, Finance alone included, for the answer, a tick and an untick", async () => {
        const ipas = await raise()
        await setCompliance("outsider", ipas.id, true, [await kindId("FDA")])
        const requirement = await requirementFor(ipas.id, "FDA")
        for (const who of CAST_KEYS.filter((k) => !["outsider", "ipasSigner", "superAdmin"].includes(k))) {
            const set = await setCompliance(who, ipas.id, false)
            expect(set.error?.code, `${who} answered`).toBe("42501")
            const tick = await rpc(who, "ipas_tick_compliance", { p_requirement_id: requirement.id, p_done_on: null, p_note: null })
            expect(tick.error?.code, `${who} ticked`).toBe("42501")
            const untick = await rpc(who, "ipas_untick_compliance", { p_requirement_id: requirement.id })
            expect(untick.error?.code, `${who} unticked`).toBe("42501")
        }
        expect((await ipasRow(ipas.id)).compliance_needed).toBe(true)
        expect((await requirementFor(ipas.id, "FDA")).done_on).toBeNull()
    })
})

describe("the answer and the kinds", () => {
    it("Yes with FDA and NTC lists both, and writes the answer and each kind in history", async () => {
        const ipas = await raise()
        const { error } = await setCompliance("outsider", ipas.id, true, [await kindId("FDA"), await kindId("NTC")])
        expect(error).toBeNull()
        const row = await ipasRow(ipas.id)
        expect(row.compliance_needed).toBe(true)
        expect(row.compliance_answered_by).toBe(ids.outsider)
        expect(row.compliance_answered_at).not.toBeNull()
        expect(await labelsOf(ipas.id)).toEqual(["FDA", "NTC"])
        const history = await events(ipas.id)
        expect(history.map((e) => e.kind).sort()).toEqual(["compliance_answered", "compliance_kind_added", "compliance_kind_added"])
        expect(history.find((e) => e.kind === "compliance_answered").detail).toMatchObject({ from: null, to: true })
        expect(history.filter((e) => e.kind === "compliance_kind_added").map((e) => e.detail.kind).sort()).toEqual(["FDA", "NTC"])
        expect(history.every((e) => e.actor_id === ids.outsider)).toBe(true)
    })

    it("refuses Yes with no kind, and writes nothing", async () => {
        const ipas = await raise()
        for (const kinds of [[], null]) {
            const { error } = await setCompliance("outsider", ipas.id, true, kinds)
            expect(error?.code).toBe("22023")
        }
        expect((await ipasRow(ipas.id)).compliance_needed).toBeNull()
        expect(await events(ipas.id)).toEqual([])
    })

    it("refuses a retired kind for a new pick, and something that is not a kind", async () => {
        const ipas = await raise()
        const omb = await kindId("OMB")
        await svc().from("ipas_options").update({ active: false }).eq("id", omb)
        try {
            const retired = await setCompliance("outsider", ipas.id, true, [omb])
            expect(retired.error?.code).toBe("22023")
        } finally {
            await svc().from("ipas_options").update({ active: true }).eq("id", omb)
        }
        const { data: other } = await svc().from("ipas_options").select("id").eq("list", "payment_method").limit(1)
        const wrong = await setCompliance("outsider", ipas.id, true, [other[0].id])
        expect(wrong.error?.code).toBe("22023")
        expect(await rowsOf(ipas.id)).toEqual([])
    })

    it("No removes the kinds, each removal and the answer in history", async () => {
        const ipas = await raise()
        await setCompliance("outsider", ipas.id, true, [await kindId("DENR"), await kindId("MARINA")])
        const { error } = await setCompliance("outsider", ipas.id, false)
        expect(error).toBeNull()
        expect((await ipasRow(ipas.id)).compliance_needed).toBe(false)
        expect(await rowsOf(ipas.id)).toEqual([])
        const history = await events(ipas.id)
        expect(history.filter((e) => e.kind === "compliance_kind_removed").map((e) => e.detail.kind).sort()).toEqual(["DENR", "MARINA"])
        expect(history.filter((e) => e.kind === "compliance_answered").map((e) => e.detail.to)).toEqual([true, false])
    })

    it("adds and removes single kinds, keeping a kept kind's tick, and writes nothing when nothing changes", async () => {
        const ipas = await raise()
        const fda = await kindId("FDA")
        const ntc = await kindId("NTC")
        const omb = await kindId("OMB")
        await setCompliance("outsider", ipas.id, true, [fda, ntc])
        await rpc("outsider", "ipas_tick_compliance", { p_requirement_id: (await requirementFor(ipas.id, "FDA")).id, p_done_on: null, p_note: "FDA-1" })

        await setCompliance("outsider", ipas.id, true, [fda, omb])
        expect(await labelsOf(ipas.id)).toEqual(["FDA", "OMB"])
        expect((await requirementFor(ipas.id, "FDA")).done_on).toBe(manilaDay())

        const before = (await events(ipas.id)).length
        await setCompliance("outsider", ipas.id, true, [fda, omb])
        expect((await events(ipas.id)).length).toBe(before)
        const kinds = (await events(ipas.id)).filter((e) => e.kind.startsWith("compliance_kind_")).map((e) => `${e.kind}:${e.detail.kind}`)
        expect(kinds.sort()).toEqual([
            "compliance_kind_added:FDA",
            "compliance_kind_added:NTC",
            "compliance_kind_added:OMB",
            "compliance_kind_removed:NTC",
        ])
    })

    it("lets a retired kind the IPAS already holds stay", async () => {
        const ipas = await raise()
        const denr = await kindId("DENR")
        const fda = await kindId("FDA")
        await setCompliance("outsider", ipas.id, true, [denr])
        await svc().from("ipas_options").update({ active: false }).eq("id", denr)
        try {
            const { error } = await setCompliance("outsider", ipas.id, true, [denr, fda])
            expect(error).toBeNull()
            expect(await labelsOf(ipas.id)).toEqual(["DENR", "FDA"])
        } finally {
            await svc().from("ipas_options").update({ active: true }).eq("id", denr)
        }
    })
})

describe("ticking", () => {
    it("records today by default, who did it and the note, and unticking clears them, each in history", async () => {
        const ipas = await raise()
        await setCompliance("outsider", ipas.id, true, [await kindId("FDA")])
        const requirement = await requirementFor(ipas.id, "FDA")

        const tick = await rpc("ipasSigner", "ipas_tick_compliance", { p_requirement_id: requirement.id, p_done_on: null, p_note: "  Permit 123  " })
        expect(tick.error).toBeNull()
        expect(tick.data).toMatchObject({ done_on: manilaDay(), note: "Permit 123", done_by: ids.ipasSigner })

        const untick = await rpc("outsider", "ipas_untick_compliance", { p_requirement_id: requirement.id })
        expect(untick.error).toBeNull()
        expect(untick.data).toMatchObject({ done_on: null, note: null, done_by: null })

        const history = (await events(ipas.id)).filter((e) => e.kind === "compliance_ticked" || e.kind === "compliance_unticked")
        expect(history.map((e) => e.kind)).toEqual(["compliance_ticked", "compliance_unticked"])
        expect(history[0].detail).toMatchObject({ kind: "FDA", done_on: manilaDay(), note: "Permit 123" })
    })

    it("accepts an earlier day, refuses tomorrow and a note over 500 characters, and a changed note is a new history row", async () => {
        const ipas = await raise()
        await setCompliance("outsider", ipas.id, true, [await kindId("NTC")])
        const requirement = await requirementFor(ipas.id, "NTC")

        const early = await rpc("outsider", "ipas_tick_compliance", { p_requirement_id: requirement.id, p_done_on: manilaDay(-7), p_note: null })
        expect(early.error).toBeNull()
        expect((await requirementFor(ipas.id, "NTC")).done_on).toBe(manilaDay(-7))

        const future = await rpc("outsider", "ipas_tick_compliance", { p_requirement_id: requirement.id, p_done_on: manilaDay(1), p_note: null })
        expect(future.error?.code).toBe("22023")
        const long = await rpc("outsider", "ipas_tick_compliance", { p_requirement_id: requirement.id, p_done_on: null, p_note: "x".repeat(501) })
        expect(long.error?.code).toBe("22023")
        expect((await requirementFor(ipas.id, "NTC")).done_on).toBe(manilaDay(-7))

        const before = (await events(ipas.id)).length
        await rpc("outsider", "ipas_tick_compliance", { p_requirement_id: requirement.id, p_done_on: manilaDay(-7), p_note: null })
        expect((await events(ipas.id)).length).toBe(before)
        await rpc("outsider", "ipas_tick_compliance", { p_requirement_id: requirement.id, p_done_on: manilaDay(-7), p_note: "Permit 9" })
        expect((await events(ipas.id)).length).toBe(before + 1)
    })
})

describe("a filed or cancelled IPAS", () => {
    it("refuses the answer, a tick and an untick once filed, and leaves the rows alone", async () => {
        const ipas = await raise()
        await setCompliance("outsider", ipas.id, true, [await kindId("FDA")])
        const requirement = await requirementFor(ipas.id, "FDA")
        await sql().query(`update public.ipas set state = 'filed', filed_at = now() where id = $1`, [ipas.id])

        for (const [name, args] of [
            ["ipas_set_compliance", { p_ipas_id: ipas.id, p_needed: false, p_kind_ids: [] }],
            ["ipas_tick_compliance", { p_requirement_id: requirement.id, p_done_on: null, p_note: null }],
            ["ipas_untick_compliance", { p_requirement_id: requirement.id }],
        ]) {
            const { error } = await rpc("outsider", name, args)
            expect(error?.code, name).toBe("22023")
            expect(error.message, name).toMatch(/filed/)
        }
        expect((await ipasRow(ipas.id)).compliance_needed).toBe(true)
        expect(await labelsOf(ipas.id)).toEqual(["FDA"])
    })

    it("refuses on a cancelled IPAS", async () => {
        const ipas = await raise()
        await setCompliance("outsider", ipas.id, true, [await kindId("FDA")])
        const requirement = await requirementFor(ipas.id, "FDA")
        await sql().query(`update public.ipas set state = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = 'test' where id = $1`, [ipas.id, ids.outsider])

        for (const [name, args] of [
            ["ipas_set_compliance", { p_ipas_id: ipas.id, p_needed: false, p_kind_ids: [] }],
            ["ipas_tick_compliance", { p_requirement_id: requirement.id, p_done_on: null, p_note: null }],
            ["ipas_untick_compliance", { p_requirement_id: requirement.id }],
        ]) {
            const { error } = await rpc("outsider", name, args)
            expect(error?.code, name).toBe("22023")
            expect(error.message, name).toMatch(/cancelled/)
        }
    })

    it("refuses the tick on an IPAS that does not ask", async () => {
        const ipas = await raise()
        await setCompliance("outsider", ipas.id, true, [await kindId("FDA")])
        const requirement = await requirementFor(ipas.id, "FDA")
        await sql().query(`update public.ipas set compliance_asked = false where id = $1`, [ipas.id])
        const { error } = await rpc("outsider", "ipas_tick_compliance", { p_requirement_id: requirement.id, p_done_on: null, p_note: null })
        expect(error?.code).toBe("22023")
        expect(error.message).toMatch(/does not ask/)
    })
})

describe("the requirements table", () => {
    it("is readable by whoever reads the IPAS and writable by nobody directly", async () => {
        const ipas = await raise()
        await setCompliance("outsider", ipas.id, true, [await kindId("FDA")])

        const read = await (await clientFor("outsider")).from("ipas_compliance_requirements").select("id").eq("ipas_id", ipas.id)
        expect(read.error).toBeNull()
        expect(read.data).toHaveLength(1)
        const hidden = await (await clientFor("ordinary")).from("ipas_compliance_requirements").select("id").eq("ipas_id", ipas.id)
        expect(hidden.data ?? []).toEqual([])

        const requirement = await requirementFor(ipas.id, "FDA")
        const client = await clientFor("outsider")
        expect((await client.from("ipas_compliance_requirements").insert({ ipas_id: ipas.id, kind_id: await kindId("OMB") })).error).not.toBeNull()
        const update = await client.from("ipas_compliance_requirements").update({ done_on: manilaDay() }).eq("id", requirement.id).select()
        expect(update.error !== null || (update.data ?? []).length === 0).toBe(true)
        expect((await client.from("ipas_compliance_requirements").delete().eq("id", requirement.id).select()).data ?? []).toEqual([])
        expect((await requirementFor(ipas.id, "FDA")).done_on).toBeNull()
    })
})

describe("the SOR's IPAS summary", () => {
    it("returns each kind with its done day and no note, and null on an IPAS that does not ask", async () => {
        const sor = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
        try {
            const asking = await raise("project", [sor])
            const silent = await raise("project", [sor])
            await setCompliance("outsider", asking.id, true, [await kindId("FDA"), await kindId("NTC")])
            await rpc("outsider", "ipas_tick_compliance", {
                p_requirement_id: (await requirementFor(asking.id, "FDA")).id,
                p_done_on: manilaDay(-2),
                p_note: "secret permit no",
            })
            await sql().query(`update public.ipas set compliance_asked = false where id = $1`, [silent.id])

            const { data, error } = await rpc("dealOwner", "ipas_summaries_for_sor", { p_opportunity_id: sor })
            expect(error).toBeNull()
            const asked = data.find((r) => r.ipas_id === asking.id)
            const quiet = data.find((r) => r.ipas_id === silent.id)
            expect(asked.compliance.needed).toBe(true)
            // In list order: NTC, then FDA.
            expect(asked.compliance.kinds.map((k) => [k.label, k.done_on])).toEqual([
                ["NTC", null],
                ["FDA", manilaDay(-2)],
            ])
            expect(JSON.stringify(asked.compliance)).not.toMatch(/secret permit/)
            expect(quiet.compliance).toBeNull()
        } finally {
            await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
            await svc().from("sales_opportunities").delete().eq("id", sor)
        }
    })
})
