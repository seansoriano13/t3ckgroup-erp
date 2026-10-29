/**
 * Ticket #744 (spec #735, ADR 0048) - Date of Award: stamped by the stage move,
 * cleared by Revert, locked to Super Admin once set. Every assertion runs as a
 * signed-in cast member; the service role only seeds.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

let saleTypeId
let flowId
let stageA
let stageB
const sorIds = []

async function stage(name, sortOrder, extra = {}) {
    const { data, error } = await serviceClient()
        .from("flow_stages")
        .insert({ flow_id: flowId, name: `${MARKER} ${name}`, sort_order: sortOrder, ...extra })
        .select("id")
        .single()
    if (error) throw new Error(`Seeding ${name}: ${error.message}`)
    return data.id
}

beforeAll(async () => {
    await ensureCastLoaded()
    const svc = serviceClient()
    const saleType = await svc.from("sale_types").insert({ name: `${MARKER} Revert` }).select("id").single()
    if (saleType.error) throw new Error(saleType.error.message)
    saleTypeId = saleType.data.id
    const flow = await svc.from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single()
    if (flow.error) throw new Error(flow.error.message)
    flowId = flow.data.id
    stageA = await stage("A", 10)
    stageB = await stage("B", 20)
})

afterAll(async () => {
    const svc = serviceClient()
    await svc.from("tasks").delete().in("opportunity_id", sorIds)
    await svc.from("committee_tasks").delete().in("opportunity_id", sorIds)
    await svc.from("sor_action_runs").delete().in("opportunity_id", sorIds)
    await svc.from("sales_opportunities").delete().in("id", sorIds)
    await svc.from("flow_stages").delete().eq("flow_id", flowId)
    await svc.from("sales_flows").delete().eq("id", flowId)
    await svc.from("sale_types").delete().eq("id", saleTypeId)
})

async function freshSor() {
    const id = await makeSor({
        registeredBy: ids.dealOwner,
        dealOwnerId: ids.dealOwner,
        closingSalesId: ids.closingSales,
        saleTypeId,
        flowStageId: stageA,
    })
    sorIds.push(id)
    return id
}

/** Moves as `who` (their own client, so the trigger records them as the mover). */
async function moveAs(who, sorId, toStage, patch = {}) {
    const client = await clientFor(who)
    const { data, error } = await client
        .from("sales_opportunities")
        .update({ flow_stage_id: toStage, ...patch })
        .eq("id", sorId)
        .select("id")
    if (error) throw new Error(`Moving as ${who}: ${error.message}`)
    if (data.length !== 1) throw new Error(`Moving as ${who} affected ${data.length} rows`)
}

async function revertAs(who, sorId) {
    const client = await clientFor(who)
    return client.rpc("sor_revert_stage", { p_opportunity_id: sorId })
}

const svc = () => serviceClient()

async function sorRow(sorId) {
    const { data } = await svc().from("sales_opportunities").select("flow_stage_id, contract_date, date_of_award").eq("id", sorId).single()
    return data
}

async function visits(sorId) {
    const { data } = await svc().from("sor_stage_visits").select("*").eq("opportunity_id", sorId).order("sequence")
    return data
}

describe("Date of Award", () => {
    it("is stamped by the move into the flow's Notice of Award Stage, and a Revert clears it", async () => {
        const sor = await freshSor()
        await moveAs("dealOwner", sor, stageB, { date_of_award: "2026-10-01" })
        expect((await sorRow(sor)).date_of_award).toBe("2026-10-01")
        expect((await visits(sor)).at(-1).date_of_award_stamped).toBe(true)

        expect((await revertAs("dealOwner", sor)).error).toBeNull()
        expect((await sorRow(sor)).date_of_award).toBeNull()
    })

    it("lets the Deal Team type it while blank, and a Revert of an ordinary move keeps a typed one", async () => {
        const sor = await freshSor()
        const client = await clientFor("dealOwner")
        const typed = await client.from("sales_opportunities").update({ date_of_award: "2026-09-15" }).eq("id", sor).select("id")
        expect(typed.error).toBeNull()
        await moveAs("dealOwner", sor, stageB)
        expect((await revertAs("dealOwner", sor)).error).toBeNull()
        expect((await sorRow(sor)).date_of_award).toBe("2026-09-15")
    })

    it("refuses a Deal Team change once it is set", async () => {
        const sor = await freshSor()
        await svc().from("sales_opportunities").update({ date_of_award: "2026-09-15" }).eq("id", sor)
        const client = await clientFor("dealOwner")
        const { error } = await client.from("sales_opportunities").update({ date_of_award: "2026-09-20" }).eq("id", sor)
        expect(error).not.toBeNull()
        expect((await sorRow(sor)).date_of_award).toBe("2026-09-15")
    })

    it("lets a Super Admin change it, and records the change in History", async () => {
        const sor = await freshSor()
        await svc().from("sales_opportunities").update({ date_of_award: "2026-09-15" }).eq("id", sor)
        const client = await clientFor("superAdmin")
        const { error } = await client.from("sales_opportunities").update({ date_of_award: "2026-09-20" }).eq("id", sor)
        expect(error).toBeNull()
        expect((await sorRow(sor)).date_of_award).toBe("2026-09-20")

        const { data } = await svc().from("sales_opportunity_logs").select("metadata").eq("opportunity_id", sor)
        expect(data.some((l) => l.metadata?.event === "DATE_OF_AWARD_CHANGED")).toBe(true)
    })
})
