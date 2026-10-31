/**
 * Issue #815 (spec #800, ADR 0050) — the S0 card's one save step, `set_sales_reference`.
 *
 * Service-role only: the edge function calls it with the caller's email and the Odoo fact. The
 * cast member named in each call is who the function acts as. The service role seeds the deals
 * and reads back what was written.
 *
 * Flow deals: two Stages in the Flow Snapshot (First sort 10, Second sort 20, listed the wrong
 * way round on purpose). Old-pipeline deals: Lead is the first Stage; a throwaway second pipeline
 * Stage is added for "past Lead".
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded, castEmail } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

const svc = () => serviceClient()
const sorIds = []
let flow
const NEXT_CODE = "M815NEXT"
const used = new Set()

async function ok(promise, what) {
    const { data, error } = await promise
    if (error) throw new Error(`Seeding ${what}: ${error.message}`)
    return data
}

/** A fresh S0 number nobody else is using. */
function s0() {
    for (;;) {
        const n = `S9${Math.floor(1000000 + Math.random() * 8999999)}`
        if (!used.has(n)) {
            used.add(n)
            return n
        }
    }
}

async function buildFlow() {
    const saleType = await ok(svc().from("sale_types").insert({ name: `${MARKER} 815 flow` }).select("id").single(), "Sale Type")
    const f = await ok(svc().from("sales_flows").insert({ sale_type_id: saleType.id }).select("id").single(), "flow")
    const first = await ok(svc().from("flow_stages").insert({ flow_id: f.id, name: `${MARKER} First`, sort_order: 10 }).select("id, name").single(), "first Stage")
    const second = await ok(svc().from("flow_stages").insert({ flow_id: f.id, name: `${MARKER} Second`, sort_order: 20 }).select("id, name").single(), "second Stage")
    const snapshot = await ok(
        svc()
            .from("flow_snapshots")
            .insert({
                flow_id: f.id,
                version: 1,
                snapshot_data: {
                    stages: [
                        { id: second.id, name: second.name, sort_order: 20 },
                        { id: first.id, name: first.name, sort_order: 10 },
                    ],
                    edges: [{ from_stage_id: first.id, to_stage_id: second.id }],
                },
                created_by: ids.dealOwner,
            })
            .select("id")
            .single(),
        "Flow Snapshot",
    )
    return { saleTypeId: saleType.id, flowId: f.id, first, second, snapshotId: snapshot.id }
}

beforeAll(async () => {
    await ensureCastLoaded()
    flow = await buildFlow()
    await ok(svc().from("crm_pipeline_stages").upsert({ code: NEXT_CODE, label: "M815 Next", sort_order: 9990 }), "pipeline Stage")
})

afterAll(async () => {
    const s = svc()
    await s.from("system_audit_logs").delete().in("entity_id", sorIds)
    await s.from("sales_opportunity_logs").delete().in("opportunity_id", sorIds)
    await s.from("sales_opportunities").delete().in("id", sorIds)
    if (flow) {
        await s.from("flow_snapshots").delete().eq("flow_id", flow.flowId)
        await s.from("flow_stages").delete().eq("flow_id", flow.flowId)
        await s.from("sales_flows").delete().eq("id", flow.flowId)
        await s.from("sale_types").delete().eq("id", flow.saleTypeId)
    }
    await s.from("crm_pipeline_stages").delete().eq("code", NEXT_CODE)
})

/** A Flow Canvas deal in its first ("first") or second ("second") Stage, with an optional S0. */
async function flowDeal(stageKey, salesReference = null) {
    const id = await makeSor({
        registeredBy: ids.dealOwner,
        dealOwnerId: ids.dealOwner,
        saleTypeId: flow.saleTypeId,
        flowStageId: flow[stageKey].id,
    })
    sorIds.push(id)
    const patch = { flow_snapshot_id: flow.snapshotId }
    if (salesReference) patch.sales_reference = salesReference
    await ok(svc().from("sales_opportunities").update(patch).eq("id", id), "deal link")
    return id
}

/** An old-pipeline deal in Lead, or past it (needs an S0 to leave Lead). */
async function oldDeal(past = false, salesReference = null) {
    const id = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    sorIds.push(id)
    const ref = salesReference ?? (past ? s0() : null)
    const patch = {}
    if (ref) patch.sales_reference = ref
    if (past) patch.status = NEXT_CODE
    if (Object.keys(patch).length) await ok(svc().from("sales_opportunities").update(patch).eq("id", id), "old deal")
    return id
}

