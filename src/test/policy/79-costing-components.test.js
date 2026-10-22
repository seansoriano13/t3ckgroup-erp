/**
 * Costing Matrix, Components, bundles, Inclusions and cost-only rows (#268, spec
 * #266, tiers from #319): who reads which columns, who writes which, the rules the
 * database holds (an Inclusion only under a bundle; a Sales incharge on the Deal
 * Team and a Purchasing incharge with Purchasing access), and the move of the old
 * sor_inclusions rows.
 *
 * The cast, on one SOR (dealOwner and support are its Deal Team):
 *   dealOwner, support  Deal Team                         -> price tier, Sales band
 *   outsider            Purchasing access, no part in it  -> cost tier, Purchasing band
 *   stageParticipant    open Stage Participant window     -> participant tier, no band
 *   finance             Finance access alone              -> no tier
 *   ipasSigner          on the final_acquire list         -> closed_book, Management band
 *   superAdmin                                            -> closed_book, Sales + Purchasing
 *   ordinary            nobody                            -> no tier
 *
 * The matrix is made with the service role (costing_open_matrix is not granted to
 * anyone else yet); every other assertion runs as a real cast member.
 * `costing_component_costs` is keyed by its Component and `costing_cost_rows` is a
 * money table keyed by its own id, so they have their own probes.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, rlsStatus } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { canRead, tryInsert, tryUpdate, tryDelete, RLS_VIOLATION } from "./support/access.js"
import { purgeCostingForSors } from "./support/costing.js"
import {
    COMPONENT_BANDS,
    COMPONENT_COST_BANDS,
    COMPONENT_COST_TIERS,
    COST_ROW_TIERS,
    COST_ROW_BANDS,
    INCLUSION_BANDS,
} from "../../constants/costing.js"

const svc = () => serviceClient()
const NO_ID = "00000000-0000-0000-0000-000000000000"
const CHECK_VIOLATION = "23514"
// #556: a refusal raised by a database function or trigger carries 22023; CHECK_VIOLATION is only for a table CHECK constraint.
const RULE_REFUSED = "22023"

let saleTypeId, flowId, stageId
let sorId, matrixId, otherSorId, otherMatrixId
let lineId
let bundleId, plainId
const sorIds = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

const readMatrix = async (who, opp = sorId) => {
    const { data, error } = await (await clientFor(who)).rpc("costing_matrix_read", { p_opportunity_id: opp })
    if (error) throw new Error(`costing_matrix_read as ${who}: ${error.message}`)
    return data
}

const history = async (who, args = {}) => {
    const { data, error } = await (await clientFor(who)).rpc("costing_history", { p_opportunity_id: sorId, ...args })
    if (error) throw new Error(`costing_history as ${who}: ${error.message}`)
    return data
}

/** Types a Component's unit costs as `who`: resolves to the RPC's error (null on success). */
const setCost = async (who, componentId, patch) => {
    const { error } = await (await clientFor(who)).rpc("costing_set_money", {
        p_table: "costing_component_costs",
        p_row: componentId,
        p_patch: patch,
    })
    return error
}

/** The same for a cost-only row. */
const setRowMoney = async (who, rowId, patch) => {
    const { error } = await (await clientFor(who)).rpc("costing_set_money", {
        p_table: "costing_cost_rows",
        p_row: rowId,
        p_patch: patch,
    })
    return error
}

const componentRow = (overrides = {}) => ({
    tender_line_id: lineId,
    position: 1,
    name: "Rescue tripod kit",
    quantity: 1,
    unit: "set",
    ...overrides,
})

async function addComponent(who, overrides) {
    const { data, error } = await (await clientFor(who)).from("costing_components").insert(componentRow(overrides)).select("id").single()
    if (error) throw new Error(`Adding a Component as ${who}: ${error.message}`)
    return data.id
}

const inclusionRow = (overrides = {}) => ({ component_id: bundleId, position: 1, description: "Carry bag", quantity: 1, ...overrides })

async function addInclusion(who, overrides) {
    const { data, error } = await (await clientFor(who)).from("costing_inclusions").insert(inclusionRow(overrides)).select("id").single()
    if (error) throw new Error(`Adding an Inclusion as ${who}: ${error.message}`)
    return data.id
}

const addCostRow = async (who, matrix = matrixId, description = "Delivery Charge", quantity = 1) => {
    const { data, error } = await (await clientFor(who)).rpc("costing_add_cost_row", {
        p_matrix_id: matrix,
        p_description: description,
        p_quantity: quantity,
    })
    return { id: data, error }
}

const moveInclusion = async (who, inclusionId, componentId) =>
    (await (await clientFor(who)).rpc("costing_move_inclusion", { p_inclusion_id: inclusionId, p_component_id: componentId })).error

