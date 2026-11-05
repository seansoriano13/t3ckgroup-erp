/**
 * Costing Matrix, Evaluation of Specification (#271, spec #266; offer-level since #908): the one Compliance
 * verdict and its note on the matrix, who may give it, the "Evaluation approved" sign-off and what clears it.
 *
 * The cast, on one SOR (dealOwner and support are its Deal Team):
 *   technical         the Technical in-charge (named by Sales or Purchasing)   -> participant tier, gives the verdict, cannot approve
 *   stageParticipant  open window, not the in-charge                           -> participant tier, no verdict
 *   dealOwner, support Deal Team                                               -> closed_book tier, Sales band
 *   outsider          Purchasing access, and on the evaluation list            -> closed_book tier, approves
 *   superAdmin                                                                 -> closed_book, not the in-charge
 *   ordinary          nobody                                                   -> no tier
 *
 * The matrix, the template, the task and its members are made with the service role; every assertion runs
 * as a real cast member. Who may name the in-charge, and the Technical list, are in 908-technical-incharge.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, rlsStatus, sql } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { canRead, tryInsert, tryUpdate, tryDelete, RLS_VIOLATION } from "./support/access.js"
import { purgeCostingForSors } from "./support/costing.js"

const svc = () => serviceClient()
const CHECK_VIOLATION = "23514"
const WRONG_STATE = "22023"
const APPROVAL_MIGRATION = readFileSync("supabase/migrations/20261121200000_911_approval_excludes_incharge.sql", "utf8")
const DOOR_MIGRATION = readFileSync("supabase/migrations/20261124100000_907_technical_door_and_template_retired.sql", "utf8")

let saleTypeId, flowId, stageId
let sorId, matrixId
let lineId, compA, compB, bundleId, inclusionId
let templateId, otherTemplateId, taskId, otherTaskId, memberRowId
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

const history = async (who, args = {}) => {
    const { data, error } = await (await clientFor(who)).rpc("costing_history", { p_opportunity_id: sorId, ...args })
    if (error) throw new Error(`costing_history as ${who}: ${error.message}`)
    return data
}

const sign = async (who, role = "evaluation_approved") => (await clientFor(who)).rpc("costing_sign", { p_matrix_id: matrixId, p_role: role })

const onList = async (listKey, who) =>
    asSvc(svc().from("costing_signer_lists").upsert({ list_key: listKey, employee_id: ids[who] }, { onConflict: "list_key,employee_id" }), `${who} onto ${listKey}`)
const offList = async (listKey, who) =>
    asSvc(svc().from("costing_signer_lists").delete().eq("list_key", listKey).eq("employee_id", ids[who]), `${who} off ${listKey}`)

/** The verdict and its note, written as the given cast member. */
const setVerdict = (who, patch) => clientFor(who).then((client) => tryUpdate(client, "costing_matrices", matrixId, patch))

/** Sets the in-charge with the service role (the Sales and Purchasing band is tested in 908). */
const setInCharge = (employeeId) => asSvc(svc().from("costing_matrices").update({ technical_incharge_id: employeeId }).eq("id", matrixId), "in-charge")

const matrixRow = async () => (await asSvc(svc().from("costing_matrices").select("*").eq("id", matrixId), "matrix"))[0]

const liveSignoff = async () =>
    (await asSvc(svc().from("costing_signoffs").select("*").eq("matrix_id", matrixId).eq("role", "evaluation_approved").is("cleared_at", null), "live sign-off"))[0] ?? null

const lastCleared = async () =>
    (
        await asSvc(
            svc().from("costing_signoffs").select("*").eq("matrix_id", matrixId).eq("role", "evaluation_approved").not("cleared_at", "is", null).order("cleared_at", { ascending: false }).order("id").limit(1),
            "cleared sign-off",
        )
    )[0] ?? null

