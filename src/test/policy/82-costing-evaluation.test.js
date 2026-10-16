/**
 * Costing Matrix, Evaluation of Specification (#271, spec #266): the Technical
 * band, Compliance and its note, the "Evaluation approved" sign-off and what
 * clears it.
 *
 * The cast, on one SOR (dealOwner and support are its Deal Team):
 *   technical         member of the SOR's Evaluation of Specification group task, with an
 *                     open Stage Participant window  -> participant tier, Technical band
 *   stageParticipant  open window, not on the task   -> participant tier, no band
 *   dealOwner, support Deal Team                      -> price tier, Sales band
 *   outsider          Purchasing access, and on the evaluation list -> cost tier,
 *                     Purchasing + Technical bands
 *   superAdmin                                        -> closed_book, Sales + Purchasing +
 *                     Technical bands, but not on the evaluation list
 *   ordinary          nobody                          -> no tier
 *
 * The matrix, the template, the task and its members are made with the service
 * role; every assertion runs as a real cast member.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, rlsStatus, sql } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { canRead, tryInsert, tryUpdate, tryDelete, RLS_VIOLATION } from "./support/access.js"
import { purgeCostingForSors } from "./support/costing.js"
import { COMPONENT_BANDS, INCLUSION_BANDS } from "../../constants/costing.js"

const svc = () => serviceClient()
const CHECK_VIOLATION = "23514"
const WRONG_STATE = "55000"
const NOT_YET = "0A000"
const MIGRATION = readFileSync("supabase/migrations/20261018140000_costing_matrix_evaluation.sql", "utf8")

let saleTypeId, flowId, stageId
let sorId, matrixId
let lineId, compA, compB, compC, bundleId, inclusionId
let templateId, otherTemplateId, taskId, otherTaskId, memberRowId
let previousTemplateId
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

const setCompliance = (who, id, patch) => clientFor(who).then((client) => tryUpdate(client, "costing_components", id, patch))

const liveSignoff = async () =>
    (await asSvc(svc().from("costing_signoffs").select("*").eq("matrix_id", matrixId).eq("role", "evaluation_approved").is("cleared_at", null), "live sign-off"))[0] ?? null

const lastCleared = async () =>
    (
        await asSvc(
            svc().from("costing_signoffs").select("*").eq("matrix_id", matrixId).eq("role", "evaluation_approved").not("cleared_at", "is", null).order("cleared_at", { ascending: false }).order("id").limit(1),
            "cleared sign-off",
        )
    )[0] ?? null

/** Gives every Component a verdict, then approves as the reviewer. */
async function approve() {
    if (await liveSignoff()) return
    const rows = await asSvc(svc().from("costing_components").select("id").in("id", [compA, compB, compC]), "components")
    for (const { id } of rows) {
        await asSvc(svc().from("costing_components").update({ compliance: "complies" }).eq("id", id).is("compliance", null), "verdict")
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

    // Technical and a plain participant both read the matrix through an open Stage Participant window.
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

    // The template the settings row names, a task on this SOR created from it, and Technical on that task.
    templateId = (
        await asSvc(svc().from("group_task_templates").insert({ name: `${MARKER} Evaluation of Specification`, created_by: ids.head }).select("id").single(), "template")
    ).id
    otherTemplateId = (
        await asSvc(svc().from("group_task_templates").insert({ name: `${MARKER} Some other template`, created_by: ids.head }).select("id").single(), "other template")
    ).id
    previousTemplateId = (await asSvc(svc().from("costing_evaluation_settings").select("evaluation_template_id").eq("id", true).single(), "settings")).evaluation_template_id
    await asSvc(svc().from("costing_evaluation_settings").update({ evaluation_template_id: templateId }).eq("id", true), "settings")

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
    compC = await component(3)
    bundleId = await component(4, { is_bundle: true })
    // Rows exist already, so a refused money write names its column and not the "add a row" band.
    await asSvc(svc().from("costing_component_costs").insert([{ component_id: compA }, { component_id: compB }]), "costs rows")
    await asSvc(svc().from("costing_tender_line_prices").insert({ tender_line_id: lineId }), "prices row")
    inclusionId = (await asSvc(svc().from("costing_inclusions").insert({ component_id: bundleId, position: 1, description: "Carry bag" }).select("id").single(), "Inclusion")).id
    // The bundle is evaluated too, once the others are; keep it out of the early "unevaluated" counts by giving it a verdict now.
    await asSvc(svc().from("costing_components").update({ compliance: "complies" }).eq("id", bundleId), "bundle verdict")
})

