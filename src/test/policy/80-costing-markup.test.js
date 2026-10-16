/**
 * Costing Matrix, markup (#269, spec #266, amended by #316 and #319): the Final Acquire list
 * sets the markup factor and the named presets, only the Closed Book reads a factor, and Sales
 * reads the peso Markup Price (computed in the database) without the Acquire or the factor
 * behind it.
 *
 * The cast, on one SOR (dealOwner and support are its Deal Team):
 *   dealOwner, support  Deal Team                         -> price tier, Sales band
 *   outsider            Purchasing access, no part in it  -> cost tier, Purchasing band
 *   stageParticipant    open Stage Participant window     -> participant tier, no band
 *   finance             Finance access alone              -> no tier
 *   ipasSigner          on the final_acquire list         -> closed_book, Management band
 *   superAdmin                                            -> closed_book, never Management
 *   ordinary            nobody                            -> no tier
 *
 * Fixtures are written with the service role (the band trigger lets it through); every
 * assertion about who may do what runs as a real cast member.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, rlsStatus, sql } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { RLS_VIOLATION } from "./support/access.js"
import { purgeCostingForSors } from "./support/costing.js"
import { COMPONENT_COST_TIERS, MATRIX_MONEY_BANDS, MATRIX_MONEY_TIERS } from "../../constants/costing.js"
import { markupPriceUnit } from "../../utils/costingMath.js"

const svc = () => serviceClient()
const CHECK_VIOLATION = "23514"
const UNIQUE_VIOLATION = "23505"

let saleTypeId, flowId, stageId
let sorId, matrixId
let lineId
let vehicleId, boltsId, blankId
let deliveryRowId, plainRowId, blankRowId
let govPreset
const sorIds = []
const presetLabel = (name) => `${MARKER} ${name}`

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

const readMatrix = async (who) => {
    const { data, error } = await (await clientFor(who)).rpc("costing_matrix_read", { p_opportunity_id: sorId })
    if (error) throw new Error(`costing_matrix_read as ${who}: ${error.message}`)
    return data
}

const tableOf = (read, name) => read.tables[name] ?? []

/** Writes the matrix's own money row as `who`: resolves to the RPC's error (null on success). */
const setMatrixMoney = async (who, patch) =>
    (await (await clientFor(who)).rpc("costing_set_money", { p_table: "costing_matrix_money", p_row: matrixId, p_patch: patch })).error

const setCost = async (who, componentId, patch) =>
    (await (await clientFor(who)).rpc("costing_set_money", { p_table: "costing_component_costs", p_row: componentId, p_patch: patch })).error

const setRowMoney = async (who, rowId, patch) =>
    (await (await clientFor(who)).rpc("costing_set_money", { p_table: "costing_cost_rows", p_row: rowId, p_patch: patch })).error

