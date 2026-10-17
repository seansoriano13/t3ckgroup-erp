/**
 * Costing Matrix, the Costing settled Stage Condition (#272, spec #266): the kind CHECK, the
 * evidence function `costing_condition_inputs` (any caller who can see the SOR gets only
 * booleans, counts and the verdict, never a peso figure), the one-centavo ABC comparison, the
 * bid-submitted stamp and the timeline entry a Final Offer change writes after it.
 *
 * The cast, on one SOR (dealOwner and support are its Deal Team):
 *   dealOwner, support  Deal Team                          -> price tier (reads the evidence)
 *   outsider            Purchasing access, no part in it   -> cost tier (writes Components)
 *   stageParticipant    open Stage Participant window      -> participant tier
 *   ipasSigner          on the final_acquire list          -> closed_book (Final Acquire, decides)
 *   ordinary            nobody                             -> sees nothing: refused
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, anonymousClient, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { purgeCostingForSors } from "./support/costing.js"

const svc = () => serviceClient()

let saleTypeId, flowId, stageId
let sorId, matrixId, lineId, componentId, costRowId, visitId, conditionId, snapshotId
const sorIds = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

const inputs = async (who, opportunityId = sorId) => (await clientFor(who)).rpc("costing_condition_inputs", { p_opportunity_id: opportunityId })
const setMoney = async (who, table, row, patch) =>
    (await (await clientFor(who)).rpc("costing_set_money", { p_table: table, p_row: row, p_patch: patch })).error
const logs = async () =>
    asSvc(
        svc().from("sales_opportunity_logs").select("*").eq("opportunity_id", sorId).eq("metadata->>event", "COSTING_FINAL_OFFER_CHANGED").order("created_at"),
        "logs",
    )
const bidSubmittedAt = async () => (await asSvc(svc().from("costing_matrices").select("bid_submitted_at").eq("id", matrixId).single(), "matrix")).bid_submitted_at

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")

    saleTypeId = (await asSvc(svc().from("sale_types").insert({ name: `${MARKER} Settled` }).select("id").single(), "sale type")).id
    flowId = (await asSvc(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "flow")).id
    stageId = (await asSvc(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Settled Stage`, sort_order: 10 }).select("id").single(), "stage")).id

    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, supportSales1Id: ids.support, saleTypeId, flowStageId: stageId })
    sorIds.push(sorId)

    visitId = (await asSvc(svc().from("sor_stage_visits").select("id").eq("opportunity_id", sorId).single(), "visit")).id
    await asSvc(
        svc().from("sor_stage_participants").insert({
            opportunity_id: sorId,
            employee_id: ids.stageParticipant,
            source: "action",
            opened_visit_id: visitId,
            until_rule: "stage_left",
        }),
        "participant window",
    )
    await asSvc(svc().from("costing_signer_lists").insert({ list_key: "final_acquire", employee_id: ids.ipasSigner }), "signer list")
})

afterAll(async () => {
    await svc().from("sales_opportunity_logs").delete().in("opportunity_id", sorIds)
    await svc().from("costing_signer_lists").delete().eq("employee_id", ids.ipasSigner)
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeCostingForSors(sorIds)
    await svc().from("sor_stage_participants").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    if (snapshotId) await svc().from("flow_snapshots").delete().eq("id", snapshotId)
    await svc().from("stage_conditions").delete().eq("stage_id", stageId)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("the condition kind", () => {
    it("is accepted by the kind CHECK, alongside every older kind", async () => {
        for (const kind of ["costing_settled", "purchasing_settled", "purchasing", "attachment"]) {
            const { data, error } = await svc().from("stage_conditions").insert({ stage_id: stageId, kind, label: `${MARKER} ${kind}` }).select("id").single()
            expect(error, kind).toBeNull()
            await svc().from("stage_conditions").delete().eq("id", data.id)
        }
        const { error } = await svc().from("stage_conditions").insert({ stage_id: stageId, kind: "nonsense", label: MARKER })
        expect(error?.code).toBe("23514")
    })
})

describe("the evidence: who may ask, and what it says", () => {
    it("says there is no matrix before one is opened", async () => {
        for (const who of ["dealOwner", "support", "stageParticipant", "superAdmin"]) {
            const { data, error } = await inputs(who)
            expect(error, who).toBeNull()
            expect(data, who).toEqual({ has_matrix: false })
        }
    })

    it("is refused to anon and to someone who cannot see the SOR", async () => {
        const stranger = await inputs("ordinary")
        expect(stranger.error?.code).toBe("42501")
        const anon = await anonymousClient().rpc("costing_condition_inputs", { p_opportunity_id: sorId })
        expect(anon.error).toBeTruthy()
    })

    it("builds up as the matrix is filled in", async () => {
        const opened = await svc().rpc("costing_open_matrix", { p_opportunity_id: sorId })
        if (opened.error) throw new Error(`costing_open_matrix: ${opened.error.message}`)
        matrixId = opened.data

        expect((await inputs("dealOwner")).data).toEqual({
            has_matrix: true,
            line_count: 0,
            missing_offer: 0,
            over_abc: false,
            costed_rows: 0,
            missing_cost: 0,
            evaluation_approved: false,
            bid_verdict: null,
            // #463's keys, beside #272's.
            settled_met: false,
            component_count: 0,
            missing_acquire: 0,
            has_purchasing_incharge: false,
        })

        lineId = (
            await asSvc(svc().from("costing_tender_lines").insert({ matrix_id: matrixId, position: 1, tender_specification: "Rescue tripod", quantity: 2, created_by: ids.dealOwner }).select("id").single(), "line")
        ).id
        expect((await inputs("dealOwner")).data).toMatchObject({ line_count: 1, missing_offer: 1, over_abc: false })

        componentId = (
            await asSvc(svc().from("costing_components").insert({ tender_line_id: lineId, position: 1, name: "Tripod head", quantity: 1 }).select("id").single(), "component")
        ).id
        const row = await (await clientFor("outsider")).rpc("costing_add_cost_row", { p_matrix_id: matrixId, p_description: "Delivery", p_quantity: 1 })
        if (row.error) throw new Error(`costing_add_cost_row: ${row.error.message}`)
        costRowId = row.data
        expect((await inputs("dealOwner")).data).toMatchObject({ costed_rows: 2, missing_cost: 2 })

        expect(await setMoney("ipasSigner", "costing_component_costs", componentId, { final_acquire_unit: 400 })).toBeNull()
        expect((await inputs("dealOwner")).data).toMatchObject({ costed_rows: 2, missing_cost: 1 })
        expect(await setMoney("ipasSigner", "costing_cost_rows", costRowId, { final_acquire_unit: 50 })).toBeNull()
        expect((await inputs("dealOwner")).data).toMatchObject({ costed_rows: 2, missing_cost: 0 })
    })

    it("compares the Final Offer total with ABC to the centavo, in the database", async () => {
        // 2 x 1,000.00 = 2,000.00 against 2 x 1,000.00: not over.
        expect(await setMoney("dealOwner", "costing_tender_line_prices", lineId, { abc_unit: 1000, final_offer_unit: 1000 })).toBeNull()
        expect((await inputs("dealOwner")).data).toMatchObject({ missing_offer: 0, over_abc: false })

        // One centavo more on the unit price is two centavos more on the line.
        expect(await setMoney("dealOwner", "costing_tender_line_prices", lineId, { final_offer_unit: 1000.01 })).toBeNull()
        expect((await inputs("dealOwner")).data.over_abc).toBe(true)

        expect(await setMoney("dealOwner", "costing_tender_line_prices", lineId, { final_offer_unit: 999.99 })).toBeNull()
        expect((await inputs("dealOwner")).data.over_abc).toBe(false)
        expect(await setMoney("dealOwner", "costing_tender_line_prices", lineId, { final_offer_unit: 1000 })).toBeNull()
    })

    it("follows the evaluation approval and the live Bid Decision, and clears them again", async () => {
        await asSvc(svc().from("costing_signoffs").insert({ matrix_id: matrixId, role: "evaluation_approved", signed_by: ids.ipasSigner }), "sign-off")
        expect((await inputs("dealOwner")).data.evaluation_approved).toBe(true)

        const decided = await (await clientFor("ipasSigner")).rpc("costing_decide_bid", { p_matrix_id: matrixId, p_verdict: "go", p_reason: "Margin is fine" })
        expect(decided.error).toBeNull()
        expect((await inputs("dealOwner")).data.bid_verdict).toBe("go")

        // An Offer Specification edit clears the approval...
        const edit = await (await clientFor("outsider")).from("costing_components").update({ offer_specification: "Aluminium head" }).eq("id", componentId)
        expect(edit.error).toBeNull()
        expect((await inputs("dealOwner")).data.evaluation_approved).toBe(false)

        // ...and a Final Offer change clears the Bid Decision.
        expect(await setMoney("dealOwner", "costing_tender_line_prices", lineId, { final_offer_unit: 990 })).toBeNull()
        expect((await inputs("dealOwner")).data.bid_verdict).toBeNull()
    })

    it("gives the price and Closed Book tiers the full evidence: booleans, counts and the verdict, no money", async () => {
        const mine = (await inputs("dealOwner")).data
        for (const who of ["support", "superAdmin"]) {
            const { data, error } = await inputs(who)
            expect(error, who).toBeNull()
            expect(data, who).toEqual(mine)
        }
        expect(Object.keys(mine).sort()).toEqual(
            [
                "bid_verdict",
                "component_count",
                "costed_rows",
                "evaluation_approved",
                "has_matrix",
                "has_purchasing_incharge",
                "line_count",
                "missing_acquire",
                "missing_cost",
                "missing_offer",
                "over_abc",
                "settled_met",
            ].sort(),
        )
        for (const [key, value] of Object.entries(mine)) {
            expect(["boolean", "number", "string", "object"], key).toContain(typeof value)
            if (typeof value === "string") expect(["go", "no_go", "revise"]).toContain(value)
        }
        expect(JSON.stringify(mine)).not.toMatch(/990|1000|400|50\b/)
    })

    it("sends everyone else (a Stage Participant) no bid verdict, no over-ABC and no settled evidence, only settled_met", async () => {
        const { data, error } = await inputs("stageParticipant")
        expect(error).toBeNull()
        expect(Object.keys(data).sort()).toEqual(["component_count", "has_matrix", "has_purchasing_incharge", "missing_acquire", "settled_met"])
        expect(data.settled_met).toBe(false)
        // The Costing priced evidence holds no money and is the same as the price tier's.
        const full = (await inputs("dealOwner")).data
        for (const key of ["component_count", "missing_acquire", "has_purchasing_incharge"]) expect(data[key], key).toEqual(full[key])
    })

    it("computes settled_met in the database, the same for every caller, and not before the matrix is ready", async () => {
        for (const who of ["dealOwner", "stageParticipant", "superAdmin"]) expect((await inputs(who)).data.settled_met, who).toBe(false)
    })
})

describe("bid submitted", () => {
    it("writes nothing to the timeline for a Final Offer change before the bid is submitted", async () => {
        expect(await bidSubmittedAt()).toBeNull()
        expect(await setMoney("dealOwner", "costing_tender_line_prices", lineId, { final_offer_unit: 980 })).toBeNull()
        expect(await logs()).toHaveLength(0)
    })

    it("is refused to anyone who has not just moved the SOR", async () => {
        for (const who of ["dealOwner", "outsider", "ipasSigner"]) {
            const { error } = await (await clientFor(who)).rpc("costing_mark_bid_submitted", { p_opportunity_id: sorId })
            expect(error?.code, who).toBe("42501")
        }
        expect(await bidSubmittedAt()).toBeNull()
    })

    it("stamps nothing when the Stage just left has no Costing settled condition, or it is not met, or it is archived", async () => {
        await asSvc(svc().from("sor_stage_visits").update({ left_at: new Date().toISOString(), left_by: ids.dealOwner }).eq("id", visitId), "leave the Stage")
        const mark = async () => await (await clientFor("dealOwner")).rpc("costing_mark_bid_submitted", { p_opportunity_id: sorId })

        // No Costing settled condition on that Stage.
        let result = await mark()
        expect(result.error).toBeNull()
        expect(result.data).toBe(false)
        expect(await bidSubmittedAt()).toBeNull()

        // The condition is there, but the matrix does not meet it (no evaluation approval, no Bid Decision).
        conditionId = (await asSvc(svc().from("stage_conditions").insert({ stage_id: stageId, kind: "costing_settled", label: `${MARKER} Costing settled` }).select("id").single(), "condition")).id
        result = await mark()
        expect(result.data).toBe(false)
        expect(await bidSubmittedAt()).toBeNull()

        // Settle it: evaluation approved and a Go.
        await asSvc(svc().from("costing_signoffs").insert({ matrix_id: matrixId, role: "evaluation_approved", signed_by: ids.ipasSigner }), "sign-off")
        const decided = await (await clientFor("ipasSigner")).rpc("costing_decide_bid", { p_matrix_id: matrixId, p_verdict: "go", p_reason: "Margin is fine" })
        expect(decided.error).toBeNull()
        expect((await inputs("stageParticipant")).data.settled_met).toBe(true)
        expect((await inputs("dealOwner")).data.settled_met).toBe(true)

        // An archived condition is not a gate.
        await asSvc(svc().from("stage_conditions").update({ archived_at: new Date().toISOString() }).eq("id", conditionId), "archive")
        result = await mark()
        expect(result.data).toBe(false)
        expect(await bidSubmittedAt()).toBeNull()
        await asSvc(svc().from("stage_conditions").update({ archived_at: null }).eq("id", conditionId), "unarchive")
    })

    it("reads the condition from the visit's Flow Snapshot, in either stored shape", async () => {
        const mark = async () => await (await clientFor("dealOwner")).rpc("costing_mark_bid_submitted", { p_opportunity_id: sorId })
        const setData = (data) => asSvc(svc().from("flow_snapshots").update({ snapshot_data: data }).eq("id", snapshotId), "snapshot data")
        const reset = () => asSvc(svc().from("costing_matrices").update({ bid_submitted_at: null }).eq("id", matrixId), "reset the stamp")

        snapshotId = (await asSvc(svc().from("flow_snapshots").insert({ flow_id: flowId, version: 9001, snapshot_data: { conditions: [{ stage_id: stageId, kind: "tickbox" }] } }).select("id").single(), "snapshot")).id
        await asSvc(svc().from("sor_stage_visits").update({ flow_snapshot_id: snapshotId }).eq("id", visitId), "pin the snapshot")

        // The live Stage has the condition but the SOR's snapshot does not: the snapshot governs.
        expect((await mark()).data).toBe(false)
        expect(await bidSubmittedAt()).toBeNull()

        await setData({ conditions: [{ stage_id: stageId, kind: "costing_settled", archived_at: null }] })
        expect((await mark()).data).toBe(true)

        await reset()
        await setData({ conditions: { [stageId]: [{ stage_id: stageId, kind: "costing_settled" }] } })
        expect((await mark()).data).toBe(true)

        await reset()
        await asSvc(svc().from("sor_stage_visits").update({ flow_snapshot_id: null }).eq("id", visitId), "unpin")
    })

    it("is stamped once, for the person who has just left the Stage", async () => {
        const first = await (await clientFor("dealOwner")).rpc("costing_mark_bid_submitted", { p_opportunity_id: sorId })
        expect(first.error).toBeNull()
        expect(first.data).toBe(true)
        const stamped = await bidSubmittedAt()
        expect(stamped).not.toBeNull()

        // Someone else who did not move it is still refused; a repeat changes nothing.
        const other = await (await clientFor("outsider")).rpc("costing_mark_bid_submitted", { p_opportunity_id: sorId })
        expect(other.error?.code).toBe("42501")
        const again = await (await clientFor("dealOwner")).rpc("costing_mark_bid_submitted", { p_opportunity_id: sorId })
        expect(again.data).toBe(false)
        expect(await bidSubmittedAt()).toBe(stamped)
    })

    it("tells the timeline about a Final Offer change after it, with the line number and no figures", async () => {
        expect(await setMoney("dealOwner", "costing_tender_line_prices", lineId, { final_offer_unit: 975.5 })).toBeNull()
        const entries = await logs()
        expect(entries).toHaveLength(1)
        expect(entries[0]).toMatchObject({
            opportunity_id: sorId,
            type: "SYSTEM",
            author_id: ids.dealOwner,
            content: "Final Offer changed on Tender Line 1 after the bid was submitted.",
        })
        expect(entries[0].content).not.toMatch(/975|980|990/)
        expect(entries[0].metadata.tender_line_id).toBe(lineId)

        // Setting the same price again is not a change.
        expect(await setMoney("dealOwner", "costing_tender_line_prices", lineId, { final_offer_unit: 975.5 })).toBeNull()
        expect(await logs()).toHaveLength(1)

        // A change to ABC alone is not a Final Offer change.
        expect(await setMoney("dealOwner", "costing_tender_line_prices", lineId, { abc_unit: 1200 })).toBeNull()
        expect(await logs()).toHaveLength(1)
    })
})

describe("who cannot ask", () => {
    it("refuses people who cannot see the SOR, whatever their matrix standing (Purchasing access, the Final Acquire list)", async () => {
        for (const who of ["ordinary", "outsider", "ipasSigner"]) {
            const { error } = await inputs(who)
            expect(error?.code, who).toBe("42501")
        }
    })
})
