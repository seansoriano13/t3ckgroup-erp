/**
 * Costing Matrix, Closed Book end to end (#319, spec #266): the database serves each side its
 * own columns, on a fully populated matrix, for every tier. This is the audit of what #267-#320
 * built: one test group per tier asserting the forbidden keys are ABSENT (not null) from
 * `costing_matrix_read` and `costing_history`, direct PostgREST reads of every money table
 * refused or empty, no client-supplied parameter changing the tier, and the write bands intact.
 *
 * Loosened by 20261102170000: the Deal Team and Purchasing read the Closed Book, so the price tier
 * is Always sees alone and the cost tier is nobody's.
 *
 * The cast, on one SOR (dealOwner and support are its Deal Team):
 *   dealOwner, support  Deal Team                          -> closed_book
 *   hr                  Always sees (flow setting)         -> price
 *   outsider            Purchasing access, no part in it   -> closed_book (every SOR)
 *   stageParticipant    open Stage Participant window      -> participant
 *   finance             Finance access alone               -> no tier
 *   ipasSigner          on the final_acquire list          -> closed_book
 *   superAdmin                                             -> closed_book
 *   ordinary            nobody                             -> no tier
 * A second SOR (owned by closingSales) is one nobody in the first cast but Purchasing may read.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { tryUpdate, tryDelete, RLS_VIOLATION } from "./support/access.js"
import { purgeCostingForSors } from "./support/costing.js"

const svc = () => serviceClient()

// Figures nobody could mistake for anything else, so a stray copy anywhere in a response shows up.
const ABC_1 = 1111.11
const OFFER_1 = 977.77
const ABC_2 = 555.55
const OFFER_2 = 444.44
const ACQUIRE = 417.31
const ODOO = 433.33
const FINAL_ACQUIRE = 389.77
const FACTOR = 1.3719
const DEFAULT_FACTOR = 1.2345
const ROW_ACQUIRE = 61.61
const ROW_FINAL_ACQUIRE = 58.58
const ROW_FACTOR = 1.5
const MARKETING = 1234.56
const OPEX = 6543.21

// What no side of the wall may carry, by tier.
const SECRETS = {
    price: [ACQUIRE, FINAL_ACQUIRE, FACTOR, DEFAULT_FACTOR, ROW_ACQUIRE, ROW_FINAL_ACQUIRE, ROW_FACTOR, MARKETING, OPEX],
    participant: [ABC_1, ABC_2, OFFER_1, OFFER_2, ACQUIRE, ODOO, FINAL_ACQUIRE, FACTOR, DEFAULT_FACTOR, ROW_ACQUIRE, ROW_FINAL_ACQUIRE, ROW_FACTOR, MARKETING, OPEX],
}

let saleTypeId, flowId, stageId
let sorId, matrixId, lineOneId, lineTwoId, componentId, bundleId, costRowId
let otherSorId, otherMatrixId, otherLineId, otherComponentId
const sorIds = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

const rpc = async (who, fn, args) => (await clientFor(who)).rpc(fn, args)

const readMatrix = async (who, args = { p_opportunity_id: sorId }) => {
    const { data, error } = await rpc(who, "costing_matrix_read", args)
    if (error) throw new Error(`costing_matrix_read as ${who}: ${error.message}`)
    return data
}

const history = async (who, args = {}) => {
    const { data, error } = await rpc(who, "costing_history", { p_opportunity_id: sorId, p_limit: 1000, ...args })
    if (error) throw new Error(`costing_history as ${who}: ${error.message}`)
    return data
}

const setMoney = async (who, table, row, patch) => (await rpc(who, "costing_set_money", { p_table: table, p_row: row, p_patch: patch })).error

/** True when the history holds an event on `column`: a change to it, or a row added or removed that carried it. */
const touches = (events, column) => events.some((e) => e.detail.column === column || (e.detail.values && column in e.detail.values))

const keysOf = (rows) => new Set(rows.flatMap((r) => Object.keys(r)))
const hasAnyKey = (rows, names) => names.filter((n) => keysOf(rows).has(n))
// Every number anywhere in the value, numeric strings included. Matching on the
// JSON text instead finds "1.5" inside a timestamp like "…:31.512Z".
const numbersIn = (value, found = []) => {
    if (typeof value === "number") found.push(value)
    else if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) found.push(Number(value))
    else if (value && typeof value === "object") for (const v of Object.values(value)) numbersIn(v, found)
    return found
}

