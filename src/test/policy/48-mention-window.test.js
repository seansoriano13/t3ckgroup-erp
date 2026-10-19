/**
 * #473 (ADR 0021, amendment 2026-10-07) — a note Mention opens a Mention
 * Window on the SOR's current Stage Visit, until the SOR leaves it.
 *
 * Three-Stage flow; Stage 2 shuts Support Sales out. The SOR is walked through
 * by hand (service role) as 14-sor-restricted-stages.test.js does, with one
 * note seeded per visit. Assertions run as the signed-in cast.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { makeSor, MARKER } from "./support/rows.js"

let saleTypeId, flowId, sorId, oldSor
const stageIds = []
const noteIds = []

async function moveTo(stageIndex) {
    const svc = serviceClient()
    const { error } = await svc.from("sales_opportunities").update({ flow_stage_id: stageIds[stageIndex] }).eq("id", sorId)
    if (error) throw new Error(`Moving to stage ${stageIndex}: ${error.message}`)
    const note = await svc
        .from("sales_opportunity_logs")
        .insert({ opportunity_id: sorId, author_id: ids.dealOwner, type: "COMMENT", content: `${MARKER} note on stage ${stageIndex}` })
        .select("id, stage_visit_id")
        .single()
    if (note.error) throw new Error(`Seeding a note: ${note.error.message}`)
    if (!note.data.stage_visit_id) throw new Error("fixture: the note was not stamped with a Stage Visit")
    noteIds[stageIndex] = note.data.id
}

beforeAll(async () => {
    await ensureCastLoaded()
    const svc = serviceClient()
    const st = await svc.from("sale_types").insert({ name: `${MARKER} Mention Window Sale Type` }).select("id").single()
    if (st.error) throw new Error(st.error.message)
    saleTypeId = st.data.id
    const flow = await svc.from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single()
    if (flow.error) throw new Error(flow.error.message)
    flowId = flow.data.id
    for (let i = 1; i <= 3; i++) {
        const s = await svc.from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} MW Stage ${i}`, sort_order: i * 10 }).select("id").single()
        if (s.error) throw new Error(s.error.message)
        stageIds.push(s.data.id)
    }
    const access = await svc.from("flow_stage_access").insert({ stage_id: stageIds[1], shut_out_roles: ["support_sales"] })
    if (access.error) throw new Error(access.error.message)

    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageIds[0] })
    await svc.from("sales_opportunities").update({ support_sales_1_id: ids.support }).eq("id", sorId)
    const note = await svc
        .from("sales_opportunity_logs")
        .insert({ opportunity_id: sorId, author_id: ids.dealOwner, type: "COMMENT", content: `${MARKER} note on stage 0` })
        .select("id")
        .single()
    if (note.error) throw new Error(note.error.message)
    noteIds[0] = note.data.id

    oldSor = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
})

afterAll(async () => {
    const svc = serviceClient()
    await svc.from("sor_mention_viewers").delete().in("opportunity_id", [sorId, oldSor])
    await svc.from("sales_opportunity_logs").delete().in("opportunity_id", [sorId, oldSor])
    await svc.from("sales_opportunities").delete().in("id", [sorId, oldSor])
    await svc.from("flow_stage_access").delete().in("stage_id", stageIds)
    await svc.from("flow_stages").delete().in("id", stageIds)
    await svc.from("sales_flows").delete().eq("id", flowId)
    await svc.from("sale_types").delete().eq("id", saleTypeId)
})

const access = async (key, id) => (await (await clientFor(key)).rpc("sor_access_level", { p_opportunity_id: id })).data
const canReadNote = async (key, noteId) => {
    const { data } = await (await clientFor(key)).from("sales_opportunity_logs").select("id").eq("id", noteId)
    return (data?.length ?? 0) === 1
}
const mention = async (by, who, id = sorId) =>
    (await clientFor(by)).rpc("sor_grant_mention_view", { p_opportunity_id: id, p_employee_ids: who })

describe("Mention Window", () => {
    it("the composer can ask who a Mention would open a window for", async () => {
        const { data, error } = await (await clientFor("dealOwner")).rpc("sor_mention_window_candidates", {
            p_opportunity_id: sorId,
            p_employee_ids: [ids.outsider, ids.dealOwner, ids.support],
        })
        expect(error).toBeNull()
        expect(data).toEqual([ids.outsider])
    })

    it("an outsider cannot ask, and gets nothing back", async () => {
        const { data } = await (await clientFor("outsider")).rpc("sor_mention_window_candidates", {
            p_opportunity_id: sorId,
            p_employee_ids: [ids.outsider],
        })
        expect(data ?? []).toEqual([])
    })

    it("a Mention opens the current visit: its notes, to read and reply to", async () => {
        expect(await access("outsider", sorId)).toBe("none")
        expect(await canReadNote("outsider", noteIds[0])).toBe(false)
        const { data, error } = await mention("dealOwner", [ids.outsider])
        expect(error).toBeNull()
        expect(data).toBe(1)
        expect(await access("outsider", sorId)).toBe("participant")
        expect(await canReadNote("outsider", noteIds[0])).toBe(true)

        const reply = await (await clientFor("outsider"))
            .from("sales_opportunity_logs")
            .insert({ opportunity_id: sorId, author_id: ids.outsider, type: "COMMENT", content: `${MARKER} reply` })
            .select("id")
            .single()
        expect(reply.error).toBeNull()
        expect(reply.data?.id).toBeTruthy()
    })

    it("a second Mention on the same visit adds no row", async () => {
        const { data } = await mention("dealOwner", [ids.outsider])
        expect(data).toBe(0)
    })

    it("once the SOR moves, the window locks: the mentioned visit stays readable, the new one does not", async () => {
        await moveTo(1)
        expect(await access("outsider", sorId)).toBe("locked")
        expect(await canReadNote("outsider", noteIds[0])).toBe(true)
        expect(await canReadNote("outsider", noteIds[1])).toBe(false)
    })

    it("a locked person cannot mention others in", async () => {
        const { error } = await mention("outsider", [ids.ordinary])
        expect(error?.code).toBe("42501")
    })

    it("a Mention on the later visit opens it too", async () => {
        await mention("dealOwner", [ids.outsider])
        expect(await access("outsider", sorId)).toBe("participant")
        expect(await canReadNote("outsider", noteIds[1])).toBe(true)
    })

    it("someone inside a window can mention a third person in (TIGHTEN(mention) relaxation)", async () => {
        const { error } = await mention("outsider", [ids.ordinary])
        expect(error).toBeNull()
        expect(await access("ordinary", sorId)).toBe("participant")
        expect(await canReadNote("ordinary", noteIds[1])).toBe(true)
        expect(await canReadNote("ordinary", noteIds[0])).toBe(false)
    })

    it("a Mention opens a Restricted Stage to someone shut out of it (TIGHTEN(mention) relaxation)", async () => {
        expect(await canReadNote("support", noteIds[1])).toBe(false)
        const { data } = await mention("dealOwner", [ids.support])
        expect(data).toBe(1)
        expect(await canReadNote("support", noteIds[1])).toBe(true)
    })

    it("each window notifies only while its visit is open", async () => {
        const svc = serviceClient()
        const { data: visit } = await svc
            .from("sor_stage_visits")
            .select("id")
            .eq("opportunity_id", sorId)
            .eq("flow_stage_id", stageIds[1])
            .single()
        const { data: audience } = await (await clientFor("dealOwner")).rpc("sor_visit_audience", {
            p_opportunity_id: sorId,
            p_visit_id: visit.id,
        })
        expect(audience).toEqual(expect.arrayContaining([ids.outsider, ids.ordinary, ids.support]))
        await moveTo(2)
        const { data: after } = await (await clientFor("dealOwner")).rpc("sor_visit_audience", {
            p_opportunity_id: sorId,
            p_visit_id: visit.id,
        })
        expect(after).not.toContain(ids.ordinary)
    })

    it("the mentioned person reads their own windows with the Stage and who mentioned them", async () => {
        const { data, error } = await (await clientFor("outsider"))
            .from("sor_mention_viewers")
            .select("id, stage_visit_id, granter:employees!sor_mention_viewers_granted_by_fkey(name), visit:sor_stage_visits(left_at, undone_at, flow_stages(name))")
            .eq("opportunity_id", sorId)
            .order("created_at", { ascending: true })
        expect(error).toBeNull()
        expect(data.map((r) => r.visit?.flow_stages?.name)).toEqual([`${MARKER} MW Stage 1`, `${MARKER} MW Stage 2`])
        expect(data.every((r) => r.granter?.name === "Deal Owner")).toBe(true)
    })

    it("the Deal Team sees who the SOR is shared with; a mentioned person does not (#477)", async () => {
        const { data, error } = await (await clientFor("dealOwner")).rpc("sor_mention_shares", { p_opportunity_id: sorId })
        expect(error).toBeNull()
        const ordinary = data.find((r) => r.employee_id === ids.ordinary)
        expect(ordinary).toMatchObject({ stage_name: `${MARKER} MW Stage 2`, is_open: false })
        expect(ordinary.granted_by_name).toBeTruthy()
        expect(data.filter((r) => r.employee_id === ids.outsider)).toHaveLength(2)

        const { data: theirs } = await (await clientFor("outsider")).rpc("sor_mention_shares", { p_opportunity_id: sorId })
        expect(theirs).toEqual([])
    })

    it("My SORs reads the SOR code and Sales Flow only for SORs the caller reaches (#478)", async () => {
        const { data, error } = await (await clientFor("outsider")).rpc("sor_my_sors_facets", { p_opportunity_ids: [sorId] })
        expect(error).toBeNull()
        expect(data).toEqual([expect.objectContaining({ opportunity_id: sorId, sale_type_name: `${MARKER} Mention Window Sale Type` })])
        const { data: none } = await (await clientFor("hr")).rpc("sor_my_sors_facets", { p_opportunity_ids: [sorId] })
        expect(none).toEqual([])
    })

    it("My SORs hides last activity and client from a person whose Mention Window has closed (#478)", async () => {
        const { data, error } = await (await clientFor("outsider")).rpc("sor_my_sors_facets", { p_opportunity_ids: [sorId] })
        expect(error).toBeNull()
        expect(data).toHaveLength(1)
        expect(data[0].last_activity_at).toBeNull()
        expect(data[0].client_name).toBeNull()
    })

    it("My SORs lists only the SORs the caller is on the Deal Team of, with a last-activity time (#478)", async () => {
        const mine = await (await clientFor("dealOwner")).rpc("sor_my_deal_team_sor_ids")
        expect(mine.error).toBeNull()
        expect(mine.data).toEqual(expect.arrayContaining([sorId, oldSor]))

        // Support Sales 1 is on this SOR's Deal Team; a mentioned person is not.
        const support = await (await clientFor("support")).rpc("sor_my_deal_team_sor_ids")
        expect(support.data).toContain(sorId)
        expect(support.data).not.toContain(oldSor)
        const outsider = await (await clientFor("outsider")).rpc("sor_my_deal_team_sor_ids")
        expect(outsider.data ?? []).not.toContain(sorId)

        const { data } = await (await clientFor("dealOwner")).rpc("sor_my_sors_facets", { p_opportunity_ids: [sorId] })
        expect(new Date(data[0].last_activity_at).getTime()).toBeGreaterThan(0)
    })

    it("My SORs Deal Team list leaves out soft-deleted and scratch SORs (#478)", async () => {
        const svc = serviceClient()
        const deleted = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
        const scratch = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
        try {
            const marked = await Promise.all([
                svc.from("sales_opportunities").update({ is_deleted: true }).eq("id", deleted),
                svc.from("sales_opportunities").update({ is_scratch: true }).eq("id", scratch),
            ])
            marked.forEach((r) => expect(r.error).toBeNull())

            const { data, error } = await (await clientFor("dealOwner")).rpc("sor_my_deal_team_sor_ids")
            expect(error).toBeNull()
            expect(data).toContain(sorId)
            expect(data).not.toContain(deleted)
            expect(data).not.toContain(scratch)
        } finally {
            await svc.from("sales_opportunities").delete().in("id", [deleted, scratch])
        }
    })

    it("an SOR with no Stage Visit keeps the permanent header grant", async () => {
        const { error } = await mention("dealOwner", [ids.outsider], oldSor)
        expect(error).toBeNull()
        expect(await access("outsider", oldSor)).toBe("participant")
        const { data } = await serviceClient().from("sor_mention_viewers").select("stage_visit_id").eq("opportunity_id", oldSor)
        expect(data).toEqual([{ stage_visit_id: null }])
    })

    it("a header-only grant lapses to locked once the SOR gains a Stage Visit", async () => {
        expect(await access("outsider", oldSor)).toBe("participant")
        const moved = await serviceClient().from("sales_opportunities").update({ sale_type_id: saleTypeId, flow_stage_id: stageIds[0] }).eq("id", oldSor)
        if (moved.error) throw new Error(moved.error.message)
        const { data: visits } = await serviceClient().from("sor_stage_visits").select("id").eq("opportunity_id", oldSor)
        if (!visits?.length) throw new Error("fixture: no Stage Visit recorded")
        expect(await access("outsider", oldSor)).toBe("locked")
        const { error } = await mention("outsider", [ids.ordinary], oldSor)
        expect(error?.code).toBe("42501")
    })
})
