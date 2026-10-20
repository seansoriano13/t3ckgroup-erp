/**
 * Goods checked and Orders filed, the order-side Stage Conditions (#465, #466, spec #461, ADR 0033):
 * the kind CHECK and `order_condition_inputs(opportunity)`, the evidence both read.
 *
 * A Transmittal is per slip and an IPAS per Odoo PO, so neither mounts on a Stage; the condition
 * asks the database for counts instead. The mover may be unable to read either, so the answer is
 * read past RLS by anyone who can see the SOR at all and holds counts only.
 *
 * The cast:
 *   dealOwner   Deal Team of the SORs   -> reads the evidence
 *   outsider    Purchasing access       -> raises the IPAS
 *   warehouse / checkByOne / checkByTwo -> only name employees on the Closed slips
 *   ordinary    nobody to the SOR       -> refused
 *
 * Slips are seeded on the superuser connection (a Closed slip needs both Check by signatures, a
 * flow the Transmittal tests already prove); IPAS go through the real `ipas_create`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { FIXTURE_DOMAIN, ids, clientFor, anonymousClient, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { purgeIpas } from "./support/ipas.js"
import { purgeFixtureTransmittals } from "./support/transmittals.js"

const svc = () => serviceClient()

let saleTypeId, flowId, stageId
let sorA, sorB, sorQuiet
const sorIds = []
const ipasIds = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

const inputs = async (sorId, who = "dealOwner") =>
    (await clientFor(who)).rpc("order_condition_inputs", { p_opportunity_id: sorId })
const counts = async (sorId, who = "dealOwner") => {
    const { data, error } = await inputs(sorId, who)
    if (error) throw new Error(`order_condition_inputs: ${error.message}`)
    return data
}

let poSeq = 0
const nextPo = () => `P9${String(60000 + (poSeq += 1)).padStart(6, "0")}`

const copyFor = (po) => ({
    po: { id: 860000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: { id: 9_600_000 + poSeq, name: "Orders Filed Supplier", contact: null },
    lines: [
        { line_id: 880000 + poSeq * 10, product_id: 7400, name: "Rope", quantity: 4, unit: "Unit", price_unit: 900, price_subtotal: 3600, taxes: [], analytic: [], brand: null },
    ],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

/** An IPAS raised through the real `ipas_create`, as Purchasing, naming the given SORs. */
async function raise(sors, purpose = "project") {
    const po = nextPo()
    const { data, error } = await (await clientFor("outsider")).rpc("ipas_create", {
        p_po_number: po,
        p_priority: "high",
        p_source: "local",
        p_purpose: purpose,
        p_sor_ids: sors,
        p_remarks: null,
        p_odoo_copy: copyFor(po),
    })
    if (error) throw new Error(`ipas_create ${po}: ${error.message}`)
    ipasIds.push(data.id)
    return data.id
}

/** Files or cancels an IPAS the way the table's checks need, past the triggers that freeze it. */
async function setIpasState(id, state) {
    const client = await sql().connect()
    try {
        await client.query("begin")
        await client.query("set local session_replication_role = replica")
        await client.query(
            `update public.ipas
                set state = $2,
                    filed_at = case when $2 = 'filed' then now() else null end,
                    cancelled_at = case when $2 = 'cancelled' then now() else null end,
                    cancelled_by = case when $2 = 'cancelled' then $3::uuid else null end,
                    cancel_reason = case when $2 = 'cancelled' then 'policy test' else null end
              where id = $1`,
            [id, state, ids.outsider],
        )
        await client.query("commit")
    } catch (error) {
        await client.query("rollback").catch(() => {})
        throw error
    } finally {
        client.release()
    }
}

let slipSeq = 0
/**
 * A slip with one typed line per SOR named. The lines go in while it is still a draft (a submitted
 * slip's lines are frozen), then it is moved to `state`.
 */
