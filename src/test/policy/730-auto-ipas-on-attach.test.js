/**
 * Attaching a P0 to a project line raises its IPAS (#730, spec #718).
 *
 * The odoo-po-verify edge function attaches the P0, reads the PO from Odoo itself and calls the
 * service-role-only `purchase_request_item_auto_ipas` for the signed-in buyer with its verdict and
 * copy. Odoo is faked here by passing the answer, as 105-ipas-raise-server-odoo does.
 *
 * `stageParticipant` is the Buyer (given Purchasing access here); `dealOwner` is on the sales side.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded, castEmail } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { purgeFixtureIpas } from "./support/ipas.js"

const svc = () => serviceClient()

let poSeq = 0
const nextPo = () => `P9${String(70000 + (poSeq += 1)).padStart(6, "0")}`

const odooAnswer = (po, currency = "PHP") => ({
    po: { id: 770000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency, origin: null, partner_ref: null },
    supplier: { id: 553, name: "Real Supplier Inc.", contact: null },
    lines: [{ line_id: 1, product_id: 10, name: "Real item", quantity: 3, unit: "Unit", price_unit: 100, price_subtotal: 300, taxes: [], analytic: [], brand: null }],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

let sorA, sorB, requestA, requestB, directRequest

async function insert(table, row) {
    const { data, error } = await svc().from(table).insert(row).select("id").single()
    if (error) throw new Error(`Seeding ${table}: ${error.message}`)
    return data.id
}

async function makeRequest(fields) {
    const id = await insert("purchase_requests", { created_by: ids.dealOwner, buyer_id: ids.stageParticipant, ...fields })
    for (const [employee, side] of [["dealOwner", "sales"], ["stageParticipant", "purchasing"]]) {
        await insert("purchase_request_members", { request_id: id, employee_id: ids[employee], side })
    }
    return id
}

/** A line with a verified P0 attached, as the attach leaves it. */
const lineWithP0 = (requestId, po, fields = {}) =>
    insert("purchase_request_items", {
        request_id: requestId,
        source: "new",
        name: `${MARKER} Harness`,
        unit: "pc",
        quantity: 2,
        status: "purchased",
        requested_by: ids.dealOwner,
        po_number: po,
        po_verification: "VERIFIED",
        ...fields,
    })

const autoIpas = (itemId, verdict, copy, who = "stageParticipant") =>
    svc().rpc("purchase_request_item_auto_ipas", {
        p_actor_email: castEmail(who),
        p_item_id: itemId,
        p_verdict: verdict,
        p_odoo_copy: copy,
    })

const ipasFor = async (po) => (await svc().from("ipas").select("*").eq("po_number", po)).data
const sorsOf = async (ipasId) => (await svc().from("ipas_sors").select("opportunity_id").eq("ipas_id", ipasId)).data.map((r) => r.opportunity_id)
const item = async (id) => (await svc().from("purchase_request_items").select("*").eq("id", id).single()).data

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.stageParticipant)
    if (flag.error) throw flag.error
    sorA = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    sorB = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    requestA = await makeRequest({ opportunity_id: sorA })
    requestB = await makeRequest({ opportunity_id: sorB })
    directRequest = await makeRequest({ title: `${MARKER} Direct request` })
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.stageParticipant)
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
    for (const id of [requestA, requestB, directRequest]) if (id) await svc().from("purchase_requests").delete().eq("id", id)
})

describe("a P0 with no live IPAS", () => {
    it("raises one IPAS with Source from currency, Project, Medium and this SOR", async () => {
        const po = nextPo()
        const line = await lineWithP0(requestA, po)
        const { data, error } = await autoIpas(line, "found", odooAnswer(po))

        expect(error).toBeNull()
        expect(data.result).toBe("created")
        const [ipas] = await ipasFor(po)
        expect(ipas).toMatchObject({ purpose: "project", priority: "medium", source: "local", state: "open", created_by: ids.stageParticipant })
        expect(await sorsOf(ipas.id)).toEqual([sorA])
        expect(await item(line)).toMatchObject({ ipas_pending: false, ipas_number: ipas.number })
    })

    it("takes Import for any currency other than PHP", async () => {
        const po = nextPo()
        const line = await lineWithP0(requestA, po)
        await autoIpas(line, "found", odooAnswer(po, "USD"))
        expect((await ipasFor(po))[0].source).toBe("import")
    })

    it("raises it once per P0, however many lines are attached", async () => {
        const po = nextPo()
        const one = await lineWithP0(requestA, po)
        const two = await lineWithP0(requestA, po)
        await autoIpas(one, "found", odooAnswer(po))
        const { data } = await autoIpas(two, "found", odooAnswer(po))

        expect(data.result).toBe("already_named")
        expect(await ipasFor(po)).toHaveLength(1)
    })
})

