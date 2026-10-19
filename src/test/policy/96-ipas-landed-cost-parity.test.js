/**
 * One Landed Cost calculation (#283). The database's `_ipas_landed_cost` is the real one: the IPAS
 * page reads it through `ipas_landed_cost`, the Costing Matrix and the SOR summary through
 * `ipas_line_landed_costs`. The fake database answers with src/test/stubs/landedCostFake.js. This
 * runs #244's fixtures through both and holds them equal, so the fake can't drift from the truth.
 *
 * Also: `ipas_landed_cost` answers whoever may read the IPAS's payments (ipas_can_read) and gives
 * null to anyone else; `ipas_line_landed_costs` agrees with it line for line.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { purgeIpas } from "./support/ipas.js"
import { computeLandedCost } from "../stubs/landedCostFake.js"

const svc = () => serviceClient()
const RUN = Date.now() % 100000
let seq = 0
const made = []
let method, kind

const line = (id, quantity, price_unit, over = {}) => ({ line_id: id, name: `Item ${id}`, quantity, unit: "Unit", price_unit, brand: null, ...over })

async function makeIpas({ currency = "Php", lines, split = "value", status = "encoding", payments = [], charges = [], filed = false }) {
    seq += 1
    const po = `P96${RUN}${String(seq).padStart(2, "0")}`
    const copy = { po: { name: po, currency }, supplier: { id: 1, name: "Supplier" }, lines }
    const client = await sql().connect()
    try {
        await client.query("begin")
        await client.query("set local session_replication_role = replica")
        const { rows } = await client.query(
            `insert into public.ipas (po_number, priority, source, purpose, odoo_copy, created_by, landed_cost_split, computation_status, state)
             values ($1, 'high', 'local', 'supplies', $2, $3, $4, $5, $6) returning id`,
            [po, copy, ids.outsider, split, status, filed ? "filed" : "open"],
        )
        const id = rows[0].id
        for (const p of payments) {
            await client.query(
                `insert into public.ipas_payments (ipas_id, kind, paid_on, amount, php_debited, charge_fee_php, method_id, created_by)
                 values ($1, $2, current_date, $3, $4, $5, $6, $7)`,
                [id, p.kind, p.amount, p.php_debited ?? null, p.charge_fee_php ?? 0, method, ids.outsider],
            )
        }
        for (const amount of charges) {
            await client.query(`insert into public.ipas_charges (ipas_id, kind_id, charged_on, amount_php, created_by) values ($1, $2, current_date, $3, $4)`, [
                id,
                kind,
                amount,
                ids.outsider,
            ])
        }
        await client.query("commit")
        made.push(id)
        return { id, copy }
    } catch (error) {
        await client.query("rollback").catch(() => {})
        throw error
    } finally {
        client.release()
    }
}

const fromDb = async (id) => (await sql().query(`select public._ipas_landed_cost($1) as r`, [id])).rows[0].r

// Numbers to six places, so a float and an exact decimal of the same value compare equal.
const norm = (value) => {
    if (typeof value === "number") return Math.round(value * 1e6) / 1e6
    if (Array.isArray(value)) return value.map(norm)
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, norm(v)]))
    return value
}

beforeAll(async () => {
    await ensureCastLoaded()
    const option = async (list) => (await sql().query(`select id from public.ipas_options where list = $1 order by sort limit 1`, [list])).rows[0].id
    method = await option("payment_method")
    kind = await option("charge_kind")
})

afterAll(async () => {
    await purgeIpas(made)
})

const FIXTURES = {
    "P02552, a peso PO with no charges": { lines: [line(1, 6, 1250)] },
    "a peso PO spread by value": { lines: [line(1, 3, 1000), line(2, 1, 333.33), line(3, 7, 12.5)], charges: [1000, 2000], payments: [{ kind: "payment", amount: 500, charge_fee_php: 75 }] },
    "a peso PO spread by quantity": { split: "quantity", lines: [line(1, 3, 1000), line(2, 1, 333.33), line(3, 7, 12.5)], charges: [1000.01] },
    "a peso PO spread equally": { split: "equal", lines: [line(1, 3, 1000), line(2, 1, 333.33), line(3, 7, 12.5)], charges: [100] },
    "a peso PO with a shipping fee": { lines: [line(1, 2, 500)], payments: [{ kind: "shipping_fee", amount: 450 }] },
    "nothing priced falls back to equal": { lines: [line(1, 2, 0), line(2, 3, 0)], charges: [500] },
    "a line that buys nothing is skipped": { lines: [line(1, 0, 100), line(2, 2, 100)], charges: [10] },
    "no lines at all": { lines: [] },
    "a USD PO at the rate paid": {
        currency: "USD",
        lines: [line(1, 10, 20), line(2, 5, 40)],
        payments: [
            { kind: "down_payment", amount: 150, php_debited: 8400, charge_fee_php: 300 },
            { kind: "full_payment", amount: 250, php_debited: 14350, charge_fee_php: 200 },
        ],
        charges: [1000, 2000],
    },
    "a USD PO with no payment": { currency: "USD", lines: [line(1, 1, 100)] },
    "a USD shipping fee in PHP debited": { currency: "USD", lines: [line(1, 4, 25)], payments: [{ kind: "payment", amount: 100, php_debited: 5600 }, { kind: "shipping_fee", amount: 20, php_debited: 1150 }] },
    "final at LC Odoo Done": { status: "lc_odoo_done", lines: [line(1, 1, 10)] },
    "final when filed, whatever the status": { filed: true, lines: [line(1, 1, 10)] },
}

describe("the database and the fake give the same Landed Cost", () => {
    it.each(Object.entries(FIXTURES))("%s", async (_name, fixture) => {
        const { id, copy } = await makeIpas(fixture)
        const fake = computeLandedCost({
            copy,
            payments: (fixture.payments ?? []).map((p) => ({ php_debited: null, charge_fee_php: 0, ...p })),
            charges: (fixture.charges ?? []).map((amount_php) => ({ amount_php })),
            split: fixture.split ?? "value",
            computationStatus: fixture.status ?? "encoding",
            filed: Boolean(fixture.filed),
        })
        expect(norm(await fromDb(id))).toEqual(norm(fake))
    })
})

describe("who reads it", () => {
    let ipas
    beforeAll(async () => {
        await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
        ipas = await makeIpas({ lines: [line(7, 6, 1250), line(8, 1, 80)], charges: [700] })
    })
    afterAll(async () => {
        await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    })

    it("answers Purchasing through ipas_landed_cost, and nobody else", async () => {
        const purchasing = await (await clientFor("outsider")).rpc("ipas_landed_cost", { p_ipas_id: ipas.id })
        expect(purchasing.error).toBeNull()
        expect(purchasing.data.totals.landedPhp).toBe(8280)
        const plain = await (await clientFor("ordinary")).rpc("ipas_landed_cost", { p_ipas_id: ipas.id })
        expect(plain.data).toBeNull()
    })

    it("agrees line for line with ipas_line_landed_costs", async () => {
        const full = await fromDb(ipas.id)
        const { rows } = await sql().query(`select * from public.ipas_line_landed_costs($1)`, [ipas.id])
        expect(rows.map((r) => [r.odoo_line_id, Number(r.total_php), Number(r.unit_php), r.mark])).toEqual(
            full.lines.map((l) => [l.lineId, l.landedPhp, l.landedPerUnitPhp, full.status]),
        )
    })
})
