/**
 * IPAS Status without Payment Approval and For Payment (#1221, spec #1220, ADR 0054 / 0055 amendments): the database rules.
 *
 * The migration moved every IPAS on either step to Order-Draft. That data move ran once, on the rows that existed
 * when it was applied; this harness builds the schema from empty, so there is nothing on the two steps to move.
 * What is proven here: the move function itself (run inside a transaction that is rolled back, with the status
 * check lifted so an IPAS can be put on a retired step), the Chat line it posts, the two steps refused afterwards,
 * kept step dates not breaking a reopen, and the two Ageing rules gone. These tests need the local stack (Docker).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser } from "./support/ipas.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

let poSeq = 0

const copyFor = (po) => ({
    po: { id: 1221000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: { id: 9_221_000 + poSeq, name: "Status Supplier", contact: null },
    lines: [{ line_id: 1221500 + poSeq * 10, product_id: 7710, name: "Item 1", quantity: 10, unit: "Unit", price_unit: 100, price_subtotal: 1000, taxes: [], analytic: [], brand: null }],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

async function raise() {
    const po = `P9${String(122100 + (poSeq += 1)).padStart(6, "0")}`
    const { data, error } = await raiseAsPurchaser({
        p_po_number: po,
        p_priority: "high",
        p_source: "import",
        p_purpose: "inventory",
        p_sor_ids: [],
        p_remarks: null,
        p_odoo_copy: copyFor(po),
    })
    if (error) throw new Error(`ipas_create ${po}: ${error.message}`)
    return data
}

const statusOf = async (ipasId) => (await svc().from("ipas").select("status").eq("id", ipasId).single()).data.status

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
})

afterAll(async () => {
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
})

// For Payment came back on 2026-11-27 (see ipas-status-for-payment-back.test.js); Payment Approval stays retired.
describe("Payment Approval is refused", () => {
    it.each(["payment_approval"])("refuses %s from ipas_set_status", async (step) => {
        const ipas = await raise()
        const refused = await rpc("outsider", "ipas_set_status", { p_ipas_id: ipas.id, p_step: step, p_reached_on: null })
        expect(refused.error?.code).toBe("22023")
        expect(await statusOf(ipas.id)).toBe("order_draft")
    })

    it.each(["payment_approval"])("refuses %s as a stored status", async (step) => {
        const ipas = await raise()
        await expect(sql().query(`update public.ipas set status = $2 where id = $1`, [ipas.id, step])).rejects.toMatchObject({ code: "23514" })
    })

    it("still names them in words, so an old Chat line or history entry reads well", async () => {
        const label = async (step) => (await svc().rpc("_ipas_status_label", { p_step: step })).data
        expect(await label("payment_approval")).toBe("Payment Approval")
        expect(await label("for_payment")).toBe("For Payment")
    })
})

describe("the move off the two steps", () => {
    it.each([
        ["payment_approval", "Payment Approval"],
        ["for_payment", "For Payment"],
    ])("moves an IPAS on %s to Order-Draft and posts the status line in its Chat", async (step, words) => {
        const ipas = await raise()
        const client = await sql().connect()
        try {
            await client.query("begin")
            // Lift the check so the IPAS can stand where it stood before the migration; rolled back below.
            await client.query(`alter table public.ipas drop constraint ipas_status_chk`)
            await client.query(`update public.ipas set status = $2 where id = $1`, [ipas.id, step])
            await client.query(`insert into public.ipas_status_steps (ipas_id, step, reached_on) values ($1, $2, '2026-11-01') on conflict do nothing`, [ipas.id, step])

            const moved = await client.query(`select public._ipas_status_drop_payment_steps($1) as moved`, [ipas.id])
            expect(moved.rows[0].moved).toBe(1)

            const after = await client.query(`select status from public.ipas where id = $1`, [ipas.id])
            expect(after.rows[0].status).toBe("order_draft")

            const lines = await client.query(
                `select content from public.ipas_messages where ipas_id = $1 and metadata ->> 'event' = 'status_changed' and metadata ->> 'from' = $2`,
                [ipas.id, step],
            )
            expect(lines.rows.map((r) => r.content)).toEqual([`Status set to Order-Draft (was ${words}).`])

            // The step date stays.
            const kept = await client.query(`select reached_on::text as reached_on from public.ipas_status_steps where ipas_id = $1 and step = $2`, [ipas.id, step])
            expect(kept.rows[0].reached_on).toBe("2026-11-01")
        } finally {
            await client.query("rollback")
            client.release()
        }
    })

    it("leaves an IPAS on a real step alone", async () => {
        const ipas = await raise()
        const moved = await sql().query(`select public._ipas_status_drop_payment_steps($1) as moved`, [ipas.id])
        expect(moved.rows[0].moved).toBe(0)
        expect(await statusOf(ipas.id)).toBe("order_draft")
    })
})

describe("step dates already stored are kept", () => {
    it("keeps a retired step row valid, and a reopen never lands on it", async () => {
        const ipas = await raise()
        await sql().query(`insert into public.ipas_status_steps (ipas_id, step, reached_on) values ($1, 'payment_approval', '2026-11-01')`, [ipas.id])
        await sql().query(`update public.ipas_status_steps set reached_on = '2026-11-02' where ipas_id = $1 and step = 'payment_approval'`, [ipas.id])

        await sql().query(`update public.ipas set state = 'filed', filed_at = now() where id = $1`, [ipas.id])
        expect(await statusOf(ipas.id)).toBe("done")

        const reopened = await rpc("superAdmin", "ipas_reopen", { p_ipas_id: ipas.id, p_reason: "Wrong bill" })
        expect(reopened.error).toBeNull()
        expect(await statusOf(ipas.id)).toBe("order_draft")
    })

    it("refuses a step row that was never a step", async () => {
        const ipas = await raise()
        await expect(
            sql().query(`insert into public.ipas_status_steps (ipas_id, step, reached_on) values ($1, 'made_up', '2026-11-01')`, [ipas.id]),
        ).rejects.toMatchObject({ code: "23514" })
    })
})

describe("Order Monitoring", () => {
    it("has no Ageing rule on Payment Approval, and refuses to add one", async () => {
        const rules = await svc().from("order_ageing_rules").select("step").in("step", ["payment_approval"])
        expect(rules.error).toBeNull()
        expect(rules.data).toEqual([])
        for (const step of ["payment_approval"]) {
            const refused = await svc().from("order_ageing_rules").insert({ step })
            expect(refused.error?.code).toBe("23514")
        }
    })
})
