/**
 * Costing Matrix, Tender Lines (#267, spec #266): who reads which columns, who
 * writes which, and that the history can't be changed.
 *
 * The cast, on one SOR (dealOwner and support are its Deal Team):
 *   dealOwner, support  Deal Team                         -> closed_book tier
 *   stageParticipant    open Stage Participant window     -> participant tier
 *   outsider            Purchasing access, no part in it  -> closed_book tier
 *   finance             Finance access alone              -> no tier (#319: Finance drops out)
 *   ipasSigner          on the final_acquire list         -> closed_book tier
 *   superAdmin                                            -> closed_book tier
 *   ordinary            nobody                            -> no tier
 *
 * The matrix is made with the service role (costing_open_matrix is not granted
 * to anyone else yet); every other assertion runs as a real cast member.
 * `costing_tender_line_prices` is keyed by its Tender Line, so it has its own
 * probes in place of support/access.js.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, rlsStatus, sql } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { canRead, tryInsert, tryUpdate, tryDelete, RLS_VIOLATION } from "./support/access.js"
import { purgeCostingForSors } from "./support/costing.js"
import { TENDER_PRICE_TIERS } from "../../constants/costing.js"

const svc = () => serviceClient()

const NO_ID = "00000000-0000-0000-0000-000000000000"

let saleTypeId, flowId, stageId, alwaysFlowId, alwaysSaleTypeId, alwaysStageId
let sorId, matrixId
let alwaysSorId
let lineId
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

const tierOf = async (who, opp = sorId) => {
    const { data, error } = await (await clientFor(who)).rpc("costing_tier", { p_opportunity_id: opp })
    if (error) throw new Error(`costing_tier as ${who}: ${error.message}`)
    return data
}

const history = async (who, args = {}) => {
    const { data, error } = await (await clientFor(who)).rpc("costing_history", { p_opportunity_id: sorId, ...args })
    if (error) throw new Error(`costing_history as ${who}: ${error.message}`)
    return data
}

/** Types money on a Tender Line as `who`: resolves to the RPC's error (null on success). */
const setMoney = async (who, lineIdArg, patch) => {
    const { error } = await (await clientFor(who)).rpc("costing_set_money", {
        p_table: "costing_tender_line_prices",
        p_row: lineIdArg,
        p_patch: patch,
    })
    return error
}

/** Can this client select the prices row of a Tender Line? */
const readsPrices = async (who, id = lineId) => {
    const { data, error } = await (await clientFor(who)).from("costing_tender_line_prices").select("tender_line_id").eq("tender_line_id", id)
    if (error) throw new Error(`Reading prices as ${who}: ${error.message}`)
    return data.length > 0
}

const eventCount = async (who) => {
    const { data, error } = await (await clientFor(who)).from("costing_events").select("id").eq("matrix_id", matrixId)
    if (error) throw new Error(`Reading events as ${who}: ${error.message}`)
    return data.length
}

const lineRow = (overrides = {}) => ({
    matrix_id: matrixId,
    position: 1,
    tender_specification: "Rescue tripod\nAluminium, 3 m",
    unit: "set",
    quantity: 2,
    created_by: ids.dealOwner,
    ...overrides,
})

