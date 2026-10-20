/**
 * Transmittals: undo a signature (#538 ticket 4), against the real database.
 * Builds on 68 to 71 (the same cast, seeds and helpers).
 *
 * `warehouse` (also the preparer, and on the Check by list), `dealOwner`
 * (Warehouse, Technical and Check by lists), `technical` (Technical list) and
 * `checkByTwo` (Check by list) are as in 71. `ordinary` and `superAdmin` are on
 * no list.
 *
 * Refusals are proven as the signed-in employee. The freeze that still holds on
 * a closed slip is proven against the service role, which bypasses row level
 * security but not a trigger.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { raiseAsPurchaser } from "./support/ipas.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

let poSeq = 0
const nextPo = () => `P7${String(30000 + (poSeq += 1)).padStart(6, "0")}`

const odooCopy = (po) => ({
    po: { id: 731000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: { id: 553, name: "Scorpe Technologies", contact: null },
    lines: [
        { line_id: 732000 + poSeq * 10, product_id: 5350, name: "Cutter", quantity: 6, unit: "Unit", price_unit: 1250, price_subtotal: 7500, taxes: [], analytic: [], brand: "SCORPE" },
    ],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

async function raiseIpas() {
    const po = nextPo()
    const { data, error } = await raiseAsPurchaser({
        p_po_number: po,
        p_priority: "high",
        p_source: "local",
        p_purpose: "inventory",
        p_sor_ids: [],
        p_remarks: null,
        p_odoo_copy: odooCopy(po),
    })
    if (error) throw new Error(`ipas_create ${po}: ${error.message}`)
    return data
}

const HEADER = { origin: "purchasing", check_warehouse: true, check_technical: true, priority: "high", entity: "T3ck Trading" }

async function submittedSlip(header = {}) {
    const ipas = await raiseIpas()
    const { data: made, error } = await rpc("warehouse", "transmittal_create", {
        p_fields: { ...HEADER, ...header },
        p_product_ids: [],
        p_reference_ids: [],
        p_lines: [{ kind: "po_line", ipas_id: ipas.id, odoo_po_line_id: ipas.odoo_copy.lines[0].line_id, quantity: 6 }],
    })
    if (error) throw new Error(`transmittal_create: ${error.message}`)
    const { error: submitError } = await rpc("warehouse", "transmittal_submit", { p_transmittal_id: made.id })
    if (submitError) throw new Error(`transmittal_submit: ${submitError.message}`)
    return made.id
}

const slipRow = async (slipId) => (await svc().from("transmittals").select("*").eq("id", slipId).single()).data
const stageRow = async (slipId, stage) =>
    (await svc().from("transmittal_stages").select("*").eq("transmittal_id", slipId).eq("stage", stage).single()).data
const linesOf = async (slipId) =>
    (await svc().from("transmittal_lines").select("*").eq("transmittal_id", slipId).order("position")).data
const clearedOf = async (slipId) =>
    (await svc().from("transmittal_cleared_signatures").select("*").eq("transmittal_id", slipId).order("cleared_at")).data

async function rate(who, slipId, rating = "gc") {
    const lines = await linesOf(slipId)
    const { error } = await rpc(who, "transmittal_rate", {
        p_transmittal_id: slipId,
        p_line_ratings: lines.map((line) => ({ line_id: line.id, rating, remark: rating === "na" ? "Cracked" : null })),
    })
    if (error) throw new Error(`rate: ${error.message}`)
}

async function sign(who, slipId, stage, other, extra = {}) {
    const { error } = await rpc(who, "transmittal_complete_stage", {
        p_transmittal_id: slipId,
        p_stage: stage,
        p_other_signer_id: other,
        p_other_signer_name: null,
        p_remarks: `${stage} done`,
        p_no_pictures_reason: "none",
        ...extra,
    })
    if (error) throw new Error(`${stage}: ${error.message}`)
}

/** Warehouse checking and releasing signed; the slip is in Technical inspection. */
async function toTechnical(slipId) {
    await rate("warehouse", slipId)
    await sign("warehouse", slipId, "warehouse_checking", ids.dealOwner)
    await sign("warehouse", slipId, "warehouse_releasing", ids.technical)
}