const save = (who, sorId, ref, { reason, odoo, items } = {}) =>
    svc().rpc("set_sales_reference", {
        p_actor_email: castEmail(who),
        p_opportunity_id: sorId,
        p_sales_reference: ref,
        ...(reason === undefined ? {} : { p_reason: reason }),
        ...(odoo === undefined ? {} : { p_odoo: odoo }),
        ...(items === undefined ? {} : { p_items: items }),
    })

async function row(sorId) {
    return ok(svc().from("sales_opportunities").select("sales_reference, sales_reference_odoo_state, sales_reference_checked_at").eq("id", sorId).single(), "row")
}

async function history(sorId) {
    const { data } = await svc()
        .from("sales_opportunity_logs")
        .select("author_id, created_at, type, content, metadata")
        .eq("opportunity_id", sorId)
        .like("metadata->>event", "SALES_REFERENCE_%")
        .order("created_at")
    return data ?? []
}

describe("the first Stage: free change and clear", () => {
    it("sets, changes and clears the S0 on a Flow Canvas deal", async () => {
        const sor = await flowDeal("first")
        const a = s0()
        const b = s0()
        expect((await save("dealOwner", sor, a)).error).toBeNull()
        expect((await row(sor)).sales_reference).toBe(a)
        expect((await save("dealOwner", sor, b)).error).toBeNull()
        expect((await row(sor)).sales_reference).toBe(b)
        expect((await save("dealOwner", sor, null)).error).toBeNull()
        expect(await row(sor)).toMatchObject({ sales_reference: null, sales_reference_odoo_state: null })
    })

    it("reads the first Stage by sort order, not by position in the snapshot", async () => {
        const first = await flowDeal("first")
        const second = await flowDeal("second")
        const one = await svc().rpc("sor_at_first_stage", { p_opportunity_id: first })
        const two = await svc().rpc("sor_at_first_stage", { p_opportunity_id: second })
        expect(one.data).toBe(true)
        expect(two.data).toBe(false)
    })

    it("treats Lead as the first Stage on the old pipeline", async () => {
        const sor = await oldDeal(false)
        const a = s0()
        expect((await save("dealOwner", sor, a)).error).toBeNull()
        expect((await save("dealOwner", sor, s0())).error).toBeNull()
        expect((await save("dealOwner", sor, null)).error).toBeNull()
        expect((await row(sor)).sales_reference).toBeNull()
    })

    it("saves the typed S0 in capitals and reads SO123 as S123", async () => {
        const sor = await flowDeal("first")
        const digits = String(Math.floor(1000000 + Math.random() * 8999999))
        used.add(`S${digits}`)
        expect((await save("dealOwner", sor, ` so${digits} `)).error).toBeNull()
        expect((await row(sor)).sales_reference).toBe(`S${digits}`)
    })

    it("refuses a bad format", async () => {
        const sor = await flowDeal("first")
        const { error } = await save("dealOwner", sor, "ABC12")
        expect(error?.hint).toBe("format")
        expect((await row(sor)).sales_reference).toBeNull()
    })
})

describe("past the first Stage: fill once, then locked", () => {
    it("fills an empty S0 once, then refuses a non-admin", async () => {
        const sor = await flowDeal("second")
        expect((await svc().rpc("sor_sales_reference_lock", { p_opportunity_id: sor })).data).toBe("fill_once")
        const a = s0()
        expect((await save("dealOwner", sor, a)).error).toBeNull()
        expect((await svc().rpc("sor_sales_reference_lock", { p_opportunity_id: sor })).data).toBe("locked")
        const { error } = await save("dealOwner", sor, s0(), { reason: "typo" })
        expect(error?.hint).toBe("locked")
        const cleared = await save("dealOwner", sor, null, { reason: "typo" })
        expect(cleared.error?.hint).toBe("locked")
        expect((await row(sor)).sales_reference).toBe(a)
    })

    it("locks an old-pipeline deal past Lead that has an S0", async () => {
        const sor = await oldDeal(true)
        expect((await svc().rpc("sor_sales_reference_lock", { p_opportunity_id: sor })).data).toBe("locked")
        const { error } = await save("dealOwner", sor, s0())
        expect(error?.hint).toBe("locked")
    })

    it("lets a Super Admin change a locked S0 only with a reason, and writes an override entry", async () => {
        const old = s0()
        const sor = await flowDeal("second", old)
        const next = s0()
        const noReason = await save("superAdmin", sor, next)
        expect(noReason.error?.hint).toBe("reason_required")
        const blank = await save("superAdmin", sor, next, { reason: "   " })
        expect(blank.error?.hint).toBe("reason_required")
        expect((await row(sor)).sales_reference).toBe(old)

        expect((await save("superAdmin", sor, next, { reason: "Wrong quotation picked" })).error).toBeNull()
        expect((await row(sor)).sales_reference).toBe(next)
        const [entry] = await history(sor)
        expect(entry.metadata).toMatchObject({ event: "SALES_REFERENCE_OVERRIDDEN", old, new: next, reason: "Wrong quotation picked", employeeId: ids.superAdmin })
    })

    it("refuses a person who cannot edit the SOR, even in the first Stage", async () => {
        const sor = await flowDeal("first")
        const { error } = await save("outsider", sor, s0())
        expect(error?.hint).toBe("forbidden")
        expect((await row(sor)).sales_reference).toBeNull()
    })
})