async function addLine(who, overrides) {
    const { data, error } = await (await clientFor(who)).from("costing_tender_lines").insert(lineRow(overrides)).select("id").single()
    if (error) throw new Error(`Adding a Tender Line as ${who}: ${error.message}`)
    return data.id
}

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")

    saleTypeId = (await asSvc(svc().from("sale_types").insert({ name: `${MARKER} Costing` }).select("id").single(), "sale type")).id
    flowId = (await asSvc(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "flow")).id
    stageId = (
        await asSvc(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Costing Stage`, sort_order: 10 }).select("id").single(), "stage")
    ).id

    sorId = await makeSor({
        registeredBy: ids.dealOwner,
        dealOwnerId: ids.dealOwner,
        supportSales1Id: ids.support,
        saleTypeId,
        flowStageId: stageId,
    })
    sorIds.push(sorId)

    // The Stage Participant's open window.
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

    // A second flow whose Always sees names one employee, on its own SOR.
    alwaysSaleTypeId = (await asSvc(svc().from("sale_types").insert({ name: `${MARKER} Costing Always` }).select("id").single(), "sale type")).id
    alwaysFlowId = (await asSvc(svc().from("sales_flows").insert({ sale_type_id: alwaysSaleTypeId }).select("id").single(), "flow")).id
    alwaysStageId = (
        await asSvc(svc().from("flow_stages").insert({ flow_id: alwaysFlowId, name: `${MARKER} Costing Always Stage`, sort_order: 10 }).select("id").single(), "stage")
    ).id
    await asSvc(svc().from("flow_access_settings").insert({ flow_id: alwaysFlowId, always_sees: [{ type: "employee", id: ids.ordinary }] }), "always sees")
    alwaysSorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId: alwaysSaleTypeId, flowStageId: alwaysStageId })
    sorIds.push(alwaysSorId)

    // The Final Acquire list: ipasSigner.
    await asSvc(svc().from("costing_signer_lists").insert({ list_key: "final_acquire", employee_id: ids.ipasSigner }), "signer list")

    const opened = await svc().rpc("costing_open_matrix", { p_opportunity_id: sorId })
    if (opened.error) throw new Error(`costing_open_matrix: ${opened.error.message}`)
    matrixId = opened.data
})

afterAll(async () => {
    await svc().from("costing_signer_lists").delete().eq("employee_id", ids.ipasSigner)
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeCostingForSors(sorIds)
    await svc().from("sor_stage_participants").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunity_items").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_access_settings").delete().eq("flow_id", alwaysFlowId)
    await svc().from("flow_stages").delete().in("flow_id", [flowId, alwaysFlowId])
    await svc().from("sales_flows").delete().in("id", [flowId, alwaysFlowId])
    await svc().from("sale_types").delete().in("id", [saleTypeId, alwaysSaleTypeId])
})

describe("costing_open_matrix", () => {
  it("creates exactly one matrix and its money row, and a second call creates none", async () => {
    const second = await svc().rpc("costing_open_matrix", { p_opportunity_id: sorId })
    expect(second.error).toBeNull()
    expect(second.data).toBe(matrixId)

    const matrices = await asSvc(svc().from("costing_matrices").select("id").eq("opportunity_id", sorId), "matrices")
    expect(matrices).toHaveLength(1)
    const money = await asSvc(svc().from("costing_matrix_money").select("matrix_id").eq("matrix_id", matrixId), "money")
    expect(money).toHaveLength(1)
  })

  it("fills only what is empty on a later call", async () => {
    const other = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    sorIds.push(other)
    const first = await svc().rpc("costing_open_matrix", { p_opportunity_id: other, p_config: { sales_incharge_id: ids.dealOwner } })
    expect(first.error).toBeNull()
    const again = await svc().rpc("costing_open_matrix", {
      p_opportunity_id: other,
      p_config: { sales_incharge_id: ids.support, purchasing_incharge_id: ids.outsider },
    })
    expect(again.error).toBeNull()
    expect(again.data).toBe(first.data)
    const row = await asSvc(svc().from("costing_matrices").select("sales_incharge_id, purchasing_incharge_id").eq("id", first.data).single(), "matrix")
    expect(row).toEqual({ sales_incharge_id: ids.dealOwner, purchasing_incharge_id: ids.outsider })
  })

  it("refuses an SOR that does not exist, and is not open to signed-in employees", async () => {
    const missing = await svc().rpc("costing_open_matrix", { p_opportunity_id: NO_ID })
    expect(missing.error?.code).toBe("22023")

    const denied = await (await clientFor("dealOwner")).rpc("costing_open_matrix", { p_opportunity_id: sorId })
    expect(denied.error).not.toBeNull()
    expect(denied.error.code).toBe("42501")
  })

  it("makes no matrix when an SOR is registered", async () => {
    const fresh = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    sorIds.push(fresh)
    const rows = await asSvc(svc().from("costing_matrices").select("id").eq("opportunity_id", fresh), "matrices")
    expect(rows).toEqual([])
    expect(await readMatrix("dealOwner", fresh)).toBeNull()
  })
})

describe("the read tier", () => {
  it.each([
    ["superAdmin", "closed_book"],
    ["ipasSigner", "closed_book"],
    // Purchasing and the SOR's Deal Team read the Closed Book (20261102170000).
    ["outsider", "closed_book"],
    ["dealOwner", "closed_book"],
    ["support", "closed_book"],
    ["stageParticipant", "participant"],
    ["finance", null],
    ["ordinary", null],
  ])("%s reads at %s", async (who, expected) => {
    expect(await tierOf(who)).toBe(expected)
    const can = await (await clientFor(who)).rpc("costing_can_read", { p_opportunity_id: sorId })
    expect(can.data).toBe(expected !== null)
  })

  it("puts the flow's Always sees on the price tier, for that SOR only", async () => {
    expect(await tierOf("ordinary", alwaysSorId)).toBe("price")
    expect(await tierOf("ordinary", sorId)).toBeNull()
  })

  it("puts a closed Stage Participant window on no tier", async () => {
    const lone = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageId })
    sorIds.push(lone)
    const visit = await asSvc(svc().from("sor_stage_visits").select("id").eq("opportunity_id", lone).single(), "visit")
    await asSvc(
      svc().from("sor_stage_participants").insert({
        opportunity_id: lone,
        employee_id: ids.stageParticipant,
        source: "action",
        opened_visit_id: visit.id,
        until_rule: "stage_left",
        closed_at: new Date().toISOString(),
        closed_reason: "stage_left",
      }),
      "closed window",
    )
    expect(await tierOf("stageParticipant", lone)).toBeNull()
  })
})

describe("Tender Lines: who writes", () => {
  it("lets the Deal Team add, edit and price a Tender Line", async () => {
    lineId = await addLine("dealOwner")
    const edit = await tryUpdate(await clientFor("support"), "costing_tender_lines", lineId, { tender_specification: "Rescue tripod\nAluminium, 3.5 m", quantity: 3 })
    expect(edit).toEqual({ ok: true, affected: 1 })

    expect(await setMoney("dealOwner", lineId, { abc_unit: 120000, final_offer_unit: 99500.5 })).toBeNull()
    const row = await asSvc(svc().from("costing_tender_line_prices").select("*").eq("tender_line_id", lineId).single(), "prices")
    expect(Number(row.abc_unit)).toBe(120000)
    expect(Number(row.final_offer_unit)).toBe(99500.5)
  })

  it("refuses a purchaser, naming the column and the band", async () => {
    const insert = await tryInsert(await clientFor("outsider"), "costing_tender_lines", lineRow())
    expect(insert).toMatchObject({ ok: false, code: RLS_VIOLATION })
    expect(insert.message).toBe("costing_band:costing_tender_lines.*:sales")

    const edit = await tryUpdate(await clientFor("outsider"), "costing_tender_lines", lineId, { unit: "pc" })
    expect(edit).toMatchObject({ ok: false, code: RLS_VIOLATION })
    expect(edit.message).toBe("costing_band:costing_tender_lines.unit:sales")

    const remove = await tryDelete(await clientFor("outsider"), "costing_tender_lines", lineId)
    expect(remove).toMatchObject({ ok: false, code: RLS_VIOLATION })
    expect(remove.message).toBe("costing_band:costing_tender_lines.*:sales")
  })

  it("refuses a purchaser writing Final Offer, and ABC", async () => {
    const offer = await setMoney("outsider", lineId, { final_offer_unit: 1 })
    expect(offer?.code).toBe(RLS_VIOLATION)
    expect(offer.message).toBe("costing_band:costing_tender_line_prices.final_offer_unit:sales")

    const abc = await setMoney("outsider", lineId, { abc_unit: 1 })
    expect(abc?.message).toBe("costing_band:costing_tender_line_prices.abc_unit:sales")

    const row = await asSvc(svc().from("costing_tender_line_prices").select("*").eq("tender_line_id", lineId).single(), "prices")
    expect(Number(row.final_offer_unit)).toBe(99500.5)
  })

  it("refuses a Stage Participant, the Final Acquire list and Finance access alone", async () => {
    const edit = await tryUpdate(await clientFor("stageParticipant"), "costing_tender_lines", lineId, { unit: "pc" })
    expect(edit).toMatchObject({ ok: false, code: RLS_VIOLATION })
    expect(edit.message).toBe("costing_band:costing_tender_lines.unit:sales")

    expect((await setMoney("stageParticipant", lineId, { final_offer_unit: 1 }))?.message).toBe(
      "costing_band:costing_tender_line_prices.final_offer_unit:sales",
    )
    // The Final Acquire list is Management, not Sales.
    expect((await setMoney("ipasSigner", lineId, { final_offer_unit: 1 }))?.message).toBe(
      "costing_band:costing_tender_line_prices.final_offer_unit:sales",
    )
    // Finance access alone has no tier, so it is refused before the band.
    expect((await setMoney("finance", lineId, { final_offer_unit: 1 }))?.code).toBe(RLS_VIOLATION)
  })

  it("refuses an employee with no part in the SOR", async () => {
    const insert = await tryInsert(await clientFor("ordinary"), "costing_tender_lines", lineRow())
    expect(insert).toMatchObject({ ok: false, code: RLS_VIOLATION })
    const edit = await tryUpdate(await clientFor("ordinary"), "costing_tender_lines", lineId, { unit: "pc" })
    expect(edit).toEqual({ ok: true, affected: 0 })
    expect((await setMoney("ordinary", lineId, { final_offer_unit: 1 }))?.code).toBe(RLS_VIOLATION)
  })

  it("lets a Super Admin write the Sales band", async () => {
    expect(await setMoney("superAdmin", lineId, { abc_unit: 125000 })).toBeNull()
    const row = await asSvc(svc().from("costing_tender_line_prices").select("abc_unit").eq("tender_line_id", lineId).single(), "prices")
    expect(Number(row.abc_unit)).toBe(125000)
    expect(await setMoney("dealOwner", lineId, { abc_unit: 120000 })).toBeNull()
  })

  it("refuses what is not a money column, a money table or a Tender Line", async () => {
    expect((await setMoney("dealOwner", lineId, { tender_line_id: NO_ID }))?.code).toBe("22023")
    expect((await setMoney("dealOwner", lineId, { nonsense: 1 }))?.code).toBe("22023")
    expect((await setMoney("dealOwner", lineId, {}))?.code).toBe("22023")
    expect((await setMoney("dealOwner", NO_ID, { abc_unit: 1 }))?.code).toBe("22023")
    const wrongTable = await (await clientFor("dealOwner")).rpc("costing_set_money", {
      p_table: "costing_tender_lines",
      p_row: lineId,
      p_patch: { unit: "x" },
    })
    expect(wrongTable.error?.code).toBe("22023")
    const negative = await setMoney("dealOwner", lineId, { abc_unit: -1 })
    expect(negative?.code).toBe("23514")
  })

  it("clears a price with null", async () => {
    expect(await setMoney("dealOwner", lineId, { final_offer_unit: null })).toBeNull()
    const row = await asSvc(svc().from("costing_tender_line_prices").select("final_offer_unit").eq("tender_line_id", lineId).single(), "prices")
    expect(row.final_offer_unit).toBeNull()
    expect(await setMoney("dealOwner", lineId, { final_offer_unit: 99500.5 })).toBeNull()
  })

  it("puts Tender Lines in the order given, and refuses a list that misses one", async () => {
    const second = await addLine("dealOwner", { position: 2, tender_specification: "Second" })
    const third = await addLine("dealOwner", { position: 3, tender_specification: "Third" })

    const reorder = await (await clientFor("dealOwner")).rpc("costing_reorder_tender_lines", {
      p_matrix_id: matrixId,
      p_ids: [third, lineId, second],
    })
    expect(reorder.error).toBeNull()
    const rows = await asSvc(svc().from("costing_tender_lines").select("id, position").eq("matrix_id", matrixId).order("position"), "lines")
    expect(rows.map((r) => r.id)).toEqual([third, lineId, second])
    expect(rows.map((r) => r.position)).toEqual([1, 2, 3])

    const missing = await (await clientFor("dealOwner")).rpc("costing_reorder_tender_lines", { p_matrix_id: matrixId, p_ids: [third, lineId] })
    expect(missing.error?.code).toBe("22023")

    const byPurchaser = await (await clientFor("outsider")).rpc("costing_reorder_tender_lines", {
      p_matrix_id: matrixId,
      p_ids: [second, third, lineId],
    })
    expect(byPurchaser.error?.message).toBe("costing_band:costing_tender_lines.position:sales")

    const removed = await tryDelete(await clientFor("dealOwner"), "costing_tender_lines", second)
    expect(removed).toEqual({ ok: true, affected: 1 })
    await tryDelete(await clientFor("dealOwner"), "costing_tender_lines", third)
  })
})

describe("Tender Lines: who reads what", () => {
  it("serves a Stage Participant the Tender Lines without any money", async () => {
    const read = await readMatrix("stageParticipant")
    expect(read.tier).toBe("participant")
    // Components, Inclusions, cost-only rows and the sign-offs reach a participant too (no money columns).
    expect(Object.keys(read.tables).sort()).toEqual([
      "costing_components",
      "costing_cost_rows",
      "costing_inclusions",
      "costing_matrices",
      "costing_signoffs",
      "costing_tender_lines",
    ])
    const [line] = read.tables.costing_tender_lines
    expect(line.id).toBe(lineId)
    expect(line.tender_specification).toBe("Rescue tripod\nAluminium, 3.5 m")
    expect(JSON.stringify(read)).not.toMatch(/abc_unit|final_offer_unit|quotation_price_unit|costing_matrix_money|costing_tender_line_prices/)
  })

  it("serves the Deal Team ABC, Final Offer and the quotation price", async () => {
    const read = await readMatrix("dealOwner")
    expect(read.tier).toBe("closed_book")
    const [prices] = read.tables.costing_tender_line_prices
    expect(prices).toMatchObject({ tender_line_id: lineId, abc_unit: 120000, final_offer_unit: 99500.5 })
    // A typed line has no SOR line to quote: the virtual column is there, and null.
    expect(Object.keys(prices)).toContain("quotation_price_unit")
    expect(prices.quotation_price_unit).toBeNull()
  })

  it("serves Purchasing every column, Final Offer included", async () => {
    const read = await readMatrix("outsider")
    expect(read.tier).toBe("closed_book")
    const [prices] = read.tables.costing_tender_line_prices
    expect(Object.keys(prices).sort()).toEqual(["abc_unit", "final_offer_unit", "quotation_price_unit", "tender_line_id"])
  })

  it("serves a Super Admin and the Final Acquire list every column", async () => {
    for (const who of ["superAdmin", "ipasSigner"]) {
      const read = await readMatrix(who)
      expect(read.tier).toBe("closed_book")
      const [prices] = read.tables.costing_tender_line_prices
      expect(Object.keys(prices).sort()).toEqual(["abc_unit", "final_offer_unit", "quotation_price_unit", "tender_line_id"])
    }
  })

  it("tells each caller the write bands they are in, so the screen can show a cell read-only", async () => {
    const bands = async (who) => [...(await readMatrix(who)).bands].sort()
    expect(await bands("dealOwner")).toEqual(["sales"])
    expect(await bands("outsider")).toEqual(["purchasing", "technical"])
    expect(await bands("ipasSigner")).toEqual(["finance", "management"])
    expect(await bands("stageParticipant")).toEqual([])
    expect(await bands("superAdmin")).toEqual(["markup", "purchasing", "sales", "super_admin_only", "technical"])
  })

  it("matches the registry the screen mirrors in src/constants/costing.js", async () => {
    const rows = await asSvc(
      svc().from("costing_column_tiers").select("column_name, tiers").eq("table_name", "costing_tender_line_prices"),
      "tiers",
    )
    for (const [column, tiers] of Object.entries(TENDER_PRICE_TIERS)) {
      expect(rows.find((r) => r.column_name === column).tiers.sort(), column).toEqual([...tiers].sort())
    }
  })

  it("serves Finance access alone, and a plain employee, nothing", async () => {
    expect(await readMatrix("finance")).toBeNull()
    expect(await readMatrix("ordinary")).toBeNull()
    expect(await history("finance")).toBeNull()
  })

  it("reads no matrix for an SOR that has none", async () => {
    const empty = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    sorIds.push(empty)
    expect(await readMatrix("superAdmin", empty)).toBeNull()
  })

  it("keeps the base tables closed: a participant reads Tender Lines and no money", async () => {
    expect(await canRead(await clientFor("stageParticipant"), "costing_tender_lines", lineId)).toBe(true)
    expect(await canRead(await clientFor("dealOwner"), "costing_tender_lines", lineId)).toBe(true)
    expect(await canRead(await clientFor("outsider"), "costing_tender_lines", lineId)).toBe(true)
    expect(await canRead(await clientFor("ordinary"), "costing_tender_lines", lineId)).toBe(false)
    expect(await canRead(await clientFor("finance"), "costing_tender_lines", lineId)).toBe(false)

    expect(await readsPrices("stageParticipant")).toBe(false)
    expect(await readsPrices("dealOwner")).toBe(true)
    expect(await readsPrices("outsider")).toBe(true)
    expect(await readsPrices("finance")).toBe(false)
    expect(await readsPrices("ordinary")).toBe(false)
    expect(await readsPrices("superAdmin")).toBe(true)
    expect(await readsPrices("ipasSigner")).toBe(true)

    const money = async (who) => (await (await clientFor(who)).from("costing_matrix_money").select("matrix_id").eq("matrix_id", matrixId)).data.length
    expect(await money("stageParticipant")).toBe(0)
    expect(await money("dealOwner")).toBe(1)
    expect(await money("outsider")).toBe(1)
    expect(await money("superAdmin")).toBe(1)
  })

  it("lets the matrix row be read by any tier, and nobody else", async () => {
    const read = async (who) =>
      (await (await clientFor(who)).from("costing_matrices").select("id").eq("id", matrixId)).data.length
    for (const who of ["stageParticipant", "dealOwner", "outsider", "superAdmin"]) expect(await read(who)).toBe(1)
    for (const who of ["ordinary", "finance"]) expect(await read(who)).toBe(0)
  })

  it("has row level security on every costing table", async () => {
    for (const table of [
      "costing_matrices",
      "costing_matrix_money",
      "costing_tender_lines",
      "costing_tender_line_prices",
      "costing_components",
      "costing_component_costs",
      "costing_inclusions",
      "costing_cost_rows",
      "costing_events",
      "costing_signer_lists",
      "costing_tables",
      "costing_column_tiers",
      "costing_virtual_columns",
      "costing_column_bands",
    ]) {
      expect((await rlsStatus(table)).enabled, table).toBe(true)
    }
  })
})

describe("a Tender Line picked from an SOR line", () => {
  it("keeps its snapshot after the line is saved again, and reports what the line says now", async () => {
    const original = await asSvc(
      svc()
        .from("sales_opportunity_items")
        .insert({ opportunity_id: sorId, product_name: "Safety harness", unit: "pc", quantity: 5, unit_price: 4500, sort_order: 1, odoo_product_id: 8123 })
        .select("id")
        .single(),
      "SOR line",
    )
    const picked = await addLine("dealOwner", {
      position: 2,
      source: "sor_line",
      sor_item_id: original.id,
      odoo_product_id: 8123,
      tender_specification: "Safety harness",
      unit: "pc",
      quantity: 5,
      sor_line_snapshot: { name: "Safety harness", quantity: 5, unit: "pc" },
    })

    // A save updates the line in place (#677): the same id, new words.
    await asSvc(
      svc().from("sales_opportunity_items").update({ product_name: "Safety harness (full body)", quantity: 8, unit_price: 4700 }).eq("id", original.id),
      "replaced line",
    )

    const read = await readMatrix("dealOwner")
    const line = read.tables.costing_tender_lines.find((l) => l.id === picked)
    expect(line.sor_line_snapshot).toEqual({ name: "Safety harness", quantity: 5, unit: "pc" })
    expect(line.quantity).toBe(5)
    expect(line.sor_line_now).toEqual({ found: true, name: "Safety harness (full body)", quantity: 8, unit: "pc", odoo_product_id: 8123 })
    const prices = read.tables.costing_tender_line_prices

    // The quotation price shows to whoever reads Final Offer, and only for a picked line.
    expect(await setMoney("dealOwner", picked, { abc_unit: 5000, final_offer_unit: 4900 })).toBeNull()
    const again = (await readMatrix("dealOwner")).tables.costing_tender_line_prices.find((p) => p.tender_line_id === picked)
    expect(again.quotation_price_unit).toBe(4700)
    expect(prices.find((p) => p.tender_line_id === lineId).quotation_price_unit).toBeNull()
    const cost = (await readMatrix("outsider")).tables.costing_tender_line_prices.find((p) => p.tender_line_id === picked)
    expect(cost.quotation_price_unit).toBe(4700)
    // A participant gets the line's SOR change without any price.
    const participantLine = (await readMatrix("stageParticipant")).tables.costing_tender_lines.find((l) => l.id === picked)
    expect(participantLine.sor_line_now.quantity).toBe(8)

    // Gone from the SOR altogether.
    await asSvc(svc().from("sales_opportunity_items").delete().eq("opportunity_id", sorId), "delete lines")
    const gone = (await readMatrix("dealOwner")).tables.costing_tender_lines.find((l) => l.id === picked)
    expect(gone.sor_line_now).toEqual({ found: false })
    expect(gone.sor_line_snapshot.quantity).toBe(5)
  })

  it("follows its own line by id when the SOR lists the same product twice", async () => {
    await asSvc(svc().from("sales_opportunity_items").delete().eq("opportunity_id", sorId), "clear lines")
    const [, second] = await asSvc(
      svc()
        .from("sales_opportunity_items")
        .insert([
          { opportunity_id: sorId, product_name: "Rope 11mm", unit: "m", quantity: 100, unit_price: 90, sort_order: 1, odoo_product_id: 9001, odoo_line_id: 7001 },
          { opportunity_id: sorId, product_name: "Rope 11mm", unit: "m", quantity: 40, unit_price: 95, sort_order: 2, odoo_product_id: 9001, odoo_line_id: 7002 },
        ])
        .select("id, sort_order")
        .order("sort_order"),
      "SOR lines",
    )
    const picked = await addLine("dealOwner", {
      position: 3,
      source: "sor_line",
      sor_item_id: second.id,
      odoo_product_id: 9001,
      tender_specification: "Rope 11mm",
      unit: "m",
      quantity: 40,
      sor_line_snapshot: { name: "Rope 11mm", quantity: 40, unit: "m" },
    })
    const line = (await readMatrix("dealOwner")).tables.costing_tender_lines.find((l) => l.id === picked)
    expect(line.sor_line_now).toMatchObject({ found: true, quantity: 40, unit: "m" })
  })

  it("reports a line the S0 dropped as gone, and refuses a made-up line id", async () => {
    const [kept] = await asSvc(svc().from("sales_opportunity_items").select("id").eq("opportunity_id", sorId).eq("odoo_line_id", 7002), "line")
    await asSvc(svc().from("sales_opportunity_items").update({ removed_from_s0: true }).eq("id", kept.id), "removed")
    const read = (await readMatrix("dealOwner")).tables.costing_tender_lines.find((l) => l.sor_item_id === kept.id)
    expect(read.sor_line_now).toEqual({ found: false })

    const bad = await svc().from("costing_tender_lines").insert({ matrix_id: matrixId, position: 99, source: "sor_line", sor_item_id: NO_ID, tender_specification: "x", quantity: 1 })
    expect(bad.error?.code).toBe("23503")
  })
})

describe("the history", () => {
  it("records each change by who made it, to the tier that may read the column", async () => {
    const owner = await history("dealOwner")
    const offerChange = owner.find((e) => e.detail.column === "final_offer_unit" && e.detail.new === 99500.5)
    expect(offerChange).toBeDefined()
    expect(offerChange.actor_id).toBe(ids.dealOwner)
    expect(offerChange.kind).toBe("changed")

    const unitChange = owner.find((e) => e.detail.table === "costing_tender_lines" && e.detail.column === "quantity")
    expect(unitChange).toMatchObject({ actor_id: ids.support, kind: "changed" })
    expect(unitChange.detail).toMatchObject({ old: 2, new: 3, row: lineId })
  })

  it("keeps money changes out of a participant's history, and shows them to Purchasing", async () => {
    const participant = await history("stageParticipant")
    expect(participant.length).toBeGreaterThan(0)
    expect(JSON.stringify(participant)).not.toMatch(/final_offer_unit|abc_unit|costing_tender_line_prices/)

    const purchaser = await history("outsider")
    expect(purchaser.some((e) => e.detail.column === "abc_unit")).toBe(true)
    expect(purchaser.some((e) => e.detail.column === "final_offer_unit")).toBe(true)
  })

  it("shows the Final Acquire list everything, and filters by table and row", async () => {
    const all = await history("ipasSigner")
    expect(all.some((e) => e.detail.column === "final_offer_unit")).toBe(true)
    const justPrices = await history("ipasSigner", { p_table: "costing_tender_line_prices", p_row: lineId })
    expect(justPrices.length).toBeGreaterThan(0)
    expect(justPrices.every((e) => e.detail.table === "costing_tender_line_prices" && e.detail.row === lineId)).toBe(true)
    const limited = await history("ipasSigner", { p_limit: 2 })
    expect(limited).toHaveLength(2)
  })

  it("records an added Tender Line with its values, minus the money a tier may not read", async () => {
    const participant = await history("stageParticipant", { p_table: "costing_tender_lines" })
    const added = participant.find((e) => e.kind === "added" && e.detail.row === lineId)
    expect(added.detail.values.tender_specification).toBe("Rescue tripod\nAluminium, 2 m".replace("2 m", "3 m"))
  })

  it("keeps a removed Tender Line and the Final Offer it had", async () => {
    const doomed = await addLine("dealOwner", { position: 9, tender_specification: "To be removed" })
    expect(await setMoney("dealOwner", doomed, { abc_unit: 10, final_offer_unit: 8 })).toBeNull()
    expect(await tryDelete(await clientFor("dealOwner"), "costing_tender_lines", doomed)).toEqual({ ok: true, affected: 1 })

    const owner = await history("dealOwner", { p_table: "costing_tender_line_prices", p_row: doomed })
    const removed = owner.find((e) => e.kind === "removed")
    expect(removed.detail.values).toMatchObject({ abc_unit: 10, final_offer_unit: 8 })
    const participant = await history("stageParticipant", { p_row: doomed })
    expect(participant.every((e) => e.detail.table !== "costing_tender_line_prices")).toBe(true)
    expect(participant.some((e) => e.kind === "removed" && e.detail.table === "costing_tender_lines")).toBe(true)
  })

  it("reads money events directly only at the closed_book tier", async () => {
    expect(await eventCount("superAdmin")).toBeGreaterThan(0)
    expect(await eventCount("ipasSigner")).toBeGreaterThan(0)
    expect(await eventCount("dealOwner")).toBeGreaterThan(0)
    expect(await eventCount("outsider")).toBeGreaterThan(0)
    expect(await eventCount("stageParticipant")).toBe(0)
    expect(await eventCount("ordinary")).toBe(0)
  })

  it("can't be updated, deleted or truncated, by anyone", async () => {
    const [event] = await asSvc(svc().from("costing_events").select("id").eq("matrix_id", matrixId).limit(1), "event")

    const update = await svc().from("costing_events").update({ kind: "removed" }).eq("id", event.id)
    expect(update.error?.code).toBe(RLS_VIOLATION)
    const remove = await svc().from("costing_events").delete().eq("id", event.id)
    expect(remove.error?.code).toBe(RLS_VIOLATION)
    await expect(sql().query("truncate public.costing_events")).rejects.toThrow(/append-only/)

    const asAdmin = await tryUpdate(await clientFor("superAdmin"), "costing_events", event.id, { kind: "removed" })
    expect(asAdmin.ok === false || asAdmin.affected === 0).toBe(true)
    const asAdminDelete = await tryDelete(await clientFor("superAdmin"), "costing_events", event.id)
    expect(asAdminDelete.ok === false || asAdminDelete.affected === 0).toBe(true)

    // And no client can write one.
    const forged = await tryInsert(await clientFor("superAdmin"), "costing_events", { matrix_id: matrixId, kind: "added", detail: {} })
    expect(forged.ok).toBe(false)
  })
})

describe("the registries and signer lists", () => {
  it("keeps the signer lists to Super Admins", async () => {
    const asOrdinary = await tryInsert(await clientFor("ordinary"), "costing_signer_lists", { list_key: "final_acquire", employee_id: ids.ordinary })
    expect(asOrdinary).toMatchObject({ ok: false, code: RLS_VIOLATION })
    const asAdmin = await (await clientFor("superAdmin")).from("costing_signer_lists").insert({ list_key: "evaluation", employee_id: ids.checkByTwo }).select("id").single()
    expect(asAdmin.error).toBeNull()
    // Who is on a list is not secret (#270): any signed-in employee reads the lists; only Super Admins write them.
    const everyone = await (await clientFor("ordinary")).from("costing_signer_lists").select("list_key, employee_id").eq("list_key", "final_acquire")
    expect(everyone.data.some((r) => r.employee_id === ids.ipasSigner)).toBe(true)
    await svc().from("costing_signer_lists").delete().eq("id", asAdmin.data.id)
  })

  it("starts with no one on a list but the employee whose call sign is 101", async () => {
    // #270 seeds 101 on the Final Acquire list; the other row here is this file's own.
    const rows = await asSvc(svc().from("costing_signer_lists").select("employee_id, employee:employees!costing_signer_lists_employee_id_fkey(call_sign)"), "lists")
    expect(rows.every((r) => r.employee_id === ids.ipasSigner || r.employee?.call_sign === "101")).toBe(true)
  })

  it("registers every column it reads and writes, and never lets a client change a registry", async () => {
    const tiers = await asSvc(svc().from("costing_column_tiers").select("table_name, column_name").eq("table_name", "costing_tender_line_prices"), "tiers")
    expect(tiers.map((t) => t.column_name).sort()).toEqual(["abc_unit", "final_offer_unit", "quotation_price_unit", "tender_line_id"])
    const forged = await (await clientFor("superAdmin")).from("costing_column_tiers").insert({ table_name: "x", column_name: "y", tiers: ["participant"] })
    expect(forged.error).not.toBeNull()
  })
})