/** Technical inspection signed too; the slip is awaiting Check by. */
async function toAwaitingCheck(slipId) {
    await toTechnical(slipId)
    await rate("technical", slipId)
    await sign("technical", slipId, "technical_inspection", ids.dealOwner)
}

const undo = (who, slipId, args) =>
    rpc(who, "transmittal_undo_signature", { p_transmittal_id: slipId, p_reason: "Signed by mistake", ...args })

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
    const lists = [
        ["warehouse", "transmittal_warehouse"],
        ["dealOwner", "transmittal_warehouse"],
        ["dealOwner", "transmittal_technical"],
        ["technical", "transmittal_technical"],
        ["checkByTwo", "transmittal_check_by"],
        ["dealOwner", "transmittal_check_by"],
        ["warehouse", "transmittal_check_by"],
    ]
    for (const [who, listKey] of lists) {
        const { error } = await svc()
            .from("ipas_signer_lists")
            .upsert({ list_key: listKey, employee_id: ids[who] }, { onConflict: "list_key,employee_id" })
        if (error) throw new Error(`Seeding ${listKey}: ${error.message}`)
    }
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await svc().from("ipas_signer_lists").delete().eq("list_key", "transmittal_technical").eq("employee_id", ids.dealOwner)
    await svc().from("ipas_signer_lists").delete().eq("list_key", "transmittal_check_by").eq("employee_id", ids.dealOwner)
    await svc().from("ipas_signer_lists").delete().eq("list_key", "transmittal_check_by").eq("employee_id", ids.warehouse)
    await svc().from("ipas_signer_lists").delete().eq("list_key", "transmittal_warehouse").eq("employee_id", ids.dealOwner)
})

