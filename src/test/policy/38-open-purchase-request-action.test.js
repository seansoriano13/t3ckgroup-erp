/**
 * Open Purchase Request (#304, part of #209): the Stage Action that opens an
 * SOR's one Purchase Request, and members added to or removed from it.
 *
 * `stageParticipant` is given Purchasing access for this file only. It is the
 * purchasing member; `dealOwner` and `support` are the sales side. Requests are
 * read back with the service role, so a pass is the RPC's doing and not a read
 * policy's.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

const svc = () => serviceClient()

let saleTypeId, flowId, stageId, firstActionId, topUpActionId
const sorIds = []

async function one(query, what) {
    const { data, error } = await query.select("id").single()
    if (error) throw new Error(`${what}: ${error.message}`)
    return data.id
}

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.stageParticipant)
    if (flag.error) throw flag.error

    saleTypeId = await one(svc().from("sale_types").insert({ name: `${MARKER} Open PR` }), "sale type")
    flowId = await one(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }), "flow")
    stageId = await one(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Stage`, sort_order: 10 }), "stage")
    firstActionId = await one(
        svc().from("flow_stage_actions").insert({ stage_id: stageId, kind: "open_purchase_request" }),
        "action",
    )
    topUpActionId = await one(
        svc().from("flow_stage_actions").insert({ stage_id: stageId, kind: "open_purchase_request" }),
        "second action",
    )
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.stageParticipant)
    await svc().from("purchase_requests").delete().in("opportunity_id", sorIds)
    await svc().from("sor_stage_participants").delete().in("opportunity_id", sorIds)
    await svc().from("sor_action_runs").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_stage_actions").delete().in("id", [firstActionId, topUpActionId])
    await svc().from("flow_stages").delete().eq("id", stageId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

async function freshSor() {
    const id = await makeSor({
        registeredBy: ids.dealOwner,
        dealOwnerId: ids.dealOwner,
        supportSales1Id: ids.support,
        salesDirectorId: ids.head,
        saleTypeId,
        flowStageId: stageId,
    })
    sorIds.push(id)
    return id
}

async function visitOf(sorId) {
    const { data, error } = await svc().from("sor_stage_visits").select("id").eq("opportunity_id", sorId).limit(1).single()
    if (error) throw new Error(error.message)
    return data.id
}

/** Run the action(s) as the Deal Owner, the way a Stage move does. */
async function run(sorId, actions) {
    const visitId = await visitOf(sorId)
    const { data, error } = await (await clientFor("dealOwner")).rpc("sor_run_stage_actions", {
        p_opportunity_id: sorId,
        p_stage_id: stageId,
        p_stage_visit_id: visitId,
        p_actions: actions.map(({ id, config }) => ({
            action_id: id,
            kind: "open_purchase_request",
            name: "Open Purchase Request",
            confirm: false,
            purchase_request: config ?? {},
        })),
    })
    if (error) throw new Error(error.message)
    return data
}

async function requestOf(sorId) {
    const { data } = await svc().from("purchase_requests").select("*").eq("opportunity_id", sorId)
    return data
}

async function membersOf(requestId) {
    const { data } = await svc().from("purchase_request_members").select("employee_id, side").eq("request_id", requestId)
    return Object.fromEntries(data.map((m) => [m.employee_id, m.side]))
}