describe("one S0 per SOR", () => {
    it("refuses an S0 on a live SOR and names that SOR", async () => {
        const taken = s0()
        const other = await flowDeal("first", taken)
        const { data: otherRow } = await svc().from("sales_opportunities").select("project_title").eq("id", other).single()
        const sor = await flowDeal("first")
        const { error } = await save("dealOwner", sor, taken)
        expect(error?.hint).toBe("duplicate")
        expect(error.message).toContain(otherRow.project_title)
        expect(error.message).toContain(taken)
        expect((await row(sor)).sales_reference).toBeNull()
    })

    it("refuses an S0 on a Lost SOR", async () => {
        const taken = s0()
        const other = await flowDeal("first", taken)
        const lost = await ok(
            svc().from("flow_stages").insert({ flow_id: flow.flowId, name: `${MARKER} Lost`, sort_order: 90, is_terminal: true, terminal_outcome: "lost" }).select("id").single(),
            "Lost Stage",
        )
        await ok(svc().from("sales_opportunities").update({ flow_stage_id: lost.id }).eq("id", other), "lose")
        const sor = await flowDeal("first")
        const { error } = await save("dealOwner", sor, taken)
        expect(error?.hint).toBe("duplicate")
        expect((await row(sor)).sales_reference).toBeNull()
    })

    it("refuses a duplicate for a Super Admin override too", async () => {
        const taken = s0()
        await flowDeal("first", taken)
        const sor = await flowDeal("second", s0())
        const { error } = await save("superAdmin", sor, taken, { reason: "Need this one" })
        expect(error?.hint).toBe("duplicate")
    })

    it("allows an S0 that is only on a deleted SOR", async () => {
        const taken = s0()
        const gone = await flowDeal("first", taken)
        await ok(svc().from("sales_opportunities").update({ is_deleted: true }).eq("id", gone), "delete")
        const sor = await flowDeal("first")
        expect((await save("dealOwner", sor, taken)).error).toBeNull()
        expect((await row(sor)).sales_reference).toBe(taken)
    })
})

describe("the Odoo fact", () => {
    it("refuses an S0 Odoo does not have", async () => {
        const sor = await flowDeal("first")
        const { error } = await save("dealOwner", sor, s0(), { odoo: "not_found" })
        expect(error?.hint).toBe("not_found")
        expect(error.message).toMatch(/Odoo has no S9\d+\. Check the number\./)
        expect((await row(sor)).sales_reference).toBeNull()
    })

    it("saves it as Not checked when Odoo did not answer (the default)", async () => {
        const sor = await flowDeal("first")
        expect((await save("dealOwner", sor, s0())).error).toBeNull()
        expect(await row(sor)).toMatchObject({ sales_reference_odoo_state: "not_checked", sales_reference_checked_at: null })
    })

    it("saves it as Found with the time Odoo was read", async () => {
        const sor = await flowDeal("first")
        expect((await save("dealOwner", sor, s0(), { odoo: "found" })).error).toBeNull()
        const r = await row(sor)
        expect(r.sales_reference_odoo_state).toBe("found")
        expect(r.sales_reference_checked_at).toBeTruthy()
    })
})

// #816: the edge function passes the Odoo lines (mapped like modal/odooLines.js toRow) with the fact.
const odooRow = (line, name) => ({
    product_name: name,
    unit: "Unit",
    quantity: 2,
    unit_price: 100,
    odoo_product_id: null,
    odoo_line_id: line,
    removed_from_s0: false,
})

const itemsOf = async (sorId) =>
    ok(svc().from("sales_opportunity_items").select("product_name, odoo_line_id, removed_from_s0").eq("opportunity_id", sorId).order("odoo_line_id"), "items")

