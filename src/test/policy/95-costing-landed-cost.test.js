/**
 * Landed Cost flows back to the Costing Matrix (#283, map #210).
 *
 *   ipas_line_landed_costs     per PO line, #218's maths (internal: read here as the superuser)
 *   costing_landed_costs       per Component: picked lines' Landed Cost, shared lines split by
 *                              quantity, blank never partial, provisional until every IPAS is final;
 *                              cost tiers only (closed_book, cost: #546)
 *   costing_component_purchases  PO numbers and IPAS per Component, no money, every tier
 *   delete guards               linked Components and their Tender Lines refuse deletion until unlinked
 *   ipas_summaries_for_sor     Landed Cost for cost readers (#546), null for everyone else
 *
 * The cast, on SOR A (dealOwner's): dealOwner (Deal Team), outsider (Purchasing access),
 * ipasSigner (final_acquire list) read cost; dealOwner (price tier, #546), technical (open Stage Participant window) and
 * ordinary don't. SOR B (closingSales') shares a PO line with SOR A.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { purgeCostingForSors } from "./support/costing.js"
import { purgeIpas } from "./support/ipas.js"

const svc = () => serviceClient()
const RUN = Date.now() % 100000

let saleTypeId, flowId, stageId
let sorA, sorB, requestA, requestB
let lineA1, lineA2, linkedLine
const c = {}
const ipas = {}
const items = {}
const sorIds = []
const ipasIds = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

const TAGS = { PHP: 1, USD: 2, SHR: 3, CHK: 4, NOPAY: 5 }
const po = (tag) => `P95${RUN}${TAGS[tag]}`
const copy = (name, currency, lines) => ({
    po: { id: 1, name, state: "purchase", currency },
    supplier: { id: 1, name: "Supplier" },
    lines: lines.map(([line_id, quantity, price_unit]) => ({ line_id, name: `Line ${line_id}`, quantity, price_unit, unit: "Unit" })),
})

async function makeIpas(tag, currency, lines, { split = "value", status = "encoding", sors = [] } = {}) {
    const client = await sql().connect()
    try {
        await client.query("begin")
        const { rows } = await client.query(
            `insert into public.ipas (po_number, priority, source, purpose, odoo_copy, created_by, landed_cost_split, computation_status)
             values ($1, 'high', $2, $3, $4, $5, $6, $7) returning id`,
            [po(tag), currency === "Php" ? "local" : "import", sors.length ? "project" : "supplies", copy(po(tag), currency, lines), ids.outsider, split, status],
        )
        for (const sor of sors) await client.query(`insert into public.ipas_sors (ipas_id, opportunity_id) values ($1, $2)`, [rows[0].id, sor])
        await client.query("commit")
        ipasIds.push(rows[0].id)
        return rows[0].id
    } catch (error) {
        await client.query("rollback").catch(() => {})
        throw error
    } finally {
        client.release()
    }
}

const exec = async (text, params = []) => (await sql().query(text, params)).rows

const lineCosts = async (ipasId) =>
    (await exec(`select * from public.ipas_line_landed_costs($1)`, [ipasId])).map((r) => ({
        line: r.odoo_line_id,
        unit: r.unit_php === null ? null : Number(r.unit_php),
        total: r.total_php === null ? null : Number(r.total_php),
        mark: r.mark,
    }))

async function makeComponent(lineId, position, name, quantity, extra = {}) {
    return (
        await asSvc(svc().from("costing_components").insert({ tender_line_id: lineId, position, name, quantity, ...extra }).select("id").single(), name)
    ).id
}

async function addItem(request, componentId, { quantity, tag, lines, status = "ordered" }) {
    return (
        await asSvc(
            svc()
                .from("purchase_request_items")
                .insert({
                    request_id: request,
                    source: "component",
                    component_id: componentId,
                    name: "Item",
                    quantity,
                    status,
                    po_number: tag ? po(tag) : null,
                    odoo_po_line_ids: lines ?? [],
                    requested_by: ids.dealOwner,
                })
                .select("id")
                .single(),
            "item",
        )
    ).id
}

const landed = async (who, sor = sorA) => {
    const { data, error } = await (await clientFor(who)).rpc("costing_landed_costs", { p_opportunity_id: sor })
    if (error) throw new Error(`costing_landed_costs: ${error.message}`)
    return new Map((data ?? []).map((r) => [r.component_id, { ...r, total_php: r.total_php === null ? null : Number(r.total_php), unit_php: r.unit_php === null ? null : Number(r.unit_php) }]))
}

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")

    saleTypeId = (await asSvc(svc().from("sale_types").insert({ name: `${MARKER} Landed Cost` }).select("id").single(), "sale type")).id
    flowId = (await asSvc(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "flow")).id
    stageId = (await asSvc(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} LC Stage`, sort_order: 10 }).select("id").single(), "stage")).id

    sorA = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageId })
    sorB = await makeSor({ registeredBy: ids.closingSales, dealOwnerId: ids.closingSales })
    sorIds.push(sorA, sorB)

    const visit = await asSvc(svc().from("sor_stage_visits").select("id").eq("opportunity_id", sorA).single(), "visit")
    await asSvc(
        svc().from("sor_stage_participants").insert({ opportunity_id: sorA, employee_id: ids.technical, source: "action", opened_visit_id: visit.id, until_rule: "stage_left" }),
        "participant",
    )
    await asSvc(svc().from("costing_signer_lists").insert({ list_key: "final_acquire", employee_id: ids.ipasSigner }), "signer list")

    const matrixA = (await svc().rpc("costing_open_matrix", { p_opportunity_id: sorA })).data
    const matrixB = (await svc().rpc("costing_open_matrix", { p_opportunity_id: sorB })).data
    const makeLine = async (matrixId, position) =>
        (await asSvc(svc().from("costing_tender_lines").insert({ matrix_id: matrixId, position, tender_specification: `Line ${position}`, quantity: 1 }).select("id").single(), "line")).id
    lineA1 = await makeLine(matrixA, 1)
    lineA2 = await makeLine(matrixA, 2)
    linkedLine = await makeLine(matrixA, 3)
    const lineB = await makeLine(matrixB, 1)

    c.hose = await makeComponent(lineA1, 1, "Hose", 6)
    c.bundle = await makeComponent(lineA1, 2, "Bundle", 1)
    c.sharedA = await makeComponent(lineA1, 3, "Shared A", 2)
    c.multi = await makeComponent(lineA2, 1, "Multi", 2)
    c.notPicked = await makeComponent(lineA2, 2, "Not picked", 1)
    c.removed = await makeComponent(lineA2, 3, "Removed", 1)
    c.unavailable = await makeComponent(lineA2, 4, "Unavailable", 1)
    c.notOrdered = await makeComponent(lineA2, 5, "Not ordered", 5)
    c.typedPo = await makeComponent(linkedLine, 1, "Typed PO", 1, { po_rfq_no: "P02574" })
    c.sharedB = await makeComponent(lineB, 1, "Shared B", 3)

    // P02552's shape: 6 x 1,250 PHP, no charges.
    ipas.php = await makeIpas("PHP", "Php", [[11, 6, 1250], [12, 1, 80]], { sors: [sorA] })
    // USD, two payments at combined 28,200 / 500 = 56.4, a 1,000 charge, by value.
    ipas.usd = await makeIpas("USD", "USD", [[21, 2, 100], [22, 3, 100]], { status: "lc_odoo_done" })
    const option = async (list) => (await exec(`select id from public.ipas_options where list = $1 order by sort limit 1`, [list]))[0].id
    const method = await option("payment_method")
    await exec(
        `insert into public.ipas_payments (ipas_id, kind, paid_on, amount, php_debited, method_id, created_by)
         values ($1, 'down_payment', current_date, 300, 16800, $2, $3), ($1, 'payment', current_date, 200, 11400, $2, $3)`,
        [ipas.usd, method, ids.outsider],
    )
    const kind = await option("charge_kind")
    await exec(`insert into public.ipas_charges (ipas_id, kind_id, charged_on, amount_php, created_by) values ($1, $2, current_date, 1000, $3)`, [ipas.usd, kind, ids.outsider])
    ipas.shared = await makeIpas("SHR", "Php", [[31, 5, 100]])
    ipas.checked = await makeIpas("CHK", "Php", [[41, 1, 300]], { status: "checked" })
    ipas.noPay = await makeIpas("NOPAY", "USD", [[51, 1, 100]])

    requestA = (await asSvc(svc().from("purchase_requests").insert({ opportunity_id: sorA, created_by: ids.dealOwner }).select("id").single(), "request A")).id
    requestB = (await asSvc(svc().from("purchase_requests").insert({ opportunity_id: sorB, created_by: ids.closingSales }).select("id").single(), "request B")).id

    items.hose = await addItem(requestA, c.hose, { quantity: 6, tag: "PHP", lines: [11] })
    items.bundle = await addItem(requestA, c.bundle, { quantity: 1, tag: "USD", lines: [21, 22] })
    items.sharedA = await addItem(requestA, c.sharedA, { quantity: 2, tag: "SHR", lines: [31] })
    items.sharedB = await addItem(requestB, c.sharedB, { quantity: 3, tag: "SHR", lines: [31] })
    items.multi1 = await addItem(requestA, c.multi, { quantity: 1, tag: "PHP", lines: [12] })
    items.multi2 = await addItem(requestA, c.multi, { quantity: 1, tag: "CHK", lines: [41] })
    items.notPicked = await addItem(requestA, c.notPicked, { quantity: 1, tag: "PHP", lines: [] })
    items.removed = await addItem(requestA, c.removed, { quantity: 1, tag: "PHP", lines: [999] })
    items.unavailable = await addItem(requestA, c.unavailable, { quantity: 1, tag: "NOPAY", lines: [51] })
    items.notOrdered = await addItem(requestA, c.notOrdered, { quantity: 3, status: "requested" })
})

afterAll(async () => {
    for (const request of [requestA, requestB].filter(Boolean)) {
        await svc().from("purchase_request_messages").delete().eq("request_id", request)
        await svc().from("purchase_request_items").delete().eq("request_id", request)
        await svc().from("purchase_requests").delete().eq("id", request)
    }
    await purgeIpas(ipasIds)
    await svc().from("costing_signer_lists").delete().eq("employee_id", ids.ipasSigner)
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeCostingForSors(sorIds)
    await svc().from("sor_stage_participants").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("ipas_line_landed_costs", () => {
    it("P02552: 6 x 1,250 PHP gives 1,250 a unit before charges", async () => {
        expect(await lineCosts(ipas.php)).toEqual([
            { line: 11, unit: 1250, total: 7500, mark: "provisional" },
            { line: 12, unit: 80, total: 80, mark: "provisional" },
        ])
    })

    it("converts a USD PO at combined PHP / combined USD and spreads the charge by value", async () => {
        // 2 x 100 x 56.4 = 11,280 and 16,920; the 1,000 charge spreads 40:60.
        expect(await lineCosts(ipas.usd)).toEqual([
            { line: 21, unit: 5840, total: 11680, mark: "final" },
            { line: 22, unit: 5840, total: 17520, mark: "final" },
        ])
    })

    it("spreads by quantity and equally as asked", async () => {
        await exec(`update public.ipas set landed_cost_split = 'equal' where id = $1`, [ipas.usd])
        expect((await lineCosts(ipas.usd)).map((l) => l.total)).toEqual([11780, 17420])
        await exec(`update public.ipas set landed_cost_split = 'quantity' where id = $1`, [ipas.usd])
        expect((await lineCosts(ipas.usd)).map((l) => l.total)).toEqual([11680, 17520])
        await exec(`update public.ipas set landed_cost_split = 'value' where id = $1`, [ipas.usd])
    })

    it("is unavailable on a foreign PO with no payment", async () => {
        expect(await lineCosts(ipas.noPay)).toEqual([{ line: 51, unit: null, total: null, mark: "unavailable" }])
    })

    it("is not callable by a client", async () => {
        const { error } = await (await clientFor("outsider")).rpc("ipas_line_landed_costs", { p_ipas_id: ipas.php })
        expect(error).not.toBeNull()
    })
})

describe("costing_landed_costs: the sums", () => {
    it("gives a sole claimant the whole line, and sums a bundle's several lines", async () => {
        const rows = await landed("outsider")
        expect(rows.get(c.hose)).toMatchObject({ total_php: 7500, unit_php: 1250, mark: "provisional", blank_reason: null })
        expect(rows.get(c.bundle)).toMatchObject({ total_php: 29200, unit_php: 29200, mark: "final" })
    })

    it("splits a line two SORs share by the quantity each claims, 2:3", async () => {
        expect((await landed("outsider")).get(c.sharedA)).toMatchObject({ total_php: 200, unit_php: 100 })
        expect((await landed("superAdmin", sorB)).get(c.sharedB)).toMatchObject({ total_php: 300, unit_php: 100 })
    })

    it("gives a cancelled item's share back", async () => {
        await asSvc(svc().from("purchase_request_items").update({ status: "cancelled" }).eq("id", items.sharedB), "cancel")
        expect((await landed("outsider")).get(c.sharedA)).toMatchObject({ total_php: 500 })
        expect((await landed("superAdmin", sorB)).get(c.sharedB)).toMatchObject({ blank_reason: "not_ordered", total_php: null })
        await asSvc(svc().from("purchase_request_items").update({ status: "ordered" }).eq("id", items.sharedB), "restore")
    })

    it("says why a Component is blank, never a partial figure", async () => {
        const rows = await landed("outsider")
        expect(rows.get(c.notPicked)).toMatchObject({ blank_reason: "po_line_not_picked", total_php: null, mark: null })
        expect(rows.get(c.removed)).toMatchObject({ blank_reason: "line_removed", total_php: null })
        expect(rows.get(c.unavailable)).toMatchObject({ blank_reason: "landed_cost_unavailable", total_php: null })
        expect(rows.get(c.notOrdered)).toMatchObject({ blank_reason: "not_ordered", total_php: null, ordered_quantity: 0 })
    })

    it("is provisional while any IPAS it draws from is, final once all are, and final when filed", async () => {
        expect((await landed("outsider")).get(c.multi)).toMatchObject({ total_php: 380, unit_php: 190, mark: "provisional" })
        await exec(`update public.ipas set computation_status = 'lc_odoo_done' where id = $1`, [ipas.php])
        expect((await landed("outsider")).get(c.multi)).toMatchObject({ mark: "final" })
        await exec(`update public.ipas set computation_status = 'encoding' where id = $1`, [ipas.php])

        const client = await sql().connect()
        try {
            await client.query("begin")
            await client.query("set local session_replication_role = replica")
            await client.query(`update public.ipas set state = 'filed' where id = $1`, [ipas.php])
            await client.query("commit")
        } finally {
            client.release()
        }
        expect((await landed("outsider")).get(c.multi)).toMatchObject({ mark: "final" })
        await exec(`update public.ipas set state = 'open' where id = $1`, [ipas.php]).catch(async () => {
            const back = await sql().connect()
            try {
                await back.query("begin")
                await back.query("set local session_replication_role = replica")
                await back.query(`update public.ipas set state = 'open' where id = $1`, [ipas.php])
                await back.query("commit")
            } finally {
                back.release()
            }
        })
    })
})

describe("costing_landed_costs: who", () => {
    it.each(["outsider", "ipasSigner"])("%s gets rows", async (who) => {
        expect((await landed(who)).get(c.hose)?.total_php).toBe(7500)
    })

    it.each(["dealOwner", "technical", "ordinary"])("%s gets nothing", async (who) => {
        expect((await landed(who)).size).toBe(0)
    })

    it("still leaves the Deal Team unable to select IPAS payments and charges", async () => {
        const client = await clientFor("dealOwner")
        for (const table of ["ipas_payments", "ipas_charges"]) {
            const { data } = await client.from(table).select("id").eq("ipas_id", ipas.usd)
            expect(data ?? [], table).toHaveLength(0)
        }
    })
})

describe("costing_component_purchases", () => {
    it("shows PO numbers, IPAS number and state and the typed PO to a participant, with no money", async () => {
        const { data, error } = await (await clientFor("technical")).rpc("costing_component_purchases", { p_opportunity_id: sorA })
        expect(error).toBeNull()
        const byId = new Map(data.map((r) => [r.component_id, r]))
        const hose = byId.get(c.hose)
        expect(Number(hose.ordered_quantity)).toBe(6)
        expect(hose.requests).toEqual([{ item_id: items.hose, request_id: requestA, name: "Item", po_number: po("PHP"), status: "ordered", odoo_po_line_ids: [11] }])
        expect(hose.ipas).toEqual([{ po_number: po("PHP"), ipas_id: ipas.php, number: expect.stringMatching(/^TGIPAS_/), state: "open" }])
        expect(byId.get(c.typedPo)).toMatchObject({ po_rfq_no: "P02574", ipas: [{ po_number: "P02574", ipas_id: null, number: null, state: null }] })
        expect(JSON.stringify(data)).not.toMatch(/total_php|unit_php/)
    })

    it("gives a plain employee nothing", async () => {
        const { data } = await (await clientFor("ordinary")).rpc("costing_component_purchases", { p_opportunity_id: sorA })
        expect(data ?? []).toHaveLength(0)
    })
})

describe("linked rows", () => {
    it("refuses deleting a Component with a Requested Item until it's detached, and keeps the unlink in history", async () => {
        const refused = await svc().from("costing_components").delete().eq("id", c.notOrdered)
        expect(refused.error?.code).toBe("22023")

        const denied = await (await clientFor("dealOwner")).rpc("purchase_request_item_detach_component", { p_item_id: items.notOrdered })
        expect(denied.error?.code).toBe("42501")
        const detached = await (await clientFor("outsider")).rpc("purchase_request_item_detach_component", { p_item_id: items.notOrdered })
        expect(detached.error).toBeNull()

        const events = await exec(`select * from public.costing_events where detail->>'row' = $1 and detail->>'column' = 'component_id'`, [items.notOrdered])
        expect(events).toHaveLength(1)
        expect(events[0]).toMatchObject({ actor_id: ids.outsider, kind: "changed" })

        const deleted = await svc().from("costing_components").delete().eq("id", c.notOrdered)
        expect(deleted.error).toBeNull()
    })

    it("refuses a Component and its Tender Line with a typed PO until it's cleared", async () => {
        expect((await svc().from("costing_components").delete().eq("id", c.typedPo)).error?.code).toBe("22023")
        expect((await svc().from("costing_tender_lines").delete().eq("id", linkedLine)).error?.code).toBe("22023")
        await asSvc(svc().from("costing_components").update({ po_rfq_no: null }).eq("id", c.typedPo), "clear PO")
        expect((await svc().from("costing_tender_lines").delete().eq("id", linkedLine)).error).toBeNull()
    })
})

describe("ipas_summaries_for_sor", () => {
    it("carries Landed Cost for a cost reader", async () => {
        const { data, error } = await (await clientFor("superAdmin")).rpc("ipas_summaries_for_sor", { p_opportunity_id: sorA })
        expect(error).toBeNull()
        const row = data.find((r) => r.ipas_id === ipas.php)
        expect(Number(row.landed_cost_total_php)).toBe(7580)
        expect(row.landed_cost_mark).toBe("provisional")
    })

    it.each(["technical", "dealOwner"])("gives %s no Landed Cost", async (who) => {
        const { data } = await (await clientFor(who)).rpc("ipas_summaries_for_sor", { p_opportunity_id: sorA })
        for (const row of data ?? []) {
            expect(row.landed_cost_total_php).toBeNull()
            expect(row.landed_cost_mark).toBeNull()
        }
    })
})