const tableOf = (read, name) => read.tables[name] ?? []

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")

    saleTypeId = (await asSvc(svc().from("sale_types").insert({ name: `${MARKER} Components` }).select("id").single(), "sale type")).id
    flowId = (await asSvc(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "flow")).id
    stageId = (
        await asSvc(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Components Stage`, sort_order: 10 }).select("id").single(), "stage")
    ).id

    sorId = await makeSor({
        registeredBy: ids.dealOwner,
        dealOwnerId: ids.dealOwner,
        supportSales1Id: ids.support,
        saleTypeId,
        flowStageId: stageId,
    })
    otherSorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageId })
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

    await asSvc(svc().from("costing_signer_lists").insert({ list_key: "final_acquire", employee_id: ids.ipasSigner }), "signer list")

    const opened = await svc().rpc("costing_open_matrix", { p_opportunity_id: sorId })
    if (opened.error) throw new Error(`costing_open_matrix: ${opened.error.message}`)
    matrixId = opened.data
    const openedOther = await svc().rpc("costing_open_matrix", { p_opportunity_id: otherSorId })
    if (openedOther.error) throw new Error(`costing_open_matrix: ${openedOther.error.message}`)
    otherMatrixId = openedOther.data

    lineId = (
        await asSvc(
            svc().from("costing_tender_lines").insert({ matrix_id: matrixId, position: 1, tender_specification: "Rescue tripod", quantity: 2, created_by: ids.dealOwner }).select("id").single(),
            "Tender Line",
        )
    ).id
})

afterAll(async () => {
    await svc().from("costing_signer_lists").delete().eq("employee_id", ids.ipasSigner)
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeCostingForSors(sorIds)
    await svc().from("sor_inclusions").delete().in("opportunity_id", sorIds)
    await svc().from("sor_stage_participants").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("Components: who writes", () => {
    it("lets Sales add a Component and write its Sales columns", async () => {
        plainId = await addComponent("dealOwner", { name: "Tripod head", brand: "Petzl", status: "stockable" })
        const edit = await tryUpdate(await clientFor("support"), "costing_components", plainId, { brand: "Kong", status: "source_out", unit: "pc", quantity: 2 })
        expect(edit).toEqual({ ok: true, affected: 1 })
        const row = await asSvc(svc().from("costing_components").select("*").eq("id", plainId).single(), "Component")
        expect(row).toMatchObject({ brand: "Kong", status: "source_out", unit: "pc", is_bundle: false, odoo_product_id: null })
    })

    it("lets Purchasing add a Component and write its Purchasing columns", async () => {
        bundleId = await addComponent("outsider", { position: 2, name: "Rescue vehicle", is_bundle: true, odoo_product_id: 8123 })
        const edit = await tryUpdate(await clientFor("outsider"), "costing_components", bundleId, {
            offer_specification: "4x4 pick-up, 13 lines",
            availability: "for_order",
            source: "import",
            po_rfq_no: "RFQ-2231",
        })
        expect(edit).toEqual({ ok: true, affected: 1 })
    })

    it("lets Purchasing write Brand, refuses Purchasing Status, and Sales the Purchasing columns, naming the band", async () => {
        const brand = await tryUpdate(await clientFor("outsider"), "costing_components", plainId, { brand: "Other" })
        expect(brand).toEqual({ ok: true, affected: 1 })
        const status = await tryUpdate(await clientFor("outsider"), "costing_components", plainId, { status: "stockable" })
        expect(status.message).toBe("costing_band:costing_components.status:sales")

        for (const [column, value] of [
            ["offer_specification", "x"],
            ["availability", "available"],
            ["source", "local"],
            ["po_rfq_no", "RFQ-1"],
        ]) {
            const refused = await tryUpdate(await clientFor("dealOwner"), "costing_components", plainId, { [column]: value })
            expect(refused, column).toMatchObject({ ok: false, code: RLS_VIOLATION })
            expect(refused.message).toBe(`costing_band:costing_components.${column}:purchasing`)
        }
    })

    it("lets a Super Admin write both Sales and Purchasing columns", async () => {
        const edit = await tryUpdate(await clientFor("superAdmin"), "costing_components", plainId, { brand: "Petzl", po_rfq_no: "RFQ-7" })
        expect(edit).toEqual({ ok: true, affected: 1 })
        await tryUpdate(await clientFor("superAdmin"), "costing_components", plainId, { po_rfq_no: null })
    })

    it("refuses a Stage Participant, the Final Acquire list and a plain employee adding or removing one", async () => {
        const participant = await tryInsert(await clientFor("stageParticipant"), "costing_components", componentRow())
        expect(participant).toMatchObject({ ok: false, code: RLS_VIOLATION })
        expect(participant.message).toBe("costing_band:costing_components.*:sales,purchasing")

        // The Final Acquire list is Management, not Sales or Purchasing.
        const signer = await tryInsert(await clientFor("ipasSigner"), "costing_components", componentRow())
        expect(signer.message).toBe("costing_band:costing_components.*:sales,purchasing")

        const remove = await tryDelete(await clientFor("stageParticipant"), "costing_components", plainId)
        expect(remove.message).toBe("costing_band:costing_components.*:sales,purchasing")

        const ordinary = await tryInsert(await clientFor("ordinary"), "costing_components", componentRow())
        expect(ordinary).toMatchObject({ ok: false, code: RLS_VIOLATION })
        expect(await tryUpdate(await clientFor("ordinary"), "costing_components", plainId, { name: "x" })).toEqual({ ok: true, affected: 0 })
        expect(await tryInsert(await clientFor("finance"), "costing_components", componentRow())).toMatchObject({ ok: false, code: RLS_VIOLATION })
    })

    it("refuses a Component with a quantity of zero, or a status outside the list", async () => {
        const zero = await tryInsert(await clientFor("dealOwner"), "costing_components", componentRow({ quantity: 0 }))
        expect(zero).toMatchObject({ ok: false, code: CHECK_VIOLATION })
        const odd = await tryUpdate(await clientFor("dealOwner"), "costing_components", plainId, { status: "maybe" })
        expect(odd).toMatchObject({ ok: false, code: CHECK_VIOLATION })
    })
})

describe("Component costs: who writes", () => {
    it("refuses Sales Acquire, and Purchasing the Odoo unit cost, naming the band", async () => {
        expect((await setCost("dealOwner", plainId, { acquire_unit: 100 }))?.message).toBe("costing_band:costing_component_costs.acquire_unit:purchasing")
        expect((await setCost("outsider", plainId, { odoo_unit: 100 }))?.message).toBe("costing_band:costing_component_costs.odoo_unit:sales")
        expect((await setCost("outsider", plainId, { odoo_unit: 100 }))?.code).toBe(RLS_VIOLATION)
        const none = await svc().from("costing_component_costs").select("component_id").eq("component_id", plainId)
        expect(none.data).toEqual([])
    })

    it("lets Purchasing write Acquire and Sales write the Odoo unit cost, on the same row", async () => {
        expect(await setCost("outsider", plainId, { acquire_unit: 18250.5 })).toBeNull()
        expect(await setCost("dealOwner", plainId, { odoo_unit: 19000 })).toBeNull()
        const row = await asSvc(svc().from("costing_component_costs").select("*").eq("component_id", plainId).single(), "costs")
        expect(Number(row.acquire_unit)).toBe(18250.5)
        expect(Number(row.odoo_unit)).toBe(19000)
    })

    it("lets a Super Admin write both, and clears a cost with null", async () => {
        expect(await setCost("superAdmin", plainId, { acquire_unit: 18300, odoo_unit: 19100 })).toBeNull()
        expect(await setCost("superAdmin", plainId, { odoo_unit: null })).toBeNull()
        const row = await asSvc(svc().from("costing_component_costs").select("*").eq("component_id", plainId).single(), "costs")
        expect(Number(row.acquire_unit)).toBe(18300)
        expect(row.odoo_unit).toBeNull()
        expect(await setCost("dealOwner", plainId, { odoo_unit: 19000 })).toBeNull()
        expect(await setCost("outsider", plainId, { acquire_unit: 18250.5 })).toBeNull()
    })

    it("keeps Final Acquire and the markup factor to the Final Acquire list, a Super Admin included", async () => {
        for (const who of ["outsider", "dealOwner", "superAdmin"]) {
            expect((await setCost(who, plainId, { final_acquire_unit: 1 }))?.message, who).toBe("costing_band:costing_component_costs.final_acquire_unit:management")
            expect((await setCost(who, plainId, { markup_factor: 1.35 }))?.message, who).toBe("costing_band:costing_component_costs.markup_factor:management")
        }
        expect(await setCost("ipasSigner", plainId, { final_acquire_unit: 17900, markup_factor: 1.35 })).toBeNull()
        const row = await asSvc(svc().from("costing_component_costs").select("*").eq("component_id", plainId).single(), "costs")
        expect(Number(row.final_acquire_unit)).toBe(17900)
        expect(Number(row.markup_factor)).toBe(1.35)
        // And the list does not write Purchasing's or Sales's columns.
        expect((await setCost("ipasSigner", plainId, { acquire_unit: 1 }))?.message).toBe("costing_band:costing_component_costs.acquire_unit:purchasing")
    })

    it("lets the Final Acquire list type before anyone else has", async () => {
        const fresh = await addComponent("dealOwner", { position: 3, name: "Fresh" })
        expect(await setCost("ipasSigner", fresh, { final_acquire_unit: 500 })).toBeNull()
        await tryDelete(await clientFor("dealOwner"), "costing_components", fresh)
    })

    it("refuses a Stage Participant and a plain employee any cost", async () => {
        expect((await setCost("stageParticipant", plainId, { acquire_unit: 1 }))?.message).toBe("costing_band:costing_component_costs.acquire_unit:purchasing")
        expect((await setCost("stageParticipant", plainId, { odoo_unit: 1 }))?.message).toBe("costing_band:costing_component_costs.odoo_unit:sales")
        expect((await setCost("ordinary", plainId, { acquire_unit: 1 }))?.code).toBe(RLS_VIOLATION)
        expect((await setCost("finance", plainId, { acquire_unit: 1 }))?.code).toBe(RLS_VIOLATION)
    })

    it("refuses what is not a cost column, a Component that is not there, and a negative cost", async () => {
        expect((await setCost("outsider", plainId, { component_id: NO_ID }))?.code).toBe("22023")
        expect((await setCost("outsider", plainId, { nonsense: 1 }))?.code).toBe("22023")
        expect((await setCost("outsider", NO_ID, { acquire_unit: 1 }))?.code).toBe("22023")
        expect((await setCost("outsider", plainId, { acquire_unit: -1 }))?.code).toBe(CHECK_VIOLATION)
        expect((await setCost("ipasSigner", plainId, { markup_factor: 0 }))?.code).toBe(CHECK_VIOLATION)
    })
})

describe("bundles and Inclusions", () => {
  it("refuses an Inclusion under a Component that is not a bundle", async () => {
    const insert = await tryInsert(await clientFor("dealOwner"), "costing_inclusions", inclusionRow({ component_id: plainId }))
    expect(insert).toMatchObject({ ok: false, code: RULE_REFUSED })
    expect(insert.message).toMatch(/only sit under a bundle/)
    const asService = await svc().from("costing_inclusions").insert(inclusionRow({ component_id: plainId }))
    expect(asService.error?.code).toBe(RULE_REFUSED)
  })

  it("lets Sales and Purchasing add and edit Inclusions under a bundle, with a heading", async () => {
    const first = await addInclusion("dealOwner", { heading: "Accessories", description: "Carry bag" })
    const second = await addInclusion("outsider", { position: 2, heading: "With", description: "Spare key", quantity: 2, unit: "pc" })
    const edit = await tryUpdate(await clientFor("dealOwner"), "costing_inclusions", first, { description: "Carry bag (black)", heading: "Accessories" })
    expect(edit).toEqual({ ok: true, affected: 1 })
    const rows = await asSvc(svc().from("costing_inclusions").select("*").eq("component_id", bundleId).order("position"), "Inclusions")
    expect(rows.map((r) => [r.heading, r.description, r.completeness])).toEqual([
      ["Accessories", "Carry bag (black)", "MISSING"],
      ["With", "Spare key", "MISSING"],
    ])
    expect(Number(rows[1].quantity)).toBe(2)
    expect(second).toBeDefined()
  })

  it("keeps Completeness to Technical: Sales is refused, Purchasing and a Super Admin pass", async () => {
    const [{ id }] = await asSvc(svc().from("costing_inclusions").select("id").eq("component_id", bundleId).order("position").limit(1), "Inclusion")
    const sales = await tryUpdate(await clientFor("dealOwner"), "costing_inclusions", id, { completeness: "COVERED" })
    expect(sales).toMatchObject({ ok: false, code: RLS_VIOLATION })
    expect(sales.message).toBe("costing_band:costing_inclusions.completeness:technical")
    expect(await tryUpdate(await clientFor("outsider"), "costing_inclusions", id, { completeness: "COVERED" })).toEqual({ ok: true, affected: 1 })
    expect(await tryUpdate(await clientFor("superAdmin"), "costing_inclusions", id, { completeness: "SUBSTITUTED" })).toEqual({ ok: true, affected: 1 })
    expect((await tryUpdate(await clientFor("superAdmin"), "costing_inclusions", id, { completeness: "MAYBE" })).code).toBe(CHECK_VIOLATION)
    // Adding one at a Completeness other than the default is Technical's, too.
    const added = await tryInsert(await clientFor("dealOwner"), "costing_inclusions", inclusionRow({ position: 9, completeness: "COVERED" }))
    expect(added.message).toBe("costing_band:costing_inclusions.completeness:technical")
  })

  it("refuses a Stage Participant, and a plain employee, adding or removing an Inclusion", async () => {
    const [{ id }] = await asSvc(svc().from("costing_inclusions").select("id").eq("component_id", bundleId).limit(1), "Inclusion")
    const add = await tryInsert(await clientFor("stageParticipant"), "costing_inclusions", inclusionRow({ position: 8 }))
    expect(add.message).toBe("costing_band:costing_inclusions.*:sales,purchasing")
    const remove = await tryDelete(await clientFor("stageParticipant"), "costing_inclusions", id)
    expect(remove.message).toBe("costing_band:costing_inclusions.*:sales,purchasing")
    expect(await tryInsert(await clientFor("ordinary"), "costing_inclusions", inclusionRow({ position: 8 }))).toMatchObject({ ok: false, code: RLS_VIOLATION })
  })

  it("moves an Inclusion under another bundle at the end of its list, and refuses a non-bundle target", async () => {
    const second = await addComponent("outsider", { position: 3, name: "Second bundle", is_bundle: true })
    const [{ id }] = await asSvc(svc().from("costing_inclusions").select("id").eq("component_id", bundleId).order("position").limit(1), "Inclusion")

    expect((await moveInclusion("dealOwner", id, plainId))?.code).toBe(RULE_REFUSED)
    expect((await moveInclusion("dealOwner", id, plainId))?.message).toMatch(/only sit under a bundle/)
    expect(await moveInclusion("dealOwner", id, second)).toBeNull()
    const moved = await asSvc(svc().from("costing_inclusions").select("component_id, position").eq("id", id).single(), "moved")
    expect(moved).toEqual({ component_id: second, position: 1 })

    // Back again: it lands after what is already there.
    expect(await moveInclusion("outsider", id, bundleId)).toBeNull()
    const back = await asSvc(svc().from("costing_inclusions").select("position").eq("id", id).single(), "back")
    expect(back.position).toBe(3)
    await tryDelete(await clientFor("outsider"), "costing_components", second)
  })

  it("refuses a move by someone outside both bands, to another SOR's bundle, or to nothing", async () => {
    const [{ id }] = await asSvc(svc().from("costing_inclusions").select("id").eq("component_id", bundleId).limit(1), "Inclusion")
    const spare = (
      await asSvc(svc().from("costing_components").insert(componentRow({ position: 5, name: "Spare bundle", is_bundle: true })).select("id").single(), "spare bundle")
    ).id
    const foreignLine = (
      await asSvc(svc().from("costing_tender_lines").insert({ matrix_id: otherMatrixId, position: 1, tender_specification: "Other" }).select("id").single(), "line")
    ).id
    const foreignBundle = (
      await asSvc(svc().from("costing_components").insert({ tender_line_id: foreignLine, position: 1, name: "Foreign bundle", is_bundle: true }).select("id").single(), "bundle")
    ).id

    expect((await moveInclusion("stageParticipant", id, spare))?.message).toBe("costing_band:costing_inclusions.component_id:sales,purchasing")
    expect((await moveInclusion("ordinary", id, spare))?.code).toBe(RLS_VIOLATION)
    expect((await moveInclusion("dealOwner", id, foreignBundle))?.code).toBe("22023")
    expect((await moveInclusion("dealOwner", id, NO_ID))?.code).toBe("22023")
    expect((await moveInclusion("dealOwner", NO_ID, spare))?.code).toBe("22023")
  })

  it("keeps a bundle a bundle while it lists Inclusions", async () => {
    const refused = await tryUpdate(await clientFor("dealOwner"), "costing_components", bundleId, { is_bundle: false })
    expect(refused).toMatchObject({ ok: false, code: RULE_REFUSED })
    expect(refused.message).toMatch(/before it stops being a bundle/)
    // A Component with no Inclusions may stop being one.
    expect(await tryUpdate(await clientFor("dealOwner"), "costing_components", plainId, { is_bundle: true })).toEqual({ ok: true, affected: 1 })
    expect(await tryUpdate(await clientFor("dealOwner"), "costing_components", plainId, { is_bundle: false })).toEqual({ ok: true, affected: 1 })
  })
})

describe("cost-only rows", () => {
  let rowId

  it("lets Sales and Purchasing add one, which starts at a x1.00 factor and no money", async () => {
    const byPurchasing = await addCostRow("outsider", matrixId, "Delivery Charge", 1)
    expect(byPurchasing.error).toBeNull()
    rowId = byPurchasing.id
    const bySales = await addCostRow("dealOwner", matrixId, "Permits", 2)
    expect(bySales.error).toBeNull()
    const rows = await asSvc(svc().from("costing_cost_rows").select("*").eq("matrix_id", matrixId).order("position"), "cost rows")
    expect(rows.map((r) => [r.position, r.description, Number(r.quantity)])).toEqual([
      [1, "Delivery Charge", 1],
      [2, "Permits", 2],
    ])
    expect(Number(rows[0].markup_factor)).toBe(1)
    expect(rows[0].acquire_unit).toBeNull()
    expect((await (await clientFor("dealOwner")).rpc("costing_remove_cost_row", { p_row_id: bySales.id })).error).toBeNull()
  })

  it("writes description and quantity for Sales or Purchasing, money by column band", async () => {
    expect(await setRowMoney("dealOwner", rowId, { description: "Delivery Charge (Davao)", quantity: 1 })).toBeNull()
    expect(await setRowMoney("outsider", rowId, { acquire_unit: 80000 })).toBeNull()
    expect(await setRowMoney("dealOwner", rowId, { odoo_unit: 90000 })).toBeNull()
    expect((await setRowMoney("dealOwner", rowId, { acquire_unit: 1 }))?.message).toBe("costing_band:costing_cost_rows.acquire_unit:purchasing")
    expect((await setRowMoney("outsider", rowId, { odoo_unit: 1 }))?.message).toBe("costing_band:costing_cost_rows.odoo_unit:sales")
    expect((await setRowMoney("superAdmin", rowId, { final_acquire_unit: 1 }))?.message).toBe("costing_band:costing_cost_rows.final_acquire_unit:management")
    expect((await setRowMoney("outsider", rowId, { markup_factor: 2 }))?.message).toBe("costing_band:costing_cost_rows.markup_factor:management")
    expect(await setRowMoney("ipasSigner", rowId, { final_acquire_unit: 75000, markup_factor: 1 })).toBeNull()
    const row = await asSvc(svc().from("costing_cost_rows").select("*").eq("id", rowId).single(), "cost row")
    expect(row).toMatchObject({ description: "Delivery Charge (Davao)" })
    expect(Number(row.acquire_unit)).toBe(80000)
    expect(Number(row.odoo_unit)).toBe(90000)
    expect(Number(row.final_acquire_unit)).toBe(75000)
  })

  it("refuses a Stage Participant and a plain employee adding, typing in or removing one", async () => {
    const add = await addCostRow("stageParticipant")
    expect(add.error?.message).toBe("costing_band:costing_cost_rows.*:sales,purchasing")
    expect((await setRowMoney("stageParticipant", rowId, { description: "x" }))?.message).toBe("costing_band:costing_cost_rows.description:sales,purchasing")
    expect((await setRowMoney("stageParticipant", rowId, { acquire_unit: 1 }))?.message).toBe("costing_band:costing_cost_rows.acquire_unit:purchasing")
    const remove = await (await clientFor("stageParticipant")).rpc("costing_remove_cost_row", { p_row_id: rowId })
    expect(remove.error?.message).toBe("costing_band:costing_cost_rows.*:sales,purchasing")

    expect((await addCostRow("ordinary")).error?.code).toBe(RLS_VIOLATION)
    expect((await addCostRow("finance")).error?.code).toBe(RLS_VIOLATION)
    expect((await setRowMoney("ordinary", rowId, { description: "x" }))?.code).toBe(RLS_VIOLATION)
    expect((await (await clientFor("ordinary")).rpc("costing_remove_cost_row", { p_row_id: rowId })).error?.code).toBe(RLS_VIOLATION)
  })

  it("refuses an unknown matrix or row, and a quantity of zero", async () => {
    expect((await addCostRow("dealOwner", NO_ID)).error?.code).toBe("22023")
    expect((await addCostRow("dealOwner", matrixId, "Zero", 0)).error?.code).toBe(CHECK_VIOLATION)
    expect((await setRowMoney("dealOwner", NO_ID, { description: "x" }))?.code).toBe("22023")
    expect((await (await clientFor("dealOwner")).rpc("costing_remove_cost_row", { p_row_id: NO_ID })).error?.code).toBe("22023")
  })

  it("removes one for Sales or Purchasing, and keeps it in the history", async () => {
    const doomed = await addCostRow("dealOwner", matrixId, "Doomed")
    expect(await setRowMoney("outsider", doomed.id, { acquire_unit: 12 })).toBeNull()
    const remove = await (await clientFor("outsider")).rpc("costing_remove_cost_row", { p_row_id: doomed.id })
    expect(remove.error).toBeNull()
    const gone = await asSvc(svc().from("costing_cost_rows").select("id").eq("id", doomed.id), "gone")
    expect(gone).toEqual([])

    const closed = await history("ipasSigner", { p_table: "costing_cost_rows", p_row: doomed.id })
    const removed = closed.find((e) => e.kind === "removed")
    expect(removed.detail.values).toMatchObject({ description: "Doomed", acquire_unit: 12 })
    // A participant sees the row went, with its description and nothing of the money.
    const participant = await history("stageParticipant", { p_table: "costing_cost_rows", p_row: doomed.id })
    expect(participant.find((e) => e.kind === "removed").detail.values).toMatchObject({ description: "Doomed" })
    expect(JSON.stringify(participant)).not.toMatch(/acquire_unit|markup_factor/)
  })
})

describe("Incharge", () => {
  it("lets the Deal Team name a Sales incharge from itself, and Purchasing a Purchasing incharge with Purchasing access", async () => {
    const sales = await tryUpdate(await clientFor("dealOwner"), "costing_matrices", matrixId, { sales_incharge_id: ids.support })
    expect(sales).toEqual({ ok: true, affected: 1 })
    const buyer = await tryUpdate(await clientFor("outsider"), "costing_matrices", matrixId, { purchasing_incharge_id: ids.outsider })
    expect(buyer).toEqual({ ok: true, affected: 1 })
    const row = await asSvc(svc().from("costing_matrices").select("sales_incharge_id, purchasing_incharge_id").eq("id", matrixId).single(), "matrix")
    expect(row).toEqual({ sales_incharge_id: ids.support, purchasing_incharge_id: ids.outsider })
  })

  it("refuses a Sales incharge off the Deal Team, and a Purchasing incharge without Purchasing access", async () => {
    const offTeam = await tryUpdate(await clientFor("dealOwner"), "costing_matrices", matrixId, { sales_incharge_id: ids.ordinary })
    expect(offTeam).toMatchObject({ ok: false, code: RULE_REFUSED })
    expect(offTeam.message).toMatch(/Sales incharge must be on the SOR's Deal Team/)

    const noAccess = await tryUpdate(await clientFor("outsider"), "costing_matrices", matrixId, { purchasing_incharge_id: ids.finance })
    expect(noAccess).toMatchObject({ ok: false, code: RULE_REFUSED })
    expect(noAccess.message).toMatch(/Purchasing incharge must have Purchasing access/)

    // Not even the service role gets around it.
    const direct = await svc().from("costing_matrices").update({ sales_incharge_id: ids.ordinary }).eq("id", matrixId)
    expect(direct.error?.code).toBe(RULE_REFUSED)
    const row = await asSvc(svc().from("costing_matrices").select("sales_incharge_id, purchasing_incharge_id").eq("id", matrixId).single(), "matrix")
    expect(row).toEqual({ sales_incharge_id: ids.support, purchasing_incharge_id: ids.outsider })
  })

  it("writes the Sales incharge by the Sales band and the Purchasing incharge by the Purchasing band", async () => {
    const crossed = await tryUpdate(await clientFor("dealOwner"), "costing_matrices", matrixId, { purchasing_incharge_id: ids.outsider })
    // Unchanged value: no write, no refusal. A different one is refused.
    expect(crossed.ok).toBe(true)
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.support), "second buyer")
    try {
      const refused = await tryUpdate(await clientFor("dealOwner"), "costing_matrices", matrixId, { purchasing_incharge_id: ids.support })
      expect(refused.message).toBe("costing_band:costing_matrices.purchasing_incharge_id:purchasing")
      const refusedSales = await tryUpdate(await clientFor("outsider"), "costing_matrices", matrixId, { sales_incharge_id: ids.dealOwner })
      expect(refusedSales.message).toBe("costing_band:costing_matrices.sales_incharge_id:sales")
    } finally {
      await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.support)
    }
  })

  it("overrides either incharge on one Component, held to the same rules and bands", async () => {
    expect(await tryUpdate(await clientFor("dealOwner"), "costing_components", plainId, { sales_incharge_id: ids.dealOwner })).toEqual({ ok: true, affected: 1 })
    expect(await tryUpdate(await clientFor("outsider"), "costing_components", plainId, { purchasing_incharge_id: ids.outsider })).toEqual({ ok: true, affected: 1 })
    const offTeam = await tryUpdate(await clientFor("dealOwner"), "costing_components", plainId, { sales_incharge_id: ids.ordinary })
    expect(offTeam).toMatchObject({ ok: false, code: RULE_REFUSED })
    const noAccess = await tryUpdate(await clientFor("outsider"), "costing_components", plainId, { purchasing_incharge_id: ids.finance })
    expect(noAccess).toMatchObject({ ok: false, code: RULE_REFUSED })
    const wrongBand = await tryUpdate(await clientFor("outsider"), "costing_components", plainId, { sales_incharge_id: ids.support })
    expect(wrongBand.message).toBe("costing_band:costing_components.sales_incharge_id:sales")
    // Back to the matrix default.
    expect(await tryUpdate(await clientFor("dealOwner"), "costing_components", plainId, { sales_incharge_id: null })).toEqual({ ok: true, affected: 1 })
    expect(await tryUpdate(await clientFor("outsider"), "costing_components", plainId, { purchasing_incharge_id: null })).toEqual({ ok: true, affected: 1 })
  })

  it("is only a label: naming someone changes nobody's tier or bands", async () => {
    const read = await readMatrix("support")
    expect(read.tier).toBe("price")
    expect([...read.bands].sort()).toEqual(["sales"])
    const buyer = await readMatrix("outsider")
    expect(buyer.tier).toBe("cost")
    expect([...buyer.bands].sort()).toEqual(["purchasing", "technical"])
  })
})

describe("who reads what", () => {
  it("serves a Stage Participant the Components, Inclusions and cost-only rows with no money at all", async () => {
    const read = await readMatrix("stageParticipant")
    expect(read.tier).toBe("participant")
    expect(Object.keys(read.tables)).not.toContain("costing_component_costs")
    expect(Object.keys(read.tables)).not.toContain("costing_tender_line_prices")
    const component = tableOf(read, "costing_components").find((c) => c.id === bundleId)
    expect(component).toMatchObject({ name: "Rescue vehicle", is_bundle: true, offer_specification: "4x4 pick-up, 13 lines", odoo_product_id: 8123 })
    expect(tableOf(read, "costing_inclusions").length).toBeGreaterThan(0)
    const [row] = tableOf(read, "costing_cost_rows")
    expect(Object.keys(row).sort()).toEqual(["created_at", "description", "id", "matrix_id", "position", "quantity"])
    expect(JSON.stringify(read)).not.toMatch(/acquire_unit|odoo_unit|final_acquire_unit|markup_factor|legacy_sor_inclusion/)
  })

  it("serves the price side the Odoo unit cost and nothing of Acquire, Final Acquire or the factor", async () => {
    const read = await readMatrix("dealOwner")
    expect(read.tier).toBe("price")
    const costs = tableOf(read, "costing_component_costs").find((c) => c.component_id === plainId)
    // Markup Price per unit (#269) is the one computed column the price tier gets besides the Odoo unit cost.
    expect(Object.keys(costs).sort()).toEqual(["component_id", "markup_price_unit", "odoo_unit"])
    expect(Number(costs.odoo_unit)).toBe(19000)
    const [row] = tableOf(read, "costing_cost_rows")
    // A cost-only row's Markup Price (Acquire x1.00) would give Acquire away: not served to the price tier.
    expect(Object.keys(row).sort()).toEqual(["created_at", "description", "id", "matrix_id", "odoo_unit", "position", "quantity"])
    expect(JSON.stringify(read)).not.toMatch(/acquire_unit|final_acquire_unit|markup_factor/)
  })

  it("serves Purchasing Acquire and the Odoo unit cost, but not Final Acquire or the factor", async () => {
    const read = await readMatrix("outsider")
    expect(read.tier).toBe("cost")
    const costs = tableOf(read, "costing_component_costs").find((c) => c.component_id === plainId)
    expect(Object.keys(costs).sort()).toEqual(["acquire_from_offer_id", "acquire_unit", "component_id", "odoo_unit"])
    const [row] = tableOf(read, "costing_cost_rows")
    expect(Object.keys(row).sort()).toEqual(["acquire_unit", "created_at", "description", "id", "matrix_id", "odoo_unit", "position", "quantity"])
    expect(JSON.stringify(read)).not.toMatch(/final_acquire_unit|markup_factor/)
  })

  it("serves a Super Admin and the Final Acquire list every column", async () => {
    for (const who of ["superAdmin", "ipasSigner"]) {
      const read = await readMatrix(who)
      expect(read.tier).toBe("closed_book")
      const costs = tableOf(read, "costing_component_costs").find((c) => c.component_id === plainId)
      expect(Object.keys(costs).sort(), who).toEqual(["acquire_from_offer_id", "acquire_unit", "component_id", "final_acquire_unit", "markup_factor", "markup_price_unit", "odoo_unit"])
      const [row] = tableOf(read, "costing_cost_rows")
      expect(Object.keys(row), who).toEqual(expect.arrayContaining(["acquire_unit", "odoo_unit", "final_acquire_unit", "markup_factor", "description", "quantity"]))
      // The id of an old Inclusion is internal and never served.
      expect(Object.keys(tableOf(read, "costing_inclusions")[0])).not.toContain("legacy_sor_inclusion_id")
    }
  })

  it("serves Finance access alone and a plain employee nothing", async () => {
    expect(await readMatrix("finance")).toBeNull()
    expect(await readMatrix("ordinary")).toBeNull()
  })

  it("keeps the money tables closed: only the closed_book tier selects them directly", async () => {
    const costs = async (who) =>
      (await (await clientFor(who)).from("costing_component_costs").select("component_id").eq("component_id", plainId)).data.length
    const rows = async (who) => (await (await clientFor(who)).from("costing_cost_rows").select("id").eq("matrix_id", matrixId)).data.length
    for (const who of ["stageParticipant", "dealOwner", "outsider", "finance", "ordinary"]) {
      expect(await costs(who), who).toBe(0)
      expect(await rows(who), who).toBe(0)
    }
    for (const who of ["superAdmin", "ipasSigner"]) {
      expect(await costs(who), who).toBe(1)
      expect(await rows(who), who).toBeGreaterThan(0)
    }
  })

  it("lets the non-money tables be read by any tier, and nobody else", async () => {
    for (const who of ["stageParticipant", "dealOwner", "outsider", "superAdmin", "ipasSigner"]) {
      expect(await canRead(await clientFor(who), "costing_components", plainId), who).toBe(true)
    }
    for (const who of ["ordinary", "finance"]) {
      expect(await canRead(await clientFor(who), "costing_components", plainId), who).toBe(false)
    }
  })

  it("matches the registries the screen mirrors in src/constants/costing.js", async () => {
    const tiers = await asSvc(svc().from("costing_column_tiers").select("table_name, column_name, tiers").in("table_name", ["costing_component_costs", "costing_cost_rows"]), "tiers")
    for (const [table, mirror] of [["costing_component_costs", COMPONENT_COST_TIERS], ["costing_cost_rows", COST_ROW_TIERS]]) {
      for (const [column, expected] of Object.entries(mirror)) {
        const row = tiers.find((t) => t.table_name === table && t.column_name === column)
        expect([...row.tiers].sort(), `${table}.${column}`).toEqual([...expected].sort())
      }
    }

    const bands = await asSvc(svc().from("costing_column_bands").select("table_name, column_name, bands").in("table_name", ["costing_components", "costing_component_costs", "costing_inclusions", "costing_cost_rows"]), "bands")
    const bandsOf = (table, column) => [...(bands.find((b) => b.table_name === table && b.column_name === column)?.bands ?? [])].sort()
    const mirrors = [
      ["costing_components", COMPONENT_BANDS],
      ["costing_component_costs", COMPONENT_COST_BANDS],
      ["costing_inclusions", INCLUSION_BANDS],
      ["costing_cost_rows", COST_ROW_BANDS],
    ]
    for (const [table, mirror] of mirrors) {
      for (const [column, expected] of Object.entries(mirror)) {
        expect(bandsOf(table, column), `${table}.${column}`).toEqual([...expected].sort())
      }
    }
  })

  it("has row level security on every Components table", async () => {
    for (const table of ["costing_components", "costing_component_costs", "costing_inclusions", "costing_cost_rows"]) {
      expect((await rlsStatus(table)).enabled, table).toBe(true)
    }
  })
})

describe("the history", () => {
  it("records a Component's costs by who typed them, to the tier that may read each column", async () => {
    const price = await history("dealOwner", { p_table: "costing_component_costs", p_row: plainId })
    expect(price.every((e) => e.detail.column === "odoo_unit" || e.detail.values)).toBe(true)
    expect(JSON.stringify(price)).not.toMatch(/acquire_unit|final_acquire_unit|markup_factor/)

    const cost = await history("outsider", { p_table: "costing_component_costs", p_row: plainId })
    const acquire = cost.find((e) => e.detail.column === "acquire_unit" && e.detail.new === 18250.5)
    expect(acquire).toMatchObject({ actor_id: ids.outsider, kind: "changed" })
    expect(JSON.stringify(cost)).not.toMatch(/final_acquire_unit|markup_factor/)

    const closed = await history("ipasSigner", { p_table: "costing_component_costs", p_row: plainId })
    expect(closed.some((e) => e.detail.column === "final_acquire_unit" && e.detail.new === 17900)).toBe(true)
  })

  it("keeps a removed Tender Line with its Components, their costs and Inclusions", async () => {
    const line = (
      await asSvc(svc().from("costing_tender_lines").insert({ matrix_id: matrixId, position: 7, tender_specification: "To be removed", quantity: 1 }).select("id").single(), "line")
    ).id
    const comp = (
      await asSvc(
        svc().from("costing_components").insert({ tender_line_id: line, position: 1, name: "Doomed bundle", is_bundle: true, quantity: 1 }).select("id").single(),
        "Component",
      )
    ).id
    await asSvc(svc().from("costing_inclusions").insert({ component_id: comp, position: 1, description: "Doomed accessory" }), "Inclusion")
    expect(await setCost("outsider", comp, { acquire_unit: 777 })).toBeNull()

    expect(await tryDelete(await clientFor("dealOwner"), "costing_tender_lines", line)).toEqual({ ok: true, affected: 1 })
    expect(await asSvc(svc().from("costing_components").select("id").eq("id", comp), "gone")).toEqual([])
    expect(await asSvc(svc().from("costing_component_costs").select("component_id").eq("component_id", comp), "gone")).toEqual([])

    const closed = await history("ipasSigner", { p_row: comp })
    expect(closed.find((e) => e.kind === "removed" && e.detail.table === "costing_components").detail.values).toMatchObject({ name: "Doomed bundle" })
    expect(closed.find((e) => e.kind === "removed" && e.detail.table === "costing_component_costs").detail.values).toMatchObject({ acquire_unit: 777 })
    const participant = await history("stageParticipant", { p_row: comp })
    expect(participant.some((e) => e.kind === "removed" && e.detail.table === "costing_components")).toBe(true)
    expect(participant.every((e) => e.detail.table !== "costing_component_costs")).toBe(true)
  })

  it("lets a Purchasing user remove a Component with its costs, and refuses a Sales-only user nothing it may do", async () => {
    const comp = await addComponent("dealOwner", { position: 9, name: "Removable" })
    expect(await setCost("outsider", comp, { acquire_unit: 10 })).toBeNull()
    expect(await tryDelete(await clientFor("outsider"), "costing_components", comp)).toEqual({ ok: true, affected: 1 })
    expect(await asSvc(svc().from("costing_component_costs").select("component_id").eq("component_id", comp), "gone")).toEqual([])
  })
})

describe("the old sor_inclusions table", () => {
  let legacySor

  it("is not backfilled into a Costing Matrix: no matrix is opened for an SOR with old Inclusions", async () => {
    legacySor = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    sorIds.push(legacySor)
    await asSvc(
      svc().from("sor_inclusions").insert([
        { opportunity_id: legacySor, description: "Anchor sling", quantity: 1, completeness: "MISSING", sort_order: 1 },
        { opportunity_id: legacySor, description: "Tripod carry bag", quantity: 2, unit: "pc", completeness: "COVERED", sort_order: 2 },
      ]),
      "legacy rows",
    )
    expect(await asSvc(svc().from("costing_matrices").select("id").eq("opportunity_id", legacySor), "no matrix")).toEqual([])
    // The one-off mover is gone (#266 review): a matrix exists only once Open Costing Matrix runs.
    const gone = await svc().rpc("costing_move_legacy_inclusions", { p_opportunity_id: legacySor })
    expect(gone.error).not.toBeNull()
    expect(await asSvc(svc().from("costing_matrices").select("id").eq("opportunity_id", legacySor), "still no matrix")).toEqual([])
  })

  it("lets Sales move an Unplaced inclusion under the bundle it belongs to", async () => {
    const opened = await svc().rpc("costing_open_matrix", { p_opportunity_id: legacySor })
    if (opened.error) throw new Error(`costing_open_matrix: ${opened.error.message}`)
    const matrix = { id: opened.data }
    const holder = await asSvc(svc().from("costing_tender_lines").insert({ matrix_id: matrix.id, position: 1, tender_specification: "Unplaced inclusions", quantity: 1 }).select("id").single(), "holder line")
    const holderBundle = await asSvc(svc().from("costing_components").insert({ tender_line_id: holder.id, position: 1, name: "Unplaced inclusions", is_bundle: true }).select("id").single(), "holder bundle")
    await asSvc(svc().from("costing_inclusions").insert({ component_id: holderBundle.id, position: 1, description: "Anchor sling", quantity: 1, completeness: "MISSING" }), "sling")
    const line = await asSvc(
      svc().from("costing_tender_lines").insert({ matrix_id: matrix.id, position: 2, tender_specification: "Rescue tripod", quantity: 1 }).select("id").single(),
      "line",
    )
    const bundle = await asSvc(
      svc().from("costing_components").insert({ tender_line_id: line.id, position: 1, name: "Tripod set", is_bundle: true }).select("id").single(),
      "bundle",
    )
    const sling = await asSvc(svc().from("costing_inclusions").select("id").eq("component_id", holderBundle.id).eq("description", "Anchor sling").single(), "sling")
    expect(await moveInclusion("dealOwner", sling.id, bundle.id)).toBeNull()
    const moved = await asSvc(svc().from("costing_inclusions").select("component_id, completeness").eq("id", sling.id).single(), "moved")
    expect(moved).toEqual({ component_id: bundle.id, completeness: "MISSING" })
  })

  it("leaves the old table read-only for everyone signed in, still readable", async () => {
    const insert = await tryInsert(await clientFor("dealOwner"), "sor_inclusions", { opportunity_id: legacySor, description: "New", quantity: 1 })
    expect(insert.ok).toBe(false)
    const [{ id }] = await asSvc(svc().from("sor_inclusions").select("id").eq("opportunity_id", legacySor).limit(1), "old row")
    const update = await tryUpdate(await clientFor("dealOwner"), "sor_inclusions", id, { description: "Changed" })
    expect(update.ok === false || update.affected === 0).toBe(true)
    const remove = await tryDelete(await clientFor("dealOwner"), "sor_inclusions", id)
    expect(remove.ok === false || remove.affected === 0).toBe(true)
    const still = await asSvc(svc().from("sor_inclusions").select("description").eq("id", id), "still there")
    expect(still).toHaveLength(1)
    expect(still[0].description).not.toBe("Changed")
    expect(await canRead(await clientFor("dealOwner"), "sor_inclusions", id)).toBe(true)
  })
})