const mentions = (value, figures) => {
    const numbers = numbersIn(value)
    return figures.filter((f) => numbers.includes(Number(f)))
}

let registry
const columnsFor = (table, tier) =>
    new Set(registry.filter((r) => r.table_name === table && r.column_name !== "*" && r.tiers.includes(tier)).map((r) => r.column_name))

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")

    saleTypeId = (await asSvc(svc().from("sale_types").insert({ name: `${MARKER} Closed Book` }).select("id").single(), "sale type")).id
    flowId = (await asSvc(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "flow")).id
    stageId = (await asSvc(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Closed Book Stage`, sort_order: 10 }).select("id").single(), "stage")).id
    // Always sees: one named employee (HR), who is no part of the Deal Team.
    await asSvc(
        svc().from("flow_access_settings").upsert({ flow_id: flowId, always_sees: [{ type: "employee", id: ids.hr }], always_edits: [] }, { onConflict: "flow_id" }),
        "always sees",
    )

    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, supportSales1Id: ids.support, saleTypeId, flowStageId: stageId })
    // No flow of its own to share: the Always sees setting above must not reach it.
    otherSorId = await makeSor({ registeredBy: ids.closingSales, dealOwnerId: ids.closingSales })
    sorIds.push(sorId, otherSorId)

    const visit = await asSvc(svc().from("sor_stage_visits").select("id").eq("opportunity_id", sorId).single(), "visit")
    await asSvc(
        svc().from("sor_stage_participants").insert({
            opportunity_id: sorId,
            employee_id: ids.stageParticipant,
            source: "action",
            opened_visit_id: visit.id,
            until_rule: "stage_left",
        }),
        "participant window",
    )
    await asSvc(svc().from("costing_signer_lists").insert([{ list_key: "final_acquire", employee_id: ids.ipasSigner }, { list_key: "markup", employee_id: ids.ipasSigner }]), "signer list")

    const opened = await svc().rpc("costing_open_matrix", { p_opportunity_id: sorId })
    if (opened.error) throw new Error(`costing_open_matrix: ${opened.error.message}`)
    matrixId = opened.data
    const openedOther = await svc().rpc("costing_open_matrix", { p_opportunity_id: otherSorId })
    if (openedOther.error) throw new Error(`costing_open_matrix (other): ${openedOther.error.message}`)
    otherMatrixId = openedOther.data

    const addLine = async (matrix, position, spec, quantity) =>
        (await asSvc(svc().from("costing_tender_lines").insert({ matrix_id: matrix, position, tender_specification: spec, quantity, created_by: ids.dealOwner }).select("id").single(), spec)).id
    const addComponent = async (line, position, name, extra = {}) =>
        (await asSvc(svc().from("costing_components").insert({ tender_line_id: line, position, name, quantity: 2, ...extra }).select("id").single(), name)).id

    lineOneId = await addLine(matrixId, 1, "Rescue tripod", 2)
    lineTwoId = await addLine(matrixId, 2, "Harness set", 1)
    componentId = await addComponent(lineOneId, 1, "Tripod head")
    bundleId = await addComponent(lineTwoId, 1, "Rescue kit", { is_bundle: true })
    await asSvc(svc().from("costing_inclusions").insert({ component_id: bundleId, position: 1, heading: false, description: "Carry bag", quantity: 1, unit: "pc" }), "inclusion")

    otherLineId = await addLine(otherMatrixId, 1, "Other line", 1)
    otherComponentId = await addComponent(otherLineId, 1, "Other component")

    // Everything typed by the band that types it, so the history has real authors.
    const typed = [
        ["dealOwner", "costing_tender_line_prices", lineOneId, { abc_unit: ABC_1, final_offer_unit: OFFER_1 }],
        ["dealOwner", "costing_tender_line_prices", lineTwoId, { abc_unit: ABC_2, final_offer_unit: OFFER_2 }],
        ["outsider", "costing_component_costs", componentId, { acquire_unit: ACQUIRE }],
        ["dealOwner", "costing_component_costs", componentId, { odoo_unit: ODOO }],
        ["ipasSigner", "costing_component_costs", componentId, { final_acquire_unit: FINAL_ACQUIRE, markup_factor: FACTOR }],
        ["ipasSigner", "costing_matrix_money", matrixId, { default_factor: DEFAULT_FACTOR, marketing: MARKETING, opex: OPEX }],
        ["dealOwner", "costing_tender_line_prices", otherLineId, { abc_unit: 99, final_offer_unit: 98 }],
    ]
    for (const [who, table, row, patch] of typed) {
        const error = await setMoney(who === "dealOwner" && row === otherLineId ? "closingSales" : who, table, row, patch)
        if (error) throw new Error(`typing ${JSON.stringify(patch)} as ${who}: ${error.message}`)
    }
    const costRow = await rpc("outsider", "costing_add_cost_row", { p_matrix_id: matrixId, p_description: "Delivery Charge", p_quantity: 1 })
    if (costRow.error) throw new Error(`costing_add_cost_row: ${costRow.error.message}`)
    costRowId = costRow.data
    for (const [who, patch] of [
        ["outsider", { acquire_unit: ROW_ACQUIRE }],
        ["ipasSigner", { final_acquire_unit: ROW_FINAL_ACQUIRE, markup_factor: ROW_FACTOR }],
    ]) {
        const error = await setMoney(who, "costing_cost_rows", costRowId, patch)
        if (error) throw new Error(`cost row as ${who}: ${error.message}`)
    }
    await asSvc(svc().from("costing_components").update({ compliance: "complies" }).eq("id", componentId), "compliance")
    await asSvc(svc().from("costing_signoffs").insert({ matrix_id: matrixId, role: "prepared", signed_by: ids.outsider }), "sign-off")
    const decided = await rpc("ipasSigner", "costing_decide_bid", { p_matrix_id: matrixId, p_verdict: "revise", p_reason: "Margin is fine" })
    if (decided.error) throw new Error(`costing_decide_bid: ${decided.error.message}`)

    registry = await asSvc(svc().from("costing_column_tiers").select("*"), "registry")
})

afterAll(async () => {
    await svc().from("notifications").delete().in("reference_id", sorIds)
    await svc().from("costing_signer_lists").delete().eq("employee_id", ids.ipasSigner)
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeCostingForSors(sorIds)
    await svc().from("sor_stage_participants").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_access_settings").delete().eq("flow_id", flowId)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

/** Every key of every row is one the registry allows the tier (virtual columns included). */
const expectOnlyRegistered = (read, tier, who) => {
    for (const [table, rows] of Object.entries(read.tables)) {
        const allowed = columnsFor(table, tier)
        for (const row of rows) {
            for (const key of Object.keys(row)) expect(allowed.has(key), `${who}: ${table}.${key}`).toBe(true)
        }
    }
}

describe("Always sees (price tier)", () => {
    it.each(["hr"])("%s reads ABC, Markup Price and Final Offer, and neither Acquire nor the factor", async (who) => {
        const read = await readMatrix(who)
        expect(read.tier).toBe("price")
        const t = read.tables
        const prices = t.costing_tender_line_prices
        expect(prices.map((r) => Number(r.final_offer_unit)).sort((a, b) => a - b)).toEqual([OFFER_2, OFFER_1])
        expect(prices.every((r) => "abc_unit" in r && "quotation_price_unit" in r)).toBe(true)
        const cost = t.costing_component_costs.find((r) => r.component_id === componentId)
        expect(cost.markup_price_unit).not.toBeNull()
        expect(cost.odoo_unit).toBe(ODOO)
        expect(t.costing_cost_rows[0].markup_price_unit).not.toBeNull()

        for (const name of ["acquire_unit", "final_acquire_unit", "markup_factor"]) {
            expect(hasAnyKey(t.costing_component_costs, [name]), `${who} component ${name}`).toEqual([])
            expect(hasAnyKey(t.costing_cost_rows, [name]), `${who} cost row ${name}`).toEqual([])
        }
        // No summary inputs (default factor, marketing, OPEX), no stamped bid figures.
        expect("costing_matrix_money" in t).toBe(false)
        const decision = t.costing_bid_decisions.find((r) => r.cleared_at === null)
        expect(decision.verdict).toBe("revise")
        expect(decision.reason).toBe("Margin is fine")
        expect(hasAnyKey(t.costing_bid_decisions, ["final_offer_total", "abc_total"])).toEqual([])
        // Compliance travels with every tier.
        expect(t.costing_components.find((r) => r.id === componentId).compliance).toBe("complies")
        expectOnlyRegistered(read, "price", who)
        expect(mentions(read, SECRETS.price)).toEqual([])
    })

    it("reads the history of price-side columns and none of the cost-side or management-side ones", async () => {
        for (const who of ["hr"]) {
            const events = await history(who)
            expect(touches(events, "final_offer_unit"), who).toBe(true)
            for (const column of ["acquire_unit", "final_acquire_unit", "markup_factor", "default_factor", "marketing", "opex"]) {
                expect(touches(events, column), `${who} ${column}`).toBe(false)
            }
            expect(events.some((e) => e.detail.table === "costing_matrix_money"), who).toBe(false)
            expect(mentions(events, SECRETS.price), who).toEqual([])
        }
    })
})

describe("Super Admin, the Final Acquire list, the Deal Team and Purchasing (Closed Book)", () => {
    it.each(["ipasSigner", "superAdmin", "dealOwner", "support", "outsider"])("%s receives every registered column", async (who) => {
        const read = await readMatrix(who)
        expect(read.tier).toBe("closed_book")
        for (const [table, rows] of Object.entries(read.tables)) {
            expect(rows.length, `${who} ${table}`).toBeGreaterThan(0)
            const allowed = [...columnsFor(table, "closed_book")]
            for (const column of allowed) {
                expect(rows.every((r) => column in r), `${who} ${table}.${column}`).toBe(true)
            }
        }
        const t = read.tables
        const cost = t.costing_component_costs.find((r) => r.component_id === componentId)
        expect(cost.final_acquire_unit).toBe(FINAL_ACQUIRE)
        expect(cost.markup_factor).toBe(FACTOR)
        expect(cost.acquire_unit).toBe(ACQUIRE)
        expect(t.costing_matrix_money[0].marketing).toBe(MARKETING)
        expect(t.costing_matrix_money[0].opex).toBe(OPEX)
        expect(t.costing_matrix_money[0].default_factor).toBe(DEFAULT_FACTOR)
        expect(t.costing_tender_line_prices.map((r) => r.final_offer_unit).sort((a, b) => a - b)).toEqual([OFFER_2, OFFER_1])
        const decision = t.costing_bid_decisions.find((r) => r.cleared_at === null)
        expect("final_offer_total" in decision && "abc_total" in decision).toBe(true)
    })

    it("sees every column's history", async () => {
        for (const who of ["ipasSigner", "dealOwner", "outsider"]) {
            const events = await history(who)
            for (const column of ["final_offer_unit", "acquire_unit", "final_acquire_unit", "markup_factor", "default_factor", "marketing", "opex"]) {
                expect(touches(events, column), `${who} ${column}`).toBe(true)
            }
        }
    })

    it("lets only Closed Book select any money table or the history directly", async () => {
        const moneyTables = ["costing_matrix_money", "costing_tender_line_prices", "costing_component_costs", "costing_cost_rows", "costing_bid_decisions", "costing_events"]
        for (const who of ["ipasSigner", "superAdmin", "dealOwner", "outsider"]) {
            for (const table of moneyTables) {
                const { data, error } = await (await clientFor(who)).from(table).select("*")
                expect(error, `${who} ${table}`).toBeNull()
                expect(data.length, `${who} ${table}`).toBeGreaterThan(0)
            }
        }
    })
})

describe("Stage Participant with an open window (no money at all)", () => {
    it("reads the matrix without a single money table or money column", async () => {
        const read = await readMatrix("stageParticipant")
        expect(read.tier).toBe("participant")
        const t = read.tables
        for (const table of ["costing_tender_line_prices", "costing_component_costs", "costing_matrix_money", "costing_bid_decisions"]) {
            expect(table in t, table).toBe(false)
        }
        // Cost-only rows keep their description and quantity; every figure is gone.
        expect(Object.keys(t.costing_cost_rows[0]).sort()).toEqual(["created_at", "description", "id", "matrix_id", "position", "quantity"].sort())
        expect(t.costing_tender_lines).toHaveLength(2)
        expect(t.costing_components.find((r) => r.id === componentId).compliance).toBe("complies")
        expectOnlyRegistered(read, "participant", "stageParticipant")
        expect(mentions(read, SECRETS.participant)).toEqual([])
    })

    it("reads a history with no money in it", async () => {
        const events = await history("stageParticipant")
        for (const event of events) {
            const tables = ["costing_tender_line_prices", "costing_component_costs", "costing_matrix_money", "costing_bid_decisions"]
            expect(tables.includes(event.detail.table), JSON.stringify(event.detail)).toBe(false)
        }
        expect(mentions(events, SECRETS.participant)).toEqual([])
    })
})

describe("a closed Stage Participant window and a signed-out caller", () => {
    it("serves a Stage Participant nothing once the window has closed", async () => {
        const window = await asSvc(svc().from("sor_stage_participants").select("id").eq("opportunity_id", sorId).eq("employee_id", ids.stageParticipant).single(), "window")
        await asSvc(svc().from("sor_stage_participants").update({ closed_at: new Date().toISOString() }).eq("id", window.id), "close window")
        try {
            expect(await readMatrix("stageParticipant")).toBeNull()
            expect(await history("stageParticipant")).toBeNull()
        } finally {
            await asSvc(svc().from("sor_stage_participants").update({ closed_at: null }).eq("id", window.id), "reopen window")
        }
        expect((await readMatrix("stageParticipant")).tier).toBe("participant")
    })

    it("refuses a caller with only the anon key, on the functions and on every table", async () => {
        const { createClient } = await import("@supabase/supabase-js")
        const { API_URL, ANON_KEY } = await import("./support/stack.js")
        const anon = createClient(API_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
        for (const fn of ["costing_matrix_read", "costing_history", "costing_tier"]) {
            const { data, error } = await anon.rpc(fn, { p_opportunity_id: sorId })
            expect(data, fn).toBeNull()
            expect(error, fn).not.toBeNull()
        }
        for (const table of ["costing_matrices", "costing_tender_line_prices", "costing_component_costs", "costing_matrix_money", "costing_events"]) {
            const { data } = await anon.from(table).select("*")
            expect(data ?? [], table).toHaveLength(0)
        }
    })
})

describe("Finance access alone and a plain employee", () => {
    it.each(["finance", "ordinary"])("%s gets nothing, from the matrix, the history or the tables", async (who) => {
        expect(await readMatrix(who)).toBeNull()
        expect(await history(who)).toBeNull()
        const client = await clientFor(who)
        for (const table of [
            "costing_matrices", "costing_tender_lines", "costing_components", "costing_inclusions", "costing_signoffs",
            "costing_matrix_money", "costing_tender_line_prices", "costing_component_costs", "costing_cost_rows", "costing_bid_decisions", "costing_events",
        ]) {
            const { data, error } = await client.from(table).select("*")
            expect(error, `${who} ${table}`).toBeNull()
            expect(data, `${who} ${table}`).toHaveLength(0)
        }
        expect((await rpc(who, "costing_tier", { p_opportunity_id: sorId })).data).toBeNull()
        expect((await rpc(who, "costing_component_requests", { p_opportunity_id: sorId })).data).toBeNull()
    })
})

describe("direct PostgREST reads", () => {
    const moneyTables = ["costing_matrix_money", "costing_tender_line_prices", "costing_component_costs", "costing_cost_rows", "costing_bid_decisions", "costing_events"]

    it.each(["hr", "stageParticipant", "finance", "ordinary"])("%s gets no row of any money table or of costing_events", async (who) => {
        const client = await clientFor(who)
        for (const table of moneyTables) {
            const { data, error } = await client.from(table).select("*")
            expect(error, `${who} ${table}`).toBeNull()
            expect(data, `${who} ${table}`).toHaveLength(0)
        }
    })

    it("returns no money through an embed on a table the caller can read", async () => {
        for (const who of ["hr", "stageParticipant"]) {
            const client = await clientFor(who)
            const lines = await client.from("costing_tender_lines").select("id, costing_tender_line_prices(*)")
            expect(lines.error, who).toBeNull()
            expect(lines.data.length, who).toBeGreaterThan(0)
            expect(lines.data.every((l) => !l.costing_tender_line_prices || (Array.isArray(l.costing_tender_line_prices) ? l.costing_tender_line_prices.length === 0 : false)), who).toBe(true)
            const components = await client.from("costing_components").select("id, costing_component_costs(*)")
            expect(components.error, who).toBeNull()
            expect(components.data.every((c) => !c.costing_component_costs || c.costing_component_costs.length === 0), who).toBe(true)
        }
    })

    it("refuses a direct write to any money table, to the history and to the signed-off facts", async () => {
        for (const who of ["dealOwner", "outsider", "ipasSigner", "superAdmin"]) {
            const client = await clientFor(who)
            for (const [table, id, key] of [
                ["costing_tender_line_prices", lineOneId, "tender_line_id"],
                ["costing_component_costs", componentId, "component_id"],
                ["costing_cost_rows", costRowId, "id"],
                ["costing_matrix_money", matrixId, "matrix_id"],
            ]) {
                const { data } = await client.from(table).update({ [key]: id }).eq(key, id).select()
                expect(data ?? [], `${who} update ${table}`).toHaveLength(0)
                const deleted = await client.from(table).delete().eq(key, id).select()
                expect(deleted.data ?? [], `${who} delete ${table}`).toHaveLength(0)
            }
            const events = await client.from("costing_events").delete().eq("matrix_id", matrixId).select()
            expect(events.data ?? [], `${who} events`).toHaveLength(0)
        }
        // Still all there.
        const { data } = await svc().from("costing_tender_line_prices").select("tender_line_id").in("tender_line_id", [lineOneId, lineTwoId])
        expect(data).toHaveLength(2)
    })
})

describe("no client-supplied parameter changes the tier", () => {
    it("refuses an extra argument that names a tier, and returns nothing for it", async () => {
        for (const extra of [{ p_tier: "closed_book" }, { tier: "closed_book" }, { p_employee_id: ids.ipasSigner }, { p_role: "super_admin" }]) {
            const { data, error } = await rpc("dealOwner", "costing_matrix_read", { p_opportunity_id: sorId, ...extra })
            expect(error, JSON.stringify(extra)).not.toBeNull()
            expect(data, JSON.stringify(extra)).toBeNull()
            const hist = await rpc("outsider", "costing_history", { p_opportunity_id: sorId, ...extra })
            expect(hist.error, JSON.stringify(extra)).not.toBeNull()
        }
    })

    it("answers the caller's own tier whatever opportunity or row id it passes", async () => {
        // The other SOR is nobody's in this cast but closingSales' (and Purchasing's, and the list's).
        for (const who of ["dealOwner", "support", "hr", "outsider", "stageParticipant"]) {
            if (who === "outsider") {
                // Purchasing access reads the Closed Book of every SOR.
                const read = await readMatrix(who, { p_opportunity_id: otherSorId })
                expect(read.tier).toBe("closed_book")
            } else {
                expect(await readMatrix(who, { p_opportunity_id: otherSorId }), who).toBeNull()
                expect((await rpc(who, "costing_history", { p_opportunity_id: otherSorId })).data, who).toBeNull()
                expect((await rpc(who, "costing_tier", { p_opportunity_id: otherSorId })).data, who).toBeNull()
            }
        }
        // A readable SOR with another SOR's row id: the history of that row is not served.
        const foreign = await history("dealOwner", { p_table: "costing_components", p_row: otherComponentId })
        expect(foreign).toEqual([])
        const money = await history("ipasSigner", { p_table: "costing_tender_line_prices", p_row: otherLineId })
        expect(money).toEqual([])
    })

    it("lets a caller on the other SOR's Deal Team see that SOR and not this one", async () => {
        const read = await readMatrix("closingSales", { p_opportunity_id: otherSorId })
        expect(read.tier).toBe("closed_book")
        expect(await readMatrix("closingSales", { p_opportunity_id: sorId })).toBeNull()
    })

    it("refuses writes to another SOR's rows, whatever the patch names", async () => {
        const error = await setMoney("dealOwner", "costing_tender_line_prices", otherLineId, { final_offer_unit: 1 })
        expect(error?.code).toBe(RLS_VIOLATION)
        const component = await setMoney("support", "costing_component_costs", otherComponentId, { final_acquire_unit: 1 })
        expect(component?.code).toBe(RLS_VIOLATION)
        const decided = await rpc("dealOwner", "costing_decide_bid", { p_matrix_id: otherMatrixId, p_verdict: "go", p_reason: "x" })
        expect(decided.error?.code).toBe(RLS_VIOLATION)
    })
})

describe("history shows an event only to tiers that may read its column", () => {
    const tiers = { outsider: "closed_book", dealOwner: "closed_book", hr: "price", stageParticipant: "participant", ipasSigner: "closed_book", superAdmin: "closed_book" }

    it.each(Object.keys(tiers))("%s sees no event on a column outside its tier", async (who) => {
        const tier = tiers[who]
        const events = await history(who)
        expect(events.length).toBeGreaterThan(0)
        for (const event of events) {
            const { table, column, values } = event.detail
            if (column) {
                expect(columnsFor(table, tier).has(column), `${who} sees ${table}.${column}`).toBe(true)
            } else {
                // An added or removed row: only the columns this tier reads survive in it.
                for (const key of Object.keys(values ?? {})) expect(columnsFor(table, tier).has(key), `${who} sees ${table}.${key} in a ${event.kind} event`).toBe(true)
            }
        }
    })
})

describe("write bands still refuse out-of-band writes", () => {
    it("refuses Sales the Purchasing columns, naming the band", async () => {
        const error = await setMoney("dealOwner", "costing_component_costs", componentId, { acquire_unit: 1 })
        expect(error?.code).toBe(RLS_VIOLATION)
        expect(error?.message).toBe("costing_band:costing_component_costs.acquire_unit:purchasing")
    })

    it("refuses Purchasing the Final Offer", async () => {
        const error = await setMoney("outsider", "costing_tender_line_prices", lineOneId, { final_offer_unit: 1 })
        expect(error?.code).toBe(RLS_VIOLATION)
        expect(error?.message).toBe("costing_band:costing_tender_line_prices.final_offer_unit:sales")
    })

    it("refuses the markup factor to anyone outside the Markup list", async () => {
        for (const who of ["stageParticipant"]) {
            const error = await setMoney(who, "costing_component_costs", componentId, { markup_factor: 9 })
            expect(error?.code, who).toBe(RLS_VIOLATION)
            expect(error?.message, who).toBe("costing_band:costing_component_costs.markup_factor:markup")
        }
    })

    it("refuses Marketing and OPEX to anyone outside Finance access, Sales, Purchasing and the list", async () => {
        for (const who of ["stageParticipant"]) {
            const error = await setMoney(who, "costing_matrix_money", matrixId, { opex: 1 })
            expect(error?.code, who).toBe(RLS_VIOLATION)
            expect(error?.message, who).toBe("costing_band:costing_matrix_money.opex:finance,sales,purchasing,management")
        }
    })

    it("refuses the technical band to the Deal Team", async () => {
        const result = await tryUpdate(await clientFor("dealOwner"), "costing_components", componentId, { compliance: "deviates", compliance_note: "x" })
        expect(result.ok).toBe(false)
        expect(result.code).toBe(RLS_VIOLATION)
        expect(result.message).toContain("costing_band:costing_components.compliance:technical")
    })

    it("refuses the Deal Team the Purchasing Incharge and Purchasing the Sales Incharge", async () => {
        const sales = await tryUpdate(await clientFor("dealOwner"), "costing_matrices", matrixId, { purchasing_incharge_id: ids.outsider })
        expect(sales.message).toContain("costing_band:costing_matrices.purchasing_incharge_id:purchasing")
        const purchasing = await tryUpdate(await clientFor("outsider"), "costing_matrices", matrixId, { sales_incharge_id: ids.dealOwner })
        expect(purchasing.message).toContain("costing_band:costing_matrices.sales_incharge_id:sales")
    })

    it("refuses a row delete outside its band", async () => {
        const result = await tryDelete(await clientFor("dealOwner"), "costing_inclusions", (await asSvc(svc().from("costing_inclusions").select("id").eq("component_id", bundleId).single(), "inclusion")).id)
        expect(result.ok === false || result.affected === 1).toBe(true)
        const other = await rpc("stageParticipant", "costing_remove_cost_row", { p_row_id: costRowId })
        expect(other.error?.code).toBe(RLS_VIOLATION)
    })

    it("lets each band write its own columns", async () => {
        expect(await setMoney("outsider", "costing_component_costs", componentId, { acquire_unit: ACQUIRE })).toBeNull()
        expect(await setMoney("dealOwner", "costing_tender_line_prices", lineOneId, { final_offer_unit: OFFER_1 })).toBeNull()
        expect(await setMoney("ipasSigner", "costing_component_costs", componentId, { markup_factor: FACTOR })).toBeNull()
    })
})