describe("running the action", () => {
    it("opens exactly one request, recording each member's side", async () => {
        const sorId = await freshSor()
        const result = await run(sorId, [{ id: firstActionId, config: { extra_member_ids: [ids.ordinary] } }])
        expect(result.failed).toEqual([])

        const requests = await requestOf(sorId)
        expect(requests).toHaveLength(1)
        expect(requests[0].buyer_id).toBeNull()

        const members = await membersOf(requests[0].id)
        expect(members[ids.stageParticipant]).toBe("purchasing")
        expect(members[ids.dealOwner]).toBe("sales")
        expect(members[ids.support]).toBe("sales")
        expect(members[ids.head]).toBe("sales")
        expect(members[ids.ordinary]).toBe("other")
    })

    it("leaves the left-out Deal Team roles out", async () => {
        const sorId = await freshSor()
        await run(sorId, [{ id: firstActionId, config: { left_out_roles: ["support_sales", "sales_director"] } }])
        const [request] = await requestOf(sorId)
        const members = await membersOf(request.id)
        expect(members[ids.dealOwner]).toBe("sales")
        expect(members[ids.support]).toBeUndefined()
        expect(members[ids.head]).toBeUndefined()
    })

    it("makes the Buyer a member", async () => {
        const sorId = await freshSor()
        await run(sorId, [{ id: firstActionId, config: { buyer_id: ids.stageParticipant } }])
        const [request] = await requestOf(sorId)
        expect(request.buyer_id).toBe(ids.stageParticipant)
        expect((await membersOf(request.id))[ids.stageParticipant]).toBe("purchasing")
    })

    it("opens a window on the opening visit for each purchasing member, and no one else", async () => {
        const sorId = await freshSor()
        const visitId = await visitOf(sorId)
        await run(sorId, [{ id: firstActionId, config: { access_until: "terminal" } }])
        const { data } = await svc()
            .from("sor_stage_participants")
            .select("employee_id, opened_visit_id, source, until_rule")
            .eq("opportunity_id", sorId)
            .eq("source", "purchase_request")
        expect(data.map((p) => p.employee_id)).toContain(ids.stageParticipant)
        expect(data.map((p) => p.employee_id)).not.toContain(ids.dealOwner)
        for (const p of data) {
            expect(p.opened_visit_id).toBe(visitId)
            expect(p.until_rule).toBe("terminal")
        }
    })

    it("re-running the same action opens nothing new and changes nothing", async () => {
        const sorId = await freshSor()
        await run(sorId, [{ id: firstActionId, config: {} }])
        const [before] = await requestOf(sorId)
        const membersBefore = await membersOf(before.id)

        await run(sorId, [{ id: firstActionId, config: { buyer_id: ids.stageParticipant, extra_member_ids: [ids.ordinary] } }])
        const after = await requestOf(sorId)
        expect(after).toHaveLength(1)
        expect(after[0].buyer_id).toBeNull()
        expect(await membersOf(before.id)).toEqual(membersBefore)
    })

    it("a second action tops up: sets the Buyer if none, adds missing members, never replaces", async () => {
        const sorId = await freshSor()
        await run(sorId, [{ id: firstActionId, config: { left_out_roles: ["support_sales"] } }])
        const [first] = await requestOf(sorId)

        await run(sorId, [
            { id: topUpActionId, config: { buyer_id: ids.stageParticipant, extra_member_ids: [ids.ordinary] } },
        ])
        const [second] = await requestOf(sorId)
        expect(second.id).toBe(first.id)
        expect(second.buyer_id).toBe(ids.stageParticipant)
        const members = await membersOf(first.id)
        expect(members[ids.ordinary]).toBe("other")
        // The top-up action left nothing out, so it adds the Support Sales the first one skipped.
        expect(members[ids.support]).toBe("sales")

        const sorId2 = await freshSor()
        await run(sorId2, [{ id: firstActionId, config: { buyer_id: ids.stageParticipant } }])
        await run(sorId2, [{ id: topUpActionId, config: { buyer_id: ids.head } }])
        const [kept] = await requestOf(sorId2)
        expect(kept.buyer_id).toBe(ids.stageParticipant)
    })
})

describe("members on a live request", () => {
    let sorId, requestId

    beforeAll(async () => {
        sorId = await freshSor()
        await run(sorId, [{ id: firstActionId, config: { buyer_id: ids.stageParticipant } }])
        requestId = (await requestOf(sorId))[0].id
    })

    it("a purchasing member adds and removes a member", async () => {
        const client = await clientFor("stageParticipant")
        const added = await client.rpc("purchase_request_add_member", { p_request_id: requestId, p_employee_id: ids.outsider })
        expect(added.error).toBeNull()
        expect((await membersOf(requestId))[ids.outsider]).toBe("other")

        const removed = await client.rpc("purchase_request_remove_member", { p_request_id: requestId, p_employee_id: ids.outsider })
        expect(removed.error).toBeNull()
        expect((await membersOf(requestId))[ids.outsider]).toBeUndefined()
    })

    it("a Super Admin adds a member", async () => {
        const { error } = await (await clientFor("superAdmin")).rpc("purchase_request_add_member", {
            p_request_id: requestId,
            p_employee_id: ids.outsider,
        })
        expect(error).toBeNull()
        await svc().from("purchase_request_members").delete().eq("request_id", requestId).eq("employee_id", ids.outsider)
    })

    it("a sales-side member can neither add nor remove", async () => {
        const client = await clientFor("dealOwner")
        const add = await client.rpc("purchase_request_add_member", { p_request_id: requestId, p_employee_id: ids.outsider })
        expect(add.error?.code).toBe("42501")
        const remove = await client.rpc("purchase_request_remove_member", { p_request_id: requestId, p_employee_id: ids.support })
        expect(remove.error?.code).toBe("42501")
        expect((await membersOf(requestId))[ids.support]).toBe("sales")
    })

    it("refuses to remove the Buyer", async () => {
        const { error } = await (await clientFor("stageParticipant")).rpc("purchase_request_remove_member", {
            p_request_id: requestId,
            p_employee_id: ids.stageParticipant,
        })
        expect(error?.code).toBe("42501")
    })

    it("removing a purchasing member closes their window", async () => {
        const client = await clientFor("superAdmin")
        await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
        try {
            await client.rpc("purchase_request_add_member", { p_request_id: requestId, p_employee_id: ids.outsider })
            const open = await svc()
                .from("sor_stage_participants")
                .select("id")
                .eq("opportunity_id", sorId)
                .eq("employee_id", ids.outsider)
                .is("closed_at", null)
            expect(open.data).toHaveLength(1)

            await client.rpc("purchase_request_remove_member", { p_request_id: requestId, p_employee_id: ids.outsider })
            const still = await svc()
                .from("sor_stage_participants")
                .select("id")
                .eq("opportunity_id", sorId)
                .eq("employee_id", ids.outsider)
                .is("closed_at", null)
            expect(still.data).toHaveLength(0)
        } finally {
            await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
        }
    })
})