describe("undoing a stage signature", () => {
    it("clears the signature, keeps ratings, remarks and the history, and reopens the stage", async () => {
        const slipId = await submittedSlip()
        await toAwaitingCheck(slipId)
        const before = await stageRow(slipId, "technical_inspection")
        expect(before.completed_at).toBeTruthy()

        const done = await undo("technical", slipId, { p_kind: "stage", p_stage: "technical_inspection" })
        expect(done.error).toBeNull()
        expect(done.data).toMatchObject({ state: "technical_inspection", kind: "stage" })

        const after = await stageRow(slipId, "technical_inspection")
        expect(after).toMatchObject({
            completed_at: null,
            completed_by: null,
            first_signer_id: null,
            second_signer_id: null,
            first_confirmed: false,
            second_confirmed: false,
        })
        // Ratings and remarks are untouched.
        expect(after.remarks).toBe("technical_inspection done")
        expect((await linesOf(slipId))[0].tech_rating).toBe("gc")
        expect((await slipRow(slipId)).state).toBe("technical_inspection")

        const [cleared] = await clearedOf(slipId)
        expect(cleared).toMatchObject({
            kind: "stage",
            stage: "technical_inspection",
            signer_id: ids.technical,
            cleared_by: ids.technical,
            cleared_reason: "Signed by mistake",
        })
        expect(cleared.signed_at).toBeTruthy()
        expect(cleared.cleared_at).toBeTruthy()

        // The stage can be signed again.
        await sign("technical", slipId, "technical_inspection", ids.dealOwner)
        expect((await slipRow(slipId)).state).toBe("awaiting_check")
    })

    it("refuses a reason that is blank, and someone who may not sign that stage", async () => {
        const slipId = await submittedSlip()
        await toAwaitingCheck(slipId)

        const blank = await undo("technical", slipId, { p_kind: "stage", p_stage: "technical_inspection", p_reason: "  " })
        expect(blank.error?.message ?? "").toMatch(/give the reason/)

        for (const who of ["warehouse", "ordinary", "superAdmin"]) {
            const { error } = await undo(who, slipId, { p_kind: "stage", p_stage: "technical_inspection" })
            expect(error, `${who} undid Technical inspection`).toBeTruthy()
        }
        expect((await stageRow(slipId, "technical_inspection")).completed_at).toBeTruthy()
        expect(await clearedOf(slipId)).toHaveLength(0)
    })

    it("refuses an earlier stage while a later one is signed, then allows it latest first", async () => {
        const slipId = await submittedSlip()
        await toAwaitingCheck(slipId)

        const early = await undo("warehouse", slipId, { p_kind: "stage", p_stage: "warehouse_checking" })
        expect(early.error?.message ?? "").toMatch(/later stage/)

        expect((await undo("technical", slipId, { p_kind: "stage", p_stage: "technical_inspection" })).error).toBeNull()
        expect((await undo("warehouse", slipId, { p_kind: "stage", p_stage: "warehouse_releasing" })).error).toBeNull()
        expect((await slipRow(slipId)).state).toBe("warehouse_releasing")
        const checking = await undo("warehouse", slipId, { p_kind: "stage", p_stage: "warehouse_checking" })
        expect(checking.error).toBeNull()
        expect((await slipRow(slipId)).state).toBe("warehouse_checking")
        expect(await clearedOf(slipId)).toHaveLength(3)
    })

    it("refuses an unsigned stage and a stage once a Check by is signed", async () => {
        const slipId = await submittedSlip()
        await toTechnical(slipId)
        const unsigned = await undo("technical", slipId, { p_kind: "stage", p_stage: "technical_inspection" })
        expect(unsigned.error?.message ?? "").toMatch(/isn't signed/)

        await rate("technical", slipId)
        await sign("technical", slipId, "technical_inspection", ids.dealOwner)
        await rpc("warehouse", "transmittal_received_in_odoo", { p_transmittal_id: slipId, p_ref: "WH/IN/U-1" })
        expect((await rpc("checkByTwo", "transmittal_check", { p_transmittal_id: slipId, p_slot: 1 })).error).toBeNull()

        const blocked = await undo("technical", slipId, { p_kind: "stage", p_stage: "technical_inspection" })
        expect(blocked.error?.message ?? "").toMatch(/Check by signed/)
    })
})

describe("undoing Received in Odoo by", () => {
    it("clears the receipt for the Warehouse list, and keeps it as history with its reference", async () => {
        const slipId = await submittedSlip()
        await rpc("warehouse", "transmittal_received_in_odoo", { p_transmittal_id: slipId, p_ref: "WH/IN/U-2" })

        for (const who of ["ordinary", "technical"]) {
            const { error } = await undo(who, slipId, { p_kind: "odoo" })
            expect(error, `${who} undid the Odoo receipt`).toBeTruthy()
        }
        const done = await undo("warehouse", slipId, { p_kind: "odoo" })
        expect(done.error).toBeNull()
        expect(await slipRow(slipId)).toMatchObject({ odoo_received_at: null, odoo_received_by: null, odoo_receipt_ref: null })
        const [cleared] = await clearedOf(slipId)
        expect(cleared).toMatchObject({ kind: "odoo", signer_id: ids.warehouse, receipt_ref: "WH/IN/U-2", cleared_by: ids.warehouse })

        const again = await undo("warehouse", slipId, { p_kind: "odoo" })
        expect(again.error?.message ?? "").toMatch(/no Odoo receipt/)
    })
})

describe("undoing a Check by", () => {
    async function closedSlip() {
        const slipId = await submittedSlip()
        await toAwaitingCheck(slipId)
        await rpc("warehouse", "transmittal_received_in_odoo", { p_transmittal_id: slipId, p_ref: "WH/IN/U-3" })
        expect((await rpc("checkByTwo", "transmittal_check", { p_transmittal_id: slipId, p_slot: 1 })).error).toBeNull()
        expect((await rpc("dealOwner", "transmittal_check", { p_transmittal_id: slipId, p_slot: 2 })).error).toBeNull()
        expect((await slipRow(slipId)).state).toBe("closed")
        return slipId
    }

    it("reopens a closed slip to Awaiting Check by, and keeps who signed and who cleared it", async () => {
        const slipId = await closedSlip()

        const done = await undo("checkByTwo", slipId, { p_kind: "check_by", p_slot: 2 })
        expect(done.error).toBeNull()
        expect(done.data).toMatchObject({ state: "awaiting_check" })
        expect(await slipRow(slipId)).toMatchObject({
            state: "awaiting_check",
            closed_at: null,
            check_by_second_id: null,
            check_by_second_at: null,
            check_by_first_id: ids.checkByTwo,
        })
        const [cleared] = await clearedOf(slipId)
        expect(cleared).toMatchObject({ kind: "check_by", slot: 2, signer_id: ids.dealOwner, cleared_by: ids.checkByTwo })

        // The slip can be closed again.
        expect((await rpc("dealOwner", "transmittal_check", { p_transmittal_id: slipId, p_slot: 2 })).error).toBeNull()
        expect((await slipRow(slipId)).state).toBe("closed")
    })

    it("refuses the preparer, someone off the Check by list, and an unsigned slot", async () => {
        const slipId = await closedSlip()
        for (const who of ["warehouse", "technical", "ordinary", "superAdmin"]) {
            const { error } = await undo(who, slipId, { p_kind: "check_by", p_slot: 1 })
            expect(error, `${who} undid a Check by`).toBeTruthy()
        }
        expect((await slipRow(slipId)).state).toBe("closed")

        expect((await undo("checkByTwo", slipId, { p_kind: "check_by", p_slot: 2 })).error).toBeNull()
        const unsigned = await undo("checkByTwo", slipId, { p_kind: "check_by", p_slot: 2 })
        expect(unsigned.error?.message ?? "").toMatch(/isn't signed/)
    })

    it("keeps the closed freeze for every other write, from the service role", async () => {
        const slipId = await closedSlip()
        const { error } = await svc().from("transmittals").update({ priority: "low" }).eq("id", slipId)
        expect(error?.message ?? "").toMatch(/closed/)
        const stage = await svc().from("transmittal_stages").update({ remarks: "Edited" }).eq("transmittal_id", slipId).eq("stage", "technical_inspection")
        expect(stage.error?.message ?? "").toMatch(/signed/)
    })
})

describe("the history of cleared signatures", () => {
    it("is read by those who read the slip, and can't be changed by anyone", async () => {
        const slipId = await submittedSlip()
        await rpc("warehouse", "transmittal_received_in_odoo", { p_transmittal_id: slipId, p_ref: "WH/IN/U-4" })
        expect((await undo("warehouse", slipId, { p_kind: "odoo" })).error).toBeNull()
        const [cleared] = await clearedOf(slipId)

        const asPreparer = await (await clientFor("warehouse")).from("transmittal_cleared_signatures").select("id").eq("transmittal_id", slipId)
        expect(asPreparer.data).toHaveLength(1)
        const asOutsider = await (await clientFor("ordinary")).from("transmittal_cleared_signatures").select("id").eq("transmittal_id", slipId)
        expect(asOutsider.data ?? []).toHaveLength(0)

        const write = await (await clientFor("warehouse"))
            .from("transmittal_cleared_signatures")
            .update({ cleared_reason: "Rewritten" })
            .eq("id", cleared.id)
        expect(write.error ?? (await clearedOf(slipId))[0].cleared_reason === "Rewritten").toBeTruthy()
        expect((await clearedOf(slipId))[0].cleared_reason).toBe("Signed by mistake")

        const service = await svc().from("transmittal_cleared_signatures").delete().eq("id", cleared.id)
        expect(service.error?.message ?? "").toMatch(/append-only/)
    })
})