/** Gives the verdict (complies) when there is none, then approves as the reviewer. */
async function approve() {
    if (await liveSignoff()) return
    if ((await matrixRow()).compliance === null) {
        const given = await setVerdict("technical", { compliance: "complies" })
        if (!given.ok || given.affected !== 1) throw new Error(`approve: verdict ${JSON.stringify(given)}`)
    }
    const { error } = await sign("outsider")
    if (error) throw new Error(`approve: ${error.message}`)
    expect(await liveSignoff()).not.toBeNull()
}

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")

    saleTypeId = (await asSvc(svc().from("sale_types").insert({ name: `${MARKER} Evaluation` }).select("id").single(), "sale type")).id
    flowId = (await asSvc(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "flow")).id
    stageId = (
        await asSvc(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Evaluation Stage`, sort_order: 10 }).select("id").single(), "stage")
    ).id

    sorId = await makeSor({
        registeredBy: ids.dealOwner,
        dealOwnerId: ids.dealOwner,
        supportSales1Id: ids.support,
        saleTypeId,
        flowStageId: stageId,
    })
    sorIds.push(sorId)

    // The Technical in-charge and a plain participant both read the matrix through an open Stage Participant window.
    const visit = await asSvc(svc().from("sor_stage_visits").select("id").eq("opportunity_id", sorId).single(), "visit")
    for (const who of [ids.technical, ids.stageParticipant]) {
        await asSvc(
            svc().from("sor_stage_participants").insert({
                opportunity_id: sorId,
                employee_id: who,
                source: "action",
                opened_visit_id: visit.id,
                until_rule: "stage_left",
            }),
            "participant window",
        )
    }

    // A task on this SOR created from the old Evaluation of Specification template, with the in-charge on it. The template
    // setting is retired (spec #907), so the task grants nothing; the cases below prove the verdict stays the in-charge's.
    templateId = (
        await asSvc(svc().from("group_task_templates").insert({ name: `${MARKER} Evaluation of Specification`, created_by: ids.head }).select("id").single(), "template")
    ).id
    otherTemplateId = (
        await asSvc(svc().from("group_task_templates").insert({ name: `${MARKER} Some other template`, created_by: ids.head }).select("id").single(), "other template")
    ).id

    taskId = (
        await asSvc(
            svc().from("committee_tasks").insert({ title: `${MARKER} Evaluation of Specification`, created_by: ids.head, opportunity_id: sorId, template_id: templateId, status: "ACTIVE" }).select("id").single(),
            "task",
        )
    ).id
    memberRowId = (
        await asSvc(
            svc().from("committee_task_members").insert({ committee_task_id: taskId, employee_id: ids.technical, task_description: "Evaluate the offer" }).select("id").single(),
            "member",
        )
    ).id
    // A task from another template, with the stage participant on it: grants nothing.
    otherTaskId = (
        await asSvc(
            svc().from("committee_tasks").insert({ title: `${MARKER} Another task`, created_by: ids.head, opportunity_id: sorId, template_id: otherTemplateId, status: "ACTIVE" }).select("id").single(),
            "other task",
        )
    ).id
    await asSvc(svc().from("committee_task_members").insert({ committee_task_id: otherTaskId, employee_id: ids.stageParticipant, task_description: "Something else" }), "other member")

    await asSvc(svc().from("costing_signer_lists").insert({ list_key: "evaluation", employee_id: ids.outsider }), "evaluation list")

    const opened = await svc().rpc("costing_open_matrix", { p_opportunity_id: sorId })
    if (opened.error) throw new Error(`costing_open_matrix: ${opened.error.message}`)
    matrixId = opened.data
    await setInCharge(ids.technical)

    lineId = (
        await asSvc(
            svc().from("costing_tender_lines").insert({ matrix_id: matrixId, position: 1, tender_specification: "Rescue tripod, 3 m, 22 kN", quantity: 2, created_by: ids.dealOwner }).select("id").single(),
            "Tender Line",
        )
    ).id
    const component = async (position, extra = {}) =>
        (await asSvc(svc().from("costing_components").insert({ tender_line_id: lineId, position, name: `Component ${position}`, quantity: 1, ...extra }).select("id").single(), "Component")).id
    compA = await component(1, { offer_specification: "Tripod 3 m, 22 kN" })
    compB = await component(2, { offer_specification: "Tripod 2.5 m, 20 kN" })
    await component(3)
    bundleId = await component(4, { is_bundle: true })
    // Rows exist already, so a refused money write names its column and not the "add a row" band.
    await asSvc(svc().from("costing_component_costs").insert([{ component_id: compA }, { component_id: compB }]), "costs rows")
    await asSvc(svc().from("costing_tender_line_prices").insert({ tender_line_id: lineId }), "prices row")
    inclusionId = (await asSvc(svc().from("costing_inclusions").insert({ component_id: bundleId, position: 1, description: "Carry bag" }).select("id").single(), "Inclusion")).id
})

afterAll(async () => {
    await svc().from("costing_signer_lists").delete().eq("employee_id", ids.outsider).eq("list_key", "evaluation")
    await svc().from("costing_signer_lists").delete().eq("employee_id", ids.technical).eq("list_key", "evaluation")
    await svc().from("employees").update({ has_purchasing_flow: false, call_sign: null }).in("id", [ids.outsider, ids.ipasSigner])
    await purgeCostingForSors(sorIds)
    await svc().from("committee_task_members").delete().in("committee_task_id", [taskId, otherTaskId].filter(Boolean))
    await svc().from("committee_tasks").delete().in("id", [taskId, otherTaskId].filter(Boolean))
    await svc().from("group_task_templates").delete().in("id", [templateId, otherTemplateId].filter(Boolean))
    await svc().from("sor_stage_participants").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("the Technical in-charge's verdict", () => {
    it("lets the in-charge give the one verdict and its note, stamped with who and when", async () => {
        const before = Date.now()
        expect(await setVerdict("technical", { compliance: "deviates", compliance_note: "2.5 m, not the 3 m asked for" })).toEqual({ ok: true, affected: 1 })
        const row = await matrixRow()
        expect(row).toMatchObject({ compliance: "deviates", compliance_note: "2.5 m, not the 3 m asked for", compliance_by: ids.technical })
        expect(new Date(row.compliance_at).getTime()).toBeGreaterThanOrEqual(before - 1000)
    })

    it("lets the in-charge clear the verdict back to unjudged", async () => {
        expect(await setVerdict("technical", { compliance: null, compliance_note: null })).toEqual({ ok: true, affected: 1 })
        expect(await matrixRow()).toMatchObject({ compliance: null, compliance_note: null, compliance_by: ids.technical })
    })

    it("refuses everyone else who can read the matrix, naming the in-charge", async () => {
        for (const who of ["dealOwner", "support", "outsider", "superAdmin", "stageParticipant"]) {
            const refused = await setVerdict(who, { compliance: "complies" })
            expect(refused, who).toMatchObject({ ok: false, code: RLS_VIOLATION })
            expect(refused.message, who).toBe("costing_technical: only the Technical in-charge can give the Compliance verdict")
        }
        // No tier on the SOR at all: the row policy hides it, so nothing is written.
        expect(await setVerdict("ordinary", { compliance: "complies" })).toEqual({ ok: true, affected: 0 })
        expect(await setVerdict("finance", { compliance: "complies" })).toEqual({ ok: true, affected: 0 })
        expect((await matrixRow()).compliance).toBeNull()
    })

    it("refuses a verdict when no in-charge is named yet", async () => {
        await setInCharge(null)
        try {
            const refused = await setVerdict("technical", { compliance: "complies" })
            expect(refused).toMatchObject({ ok: false, code: RLS_VIOLATION })
            expect(refused.message).toBe("costing_technical: name the Technical in-charge first")
        } finally {
            await setInCharge(ids.technical)
        }
    })

    it("stays the in-charge's when they leave the task: the task grants Completeness only, not the verdict", async () => {
        await asSvc(svc().from("committee_task_members").delete().eq("id", memberRowId), "remove member")
        try {
            expect(await setVerdict("technical", { compliance: "complies" })).toEqual({ ok: true, affected: 1 })
            // A task member who is not the in-charge still cannot give it.
            expect((await setVerdict("stageParticipant", { compliance: "deviates", compliance_note: "x" })).message).toBe(
                "costing_technical: only the Technical in-charge can give the Compliance verdict",
            )
        } finally {
            memberRowId = (
                await asSvc(
                    svc().from("committee_task_members").insert({ committee_task_id: taskId, employee_id: ids.technical, task_description: "Evaluate the offer" }).select("id").single(),
                    "member again",
                )
            ).id
        }
    })

    it("keeps the verdict out of a plain write: the stamp follows only a change to the verdict", async () => {
        await setVerdict("technical", { compliance: "complies" })
        const stamped = (await matrixRow()).compliance_by
        // The Sales and Purchasing write (import addon) cannot move the stamp to someone else.
        const plain = await tryUpdate(await clientFor("outsider"), "costing_matrices", matrixId, { import_addon_percent: 5, compliance_by: ids.outsider })
        expect(plain).toEqual({ ok: true, affected: 1 })
        expect((await matrixRow()).compliance_by).toBe(stamped)
        await asSvc(svc().from("costing_matrices").update({ import_addon_percent: null }).eq("id", matrixId), "reset addon")
    })
})

describe("the in-charge reads the matrix without money", () => {
    it("reads at the participant tier with the Technical band", async () => {
        const read = await readMatrix("technical")
        expect(read.tier).toBe("participant")
        expect(read.bands).toEqual(["technical"])
        const json = JSON.stringify(read)
        expect(json).not.toMatch(/acquire_unit|final_acquire_unit|markup_factor|odoo_unit|abc_unit|final_offer_unit/)
        expect(read.tables.costing_matrices[0]).toMatchObject({ technical_incharge_id: ids.technical })
    })

    it("refuses the in-charge a Compliance-free money write, naming the band", async () => {
        const typed = async (table, row, patch) =>
            (await (await clientFor("technical")).rpc("costing_set_money", { p_table: table, p_row: row, p_patch: patch })).error
        expect((await typed("costing_component_costs", compA, { acquire_unit: 100 })).message).toBe("costing_band:costing_component_costs.acquire_unit:purchasing")
        expect((await typed("costing_component_costs", compA, { odoo_unit: 100 })).message).toBe("costing_band:costing_component_costs.odoo_unit:sales")
        expect((await typed("costing_component_costs", compA, { final_acquire_unit: 100 })).message).toBe("costing_band:costing_component_costs.final_acquire_unit:sales,purchasing,management")
        expect((await typed("costing_tender_line_prices", lineId, { final_offer_unit: 100 })).message).toBe("costing_band:costing_tender_line_prices.final_offer_unit:sales")
        expect((await typed("costing_matrix_money", matrixId, { nonsense: 1 })).code).toBe("22023")

        for (const table of ["costing_component_costs", "costing_tender_line_prices", "costing_matrix_money", "costing_cost_rows"]) {
            const { data } = await (await clientFor("technical")).from(table).select("*")
            expect(data, table).toEqual([])
        }
    })

    it("refuses the in-charge every other column, and adding or removing a Component", async () => {
        const brand = await tryUpdate(await clientFor("technical"), "costing_components", compA, { brand: "Petzl" })
        expect(brand).toMatchObject({ ok: false, code: RLS_VIOLATION })
        expect(brand.message).toBe("costing_band:costing_components.brand:sales,purchasing")
        const offer = await tryUpdate(await clientFor("technical"), "costing_components", compA, { offer_specification: "changed" })
        expect(offer.message).toBe("costing_band:costing_components.offer_specification:purchasing")
        const add = await tryInsert(await clientFor("technical"), "costing_components", { tender_line_id: lineId, position: 9, name: "x", quantity: 1 })
        expect(add.message).toBe("costing_band:costing_components.*:sales,purchasing")
        const remove = await tryDelete(await clientFor("technical"), "costing_components", compA)
        expect(remove.message).toBe("costing_band:costing_components.*:sales,purchasing")
        const line = await tryUpdate(await clientFor("technical"), "costing_tender_lines", lineId, { tender_specification: "changed" })
        expect(line.message).toBe("costing_band:costing_tender_lines.tender_specification:sales")
    })

    it("lets the in-charge set an Inclusion's Completeness, and refuses it to the Deal Team and a Stage Participant", async () => {
        expect(await tryUpdate(await clientFor("technical"), "costing_inclusions", inclusionId, { completeness: "COVERED" })).toEqual({ ok: true, affected: 1 })
        for (const who of ["dealOwner", "stageParticipant"]) {
            const completeness = await tryUpdate(await clientFor(who), "costing_inclusions", inclusionId, { completeness: "MISSING" })
            expect(completeness.message, who).toBe("costing_band:costing_inclusions.completeness:technical")
        }
    })
})

describe("a deviation needs a note", () => {
    it("is refused by the database without one, or with a blank one, even to the service role", async () => {
        const bare = await setVerdict("technical", { compliance: "deviates" })
        expect(bare).toMatchObject({ ok: false, code: CHECK_VIOLATION })
        expect(bare.message).toMatch(/costing_matrices_deviation_note_chk/)
        const blank = await setVerdict("technical", { compliance: "deviates", compliance_note: "   " })
        expect(blank).toMatchObject({ ok: false, code: CHECK_VIOLATION })
        const asService = await svc().from("costing_matrices").update({ compliance: "deviates" }).eq("id", matrixId)
        expect(asService.error?.code).toBe(CHECK_VIOLATION)
    })

    it("refuses removing the note from a deviation", async () => {
        expect(await setVerdict("technical", { compliance: "deviates", compliance_note: "Over spec" })).toEqual({ ok: true, affected: 1 })
        const removed = await setVerdict("technical", { compliance_note: null })
        expect(removed).toMatchObject({ ok: false, code: CHECK_VIOLATION })
    })

    it("accepts a deviation with a note, and a verdict outside the list is refused", async () => {
        expect(await setVerdict("technical", { compliance: "deviates", compliance_note: "Different thread" })).toEqual({ ok: true, affected: 1 })
        const odd = await setVerdict("technical", { compliance: "maybe" })
        expect(odd).toMatchObject({ ok: false, code: CHECK_VIOLATION })
        expect(odd.message).toMatch(/costing_matrices_compliance_chk/)
        expect(await setVerdict("technical", { compliance: null, compliance_note: null })).toEqual({ ok: true, affected: 1 })
    })
})

describe("the retired teams and the per-Component verdicts", () => {
    it("no longer has the evaluating team on a Tender Line, nor the RRD and IOE lists", async () => {
        const column = await svc().from("costing_tender_lines").select("evaluating_team").limit(1)
        expect(column.error).not.toBeNull()
        const list = await svc().from("costing_signer_lists").insert({ list_key: "team_rrd", employee_id: ids.technical })
        expect(list.error?.code).toBe(CHECK_VIOLATION)
    })

    it("keeps a Component's old verdict as read-only history: the in-charge and the Deal Team cannot change it", async () => {
        await asSvc(svc().from("costing_components").update({ compliance: "complies", compliance_note: "Old verdict" }).eq("id", compB), "history")
        const refused = await tryUpdate(await clientFor("technical"), "costing_components", compB, { compliance: "deviates", compliance_note: "x" })
        expect(refused).toMatchObject({ ok: false, code: RLS_VIOLATION })
        expect(refused.message).toMatch(/read-only history/)
        expect((await tryUpdate(await clientFor("dealOwner"), "costing_components", compB, { compliance_note: "x" })).message).toMatch(/read-only history/)

        const read = await readMatrix("technical")
        expect(read.tables.costing_components.find((c) => c.id === compB)).toMatchObject({ compliance: "complies", compliance_note: "Old verdict" })
        await asSvc(svc().from("costing_components").update({ compliance: null, compliance_note: null }).eq("id", compB), "tidy history")
    })
})

describe("Evaluation approved", () => {
    it("is refused while the Technical verdict is not given, and says so", async () => {
        await setVerdict("technical", { compliance: null, compliance_note: null })
        const { error } = await sign("outsider")
        expect(error?.code).toBe(WRONG_STATE)
        expect(error?.message).toBe("costing_sign: the Technical verdict is not given yet")
        expect(await liveSignoff()).toBeNull()
    })

    it("is refused to anyone off the evaluation list, a Super Admin and the in-charge included", async () => {
        await setVerdict("technical", { compliance: "complies" })
        for (const who of ["superAdmin", "technical", "dealOwner", "stageParticipant"]) {
            const { error } = await sign(who)
            expect(error?.code, who).toBe(RLS_VIOLATION)
        }
        expect((await sign("ordinary")).error?.code).toBe(RLS_VIOLATION)
        expect((await sign("superAdmin")).error?.message).toMatch(/evaluation list/)
        expect(await liveSignoff()).toBeNull()
    })

    it("is refused to the Technical in-charge, even on the list, so someone else approves it", async () => {
        await onList("evaluation", "technical")
        try {
            const { error } = await sign("technical")
            expect(error?.code).toBe(RLS_VIOLATION)
            expect(error?.message).toBe("costing_sign: the Technical in-charge cannot approve the evaluation, so someone else has to")
        } finally {
            await offList("evaluation", "technical")
        }
        expect(await liveSignoff()).toBeNull()
    })

    it("refuses the in-charge by the seat, not by who stamped the verdict", async () => {
        // The verdict was stamped by someone else (an earlier in-charge): the in-charge still cannot approve.
        await asSvc(svc().from("costing_matrices").update({ compliance_by: ids.outsider }).eq("id", matrixId), "stamp")
        await onList("evaluation", "technical")
        try {
            const { error } = await sign("technical")
            expect(error?.code).toBe(RLS_VIOLATION)
            expect(error?.message).toBe("costing_sign: the Technical in-charge cannot approve the evaluation, so someone else has to")
        } finally {
            await offList("evaluation", "technical")
        }
        expect(await liveSignoff()).toBeNull()
    })

    it("signs nothing but the evaluation (#722: Prepared, Costed and Final approved are no longer sign-offs)", async () => {
        for (const role of ["prepared", "costed", "final_approved", "nonsense"]) {
            expect((await sign("outsider", role)).error?.code, role).toBe("22023")
        }
        expect(await liveSignoff()).toBeNull()
    })

    it("is signed by someone on the list once the in-charge has given the verdict", async () => {
        await setVerdict("technical", { compliance: "complies" })
        const { data, error } = await sign("outsider")
        expect(error).toBeNull()
        expect(data.signoff).toMatchObject({ matrix_id: matrixId, role: "evaluation_approved", signed_by: ids.outsider, signature_declined: false, cleared_at: null })
        expect(await liveSignoff()).toMatchObject({ signed_by: ids.outsider })
    })

    it("cannot be signed twice while live", async () => {
        const { error } = await sign("outsider")
        expect(error?.code).toBe(WRONG_STATE)
        expect(error?.message).toMatch(/already approved/)
    })

    it("shows in the matrix read to every tier, with who and when", async () => {
        for (const who of ["technical", "dealOwner", "outsider", "superAdmin"]) {
            const read = await readMatrix(who)
            const live = read.tables.costing_signoffs.filter((s) => s.role === "evaluation_approved" && s.cleared_at === null)
            expect(live, who).toHaveLength(1)
            expect(live[0].signed_by, who).toBe(ids.outsider)
        }
    })

    it("is no longer refused to a list member with no other tier on the SOR (#545: the list opens a matrix SOR)", async () => {
        // The Evaluation list reads the matrix at the participant tier, so this member passes the permission check
        // and meets the state rule instead: the Evaluation is already approved.
        await asSvc(svc().from("costing_signer_lists").insert({ list_key: "evaluation", employee_id: ids.ordinary }), "list")
        try {
            const { error } = await sign("ordinary")
            expect(error?.code).toBe(WRONG_STATE)
            expect(error?.message).toMatch(/already approved/)
        } finally {
            await svc().from("costing_signer_lists").delete().eq("employee_id", ids.ordinary).eq("list_key", "evaluation")
        }
    })
})

describe("what clears it", () => {
    const cases = [
        ["a Tender Specification changes", "dealOwner", () => ({ table: "costing_tender_lines", id: lineId, patch: { tender_specification: "Rescue tripod, 3 m, 25 kN" } }), "A Tender Specification changed"],
        ["an Offer Specification changes", "outsider", () => ({ table: "costing_components", id: compA, patch: { offer_specification: "Tripod 3 m, 25 kN" } }), "An Offer Specification changed"],
        ["the verdict changes", "technical", () => ({ table: "costing_matrices", id: matrixId, patch: { compliance: "deviates", compliance_note: "25 kN is over spec" } }), "A Compliance verdict changed"],
        ["the note changes", "technical", () => ({ table: "costing_matrices", id: matrixId, patch: { compliance_note: "25 kN is more than asked" } }), "A Compliance note changed"],
    ]

    for (const [title, who, change, reason] of cases) {
        it(`clears when ${title}, with the reason on the cleared sign-off`, async () => {
            await approve()
            const { table, id, patch } = change()
            const result = await tryUpdate(await clientFor(who), table, id, patch)
            expect(result, title).toEqual({ ok: true, affected: 1 })
            expect(await liveSignoff()).toBeNull()
            expect(await lastCleared()).toMatchObject({ cleared_reason: reason, signed_by: ids.outsider })
        })
    }

    it("clears when a Tender Line or a Component is added or removed", async () => {
        const lastReason = async () => (await lastCleared()).cleared_reason

        await approve()
        const line = await asSvc(svc().from("costing_tender_lines").insert({ matrix_id: matrixId, position: 5, tender_specification: "Harness", quantity: 1 }).select("id").single(), "line")
        expect(await liveSignoff()).toBeNull()
        expect(await lastReason()).toBe("A Tender Line was added")

        await approve()
        expect((await tryDelete(await clientFor("dealOwner"), "costing_tender_lines", line.id)).ok).toBe(true)
        expect(await liveSignoff()).toBeNull()
        expect(await lastReason()).toBe("A Tender Line was removed")

        await approve()
        const comp = await asSvc(svc().from("costing_components").insert({ tender_line_id: lineId, position: 8, name: "Extra", quantity: 1 }).select("id").single(), "Component")
        expect(await liveSignoff()).toBeNull()
        expect(await lastReason()).toBe("A Component was added")

        await approve()
        expect((await tryDelete(await clientFor("dealOwner"), "costing_components", comp.id)).ok).toBe(true)
        expect(await liveSignoff()).toBeNull()
        expect(await lastReason()).toBe("A Component was removed")
    })

    it("clears when removing a Tender Line takes its Components with it", async () => {
        const line = await asSvc(svc().from("costing_tender_lines").insert({ matrix_id: matrixId, position: 6, tender_specification: "Helmet", quantity: 1 }).select("id").single(), "line")
        await asSvc(svc().from("costing_components").insert({ tender_line_id: line.id, position: 1, name: "Helmet", quantity: 1 }), "Component")
        await approve()
        expect((await tryDelete(await clientFor("dealOwner"), "costing_tender_lines", line.id)).ok).toBe(true)
        expect(await liveSignoff()).toBeNull()
        expect((await lastCleared()).cleared_reason).toMatch(/was removed$/)
    })

    it("does not clear on a change that has nothing to do with the evaluation", async () => {
        await approve()
        // A brand, a quantity, a price and an Inclusion's Completeness.
        expect(await tryUpdate(await clientFor("dealOwner"), "costing_components", compB, { brand: "Kong", quantity: 3 })).toEqual({ ok: true, affected: 1 })
        expect((await (await clientFor("dealOwner")).rpc("costing_set_money", { p_table: "costing_tender_line_prices", p_row: lineId, p_patch: { final_offer_unit: 1234 } })).error).toBeNull()
        expect(await tryUpdate(await clientFor("technical"), "costing_inclusions", inclusionId, { completeness: "SUBSTITUTED" })).toEqual({ ok: true, affected: 1 })
        // An update that names the column but does not change it.
        expect(await tryUpdate(await clientFor("outsider"), "costing_components", compB, { offer_specification: "Tripod 2.5 m, 20 kN" })).toEqual({ ok: true, affected: 1 })
        expect(await liveSignoff()).not.toBeNull()
    })

    it("keeps the cleared sign-off as history with its reason, visible in the matrix history", async () => {
        await approve()
        await tryUpdate(await clientFor("outsider"), "costing_components", compA, { offer_specification: "Tripod 3 m, 30 kN" })
        const cleared = await lastCleared()
        expect(cleared.cleared_reason).toBe("An Offer Specification changed")

        for (const who of ["technical", "dealOwner", "outsider", "superAdmin"]) {
            const events = await history(who, { p_table: "costing_signoffs" })
            const reason = events.find((e) => e.detail.column === "cleared_reason" && e.detail.row === cleared.id)
            expect(reason, who).toMatchObject({ kind: "changed", detail: { new: "An Offer Specification changed" } })
            expect(events.some((e) => e.kind === "added" && e.detail.row === cleared.id), who).toBe(true)
        }
    })

    it("keeps a cleared sign-off from changing, and lets no client write sign-offs", async () => {
        const cleared = await lastCleared()
        const edit = await svc().from("costing_signoffs").update({ cleared_reason: "rewritten" }).eq("id", cleared.id)
        expect(edit.error?.code).toBe(RLS_VIOLATION)
        await approve()
        const live = await liveSignoff()
        const changed = await svc().from("costing_signoffs").update({ signed_by: ids.dealOwner }).eq("id", live.id)
        expect(changed.error?.code).toBe(RLS_VIOLATION)

        for (const who of ["outsider", "superAdmin", "dealOwner"]) {
            const client = await clientFor(who)
            expect(await tryInsert(client, "costing_signoffs", { matrix_id: matrixId, role: "evaluation_approved", signed_by: ids[who] }), who).toMatchObject({ ok: false })
            expect(await tryUpdate(client, "costing_signoffs", live.id, { cleared_at: new Date().toISOString(), cleared_reason: "sneaky" }), who).toMatchObject({ ok: false })
            expect(await tryDelete(client, "costing_signoffs", live.id), who).toMatchObject({ ok: false })
            const clear = await client.rpc("costing_clear_signoffs", { p_matrix_id: matrixId, p_roles: ["evaluation_approved"], p_reason: "sneaky" })
            expect(clear.error, who).not.toBeNull()
        }
        expect(await liveSignoff()).not.toBeNull()
    })

    it("allows only one live sign-off per role", async () => {
        const second = await svc().from("costing_signoffs").insert({ matrix_id: matrixId, role: "evaluation_approved", signed_by: ids.outsider })
        expect(second.error?.code).toBe("23505")
    })
})

describe("a verdict leaves the money alone", () => {
    it("changes nothing in the money tables and nothing in the money read", async () => {
        await svc().from("costing_signer_lists").insert([
            { list_key: "final_acquire", employee_id: ids.ipasSigner },
            { list_key: "markup", employee_id: ids.ipasSigner },
        ])
        try {
            const outsider = await clientFor("outsider")
            expect((await outsider.rpc("costing_set_money", { p_table: "costing_component_costs", p_row: compA, p_patch: { acquire_unit: 18250.5 } })).error).toBeNull()
            expect((await (await clientFor("ipasSigner")).rpc("costing_set_money", { p_table: "costing_component_costs", p_row: compA, p_patch: { final_acquire_unit: 17900, markup_factor: 1.35 } })).error).toBeNull()
            expect((await (await clientFor("dealOwner")).rpc("costing_set_money", { p_table: "costing_tender_line_prices", p_row: lineId, p_patch: { abc_unit: 20000, final_offer_unit: 24000 } })).error).toBeNull()

            const money = async () => {
                const read = await readMatrix("superAdmin")
                return {
                    costs: read.tables.costing_component_costs,
                    prices: read.tables.costing_tender_line_prices,
                    matrixMoney: read.tables.costing_matrix_money,
                    costRows: read.tables.costing_cost_rows,
                }
            }
            const before = await money()
            expect(before.costs.find((c) => c.component_id === compA)).toMatchObject({ acquire_unit: 18250.5, final_acquire_unit: 17900 })

            expect(await setVerdict("technical", { compliance: "deviates", compliance_note: "Over spec" })).toEqual({ ok: true, affected: 1 })
            expect(await money()).toEqual(before)
            expect(await setVerdict("technical", { compliance: null, compliance_note: null })).toEqual({ ok: true, affected: 1 })
            expect(await money()).toEqual(before)
        } finally {
            await svc().from("costing_signer_lists").delete().eq("employee_id", ids.ipasSigner).in("list_key", ["final_acquire", "markup"])
        }
    })
})

describe("the registries and settings", () => {
    it("serves the verdict to every tier and names the in-charge from Sales and Purchasing", async () => {
        const tiers = await asSvc(svc().from("costing_column_tiers").select("column_name, tiers").eq("table_name", "costing_matrices").in("column_name", ["technical_incharge_id", "compliance", "compliance_note", "compliance_by", "compliance_at"]), "tiers")
        expect(tiers).toHaveLength(5)
        for (const row of tiers) expect([...row.tiers].sort(), row.column_name).toEqual(["closed_book", "cost", "participant", "price"])

        const bands = await asSvc(svc().from("costing_column_bands").select("column_name, bands").eq("table_name", "costing_matrices").eq("column_name", "technical_incharge_id"), "bands")
        expect([...bands[0].bands].sort()).toEqual(["purchasing", "sales"])
        const verdictBands = await asSvc(svc().from("costing_column_bands").select("column_name").eq("table_name", "costing_matrices").in("column_name", ["compliance", "compliance_note"]), "verdict bands")
        expect(verdictBands).toEqual([])
    })

    it("has row level security on the sign-offs", async () => {
        expect((await rlsStatus("costing_signoffs")).enabled).toBe(true)
    })

    it("has retired the evaluation task template: no setting, and no function reads one (spec #907)", async () => {
        const gone = await sql().query("select to_regclass('public.costing_evaluation_settings') as setting")
        expect(gone.rows[0].setting).toBeNull()
        const body = await sql().query("select pg_get_functiondef('public.costing_is_technical(uuid)'::regprocedure) as def")
        expect(body.rows[0].def).not.toMatch(/costing_evaluation_settings|template_id/)
    })

    it("keeps the evaluation list to the Super Admin", async () => {
        const insert = await tryInsert(await clientFor("dealOwner"), "costing_signer_lists", { list_key: "evaluation", employee_id: ids.dealOwner })
        expect(insert).toMatchObject({ ok: false, code: RLS_VIOLATION })
        const own = await (await clientFor("outsider")).from("costing_signer_lists").select("list_key").eq("list_key", "evaluation")
        expect(own.data).toEqual([{ list_key: "evaluation" }])
    })

    it("runs again without harm, and keeps the in-charge and the verdict", async () => {
        await setVerdict("technical", { compliance: "complies" })
        // 908 itself cannot run again: its Technical check read the template setting, which the door migration drops.
        // Its columns and data are covered by the later migrations, which are the ones to run twice.
        await sql().query(APPROVAL_MIGRATION)
        await sql().query(DOOR_MIGRATION)
        await sql().query(APPROVAL_MIGRATION)
        await sql().query(DOOR_MIGRATION)
        expect(await matrixRow()).toMatchObject({ technical_incharge_id: ids.technical, compliance: "complies", compliance_by: ids.technical })
        expect(await canRead(await clientFor("outsider"), "costing_components", compA)).toBe(true)
    })
})