async function slip(state, sors) {
    const { rows } = await sql().query(
        `insert into public.transmittals (number, origin, priority, entity, check_warehouse, state, prepared_by)
         values ($1, 'purchasing', 'high', 'T3ck Trading', true, 'draft', $2)
         returning id`,
        [`${MARKER}-TG-${(slipSeq += 1)}`, ids.warehouse],
    )
    const id = rows[0].id
    for (const [i, sor] of sors.entries()) {
        await sql().query(
            `insert into public.transmittal_lines (transmittal_id, position, kind, description, quantity, unit, opportunity_id)
             values ($1, $2, 'typed', 'Harness', 1, 'Unit', $3)`,
            [id, i + 1, sor],
        )
    }
    if (state !== "draft") await setSlipState(id, state)
    return id
}

/** Moves a slip to `state`, filling what the table's checks demand of that state. */
async function setSlipState(id, state) {
    const now = new Date().toISOString()
    const closed = state === "closed"
    const cancelled = state === "cancelled"
    await sql().query(
        `update public.transmittals
            set state = $2,
                submitted_at = $3,
                check_by_first_id = $4, check_by_first_at = $5,
                check_by_second_id = $6, check_by_second_at = $5,
                closed_at = $5,
                cancelled_at = $7, cancel_reason = $8
          where id = $1`,
        [
            id,
            state,
            now,
            closed ? ids.technical : null,
            closed ? now : null,
            closed ? ids.checkByTwo : null,
            cancelled ? now : null,
            cancelled ? "policy test" : null,
        ],
    )
}

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")

    saleTypeId = (await asSvc(svc().from("sale_types").insert({ name: `${MARKER} Orders` }).select("id").single(), "sale type")).id
    flowId = (await asSvc(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "flow")).id
    stageId = (await asSvc(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Orders Stage`, sort_order: 10 }).select("id").single(), "stage")).id

    for (const holder of [(id) => (sorA = id), (id) => (sorB = id), (id) => (sorQuiet = id)]) {
        const id = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageId })
        sorIds.push(id)
        holder(id)
    }
})

afterAll(async () => {
    await purgeIpas(ipasIds)
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    // A Transmittal is never deleted by the front door: triggers refuse it, and its lines, SOR links and
    // stages hang off it. The shared helper removes what the fixture employees prepared.
    await purgeFixtureTransmittals(`%@${FIXTURE_DOMAIN}`)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("stage_conditions").delete().eq("stage_id", stageId)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("the condition kinds", () => {
    it("are accepted by the kind CHECK, alongside every older kind", async () => {
        for (const kind of ["goods_checked", "orders_filed", "costing_priced", "costing_settled", "purchasing_settled", "attachment"]) {
            const { data, error } = await svc().from("stage_conditions").insert({ stage_id: stageId, kind, label: `${MARKER} ${kind}` }).select("id").single()
            expect(error, kind).toBeNull()
            await svc().from("stage_conditions").delete().eq("id", data.id)
        }
        const { error } = await svc().from("stage_conditions").insert({ stage_id: stageId, kind: "nonsense", label: MARKER })
        expect(error?.code).toBe("23514")
    })
})

describe("Goods checked: the Transmittals the SOR is named on", () => {
    it("is zero for an SOR no Transmittal names", async () => {
        expect((await counts(sorQuiet)).unclosed_slips).toBe(0)
    })

    it("counts a submitted slip until it is Closed, and not after", async () => {
        const id = await slip("warehouse_checking", [sorA])
        expect((await counts(sorA)).unclosed_slips).toBe(1)
        for (const state of ["warehouse_releasing", "technical_inspection", "awaiting_check"]) {
            await setSlipState(id, state)
            expect((await counts(sorA)).unclosed_slips, state).toBe(1)
        }
        await setSlipState(id, "closed")
        expect((await counts(sorA)).unclosed_slips).toBe(0)
    })

    it("ignores Drafts, Closed and Cancelled slips", async () => {
        await slip("draft", [sorQuiet])
        await slip("closed", [sorQuiet])
        await slip("cancelled", [sorQuiet])
        expect((await counts(sorQuiet)).unclosed_slips).toBe(0)
    })

    it("counts a slip with lines for two SORs against both, and releases both when it closes", async () => {
        const other = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
        sorIds.push(other)
        const before = (await counts(sorB)).unclosed_slips
        const id = await slip("technical_inspection", [other, sorB])
        expect((await counts(other)).unclosed_slips).toBe(1)
        expect((await counts(sorB)).unclosed_slips).toBe(before + 1)

        await setSlipState(id, "closed")
        expect((await counts(other)).unclosed_slips).toBe(0)
        expect((await counts(sorB)).unclosed_slips).toBe(before)
    })

    it("counts a slip once however many of its lines name the SOR", async () => {
        const other = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
        sorIds.push(other)
        await slip("awaiting_check", [other, other, other])
        expect((await counts(other)).unclosed_slips).toBe(1)
    })

    it("does not count a slip that names only another SOR", async () => {
        const other = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
        sorIds.push(other)
        const before = (await counts(sorQuiet)).unclosed_slips
        await slip("warehouse_checking", [other])
        expect((await counts(sorQuiet)).unclosed_slips).toBe(before)
    })
})

describe("Orders filed: the IPAS the SOR is named on", () => {
    let freshA, freshB

    beforeAll(async () => {
        freshA = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
        freshB = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
        sorIds.push(freshA, freshB)
    })

    it("is zero for an SOR no IPAS names", async () => {
        expect((await counts(sorQuiet)).unfiled_orders).toBe(0)
    })

    it("counts an open IPAS until it is filed, and not after", async () => {
        const id = await raise([sorA])
        expect((await counts(sorA)).unfiled_orders).toBe(1)
        await setIpasState(id, "filed")
        expect((await counts(sorA)).unfiled_orders).toBe(0)
    })

    it("ignores a cancelled IPAS", async () => {
        const id = await raise([sorQuiet])
        expect((await counts(sorQuiet)).unfiled_orders).toBe(1)
        await setIpasState(id, "cancelled")
        expect((await counts(sorQuiet)).unfiled_orders).toBe(0)
    })

    it("counts an IPAS naming several SORs for each, and releases each when it is filed", async () => {
        const id = await raise([freshA, freshB])
        expect((await counts(freshA)).unfiled_orders).toBe(1)
        expect((await counts(freshB)).unfiled_orders).toBe(1)
        await setIpasState(id, "filed")
        expect((await counts(freshA)).unfiled_orders).toBe(0)
        expect((await counts(freshB)).unfiled_orders).toBe(0)
    })

    it("does not count an IPAS that names only another SOR, nor an inventory IPAS naming none", async () => {
        const before = (await counts(freshA)).unfiled_orders
        await raise([freshB])
        await raise([], "inventory")
        expect((await counts(freshA)).unfiled_orders).toBe(before)
    })

    it("keeps Goods checked and Orders filed apart: an open slip leaves the IPAS count alone", async () => {
        const before = (await counts(freshA)).unfiled_orders
        await slip("warehouse_checking", [freshA])
        const after = await counts(freshA)
        expect(after.unfiled_orders).toBe(before)
        expect(after.unclosed_slips).toBeGreaterThan(0)
    })
})

describe("who may ask", () => {
    it("is refused to someone who can't see the SOR, and to a signed-out caller", async () => {
        const { error } = await inputs(sorA, "ordinary")
        expect(error?.code).toBe("42501")
        const anon = await anonymousClient().rpc("order_condition_inputs", { p_opportunity_id: sorA })
        expect(anon.error).toBeTruthy()
    })

    it("holds counts only", async () => {
        await slip("warehouse_checking", [sorA])
        const data = await counts(sorA)
        expect(Object.keys(data).sort()).toEqual(["unclosed_slips", "unfiled_orders"])
        expect(Number.isInteger(data.unclosed_slips)).toBe(true)
    })
})