describe("a live IPAS for the P0", () => {
    it("gets this SOR added and records it in the history", async () => {
        const po = nextPo()
        await autoIpas(await lineWithP0(requestA, po), "found", odooAnswer(po))
        const { data } = await autoIpas(await lineWithP0(requestB, po), "found", odooAnswer(po))

        expect(data.result).toBe("sor_added")
        const [ipas] = await ipasFor(po)
        expect((await sorsOf(ipas.id)).sort()).toEqual([sorA, sorB].sort())
        const events = (await svc().from("ipas_events").select("kind, actor_id").eq("ipas_id", ipas.id).eq("kind", "sor_added")).data
        expect(events).toEqual([{ kind: "sor_added", actor_id: ids.stageParticipant }])
    })

    it("adds the SOR even when Odoo does not answer", async () => {
        const po = nextPo()
        await autoIpas(await lineWithP0(requestA, po), "found", odooAnswer(po))
        const { data } = await autoIpas(await lineWithP0(requestB, po), "unavailable", null)
        expect(data.result).toBe("sor_added")
    })

    it("still refuses to change the SORs by hand", async () => {
        const po = nextPo()
        await autoIpas(await lineWithP0(requestA, po), "found", odooAnswer(po))
        const [ipas] = await ipasFor(po)
        const { error } = await (await clientFor("stageParticipant")).rpc("ipas_set_purpose_and_sors", {
            p_ipas_id: ipas.id,
            p_purpose: "project",
            p_sor_ids: [sorA, sorB],
        })
        expect(error?.code).toBe("22023")
    })
})

describe("a filed IPAS", () => {
    it("is left untouched and the answer says so", async () => {
        const po = nextPo()
        await autoIpas(await lineWithP0(requestA, po), "found", odooAnswer(po))
        const [ipas] = await ipasFor(po)
        await sql().query(`update public.ipas set state = 'filed', filed_at = now() where id = $1`, [ipas.id])

        const line = await lineWithP0(requestB, po)
        const { data, error } = await autoIpas(line, "found", odooAnswer(po))

        expect(error).toBeNull()
        expect(data.result).toBe("filed")
        expect(data.message).toContain("filed")
        expect(await sorsOf(ipas.id)).toEqual([sorA])
        expect(await ipasFor(po)).toHaveLength(1)
        expect(await item(line)).toMatchObject({ ipas_pending: false })
    })
})

describe("Odoo does not answer", () => {
    it("leaves the P0 attached, flags the line, and a retry raises the IPAS", async () => {
        const po = nextPo()
        const line = await lineWithP0(requestA, po)
        const down = await autoIpas(line, "unavailable", null)

        expect(down.error).toBeNull()
        expect(down.data.result).toBe("unavailable")
        expect(await ipasFor(po)).toEqual([])
        expect(await item(line)).toMatchObject({ ipas_pending: true, po_number: po, po_verification: "VERIFIED" })

        const retry = await autoIpas(line, "found", odooAnswer(po))
        expect(retry.data.result).toBe("created")
        expect(await item(line)).toMatchObject({ ipas_pending: false })
        expect(await ipasFor(po)).toHaveLength(1)
    })

    it("does not raise an IPAS for a PO Odoo has never heard of", async () => {
        const po = nextPo()
        const line = await lineWithP0(requestA, po)
        const { data } = await autoIpas(line, "not_found", null)
        expect(data.result).toBe("not_found")
        expect(await ipasFor(po)).toEqual([])
    })
})

describe("what is not automatic", () => {
    it("does nothing for a Direct request, which has no SOR", async () => {
        const po = nextPo()
        const { data } = await autoIpas(await lineWithP0(directRequest, po), "found", odooAnswer(po))
        expect(data.result).toBe("not_project")
        expect(await ipasFor(po)).toEqual([])
    })

    it("does not add an SOR to an IPAS raised by hand for Inventory", async () => {
        const po = nextPo()
        await svc().rpc("ipas_raise_from_odoo", {
            p_actor: ids.stageParticipant,
            p_po_number: po,
            p_priority: "high",
            p_source: "local",
            p_purpose: "inventory",
            p_sor_ids: [],
            p_remarks: null,
            p_verdict: "found",
            p_odoo_copy: odooAnswer(po),
        })
        const { data } = await autoIpas(await lineWithP0(requestA, po), "found", odooAnswer(po))
        expect(data.result).toBe("not_project")
        expect(await sorsOf((await ipasFor(po))[0].id)).toEqual([])
    })

    it("needs a verified P0 on the line", async () => {
        const po = nextPo()
        const line = await lineWithP0(requestA, po, { po_verification: "UNVERIFIED" })
        const { error } = await autoIpas(line, "found", odooAnswer(po))
        expect(error?.code).toBe("22023")
        expect(await ipasFor(po)).toEqual([])
    })
})

describe("who can call it", () => {
    it("refuses someone without Purchasing access", async () => {
        const po = nextPo()
        const line = await lineWithP0(requestA, po)
        const { error } = await autoIpas(line, "found", odooAnswer(po), "ordinary")
        expect(error?.code).toBe("42501")
        expect(await ipasFor(po)).toEqual([])
    })

    it.each(["stageParticipant", "superAdmin"])("keeps it out of reach of a signed-in %s", async (who) => {
        const po = nextPo()
        const line = await lineWithP0(requestA, po)
        const { error } = await (await clientFor(who)).rpc("purchase_request_item_auto_ipas", {
            p_actor_email: castEmail(who),
            p_item_id: line,
            p_verdict: "found",
            p_odoo_copy: odooAnswer(po),
        })
        expect(error?.code).toBe("42501")
        expect(await ipasFor(po)).toEqual([])
    })
})
