/**
 * Costing Matrix, the Bid Decision (#320, spec #266, Closed Book from #319): who decides, what the
 * decision is stamped with, what clears it, who reads what of it, and what a No-go or a Revise
 * does (tell the Deal Team, change nothing on the SOR).
 *
 * Loosened by 20261102170000: the Deal Team and Purchasing read the Closed Book, so they decide too.
 *
 * Since #704 (spec #699) a live Go locks the sheet and cannot be decided again until it is unlocked with a
 * reason. So the tests that change the sheet under a decision, or decide over a live one, use a Revise or a
 * No-go (those are still cleared by a later change); the Go lock itself has its own describe at the end.
 *
 * The cast, on one SOR (dealOwner and support are its Deal Team):
 *   dealOwner, support  Deal Team                          -> closed_book, decides
 *   outsider            Purchasing access, no part in it   -> closed_book, decides
 *   stageParticipant    open Stage Participant window      -> participant tier
 *   finance             Finance access alone               -> no tier
 *   ipasSigner          on the final_acquire list          -> closed_book, decides
 *   superAdmin                                             -> closed_book, decides
 *   ordinary            nobody                             -> no tier
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { tryInsert, tryUpdate, tryDelete, RLS_VIOLATION } from "./support/access.js"
import { purgeCostingForSors } from "./support/costing.js"
import { BID_DECISION_TIERS } from "../../constants/costing.js"
import { matrixTotals } from "../../utils/costingMath.js"

const svc = () => serviceClient()

let saleTypeId, flowId, stageId
let sorId, matrixId, lineOneId, lineTwoId, componentId, costRowId
const sorIds = []

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

/** Takes a decision as `who`; resolves to `{ id, error }`. */
const decide = async (who, verdict, reason = "Reason for the decision") => {
    const { data, error } = await (await clientFor(who)).rpc("costing_decide_bid", { p_matrix_id: matrixId, p_verdict: verdict, p_reason: reason })
    return { id: data, error }
}

/** Unlocks the live Go as `who`; resolves to the error, or null. */
const unlock = async (who, reason = "Unlocking for the test") =>
    (await (await clientFor(who)).rpc("costing_unlock_bid", { p_matrix_id: matrixId, p_reason: reason })).error

const setMoney = async (who, table, row, patch) =>
    (await (await clientFor(who)).rpc("costing_set_money", { p_table: table, p_row: row, p_patch: patch })).error