describe("pulling products in the same step (#816)", () => {
    it("pulls the Odoo lines when the S0 is found", async () => {
        const sor = await flowDeal("first")
        const { error } = await save("dealOwner", sor, s0(), { odoo: "found", items: [odooRow(710001, "Pump"), odooRow(710002, "Hose")] })
        expect(error).toBeNull()
        expect((await itemsOf(sor)).map((i) => [i.product_name, i.odoo_line_id])).toEqual([["Pump", 710001], ["Hose", 710002]])
    })

    it("leaves the Product List alone when Odoo has no such S0 (refused)", async () => {
        const sor = await flowDeal("first")
        const { error } = await save("dealOwner", sor, s0(), { odoo: "not_found", items: [odooRow(710003, "Ghost")] })
        expect(error?.hint).toBe("not_found")
        expect(await itemsOf(sor)).toEqual([])
    })

    it("saves as Not checked and pulls nothing when Odoo did not answer", async () => {
        const sor = await flowDeal("first")
        expect((await save("dealOwner", sor, s0(), { odoo: "unreachable" })).error).toBeNull()
        expect((await row(sor)).sales_reference_odoo_state).toBe("not_checked")
        expect(await itemsOf(sor)).toEqual([])
    })

    it("does not pull lines when the save is refused for another reason (duplicate)", async () => {
        const taken = s0()
        await flowDeal("first", taken)
        const sor = await flowDeal("first")
        const { error } = await save("dealOwner", sor, taken, { odoo: "found", items: [odooRow(710004, "Dup")] })
        expect(error?.hint).toBe("duplicate")
        expect(await itemsOf(sor)).toEqual([])
    })
})

describe("history", () => {
    it("writes one entry for each set, change and clear, and none for a same-value save", async () => {
        const sor = await flowDeal("first")
        const a = s0()
        const b = s0()
        await save("dealOwner", sor, a)
        await save("dealOwner", sor, a)
        await save("dealOwner", sor, b, { reason: "Typo" })
        await save("dealOwner", sor, null)
        const entries = await history(sor)
        expect(entries.map((e) => e.metadata.event)).toEqual(["SALES_REFERENCE_SET", "SALES_REFERENCE_CHANGED", "SALES_REFERENCE_CLEARED"])
        expect(entries[0].metadata).toMatchObject({ old: null, new: a, employeeId: ids.dealOwner })
        expect(entries[1].metadata).toMatchObject({ old: a, new: b, reason: "Typo" })
        expect(entries[2].metadata).toMatchObject({ old: b, new: null })
        for (const e of entries) {
            expect(e.type).toBe("SYSTEM")
            expect(e.author_id).toBe(ids.dealOwner)
            expect(e.created_at).toBeTruthy()
        }
        const { data: audit } = await svc().from("system_audit_logs").select("id").eq("entity_id", sor).like("metadata->>event", "SALES_REFERENCE_%")
        expect(audit).toHaveLength(3)
    })
})

describe("the card read", () => {
    it("tells the caller the lock, the first Stage and whether they may change it", async () => {
        const sor = await flowDeal("second", s0())
        const owner = await (await clientFor("dealOwner")).rpc("sales_reference_card", { p_opportunity_id: sor })
        expect(owner.error).toBeNull()
        expect(owner.data).toMatchObject({ lock: "locked", can_edit: false, first_stage_name: `${MARKER} First`, product_count: 0 })
        const admin = await (await clientFor("superAdmin")).rpc("sales_reference_card", { p_opportunity_id: sor })
        expect(admin.data.can_edit).toBe(true)
        const open = await flowDeal("first")
        const card = await (await clientFor("dealOwner")).rpc("sales_reference_card", { p_opportunity_id: open })
        expect(card.data).toMatchObject({ lock: "open", can_edit: true, sales_reference: null })
    })

    it("refuses someone who cannot read the SOR", async () => {
        const sor = await flowDeal("first")
        const { error } = await (await clientFor("outsider")).rpc("sales_reference_card", { p_opportunity_id: sor })
        expect(error).not.toBeNull()
    })

    it("is not open to the browser as a save: set_sales_reference is service role only", async () => {
        const sor = await flowDeal("first")
        const { error } = await (await clientFor("dealOwner")).rpc("set_sales_reference", {
            p_actor_email: castEmail("dealOwner"),
            p_opportunity_id: sor,
            p_sales_reference: s0(),
        })
        expect(error).not.toBeNull()
    })
})