const markupUnitOf = (read, componentId) => tableOf(read, "costing_component_costs").find((c) => c.component_id === componentId)?.markup_price_unit
const markupUnitOfRow = (read, rowId) => tableOf(read, "costing_cost_rows").find((r) => r.id === rowId)?.markup_price_unit

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")

    saleTypeId = (await asSvc(svc().from("sale_types").insert({ name: `${MARKER} Markup` }).select("id").single(), "sale type")).id
    flowId = (await asSvc(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "flow")).id
    stageId = (
        await asSvc(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Markup Stage`, sort_order: 10 }).select("id").single(), "stage")
    ).id

    sorId = await makeSor({
        registeredBy: ids.dealOwner,
        dealOwnerId: ids.dealOwner,
        supportSales1Id: ids.support,
        saleTypeId,
        flowStageId: stageId,
    })
    sorIds.push(sorId)

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
    await asSvc(svc().from("costing_signer_lists").insert({ list_key: "final_acquire", employee_id: ids.ipasSigner }), "signer list")

    const opened = await svc().rpc("costing_open_matrix", { p_opportunity_id: sorId })
    if (opened.error) throw new Error(`costing_open_matrix: ${opened.error.message}`)
    matrixId = opened.data

    lineId = (
        await asSvc(
            svc().from("costing_tender_lines").insert({ matrix_id: matrixId, position: 1, tender_specification: "Rescue vehicle", quantity: 1, created_by: ids.dealOwner }).select("id").single(),
            "Tender Line",
        )
    ).id
    await asSvc(svc().from("costing_tender_line_prices").insert({ tender_line_id: lineId, abc_unit: 4000000, final_offer_unit: 3300000 }), "prices")

    const component = async (position, name, costs) => {
        const row = await asSvc(svc().from("costing_components").insert({ tender_line_id: lineId, position, name, quantity: 1 }).select("id").single(), name)
        if (costs) await asSvc(svc().from("costing_component_costs").insert({ component_id: row.id, ...costs }), `${name} costs`)
        return row.id
    }
    vehicleId = await component(1, "Vehicle", { acquire_unit: 2160500, markup_factor: 1.47 })
    boltsId = await component(2, "Anchor bolts", { acquire_unit: 18250.5 })
    blankId = await component(3, "Spare wheel", { odoo_unit: 9000 })

    const costRow = async (position, description, costs) =>
        (await asSvc(svc().from("costing_cost_rows").insert({ matrix_id: matrixId, position, description, quantity: 1, ...costs }).select("id").single(), description)).id
    deliveryRowId = await costRow(1, "Delivery Charge", { acquire_unit: 100000 })
    plainRowId = await costRow(2, "Permit", { acquire_unit: 333.33, markup_factor: null })
    blankRowId = await costRow(3, "Unpriced", {})
})

afterAll(async () => {
    await svc().from("costing_matrix_money").update({ default_preset_id: null, default_factor: null }).eq("matrix_id", matrixId)
    await svc().from("costing_markup_presets").delete().like("label", `${MARKER}%`)
    await svc().from("costing_signer_lists").delete().eq("employee_id", ids.ipasSigner)
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeCostingForSors(sorIds)
    await svc().from("sor_stage_participants").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("markup presets: who reads and writes", () => {
    it("lets the Final Acquire list add a preset and read it back", async () => {
        const { data, error } = await (await clientFor("ipasSigner"))
            .from("costing_markup_presets")
            .insert({ label: presetLabel("Government"), factor: 1.35, sort: 1 })
            .select("*")
            .single()
        expect(error).toBeNull()
        expect(data).toMatchObject({ label: presetLabel("Government"), active: true })
        expect(Number(data.factor)).toBe(1.35)
        govPreset = data.id
    })

    it("lets a Super Admin add and read presets too", async () => {
        const { data, error } = await (await clientFor("superAdmin"))
            .from("costing_markup_presets")
            .insert({ label: presetLabel("Private"), factor: 2.4, sort: 2 })
            .select("id")
            .single()
        expect(error).toBeNull()
        expect(data.id).toBeTruthy()
        const seen = await (await clientFor("superAdmin")).from("costing_markup_presets").select("id").like("label", `${MARKER}%`)
        expect(seen.data).toHaveLength(2)
    })

    it("refuses a plain employee, Purchasing, Sales, Finance and a Stage Participant writing a preset", async () => {
        for (const who of ["ordinary", "outsider", "dealOwner", "finance", "stageParticipant"]) {
            const { error } = await (await clientFor(who)).from("costing_markup_presets").insert({ label: presetLabel(`Nope ${who}`), factor: 9 })
            expect(error?.code, who).toBe(RLS_VIOLATION)
        }
        const none = await svc().from("costing_markup_presets").select("id").like("label", `${MARKER} Nope%`)
        expect(none.data).toEqual([])
    })

    it("refuses those same people editing a preset, and shows them none", async () => {
        for (const who of ["ordinary", "outsider", "dealOwner", "finance", "stageParticipant"]) {
            const client = await clientFor(who)
            const edit = await client.from("costing_markup_presets").update({ factor: 9 }).eq("id", govPreset).select("id")
            expect(edit.data ?? [], who).toEqual([])
            const read = await client.from("costing_markup_presets").select("id")
            expect(read.data, who).toEqual([])
        }
        const row = await asSvc(svc().from("costing_markup_presets").select("factor").eq("id", govPreset).single(), "preset")
        expect(Number(row.factor)).toBe(1.35)
    })

    it("lets the Final Acquire list rename, retype and deactivate a preset, and never delete one", async () => {
        const client = await clientFor("ipasSigner")
        const edit = await client.from("costing_markup_presets").update({ label: presetLabel("Government bids"), factor: 1.4 }).eq("id", govPreset).select("*").single()
        expect(edit.error).toBeNull()
        expect(Number(edit.data.factor)).toBe(1.4)
        expect(new Date(edit.data.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(edit.data.created_at).getTime())

        const off = await client.from("costing_markup_presets").update({ active: false }).eq("id", govPreset).select("active").single()
        expect(off.data.active).toBe(false)
        await client.from("costing_markup_presets").update({ active: true, label: presetLabel("Government"), factor: 1.35 }).eq("id", govPreset)

        for (const who of ["ipasSigner", "superAdmin"]) {
            const del = await (await clientFor(who)).from("costing_markup_presets").delete().eq("id", govPreset).select("id")
            expect(del.error?.code, who).toBe(RLS_VIOLATION)
        }
        const still = await svc().from("costing_markup_presets").select("id").eq("id", govPreset)
        expect(still.data).toHaveLength(1)
    })

    it("refuses a second preset with the same name however it is spelled, and a factor of zero or less", async () => {
        const client = await clientFor("ipasSigner")
        const twin = await client.from("costing_markup_presets").insert({ label: `  ${presetLabel("GOVERNMENT")} `, factor: 1.5 })
        expect(twin.error?.code).toBe(UNIQUE_VIOLATION)
        const zero = await client.from("costing_markup_presets").insert({ label: presetLabel("Zero"), factor: 0 })
        expect(zero.error?.code).toBe(CHECK_VIOLATION)
        const negative = await client.from("costing_markup_presets").update({ factor: -1 }).eq("id", govPreset)
        expect(negative.error?.code).toBe(CHECK_VIOLATION)
    })

    it("tells the screen who edits presets: the Final Acquire list and Super Admins", async () => {
        const answer = async (who) => (await (await clientFor(who)).rpc("costing_can_manage_markup")).data
        expect(await answer("ipasSigner")).toBe(true)
        expect(await answer("superAdmin")).toBe(true)
        for (const who of ["outsider", "dealOwner", "ordinary", "finance", "stageParticipant"]) {
            expect(await answer(who), who).toBe(false)
        }
    })

    it("has row level security on, with no delete policy", async () => {
        const status = await rlsStatus("costing_markup_presets")
        expect(status.enabled).toBe(true)
        expect(JSON.stringify(status.policies)).not.toMatch(/delete/i)
    })
})

describe("the default factor: only the Final Acquire list writes it", () => {
    it("refuses Sales, Purchasing, a Stage Participant, a plain employee and Finance, naming the band", async () => {
        for (const who of ["dealOwner", "support", "outsider", "stageParticipant"]) {
            const error = await setMatrixMoney(who, { default_factor: 1.35 })
            expect(error?.code, who).toBe(RLS_VIOLATION)
            expect(error.message, who).toBe("costing_band:costing_matrix_money.default_factor:management")
        }
        for (const who of ["ordinary", "finance"]) {
            expect((await setMatrixMoney(who, { default_factor: 1.35 }))?.code, who).toBe(RLS_VIOLATION)
        }
        const preset = await setMatrixMoney("dealOwner", { default_preset_id: govPreset })
        expect(preset.message).toBe("costing_band:costing_matrix_money.default_preset_id:management")
    })

    it("refuses a Super Admin who is not on the list: the Closed Book reads it, only the list sets it", async () => {
        const error = await setMatrixMoney("superAdmin", { default_factor: 1.35 })
        expect(error?.message).toBe("costing_band:costing_matrix_money.default_factor:management")
    })

    it("lets the Final Acquire list type a factor or take a preset, and refuses a factor of zero", async () => {
        expect(await setMatrixMoney("ipasSigner", { default_factor: 1.35 })).toBeNull()
        let row = await asSvc(svc().from("costing_matrix_money").select("*").eq("matrix_id", matrixId).single(), "money")
        expect(Number(row.default_factor)).toBe(1.35)

        expect(await setMatrixMoney("ipasSigner", { default_factor: 1.4, default_preset_id: govPreset })).toBeNull()
        row = await asSvc(svc().from("costing_matrix_money").select("*").eq("matrix_id", matrixId).single(), "money")
        expect(row).toMatchObject({ default_preset_id: govPreset })
        expect(Number(row.default_factor)).toBe(1.4)

        expect((await setMatrixMoney("ipasSigner", { default_factor: 0 }))?.code).toBe(CHECK_VIOLATION)
        expect(await setMatrixMoney("ipasSigner", { default_factor: 1.35, default_preset_id: null })).toBeNull()
    })

    it("keeps a preset a matrix took even after the preset is switched off (it is never deleted)", async () => {
        expect(await setMatrixMoney("ipasSigner", { default_preset_id: govPreset })).toBeNull()
        await svc().from("costing_markup_presets").update({ active: false }).eq("id", govPreset)
        const row = await asSvc(svc().from("costing_matrix_money").select("*").eq("matrix_id", matrixId).single(), "money")
        expect(row.default_preset_id).toBe(govPreset)
        await svc().from("costing_markup_presets").update({ active: true }).eq("id", govPreset)
        expect(await setMatrixMoney("ipasSigner", { default_preset_id: null })).toBeNull()
    })

    it("serves the default factor to the Closed Book alone, with no money row at all for everyone else", async () => {
        for (const who of ["superAdmin", "ipasSigner"]) {
            const read = await readMatrix(who)
            expect(read.tier).toBe("closed_book")
            const [money] = tableOf(read, "costing_matrix_money")
            expect(Object.keys(money).sort(), who).toEqual(["default_factor", "default_preset_id", "matrix_id"])
            expect(Number(money.default_factor), who).toBe(1.35)
        }
        for (const who of ["dealOwner", "outsider", "stageParticipant"]) {
            const read = await readMatrix(who)
            expect(read.tables.costing_matrix_money, who).toBeUndefined()
            expect(JSON.stringify(read), who).not.toMatch(/default_factor|default_preset_id/)
        }
    })

    it("keeps the money row closed to direct reads below the Closed Book", async () => {
        for (const who of ["dealOwner", "outsider", "stageParticipant", "ordinary", "finance"]) {
            const { data } = await (await clientFor(who)).from("costing_matrix_money").select("matrix_id").eq("matrix_id", matrixId)
            expect(data, who).toEqual([])
        }
        const closed = await (await clientFor("ipasSigner")).from("costing_matrix_money").select("matrix_id").eq("matrix_id", matrixId)
        expect(closed.data).toHaveLength(1)
    })
})

describe("row overrides: the same band", () => {
    it("refuses Sales, Purchasing and a Super Admin a Component's factor, and lets the Final Acquire list set it", async () => {
        for (const who of ["dealOwner", "outsider", "superAdmin", "stageParticipant"]) {
            expect((await setCost(who, boltsId, { markup_factor: 2 }))?.message, who).toBe("costing_band:costing_component_costs.markup_factor:management")
        }
        expect((await setCost("ordinary", boltsId, { markup_factor: 2 }))?.code).toBe(RLS_VIOLATION)
        expect(await setCost("ipasSigner", boltsId, { markup_factor: 2 })).toBeNull()
        expect(await setCost("ipasSigner", boltsId, { markup_factor: null })).toBeNull()
    })

    it("refuses those same people a cost-only row's factor, and lets the Final Acquire list set it", async () => {
        for (const who of ["dealOwner", "outsider", "superAdmin"]) {
            expect((await setRowMoney(who, plainRowId, { markup_factor: 2 }))?.message, who).toBe("costing_band:costing_cost_rows.markup_factor:management")
        }
        expect(await setRowMoney("ipasSigner", plainRowId, { markup_factor: 1.2 })).toBeNull()
        expect(await setRowMoney("ipasSigner", plainRowId, { markup_factor: null })).toBeNull()
    })

    it("refuses a factor of zero on a row", async () => {
        expect((await setCost("ipasSigner", boltsId, { markup_factor: 0 }))?.code).toBe(CHECK_VIOLATION)
        expect((await setRowMoney("ipasSigner", plainRowId, { markup_factor: 0 }))?.code).toBe(CHECK_VIOLATION)
    })
})

describe("Markup Price: computed in the database", () => {
    it("gives Sales the peso Markup Price per unit, on every row, and no Acquire and no factor", async () => {
        // default x1.35 (set above); the vehicle has its own x1.47; the Permit row has none (x1.00).
        const read = await readMatrix("dealOwner")
        expect(read.tier).toBe("price")
        expect(Number(markupUnitOf(read, vehicleId))).toBe(3175935) // 2,160,500 x 1.47
        expect(Number(markupUnitOf(read, boltsId))).toBe(24638.18) // 18,250.50 x 1.35 = 24,638.175, half up
        expect(markupUnitOfRow(read, deliveryRowId)).toBeDefined()
        expect(Number(markupUnitOfRow(read, deliveryRowId))).toBe(100000) // a cost-only row is x1.00, not x1.35
        expect(Number(markupUnitOfRow(read, plainRowId))).toBe(333.33)

        // A blank Acquire leaves Markup Price blank: the key is there, the value is null, never 0.
        const costs = tableOf(read, "costing_component_costs")
        const blank = costs.find((c) => c.component_id === blankId)
        expect(blank).toBeDefined()
        expect(blank.markup_price_unit).toBeNull()
        expect(markupUnitOfRow(read, blankRowId)).toBeNull()

        expect(JSON.stringify(read)).not.toMatch(/acquire_unit|markup_factor|default_factor|final_acquire_unit/)
        expect(Object.keys(costs.find((c) => c.component_id === vehicleId)).sort()).toEqual(["component_id", "markup_price_unit", "odoo_unit"])
    })

    it("gives the Closed Book the Markup Price beside the Acquire and the factor behind it", async () => {
        for (const who of ["superAdmin", "ipasSigner"]) {
            const read = await readMatrix(who)
            const vehicle = tableOf(read, "costing_component_costs").find((c) => c.component_id === vehicleId)
            expect(Number(vehicle.acquire_unit), who).toBe(2160500)
            expect(Number(vehicle.markup_factor), who).toBe(1.47)
            expect(Number(vehicle.markup_price_unit), who).toBe(3175935)
            const delivery = tableOf(read, "costing_cost_rows").find((r) => r.id === deliveryRowId)
            expect(Number(delivery.markup_factor), who).toBe(1)
            expect(Number(delivery.markup_price_unit), who).toBe(100000)
        }
    })

    it("gives Purchasing the Acquire and no Markup Price, and a Stage Participant no money at all", async () => {
        const cost = await readMatrix("outsider")
        expect(JSON.stringify(cost)).not.toMatch(/markup_price_unit|markup_factor|default_factor/)
        expect(Number(tableOf(cost, "costing_component_costs").find((c) => c.component_id === vehicleId).acquire_unit)).toBe(2160500)

        const participant = await readMatrix("stageParticipant")
        expect(participant.tables.costing_component_costs).toBeUndefined()
        expect(participant.tables.costing_cost_rows.every((r) => !("markup_price_unit" in r))).toBe(true)
    })

    it("follows the default for a row with no factor of its own, and keeps a row's override when the default changes", async () => {
        expect(await setMatrixMoney("ipasSigner", { default_factor: 2 })).toBeNull()
        const read = await readMatrix("dealOwner")
        expect(Number(markupUnitOf(read, boltsId))).toBe(36501) // x2.00 now
        expect(Number(markupUnitOf(read, vehicleId))).toBe(3175935) // its own x1.47 stays
        expect(Number(markupUnitOfRow(read, plainRowId))).toBe(333.33) // cost-only rows ignore the default
        expect(await setMatrixMoney("ipasSigner", { default_factor: 1.35 })).toBeNull()
    })

    it("leaves Final Offer where Sales typed it when the factor changes", async () => {
        const offer = async () => Number(tableOf(await readMatrix("dealOwner"), "costing_tender_line_prices").find((p) => p.tender_line_id === lineId).final_offer_unit)
        expect(await offer()).toBe(3300000)
        expect(await setMatrixMoney("ipasSigner", { default_factor: 3 })).toBeNull()
        expect(await setCost("ipasSigner", vehicleId, { markup_factor: 1.9 })).toBeNull()
        expect(await offer()).toBe(3300000)
        expect(await setCost("ipasSigner", vehicleId, { markup_factor: 1.47 })).toBeNull()
        expect(await setMatrixMoney("ipasSigner", { default_factor: 1.35 })).toBeNull()
    })

    it("gives no Markup Price while no factor is known for a Component", async () => {
        expect(await setMatrixMoney("ipasSigner", { default_factor: null })).toBeNull()
        const read = await readMatrix("dealOwner")
        expect(markupUnitOf(read, boltsId)).toBeNull()
        expect(Number(markupUnitOf(read, vehicleId))).toBe(3175935) // its own factor still prices it
        expect(await setMatrixMoney("ipasSigner", { default_factor: 1.35 })).toBeNull()
    })

    it("agrees with costingMath.markupPriceUnit to the centavo", async () => {
        const pairs = [
            [2160500, 1.47],
            [100000, 1],
            [18250.5, 1.35],
            [0.1, 1.05],
            [1.15, 1.1],
            [2.5, 1.35],
            [100.01, 1.35],
            [0.01, 1.5],
            [0.01, 1.49],
            [999999999.99, 2.0644],
            [12345.67, 1.3333],
            [333.33, 3],
            [0, 1.35],
            [1234.56, 0.9],
            [null, 1.35],
            [100, null],
        ]
        for (const [acquire, factor] of pairs) {
            const { rows } = await sql().query("select public.costing_markup_price($1::numeric, $2::numeric) as price", [acquire, factor])
            const fromSql = rows[0].price === null ? null : Number(rows[0].price)
            expect(fromSql, `${acquire} x ${factor}`).toBe(markupPriceUnit(acquire, factor))
        }
    })

    it("agrees with it through the read too, row by row", async () => {
        const read = await readMatrix("ipasSigner")
        for (const component of tableOf(read, "costing_component_costs")) {
            const factor = component.markup_factor ?? 1.35
            expect(component.markup_price_unit === null ? null : Number(component.markup_price_unit)).toBe(markupPriceUnit(component.acquire_unit, factor))
        }
        for (const row of tableOf(read, "costing_cost_rows")) {
            expect(row.markup_price_unit === null ? null : Number(row.markup_price_unit)).toBe(markupPriceUnit(row.acquire_unit, row.markup_factor ?? 1))
        }
    })
})

describe("the history", () => {
    it("shows a factor change to the Closed Book and nothing about it to anyone below", async () => {
        const closed = await (await clientFor("ipasSigner")).rpc("costing_history", { p_opportunity_id: sorId, p_table: "costing_matrix_money" })
        expect(closed.data.some((e) => e.detail.column === "default_factor" && e.actor_id === ids.ipasSigner)).toBe(true)

        for (const who of ["dealOwner", "outsider"]) {
            const below = await (await clientFor(who)).rpc("costing_history", { p_opportunity_id: sorId })
            expect(JSON.stringify(below.data), who).not.toMatch(/default_factor|default_preset_id|markup_factor/)
        }
    })
})

describe("the registries", () => {
    it("matches what src/constants/costing.js mirrors", async () => {
        const tiers = await asSvc(svc().from("costing_column_tiers").select("table_name, column_name, tiers").in("table_name", ["costing_matrix_money", "costing_component_costs", "costing_cost_rows"]), "tiers")
        for (const [column, expected] of Object.entries(MATRIX_MONEY_TIERS)) {
            const row = tiers.find((t) => t.table_name === "costing_matrix_money" && t.column_name === column)
            expect([...row.tiers].sort(), column).toEqual([...expected].sort())
        }
        for (const table of ["costing_component_costs", "costing_cost_rows"]) {
            const row = tiers.find((t) => t.table_name === table && t.column_name === "markup_price_unit")
            expect([...row.tiers].sort(), table).toEqual([...COMPONENT_COST_TIERS.markup_price_unit].sort())
        }

        const bands = await asSvc(svc().from("costing_column_bands").select("table_name, column_name, bands").eq("table_name", "costing_matrix_money"), "bands")
        for (const [column, expected] of Object.entries(MATRIX_MONEY_BANDS)) {
            expect([...bands.find((b) => b.column_name === column).bands].sort(), column).toEqual([...expected].sort())
        }
        // Markup Price is computed, never written: no band row can exist for it.
        const virtualBands = await asSvc(svc().from("costing_column_bands").select("column_name").eq("column_name", "markup_price_unit"), "bands")
        expect(virtualBands).toEqual([])
    })

    it("registers Markup Price as a computed column on both unit-cost tables", async () => {
        const virtual = await asSvc(svc().from("costing_virtual_columns").select("table_name").eq("column_name", "markup_price_unit"), "virtual")
        expect(virtual.map((v) => v.table_name).sort()).toEqual(["costing_component_costs", "costing_cost_rows"])
    })
})
