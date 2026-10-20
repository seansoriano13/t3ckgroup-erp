/**
 * Raising an IPAS: the server fetches the Odoo copy itself (#550, spec #544).
 *
 * The odoo-po-ipas edge function asks Odoo, then calls `ipas_raise_from_odoo`
 * (service role only) for the signed-in caller with its own verdict and copy.
 * Odoo is replaced by a fake here: the test passes the answer Odoo "gave"
 * (found with a copy, not found, no answer) exactly as the function would.
 * Prior art: 56-ipas-raise and 57-ipas-odoo-copy.
 *
 * `outsider` holds Purchasing access; `finance`, `ipasSigner`, `superAdmin` and
 * `ordinary` do not.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { FIXTURE_DOMAIN, ids, clientFor, anonymousClient, ensureCastLoaded, castEmail } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { purgeFixtureIpas, raiseIpas, recordOdooCopyAs } from "./support/ipas.js"

const svc = () => serviceClient()

let poSeq = 0
/** A PO number nothing else in the tier uses. */
const nextPo = () => `P9${String(60000 + (poSeq += 1)).padStart(6, "0")}`

/** What the fake Odoo answers for a PO it knows. */
const odooAnswer = (po) => ({
    po: { id: 660000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: { id: 553, name: "Real Supplier Inc.", contact: null },
    lines: [
        { line_id: 1, product_id: 10, name: "Real item", quantity: 3, unit: "Unit", price_unit: 100, price_subtotal: 300, taxes: [], analytic: [], brand: null },
    ],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

const args = (po, over = {}) => ({
    p_po_number: po,
    p_priority: "high",
    p_source: "local",
    p_purpose: "inventory",
    p_sor_ids: [],
    p_remarks: null,
    ...over,
})

/** The server's raise: the caller, what Odoo said. */
const serverRaise = (po, verdict, copy, who = ids.outsider) =>
    raiseIpas(who, args(po, { p_verdict: verdict, p_odoo_copy: copy }))

const rowsFor = async (po) => (await svc().from("ipas").select("*").eq("po_number", po)).data

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
})

describe("Odoo knows the PO", () => {
    it("raises the IPAS with Odoo's copy from the start, so the list shows real data", async () => {
        const po = nextPo()
        const { data, error } = await serverRaise(po, "found", odooAnswer(po))

        expect(error).toBeNull()
        expect(data).toMatchObject({ po_number: po, state: "open", created_by: ids.outsider })
        expect(data.odoo_fetched_at).toBeTruthy()

        // What the IPAS list reads, as the purchaser.
        const { data: listed } = await (await clientFor("outsider")).from("ipas").select("odoo_copy, odoo_fetched_at").eq("id", data.id).single()
        expect(listed.odoo_copy.supplier.name).toBe("Real Supplier Inc.")
        expect(listed.odoo_copy.lines).toHaveLength(1)
    })

    it("writes the created event for the caller the server named", async () => {
        const po = nextPo()
        const { data } = await serverRaise(po, "found", odooAnswer(po))
        const events = (await svc().from("ipas_events").select("kind, actor_id").eq("ipas_id", data.id)).data
        expect(events).toEqual([{ kind: "created", actor_id: ids.outsider }])
    })

    it("refuses a copy that is for a different PO", async () => {
        const po = nextPo()
        const { error } = await serverRaise(po, "found", odooAnswer(nextPo()))
        expect(error?.code).toBe("22023")
        expect(await rowsFor(po)).toEqual([])
    })

    it("still refuses a second live IPAS for the PO", async () => {
        const po = nextPo()
        await serverRaise(po, "found", odooAnswer(po))
        const { error } = await serverRaise(po, "found", odooAnswer(po))
        expect(error?.code).toBe("23505")
    })
})

describe("Odoo does not know the PO", () => {
    it("refuses, naming the PO, and writes nothing", async () => {
        const po = nextPo()
        const { data, error } = await serverRaise(po, "not_found", null)

        expect(data).toBeNull()
        expect(error?.code).toBe("22023")
        expect(error?.message).toContain(po)
        expect(error?.hint).toBe("odoo_not_found")
        expect(await rowsFor(po)).toEqual([])
    })

    it("does not accept a copy alongside the verdict", async () => {
        const po = nextPo()
        const { error } = await serverRaise(po, "not_found", odooAnswer(po))
        expect(error?.code).toBe("22023")
        expect(await rowsFor(po)).toEqual([])
    })
})

describe("Odoo does not answer", () => {
    it("refuses as could-not-check, never as not-found, and writes nothing", async () => {
        const po = nextPo()
        const { error } = await serverRaise(po, "unavailable", null)

        expect(error?.code).toBe("22023")
        expect(error?.hint).toBe("odoo_unavailable")
        expect(error?.hint).not.toBe("odoo_not_found")
        expect(await rowsFor(po)).toEqual([])
    })

    it("refuses a verdict it does not know", async () => {
        const po = nextPo()
        const { error } = await serverRaise(po, "maybe", odooAnswer(po))
        expect(error?.code).toBe("22023")
        expect(await rowsFor(po)).toEqual([])
    })
})

describe("who may raise", () => {
    it.each(["finance", "ipasSigner", "superAdmin", "ordinary"])("refuses %s even when Odoo knows the PO", async (who) => {
        const po = nextPo()
        const { error } = await serverRaise(po, "found", odooAnswer(po), ids[who])
        expect(error?.code, `${who} raised an IPAS`).toBe("42501")
        expect(await rowsFor(po)).toEqual([])
    })

    it("refuses a missing caller", async () => {
        const po = nextPo()
        const { error } = await serverRaise(po, "found", odooAnswer(po), null)
        expect(error?.code).toBe("42501")
    })
})

describe("a signed-in caller cannot send a copy", () => {
    it.each(["outsider", "finance", "superAdmin"])("refuses ipas_create from %s, with a forged copy or none", async (who) => {
        const client = await clientFor(who)
        for (const copy of [odooAnswer(nextPo()), null]) {
            const po = copy?.po.name ?? nextPo()
            const { data, error } = await client.rpc("ipas_create", { ...args(po), p_odoo_copy: copy })
            expect(data).toBeNull()
            expect(error?.code, `${who} raised with ${copy ? "a copy" : "none"}`).toBe("42501")
            expect(await rowsFor(po)).toEqual([])
        }
    })

    it("refuses the signed-out", async () => {
        const po = nextPo()
        const { error } = await anonymousClient().rpc("ipas_create", { ...args(po), p_odoo_copy: odooAnswer(po) })
        expect(error).not.toBeNull()
        expect(await rowsFor(po)).toEqual([])
    })

    it.each(["outsider", "superAdmin"])("keeps the server's raise out of reach of %s", async (who) => {
        const po = nextPo()
        const { data, error } = await (await clientFor(who)).rpc("ipas_raise_from_odoo", {
            ...args(po),
            p_actor: ids[who],
            p_verdict: "found",
            p_odoo_copy: odooAnswer(po),
        })
        expect(data).toBeNull()
        expect(error?.code).toBe("42501")
        expect(await rowsFor(po)).toEqual([])
    })

    it("keeps refresh-on-open working for the purchaser, through the server", async () => {
        const po = nextPo()
        const { data: ipas } = await serverRaise(po, "found", odooAnswer(po))
        const next = { ...ipas.odoo_copy, receipts: { status: "partial", done: 1, total: 2 } }
        const { data, error } = await recordOdooCopyAs("outsider", { p_ipas_id: ipas.id, p_odoo_copy: next })
        expect(error).toBeNull()
        expect(data.ipas.odoo_copy.receipts.done).toBe(1)
    })

    it("refuses a signed-in caller storing an Odoo copy, directly or through the server function", async () => {
        const po = nextPo()
        const { data: ipas } = await serverRaise(po, "found", odooAnswer(po))
        const forged = { ...ipas.odoo_copy, receipts: { status: "full", done: 9, total: 9 } }
        const client = await clientFor("outsider")

        const direct = await client.rpc("ipas_record_odoo_copy", { p_ipas_id: ipas.id, p_odoo_copy: forged })
        expect(direct.error?.code).toBe("42501")
        const viaServer = await client.rpc("ipas_refresh_from_odoo", {
            p_actor_email: castEmail("outsider"),
            p_ipas_id: ipas.id,
            p_odoo_copy: forged,
        })
        expect(viaServer.error?.code).toBe("42501")
        expect((await rowsFor(po))[0].odoo_copy.receipts.done).not.toBe(9)
    })

    it("still holds the server path to the reader rule", async () => {
        const po = nextPo()
        const { data: ipas } = await serverRaise(po, "found", odooAnswer(po))
        const refused = await recordOdooCopyAs("ordinary", { p_ipas_id: ipas.id, p_odoo_copy: ipas.odoo_copy })
        expect(refused.error?.code).toBe("42501")
    })
})