afterAll(async () => {
    await svc().from("costing_signer_lists").delete().eq("employee_id", ids.outsider).eq("list_key", "evaluation")
    await svc().from("employees").update({ has_purchasing_flow: false, call_sign: null }).in("id", [ids.outsider, ids.ipasSigner])
    await svc().from("costing_evaluation_settings").update({ evaluation_template_id: previousTemplateId }).eq("id", true)
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

describe("the Technical band", () => {
    it("lets a member of the evaluation task write Compliance, its note and the recommended alternative", async () => {
        expect(await setCompliance("technical", compA, { compliance: "complies" })).toEqual({ ok: true, affected: 1 })
        const deviate = await setCompliance("technical", compB, {
            compliance: "deviates",
            compliance_note: "2.5 m, not the 3 m asked for",
            recommended_alternative: "Tripod 3 m, 22 kN (model T3)",
        })
        expect(deviate).toEqual({ ok: true, affected: 1 })
        const row = await asSvc(svc().from("costing_components").select("*").eq("id", compB).single(), "Component")
        expect(row).toMatchObject({
            compliance: "deviates",
            compliance_note: "2.5 m, not the 3 m asked for",
            recommended_alternative: "Tripod 3 m, 22 kN (model T3)",
        })
    })

    it("lets a member set an Inclusion's Completeness", async () => {
        const edit = await tryUpdate(await clientFor("technical"), "costing_inclusions", inclusionId, { completeness: "COVERED" })
        expect(edit).toEqual({ ok: true, affected: 1 })
    })

    it("reads the matrix with no money at all", async () => {
        const read = await readMatrix("technical")
        expect(read.tier).toBe("participant")
        expect(read.bands).toEqual(["technical"])
        const json = JSON.stringify(read)
        expect(json).not.toMatch(/acquire_unit|final_acquire_unit|markup_factor|odoo_unit|abc_unit|final_offer_unit/)
        expect(read.tables.costing_components.find((c) => c.id === compB)).toMatchObject({ compliance: "deviates", compliance_note: "2.5 m, not the 3 m asked for" })
    })

    it("refuses a member Acquire and every money table, naming the band", async () => {
        const typed = async (table, row, patch) =>
            (await (await clientFor("technical")).rpc("costing_set_money", { p_table: table, p_row: row, p_patch: patch })).error
        expect((await typed("costing_component_costs", compA, { acquire_unit: 100 })).message).toBe("costing_band:costing_component_costs.acquire_unit:purchasing")
        expect((await typed("costing_component_costs", compA, { odoo_unit: 100 })).message).toBe("costing_band:costing_component_costs.odoo_unit:sales")
        expect((await typed("costing_component_costs", compA, { final_acquire_unit: 100 })).message).toBe("costing_band:costing_component_costs.final_acquire_unit:management")
        expect((await typed("costing_tender_line_prices", lineId, { final_offer_unit: 100 })).message).toBe("costing_band:costing_tender_line_prices.final_offer_unit:sales")
        expect((await typed("costing_tender_line_prices", lineId, { abc_unit: 100 })).code).toBe(RLS_VIOLATION)
        expect((await typed("costing_matrix_money", matrixId, { nonsense: 1 })).code).toBe("22023")

        const costs = await (await clientFor("technical")).from("costing_component_costs").select("component_id")
        const prices = await (await clientFor("technical")).from("costing_tender_line_prices").select("tender_line_id")
        const money = await (await clientFor("technical")).from("costing_matrix_money").select("matrix_id")
        const rows = await (await clientFor("technical")).from("costing_cost_rows").select("id")
        for (const result of [costs, prices, money, rows]) expect(result.data).toEqual([])
    })

    it("refuses a member every other column, and adding or removing a Component", async () => {
        const brand = await setCompliance("technical", compA, { brand: "Petzl" })
        expect(brand).toMatchObject({ ok: false, code: RLS_VIOLATION })
        expect(brand.message).toBe("costing_band:costing_components.brand:sales")
        const offer = await setCompliance("technical", compA, { offer_specification: "changed" })
        expect(offer.message).toBe("costing_band:costing_components.offer_specification:purchasing")
        const add = await tryInsert(await clientFor("technical"), "costing_components", { tender_line_id: lineId, position: 9, name: "x", quantity: 1 })
        expect(add.message).toBe("costing_band:costing_components.*:sales,purchasing")
        const remove = await tryDelete(await clientFor("technical"), "costing_components", compA)
        expect(remove.message).toBe("costing_band:costing_components.*:sales,purchasing")
        const line = await tryUpdate(await clientFor("technical"), "costing_tender_lines", lineId, { tender_specification: "changed" })
        expect(line.message).toBe("costing_band:costing_tender_lines.tender_specification:sales")
    })

    it("refuses a Deal Team member and a Stage Participant who are not on the task", async () => {
        for (const who of ["dealOwner", "support", "stageParticipant"]) {
            for (const column of ["compliance", "compliance_note", "recommended_alternative"]) {
                const patch = { [column]: column === "compliance" ? "complies" : "x" }
                const refused = await setCompliance(who, compC, patch)
                expect(refused, `${who} ${column}`).toMatchObject({ ok: false, code: RLS_VIOLATION })
                expect(refused.message).toBe(`costing_band:costing_components.${column}:technical`)
            }
            const completeness = await tryUpdate(await clientFor(who), "costing_inclusions", inclusionId, { completeness: "MISSING" })
            expect(completeness.message, who).toBe("costing_band:costing_inclusions.completeness:technical")
        }
        // No tier on the SOR at all: the row policy hides it.
        expect(await setCompliance("ordinary", compC, { compliance: "complies" })).toEqual({ ok: true, affected: 0 })
        expect(await setCompliance("finance", compC, { compliance: "complies" })).toEqual({ ok: true, affected: 0 })
        const row = await asSvc(svc().from("costing_components").select("compliance").eq("id", compC).single(), "Component")
        expect(row.compliance).toBeNull()
    })

    it("lets Purchasing access and a Super Admin write Compliance without being on the task", async () => {
        expect(await setCompliance("outsider", compC, { compliance: "complies" })).toEqual({ ok: true, affected: 1 })
        expect(await setCompliance("superAdmin", compC, { compliance: null })).toEqual({ ok: true, affected: 1 })
        expect(await setCompliance("superAdmin", compC, { recommended_alternative: "Model X" })).toEqual({ ok: true, affected: 1 })
        expect(await setCompliance("superAdmin", compC, { recommended_alternative: null })).toEqual({ ok: true, affected: 1 })
    })

    it("refuses the write once the member is removed from the task, and again when they are put back", async () => {
        await asSvc(svc().from("committee_task_members").delete().eq("id", memberRowId), "remove member")
        const refused = await setCompliance("technical", compA, { compliance_note: "Looks fine" })
        expect(refused).toMatchObject({ ok: false, code: RLS_VIOLATION })
        expect(refused.message).toBe("costing_band:costing_components.compliance_note:technical")
        // They still read the matrix: the window is a separate door.
        expect((await readMatrix("technical")).tier).toBe("participant")

        memberRowId = (
            await asSvc(
                svc().from("committee_task_members").insert({ committee_task_id: taskId, employee_id: ids.technical, task_description: "Evaluate the offer" }).select("id").single(),
                "member again",
            )
        ).id
        expect(await setCompliance("technical", compA, { compliance_note: "Looks fine" })).toEqual({ ok: true, affected: 1 })
        expect(await setCompliance("technical", compA, { compliance_note: null })).toEqual({ ok: true, affected: 1 })
    })

    it("grants nothing from a cancelled task, or a task from another template", async () => {
        await asSvc(svc().from("committee_tasks").update({ status: "CANCELLED" }).eq("id", taskId), "cancel")
        expect((await setCompliance("technical", compA, { compliance_note: "again" })).message).toBe("costing_band:costing_components.compliance_note:technical")
        await asSvc(svc().from("committee_tasks").update({ status: "ACTIVE" }).eq("id", taskId), "reopen")
        expect(await setCompliance("technical", compA, { compliance_note: null })).toEqual({ ok: true, affected: 1 })

        // stageParticipant is on a task from another template: still refused.
        expect((await setCompliance("stageParticipant", compC, { compliance: "complies" })).message).toBe("costing_band:costing_components.compliance:technical")
    })

    it("follows the settings row: with no template named, no task grants the write", async () => {
        await asSvc(svc().from("costing_evaluation_settings").update({ evaluation_template_id: null }).eq("id", true), "clear template")
        expect((await setCompliance("technical", compA, { compliance_note: "x" })).message).toBe("costing_band:costing_components.compliance_note:technical")
        await asSvc(svc().from("costing_evaluation_settings").update({ evaluation_template_id: templateId }).eq("id", true), "restore template")
        expect(await setCompliance("technical", compA, { compliance_note: null })).toEqual({ ok: true, affected: 1 })
    })
})

describe("a deviation needs a note", () => {
    it("is refused by the database without one, or with a blank one", async () => {
        const bare = await setCompliance("technical", compC, { compliance: "deviates" })
        expect(bare).toMatchObject({ ok: false, code: CHECK_VIOLATION })
        expect(bare.message).toMatch(/costing_components_deviation_note_chk/)
        const blank = await setCompliance("technical", compC, { compliance: "deviates", compliance_note: "   " })
        expect(blank).toMatchObject({ ok: false, code: CHECK_VIOLATION })
        // Not even the service role gets round it.
        const asService = await svc().from("costing_components").update({ compliance: "deviates" }).eq("id", compC)
        expect(asService.error?.code).toBe(CHECK_VIOLATION)
        const insert = await svc().from("costing_components").insert({ tender_line_id: lineId, position: 20, name: "x", compliance: "deviates" })
        expect(insert.error?.code).toBe(CHECK_VIOLATION)
    })

    it("refuses removing the note from a Component that deviates", async () => {
        const removed = await setCompliance("technical", compB, { compliance_note: null })
        expect(removed).toMatchObject({ ok: false, code: CHECK_VIOLATION })
    })

    it("accepts a deviation with a note, and a verdict outside the list is refused", async () => {
        expect(await setCompliance("technical", compC, { compliance: "deviates", compliance_note: "Different thread" })).toEqual({ ok: true, affected: 1 })
        const odd = await setCompliance("technical", compC, { compliance: "maybe" })
        expect(odd).toMatchObject({ ok: false, code: CHECK_VIOLATION })
        // Back to unevaluated for the sign-off tests.
        expect(await setCompliance("technical", compC, { compliance: null })).toEqual({ ok: true, affected: 1 })
    })
})

describe("Evaluation approved", () => {
    it("is refused while a Component has no verdict, and says how many", async () => {
        const { error } = await sign("outsider")
        expect(error?.code).toBe(WRONG_STATE)
        expect(error?.message).toBe("costing_sign: 1 Component has no verdict yet")
        expect(await liveSignoff()).toBeNull()

        await asSvc(svc().from("costing_components").update({ compliance: null }).eq("id", bundleId), "unevaluate")
        const two = await sign("outsider")
        expect(two.error?.message).toBe("costing_sign: 2 Components have no verdict yet")
        await asSvc(svc().from("costing_components").update({ compliance: "complies" }).eq("id", bundleId), "bundle verdict")
    })

    it("is refused to anyone off the evaluation list, a Super Admin and a task member included", async () => {
        await asSvc(svc().from("costing_components").update({ compliance: "complies" }).eq("id", compC), "verdict")
        for (const who of ["superAdmin", "technical", "dealOwner", "stageParticipant"]) {
            const { error } = await sign(who)
            expect(error?.code, who).toBe(RLS_VIOLATION)
        }
        expect((await sign("ordinary")).error?.code).toBe(RLS_VIOLATION)
        expect((await sign("superAdmin")).error?.message).toMatch(/evaluation list/)
        expect(await liveSignoff()).toBeNull()
    })

    it("is not yet available for the other roles", async () => {
        for (const role of ["prepared", "costed", "final_approved"]) {
            expect((await sign("outsider", role)).error?.code, role).toBe(NOT_YET)
        }
        expect((await sign("outsider", "nonsense")).error?.code).toBe("22023")
        expect(await liveSignoff()).toBeNull()
    })

    it("is signed by someone on the list when every Component has a verdict", async () => {
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

    it("is refused to a list member who has no tier on the SOR", async () => {
        await asSvc(svc().from("costing_signer_lists").insert({ list_key: "evaluation", employee_id: ids.ordinary }), "list")
        const { error } = await sign("ordinary")
        expect(error?.code).toBe(RLS_VIOLATION)
        await svc().from("costing_signer_lists").delete().eq("employee_id", ids.ordinary).eq("list_key", "evaluation")
    })
})

describe("what clears it", () => {
    const cases = [
        ["a Tender Specification changes", "dealOwner", () => ({ table: "costing_tender_lines", id: lineId, patch: { tender_specification: "Rescue tripod, 3 m, 25 kN" } }), "A Tender Specification changed"],
        ["an Offer Specification changes", "outsider", () => ({ table: "costing_components", id: compA, patch: { offer_specification: "Tripod 3 m, 25 kN" } }), "An Offer Specification changed"],
        ["a verdict changes", "technical", () => ({ table: "costing_components", id: compA, patch: { compliance: "deviates", compliance_note: "25 kN is over spec" } }), "A Compliance verdict changed"],
        ["a note changes", "technical", () => ({ table: "costing_components", id: compA, patch: { compliance_note: "25 kN is more than asked" } }), "A Compliance note changed"],
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
        const comp = await asSvc(svc().from("costing_components").insert({ tender_line_id: lineId, position: 8, name: "Extra", quantity: 1, compliance: "complies" }).select("id").single(), "Component")
        expect(await liveSignoff()).toBeNull()
        expect(await lastReason()).toBe("A Component was added")

        await approve()
        expect((await tryDelete(await clientFor("dealOwner"), "costing_components", comp.id)).ok).toBe(true)
        expect(await liveSignoff()).toBeNull()
        expect(await lastReason()).toBe("A Component was removed")
    })

    it("clears when removing a Tender Line takes its Components with it", async () => {
        const line = await asSvc(svc().from("costing_tender_lines").insert({ matrix_id: matrixId, position: 6, tender_specification: "Helmet", quantity: 1 }).select("id").single(), "line")
        await asSvc(svc().from("costing_components").insert({ tender_line_id: line.id, position: 1, name: "Helmet", quantity: 1, compliance: "complies" }), "Component")
        await approve()
        expect((await tryDelete(await clientFor("dealOwner"), "costing_tender_lines", line.id)).ok).toBe(true)
        expect(await liveSignoff()).toBeNull()
        expect((await lastCleared()).cleared_reason).toMatch(/was removed$/)
    })

    it("does not clear on a change that has nothing to do with the evaluation", async () => {
        await approve()
        // The recommended alternative, a brand, a quantity, a price and an Inclusion's Completeness.
        expect(await tryUpdate(await clientFor("technical"), "costing_components", compB, { recommended_alternative: "Another model" })).toEqual({ ok: true, affected: 1 })
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

describe("a deviation leaves the money alone", () => {
    it("changes nothing in the money tables and nothing in the money read", async () => {
        await svc().from("costing_signer_lists").insert({ list_key: "final_acquire", employee_id: ids.ipasSigner })
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

            expect(await tryUpdate(await clientFor("technical"), "costing_components", compA, { compliance: "deviates", compliance_note: "Over spec", recommended_alternative: "Model Y" })).toEqual({ ok: true, affected: 1 })
            expect(await money()).toEqual(before)
            expect(await tryUpdate(await clientFor("technical"), "costing_components", compA, { compliance: null })).toEqual({ ok: true, affected: 1 })
            expect(await money()).toEqual(before)
        } finally {
            await svc().from("costing_signer_lists").delete().eq("employee_id", ids.ipasSigner).eq("list_key", "final_acquire")
        }
    })
})

describe("the registries and settings", () => {
    it("serves Compliance to every tier and writes it from the Technical band", async () => {
        const tiers = await asSvc(svc().from("costing_column_tiers").select("table_name, column_name, tiers").eq("table_name", "costing_components").in("column_name", ["compliance", "compliance_note", "recommended_alternative"]), "tiers")
        expect(tiers).toHaveLength(3)
        for (const row of tiers) expect([...row.tiers].sort(), row.column_name).toEqual(["closed_book", "cost", "participant", "price"])

        const bands = await asSvc(svc().from("costing_column_bands").select("table_name, column_name, bands").in("table_name", ["costing_components", "costing_inclusions"]), "bands")
        const bandsOf = (table, column) => [...(bands.find((b) => b.table_name === table && b.column_name === column)?.bands ?? [])].sort()
        for (const [column, expected] of Object.entries({ compliance: COMPONENT_BANDS.compliance, compliance_note: COMPONENT_BANDS.compliance_note, recommended_alternative: COMPONENT_BANDS.recommended_alternative })) {
            expect(bandsOf("costing_components", column), column).toEqual([...expected].sort())
        }
        expect(bandsOf("costing_inclusions", "completeness")).toEqual([...INCLUSION_BANDS.completeness].sort())
    })

    it("has row level security on the sign-offs and the settings", async () => {
        for (const table of ["costing_signoffs", "costing_evaluation_settings"]) expect((await rlsStatus(table)).enabled, table).toBe(true)
    })

    it("lets any signed-in employee read the settings and only a Super Admin change them", async () => {
        const read = async (who) => (await (await clientFor(who)).from("costing_evaluation_settings").select("evaluation_template_id")).data
        for (const who of ["ordinary", "technical", "outsider", "superAdmin"]) expect(await read(who), who).toEqual([{ evaluation_template_id: templateId }])

        for (const who of ["outsider", "dealOwner", "technical"]) {
            const client = await clientFor(who)
            const update = await client.from("costing_evaluation_settings").update({ evaluation_template_id: null }).eq("id", true).select("id")
            expect(update.data ?? [], who).toEqual([])
            const insert = await client.from("costing_evaluation_settings").insert({ id: false, evaluation_template_id: null })
            expect(insert.error?.code, who).toBe(RLS_VIOLATION)
        }
        const admin = await (await clientFor("superAdmin")).from("costing_evaluation_settings").update({ evaluation_template_id: otherTemplateId }).eq("id", true).select("id")
        expect(admin.data).toHaveLength(1)
        await asSvc(svc().from("costing_evaluation_settings").update({ evaluation_template_id: templateId }).eq("id", true), "restore")
        // Only ever one row.
        const extra = await svc().from("costing_evaluation_settings").insert({ id: false })
        expect(extra.error?.code).toBe(CHECK_VIOLATION)
    })

    it("keeps the evaluation list to the Super Admin", async () => {
        const insert = await tryInsert(await clientFor("dealOwner"), "costing_signer_lists", { list_key: "evaluation", employee_id: ids.dealOwner })
        expect(insert).toMatchObject({ ok: false, code: RLS_VIOLATION })
        const own = await (await clientFor("outsider")).from("costing_signer_lists").select("list_key").eq("list_key", "evaluation")
        expect(own.data).toEqual([{ list_key: "evaluation" }])
    })

    it("seeds the evaluation list with call sign 1001 and the template by name, and runs again without harm", async () => {
        // Nobody has call sign 1001: nothing is seeded and nothing fails.
        await sql().query(MIGRATION)

        await svc().from("employees").update({ call_sign: "1001" }).eq("id", ids.ipasSigner)
        const named = await asSvc(svc().from("group_task_templates").insert({ name: "Evaluation of Specification", created_by: ids.head }).select("id").single(), "named template")
        try {
            await svc().from("costing_evaluation_settings").update({ evaluation_template_id: null }).eq("id", true)
            await sql().query(MIGRATION)
            await sql().query(MIGRATION)
            const list = await asSvc(svc().from("costing_signer_lists").select("employee_id").eq("list_key", "evaluation").eq("employee_id", ids.ipasSigner), "list")
            expect(list).toHaveLength(1)
            const settings = await asSvc(svc().from("costing_evaluation_settings").select("*"), "settings")
            expect(settings).toHaveLength(1)
            expect(settings[0].evaluation_template_id).toBe(named.id)
        } finally {
            await svc().from("costing_evaluation_settings").update({ evaluation_template_id: templateId }).eq("id", true)
            await svc().from("group_task_templates").delete().eq("id", named.id)
            await svc().from("costing_signer_lists").delete().eq("employee_id", ids.ipasSigner).eq("list_key", "evaluation")
            await svc().from("employees").update({ call_sign: null }).eq("id", ids.ipasSigner)
        }
        expect(await canRead(await clientFor("outsider"), "costing_components", compA)).toBe(true)
    })
})
