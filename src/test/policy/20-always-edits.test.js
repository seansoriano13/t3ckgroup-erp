/**
 * Issue #381 (part of #377) — Always edits.
 *
 * Open flow: Always sees and Always edits both Everyone (Legacy-style).
 * Private flow: both empty (Government-style). Two more flows isolate the
 * single-list cases: edits-only, and sees-only.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { canRead, tryUpdate } from "./support/access.js"

const flows = {} // key -> { saleTypeId, flowId, stages: [s1, s2], sorId }
const CONFIG = {
    open: { sees: [{ type: "everyone" }], edits: [{ type: "everyone" }] },
    private: { sees: [], edits: [] },
    editsOnly: { sees: [], edits: [{ type: "everyone" }] },
    seesOnly: { sees: [{ type: "everyone" }], edits: [] },
}

async function seedFlow(key, { sees, edits }) {
    const svc = serviceClient()
    const saleType = await svc.from("sale_types").insert({ name: `${MARKER} Edits ${key}` }).select("id").single()
    if (saleType.error) throw new Error(saleType.error.message)
    const flow = await svc.from("sales_flows").insert({ sale_type_id: saleType.data.id }).select("id").single()
    if (flow.error) throw new Error(flow.error.message)
    const stages = []
    for (const i of [1, 2]) {
        const stage = await svc
            .from("flow_stages")
            .insert({ flow_id: flow.data.id, name: `${MARKER} Edits ${key}${i}`, sort_order: i * 10 })
            .select("id")
            .single()
        if (stage.error) throw new Error(stage.error.message)
        stages.push(stage.data.id)
    }
    const access = await svc
        .from("flow_access_settings")
        .insert({ flow_id: flow.data.id, always_sees: sees, always_edits: edits })
    if (access.error) throw new Error(access.error.message)
    const sorId = await makeSor({
        registeredBy: ids.dealOwner,
        dealOwnerId: ids.dealOwner,
        saleTypeId: saleType.data.id,
        flowStageId: stages[0],
        companyName: `${MARKER} Edits ${key} Company`,
    })
    flows[key] = { saleTypeId: saleType.data.id, flowId: flow.data.id, stages, sorId }
}

beforeAll(async () => {
    await ensureCastLoaded()
    for (const [key, cfg] of Object.entries(CONFIG)) await seedFlow(key, cfg)
})

afterAll(async () => {
    const svc = serviceClient()
    const all = Object.values(flows)
    await svc.from("sales_opportunity_items").delete().in("opportunity_id", all.map((f) => f.sorId))
    await svc.from("sales_opportunities").delete().in("id", all.map((f) => f.sorId))
    await svc.from("flow_access_settings").delete().in("flow_id", all.map((f) => f.flowId))
    await svc.from("flow_stages").delete().in("flow_id", all.map((f) => f.flowId))
    await svc.from("sales_flows").delete().in("id", all.map((f) => f.flowId))
    await svc.from("sale_types").delete().in("id", all.map((f) => f.saleTypeId))
})

async function abilities(key, flowKey) {
    const flow = flows[flowKey]
    const client = await clientFor(key)
    const read = await canRead(client, "sales_opportunities", flow.sorId)
    const details = (await tryUpdate(client, "sales_opportunities", flow.sorId, { project_title: `${MARKER} edited by ${key}` }))
        .affected === 1
    const items = await client.rpc("sor_replace_items", {
        p_opportunity_id: flow.sorId,
        p_items: [{ product_name: `${MARKER} Rope`, unit: "pc", quantity: 1, unit_price: 10 }],
    })
    const move = (await tryUpdate(client, "sales_opportunities", flow.sorId, { flow_stage_id: flow.stages[1] })).affected === 1
    // put the Stage back for the next caller
    await serviceClient().from("sales_opportunities").update({ flow_stage_id: flow.stages[0] }).eq("id", flow.sorId)
    return { read, details, items: !items.error, move }
}

const ALL = { read: true, details: true, items: true, move: true }
const NONE = { read: false, details: false, items: false, move: false }

describe("Always edits — matrix", () => {
    // outsider: Operations, off the Deal Team. hr: no sub-department.
    it.each(["dealOwner", "outsider", "hr", "superAdmin"])("%s on the open flow can do all four", async (key) => {
        expect(await abilities(key, "open")).toEqual(ALL)
    })

    it.each([
        ["dealOwner", ALL],
        ["superAdmin", ALL],
        ["outsider", NONE],
        ["hr", NONE],
    ])("%s on the private flow", async (key, expected) => {
        expect(await abilities(key, "private")).toEqual(expected)
    })
})

describe("Always edits — grants editing only", () => {
    it("someone only in Always edits can't edit, because they can't read", async () => {
        expect(await abilities("outsider", "editsOnly")).toEqual(NONE)
    })

    it("someone in both lists can", async () => {
        expect(await abilities("outsider", "open")).toEqual(ALL)
    })

    it("someone only in Always sees can read and move but can't edit", async () => {
        const result = await abilities("outsider", "seesOnly")
        expect(result).toEqual({ read: true, details: false, items: false, move: true })
    })

    it("heads keep their edit rights", async () => {
        const { data } = await (await clientFor("head")).rpc("sor_can_edit_opportunity", { p_opportunity_id: flows.private.sorId })
        expect(data).toBe(true)
    })
})