const rows = async () => asSvc(svc().from("costing_bid_decisions").select("*").eq("matrix_id", matrixId).order("decided_at").order("id"), "bid decisions")
const live = async () => (await rows()).filter((r) => r.cleared_at === null)
const sorRow = async () => asSvc(svc().from("sales_opportunities").select("*").eq("id", sorId).single(), "SOR")
const bidNotices = async () =>
    asSvc(svc().from("notifications").select("*").eq("reference_id", sorId).eq("type", "SOR_BID_DECISION").order("created_at"), "notifications")

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")

    saleTypeId = (await asSvc(svc().from("sale_types").insert({ name: `${MARKER} Bid` }).select("id").single(), "sale type")).id
    flowId = (await asSvc(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "flow")).id
    stageId = (await asSvc(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Bid Stage`, sort_order: 10 }).select("id").single(), "stage")).id

    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, supportSales1Id: ids.support, saleTypeId, flowStageId: stageId })
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

    // Quantity 2.5 at 1001.15 is 2502.875 -> 2502.88 (half-up), which a naive float or banker's round misses.
    lineOneId = (
        await asSvc(svc().from("costing_tender_lines").insert({ matrix_id: matrixId, position: 1, tender_specification: "Rescue tripod", quantity: 2.5, created_by: ids.dealOwner }).select("id").single(), "Tender Line 1")
    ).id
    lineTwoId = (
        await asSvc(svc().from("costing_tender_lines").insert({ matrix_id: matrixId, position: 2, tender_specification: "Harness set", quantity: 3, created_by: ids.dealOwner }).select("id").single(), "Tender Line 2")
    ).id
    componentId = (
        await asSvc(svc().from("costing_components").insert({ tender_line_id: lineOneId, position: 1, name: "Tripod head", quantity: 2 }).select("id").single(), "Component")
    ).id
    const row = await (await clientFor("outsider")).rpc("costing_add_cost_row", { p_matrix_id: matrixId, p_description: "Delivery Charge", p_quantity: 1 })
    if (row.error) throw new Error(`costing_add_cost_row: ${row.error.message}`)
    costRowId = row.data
})

afterAll(async () => {
    await svc().from("notifications").delete().eq("reference_id", sorId)
    await svc().from("costing_signer_lists").delete().eq("employee_id", ids.ipasSigner)
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeCostingForSors(sorIds)
    await svc().from("sor_stage_participants").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("before there is anything to judge", () => {
    it("refuses a decision while a Tender Line has no Final Offer, and queues nothing", async () => {
        expect(await setMoney("dealOwner", "costing_tender_line_prices", lineOneId, { abc_unit: 1100.1, final_offer_unit: 1001.15 })).toBeNull()
        const { error } = await decide("ipasSigner", "go")
        expect(error?.code).toBe("22023")
        expect(error?.message).toBe("costing_bid: every Tender Line needs a Final Offer before the bid can be decided")
        expect(await rows()).toHaveLength(0)

        const pending = await (await clientFor("ipasSigner")).rpc("costing_pending_bid_decisions")
        expect(pending.error).toBeNull()
        expect(pending.data.filter((p) => p.matrix_id === matrixId)).toHaveLength(0)
    })

    it("queues the matrix for everyone who decides once every Final Offer is set", async () => {
        expect(await setMoney("dealOwner", "costing_tender_line_prices", lineTwoId, { abc_unit: 500, final_offer_unit: 480 })).toBeNull()
        for (const who of ["ipasSigner", "superAdmin", "dealOwner", "outsider"]) {
            const pending = await (await clientFor(who)).rpc("costing_pending_bid_decisions")
            expect(pending.error, who).toBeNull()
            const mine = pending.data.find((p) => p.matrix_id === matrixId)
            expect(mine, who).toBeTruthy()
            expect(mine.opportunity_id).toBe(sorId)
            expect(mine.project_title).toBe(`${MARKER} Rope Rescue Equipment`)
            expect(mine.client_name).toBe(`${MARKER} Acme Rescue Supplies`)
            expect(mine.deal_owner_id).toBe(ids.dealOwner)
            expect(mine.deal_owner_name).toBe("Deal Owner")
            expect(Number(mine.final_offer_total)).toBe(3942.88)
        }
        for (const who of ["stageParticipant", "finance", "ordinary"]) {
            const pending = await (await clientFor(who)).rpc("costing_pending_bid_decisions")
            expect((pending.data ?? []).filter((p) => p.matrix_id === matrixId), who).toHaveLength(0)
        }
    })
})

describe("who decides", () => {
    it("refuses a Stage Participant, Finance and a plain employee", async () => {
        for (const who of ["stageParticipant", "finance", "ordinary"]) {
            const { error } = await decide(who, "go")
            expect(error?.code, who).toBe(RLS_VIOLATION)
            expect(error?.message, who).toBe("costing_bid: only Sales, Purchasing, a Super Admin or the Final Acquire list can decide a bid")
        }
        expect(await rows()).toHaveLength(0)
        expect(await readMatrix("finance")).toBeNull()
    })

    it("refuses an unknown verdict and a blank reason", async () => {
        const verdict = await decide("ipasSigner", "maybe")
        expect(verdict.error?.message).toBe("costing_bid: the verdict must be Go, No-go or Revise")
        for (const reason of ["", "   "]) {
            const blank = await decide("ipasSigner", "go", reason)
            expect(blank.error?.message).toBe("costing_bid: write the reason for the decision")
        }
        expect(await rows()).toHaveLength(0)
    })

    it("lets a member of the Final Acquire list decide, with no self-approval rule", async () => {
        // The list member also typed the Final Acquire here: that is the boss deciding on the boss's own numbers.
        expect(await setMoney("ipasSigner", "costing_component_costs", componentId, { final_acquire_unit: 900 })).toBeNull()
        const { id, error } = await decide("ipasSigner", "revise", "  Price fits the ABC and the margin is fine  ")
        expect(error).toBeNull()
        expect(id).toBeTruthy()
        const [decision] = await live()
        expect(decision.id).toBe(id)
        expect(decision.verdict).toBe("revise")
        expect(decision.reason).toBe("Price fits the ABC and the margin is fine")
        expect(decision.decided_by).toBe(ids.ipasSigner)
        expect(decision.decided_at).toBeTruthy()
        expect(decision.cleared_at).toBeNull()
    })

    it("lets a Super Admin who is not on the list decide, replacing the live decision", async () => {
        const before = await live()
        const { id, error } = await decide("superAdmin", "no_go", "Reprice the harnesses")
        expect(error).toBeNull()
        const now = await live()
        expect(now).toHaveLength(1)
        expect(now[0].id).toBe(id)
        expect(now[0].decided_by).toBe(ids.superAdmin)
        const old = (await rows()).find((r) => r.id === before[0].id)
        expect(old.cleared_at).not.toBeNull()
        expect(old.cleared_reason).toBe("Decided again")
    })

    it("lets the Deal Team and Purchasing decide too, each replacing the live decision", async () => {
        for (const who of ["dealOwner", "outsider"]) {
            const { id, error } = await decide(who, "revise", `Revise from ${who}`)
            expect(error, who).toBeNull()
            const now = await live()
            expect(now, who).toHaveLength(1)
            expect(now[0].id, who).toBe(id)
            expect(now[0].decided_by, who).toBe(ids[who])
        }
    })

    it("allows only one live decision per matrix", async () => {
        const second = await svc().from("costing_bid_decisions").insert({ matrix_id: matrixId, verdict: "go", reason: "x", final_offer_total: 1 })
        expect(second.error?.code).toBe("23505")
    })

    it("lets nobody write the table directly", async () => {
        const [decision] = await live()
        for (const who of ["ipasSigner", "superAdmin", "dealOwner"]) {
            const client = await clientFor(who)
            const inserted = await tryInsert(client, "costing_bid_decisions", { matrix_id: matrixId, verdict: "go", reason: "x", final_offer_total: 1 })
            expect(inserted.ok, who).toBe(false)
            expect((await tryUpdate(client, "costing_bid_decisions", decision.id, { verdict: "go" })).affected, who).toBe(0)
            expect((await tryDelete(client, "costing_bid_decisions", decision.id)).affected, who).toBe(0)
        }
        expect((await live())[0]).toMatchObject({ id: decision.id, verdict: decision.verdict })
    })
})

describe("what it is stamped with", () => {
    it("stamps the Final Offer total and the ABC total the way costingMath works them", async () => {
        const { error } = await decide("ipasSigner", "revise", "Stamp check")
        expect(error).toBeNull()
        const [decision] = await live()
        const expected = matrixTotals([
            { quantity: 2.5, abc_unit: 1100.1, final_offer_unit: 1001.15 },
            { quantity: 3, abc_unit: 500, final_offer_unit: 480 },
        ])
        expect(Number(decision.final_offer_total)).toBe(expected.finalOfferTotal)
        expect(Number(decision.abc_total)).toBe(expected.abcTotal)
        // 2.5 x 1001.15 = 2502.875 -> 2502.88; 2.5 x 1100.10 = 2750.25; 3 x 480 = 1440; 3 x 500 = 1500
        expect(Number(decision.final_offer_total)).toBe(3942.88)
        expect(Number(decision.abc_total)).toBe(4250.25)
    })

    it("stamps no ABC total while a Tender Line has no ABC", async () => {
        expect(await setMoney("dealOwner", "costing_tender_line_prices", lineTwoId, { abc_unit: null })).toBeNull()
        const { error } = await decide("ipasSigner", "revise", "No ABC on one line")
        expect(error).toBeNull()
        const [decision] = await live()
        expect(Number(decision.final_offer_total)).toBe(3942.88)
        expect(decision.abc_total).toBeNull()
        expect(await setMoney("dealOwner", "costing_tender_line_prices", lineTwoId, { abc_unit: 500 })).toBeNull()
    })
})

describe("what clears it", () => {
    it("clears the live decision when a Final Offer changes, and says why", async () => {
        const { id, error } = await decide("ipasSigner", "revise", "Good to go")
        expect(error).toBeNull()
        expect(await live()).toHaveLength(1)
        expect(await setMoney("dealOwner", "costing_tender_line_prices", lineTwoId, { final_offer_unit: 490 })).toBeNull()
        expect(await live()).toHaveLength(0)
        const cleared = (await rows()).find((r) => r.id === id)
        expect(cleared.cleared_at).not.toBeNull()
        expect(cleared.cleared_reason).toBe("The Final Offer changed")
        // The stamped figures stay what they were when it was taken.
        expect(Number(cleared.final_offer_total)).toBe(3942.88)
    })

    it("clears it when a Tender Line's quantity changes, which moves the Final Offer total", async () => {
        await decide("ipasSigner", "revise", "Good to go again")
        expect(await live()).toHaveLength(1)
        await asSvc(svc().from("costing_tender_lines").update({ quantity: 4 }).eq("id", lineTwoId), "quantity")
        expect(await live()).toHaveLength(0)
        await asSvc(svc().from("costing_tender_lines").update({ quantity: 3 }).eq("id", lineTwoId), "quantity back")
    })

    it("clears it when a Component's Final Acquire changes", async () => {
        const { id } = await decide("ipasSigner", "revise", "Good to go once more")
        expect(await setMoney("ipasSigner", "costing_component_costs", componentId, { final_acquire_unit: 950 })).toBeNull()
        expect(await live()).toHaveLength(0)
        expect((await rows()).find((r) => r.id === id).cleared_reason).toBe("A Final Acquire changed")
    })

    it("clears it when a cost-only row's Final Acquire changes", async () => {
        const { id } = await decide("ipasSigner", "revise", "Good to go, row")
        expect(await setMoney("ipasSigner", "costing_cost_rows", costRowId, { final_acquire_unit: 2500 })).toBeNull()
        expect(await live()).toHaveLength(0)
        expect((await rows()).find((r) => r.id === id).cleared_reason).toBe("A Final Acquire changed")
    })

    it("keeps it when something else changes (ABC, Acquire, a Final Offer written to its own value)", async () => {
        await decide("ipasSigner", "revise", "Hold steady")
        expect(await setMoney("dealOwner", "costing_tender_line_prices", lineOneId, { abc_unit: 1200 })).toBeNull()
        expect(await setMoney("outsider", "costing_component_costs", componentId, { acquire_unit: 700 })).toBeNull()
        expect(await setMoney("dealOwner", "costing_tender_line_prices", lineOneId, { final_offer_unit: 1001.15 })).toBeNull()
        expect(await live()).toHaveLength(1)
        await asSvc(svc().from("costing_tender_lines").update({ tender_specification: "Rescue tripod, long" }).eq("id", lineOneId), "spec")
        expect(await live()).toHaveLength(1)
    })

    it("clears it when a Component carrying a Final Acquire is removed", async () => {
        const extra = (
            await asSvc(svc().from("costing_components").insert({ tender_line_id: lineTwoId, position: 1, name: "Spare", quantity: 1 }).select("id").single(), "extra Component")
        ).id
        expect(await setMoney("ipasSigner", "costing_component_costs", extra, { final_acquire_unit: 10 })).toBeNull()
        await decide("ipasSigner", "revise", "Before removing a Component")
        expect(await live()).toHaveLength(1)
        await asSvc(svc().from("costing_components").delete().eq("id", extra), "remove Component")
        expect(await live()).toHaveLength(0)
    })

    it("records the decision and its clearing in the matrix history for Closed Book", async () => {
        const { data } = await (await clientFor("ipasSigner")).rpc("costing_history", { p_opportunity_id: sorId, p_table: "costing_bid_decisions", p_limit: 200 })
        const kinds = new Set(data.map((e) => e.kind))
        expect(kinds.has("added")).toBe(true)
        expect(data.some((e) => e.kind === "changed" && e.detail.column === "cleared_reason" && e.detail.new === "The Final Offer changed")).toBe(true)
    })
})

describe("who reads what of it", () => {
    it("gives the Deal Team the verdict and reason with the stamped figures, the cleared ones included", async () => {
        const { id } = await decide("ipasSigner", "no_go", "Over the ABC and we cannot get there")
        for (const who of ["dealOwner", "support"]) {
            const read = await readMatrix(who)
            expect(read.tier, who).toBe("closed_book")
            const table = read.tables.costing_bid_decisions
            const live_ = table.find((r) => r.id === id)
            expect(live_.verdict).toBe("no_go")
            expect(live_.reason).toBe("Over the ABC and we cannot get there")
            expect(live_.decided_by).toBe(ids.ipasSigner)
            expect(live_.decided_at).toBeTruthy()
            expect("final_offer_total" in live_, who).toBe(true)
            expect(table.some((r) => r.cleared_reason === "The Final Offer changed")).toBe(true)
        }
    })

    it("gives a Stage Participant nothing of it", async () => {
        for (const who of ["stageParticipant"]) {
            const read = await readMatrix(who)
            expect(read, who).not.toBeNull()
            expect("costing_bid_decisions" in read.tables, who).toBe(false)
        }
    })

    it("gives Closed Book everything, the stamped figures included", async () => {
        for (const who of ["ipasSigner", "superAdmin", "outsider"]) {
            const read = await readMatrix(who)
            const decision = read.tables.costing_bid_decisions.find((r) => r.cleared_at === null)
            expect(decision.verdict, who).toBe("no_go")
            expect(Number(decision.final_offer_total), who).toBe(3972.88)
            expect("abc_total" in decision, who).toBe(true)
        }
    })

    it("lets only Closed Book select the table directly", async () => {
        for (const who of ["ipasSigner", "dealOwner", "support", "outsider"]) {
            const closed = await (await clientFor(who)).from("costing_bid_decisions").select("id").eq("matrix_id", matrixId)
            expect(closed.data.length, who).toBeGreaterThan(0)
        }
        for (const who of ["stageParticipant", "finance", "ordinary"]) {
            const { data } = await (await clientFor(who)).from("costing_bid_decisions").select("id").eq("matrix_id", matrixId)
            expect(data, who).toHaveLength(0)
        }
    })

    it("shows the Deal Team the stamped figures in the history too", async () => {
        const { data } = await (await clientFor("dealOwner")).rpc("costing_history", { p_opportunity_id: sorId, p_table: "costing_bid_decisions", p_limit: 200 })
        const added = data.filter((e) => e.kind === "added")
        expect(added.length).toBeGreaterThan(0)
        for (const event of added) {
            expect(event.detail.values.verdict).toBeTruthy()
            expect("final_offer_total" in event.detail.values).toBe(true)
        }
    })

    it("matches the registry the screen mirrors in src/constants/costing.js", async () => {
        const tiers = await asSvc(svc().from("costing_column_tiers").select("column_name, tiers").eq("table_name", "costing_bid_decisions"), "tiers")
        expect(tiers).toHaveLength(Object.keys(BID_DECISION_TIERS).length)
        for (const [column, expected] of Object.entries(BID_DECISION_TIERS)) {
            const row = tiers.find((t) => t.column_name === column)
            expect([...row.tiers].sort(), column).toEqual([...expected].sort())
        }
    })
})

describe("what a No-go or a Revise does", () => {
    const stageAndStatus = async () => {
        const s = await sorRow()
        return { ...s }
    }

    it("tells the Deal Team (not the decider) with the verdict and reason and no figure, and changes nothing on the SOR", async () => {
        await asSvc(svc().from("notifications").delete().eq("reference_id", sorId), "clear notifications")
        const before = await stageAndStatus()

        const reason = "Offer is too far over the ABC to win"
        const { error } = await decide("ipasSigner", "no_go", reason)
        expect(error).toBeNull()

        const notices = await bidNotices()
        expect(notices.map((n) => n.recipient_id).sort()).toEqual([ids.dealOwner, ids.support].sort())
        for (const notice of notices) {
            expect(notice.sender_id).toBe(ids.ipasSigner)
            expect(notice.title).toBe("Bid decision: No-go")
            expect(notice.message).toContain(reason)
            expect(notice.message).toContain("No-go")
            expect(notice.message).not.toMatch(/\d{1,3}(,\d{3})+|\d+\.\d{2}/)
        }

        const after = await stageAndStatus()
        expect(after).toEqual(before)
        expect(after.status).toBe("LEAD")
        expect(after.flow_stage_id).toBe(stageId)
        expect(after.is_deleted).toBe(false)
    })

    it("tells the Deal Team on a Revise too, and again when the decision changes", async () => {
        const { error } = await decide("superAdmin", "revise", "Reprice the harnesses")
        expect(error).toBeNull()
        const notices = (await bidNotices()).filter((n) => n.title === "Bid decision: Revise")
        expect(notices.map((n) => n.recipient_id).sort()).toEqual([ids.dealOwner, ids.support].sort())
        expect(notices[0].sender_id).toBe(ids.superAdmin)
        const after = await sorRow()
        expect(after.status).toBe("LEAD")
        expect(after.flow_stage_id).toBe(stageId)
    })

    it("does not tell the decider when they are on the Deal Team", async () => {
        await asSvc(svc().from("notifications").delete().eq("reference_id", sorId), "clear notifications")
        await asSvc(svc().from("costing_signer_lists").insert({ list_key: "final_acquire", employee_id: ids.dealOwner }), "list the deal owner")
        try {
            const { error } = await decide("dealOwner", "no_go", "I am on the team and I decided")
            expect(error).toBeNull()
            const notices = await bidNotices()
            expect(notices.map((n) => n.recipient_id)).toEqual([ids.support])
        } finally {
            await svc().from("costing_signer_lists").delete().eq("employee_id", ids.dealOwner)
        }
    })

    it("tells nobody on a Go", async () => {
        await asSvc(svc().from("notifications").delete().eq("reference_id", sorId), "clear notifications")
        const { error } = await decide("ipasSigner", "go", "Go ahead")
        expect(error).toBeNull()
        expect(await bidNotices()).toHaveLength(0)
    })

    it("takes the matrix out of the pending queue while a decision is live, and back in when it is cleared", async () => {
        const mine = async () => {
            const pending = await (await clientFor("ipasSigner")).rpc("costing_pending_bid_decisions")
            return pending.data.filter((p) => p.matrix_id === matrixId)
        }
        expect(await live()).toHaveLength(1)
        expect(await mine()).toHaveLength(0)
        // The live decision is the Go from the test before; unlocking it clears it.
        expect(await unlock("ipasSigner", "Back to the queue")).toBeNull()
        expect(await live()).toHaveLength(0)
        expect(await mine()).toHaveLength(1)
        expect(await setMoney("dealOwner", "costing_tender_line_prices", lineTwoId, { final_offer_unit: 495 })).toBeNull()
        const back = await mine()
        expect(back).toHaveLength(1)
        expect(Number(back[0].final_offer_total)).toBe(3987.88)
    })
})

describe("a Go locks the sheet", () => {
    it("stamps the planned cost with the Go, the way the Costing Matrix page adds it", async () => {
        // The Component at 950 x 2 and the cost-only row at 2500 x 1.
        const { id, error } = await decide("ipasSigner", "go", "Locking the sheet")
        expect(error).toBeNull()
        const [decision] = await live()
        expect(decision.id).toBe(id)
        expect(decision.verdict).toBe("go")
        expect(Number(decision.planned_cost_total)).toBe(4400)
    })

    it("refuses any change to the numbers while the Go is live, for everyone, and keeps the Go", async () => {
        const locked = { code: RLS_VIOLATION, message: "costing_bid: the sheet is locked by a Go. Unlock it, with a reason, to change it" }
        expect(await setMoney("dealOwner", "costing_tender_line_prices", lineOneId, { abc_unit: 1300 })).toMatchObject(locked)
        expect(await setMoney("outsider", "costing_component_costs", componentId, { acquire_unit: 701 })).toMatchObject(locked)
        expect(await setMoney("ipasSigner", "costing_cost_rows", costRowId, { final_acquire_unit: 2600 })).toMatchObject(locked)
        expect(await live()).toHaveLength(1)
    })

    it("refuses to decide again over a live Go", async () => {
        for (const verdict of ["go", "revise", "no_go"]) {
            const { error } = await decide("superAdmin", verdict)
            expect(error?.code, verdict).toBe("22023")
            expect(error?.message, verdict).toBe("costing_bid: the sheet is locked by a Go. Unlock it first")
        }
        expect(await live()).toHaveLength(1)
    })

    it("lets only Closed Book unlock it, and only with a reason", async () => {
        for (const who of ["stageParticipant", "finance", "ordinary"]) {
            const error = await unlock(who)
            expect(error?.code, who).toBe(RLS_VIOLATION)
            expect(error?.message, who).toBe("costing_bid: only Sales, Purchasing, a Super Admin or the Final Acquire list can unlock a bid")
        }
        for (const reason of ["", "   "]) {
            const error = await unlock("ipasSigner", reason)
            expect(error?.code).toBe("22023")
            expect(error?.message).toBe("costing_bid: write the reason for unlocking")
        }
        expect(await live()).toHaveLength(1)
    })

    it("unlocks with a reason, records who did it, and lets the sheet change again", async () => {
        const [go] = await live()
        expect(await unlock("dealOwner", "  The supplier moved the price  ")).toBeNull()
        expect(await live()).toHaveLength(0)
        const cleared = (await rows()).find((r) => r.id === go.id)
        expect(cleared.cleared_reason).toBe("Unlocked: The supplier moved the price")
        expect(cleared.unlocked_by).toBe(ids.dealOwner)
        expect(await setMoney("dealOwner", "costing_tender_line_prices", lineOneId, { abc_unit: 1300 })).toBeNull()
    })

    it("has nothing to unlock once it is unlocked", async () => {
        const error = await unlock("ipasSigner")
        expect(error?.code).toBe("22023")
        expect(error?.message).toBe("costing_bid: there is no Go to unlock")
    })
})
