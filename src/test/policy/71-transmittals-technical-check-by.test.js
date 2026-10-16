/**
 * Transmittals (TG03, #254, spec #251): Technical inspection and Check by,
 * against the real database. Builds on 68 and 69 (the same seeds and helpers).
 *
 * `technical` and `dealOwner` are on the Technical list (dealOwner is also a
 * Warehouse member, so the Technical co-signer is a Technical list member other
 * than the inspector). `checkByTwo` and `dealOwner` are on the Check by list.
 * `warehouse` is on the Check by list too, so the preparer's refusal is proven
 * against someone who could otherwise sign. `superAdmin` is off every list.
 *
 * Refusals are proven as the signed-in employee. The closed freeze is proven
 * against the service role, which bypasses row level security but not a trigger.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

let poSeq = 0
const nextPo = () => `P7${String(10000 + (poSeq += 1)).padStart(6, "0")}`

const odooCopy = (po) => ({
    po: { id: 771000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: { id: 553, name: "Scorpe Technologies", contact: null },
    lines: [
        { line_id: 761000 + poSeq * 10, product_id: 5350, name: "Cutter", quantity: 6, unit: "Unit", price_unit: 1250, price_subtotal: 7500, taxes: [], analytic: [], brand: "SCORPE" },
    ],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

async function raiseIpas() {
    const po = nextPo()
    const { data, error } = await rpc("outsider", "ipas_create", {
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

/** A submitted slip with one PO line, prepared by the Warehouse list. */
async function submittedSlip(ipas, header = {}) {
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

async function linesOf(slipId) {
    const { data, error } = await svc().from("transmittal_lines").select("*").eq("transmittal_id", slipId).order("position")
    if (error) throw error
    return data
}

async function slipState(slipId) {
    const { data, error } = await svc().from("transmittals").select("state").eq("id", slipId).single()
    if (error) throw error
    return data.state
}

async function rate(who, slipId, rating = "gc") {
    const lines = await linesOf(slipId)
    return rpc(who, "transmittal_rate", {
        p_transmittal_id: slipId,
        p_line_ratings: lines.map((line) => ({ line_id: line.id, rating, remark: rating === "na" ? "Cracked" : null })),
    })
}

/** Warehouse checking and releasing signed; the slip is now in Technical inspection. */
async function toTechnical(slipId) {
    const rated = await rate("warehouse", slipId)
    if (rated.error) throw new Error(`warehouse rate: ${rated.error.message}`)
    const checking = await rpc("warehouse", "transmittal_complete_stage", {
        p_transmittal_id: slipId,
        p_stage: "warehouse_checking",
        p_other_signer_id: ids.dealOwner,
        p_other_signer_name: null,
        p_remarks: null,
        p_no_pictures_reason: "none",
    })
    if (checking.error) throw new Error(`checking: ${checking.error.message}`)
    const releasing = await rpc("warehouse", "transmittal_complete_stage", {
        p_transmittal_id: slipId,
        p_stage: "warehouse_releasing",
        p_other_signer_id: ids.technical,
        p_other_signer_name: null,
        p_remarks: null,
        p_no_pictures_reason: "none",
    })
    if (releasing.error) throw new Error(`releasing: ${releasing.error.message}`)
    expect(await slipState(slipId)).toBe("technical_inspection")
}

/** Technical inspection signed by the Technical list; the slip is awaiting Check by. */
async function toAwaitingCheck(slipId) {
    await toTechnical(slipId)
    const rated = await rate("technical", slipId)
    if (rated.error) throw new Error(`technical rate: ${rated.error.message}`)
    const signed = await rpc("technical", "transmittal_complete_stage", {
        p_transmittal_id: slipId,
        p_stage: "technical_inspection",
        p_other_signer_id: ids.dealOwner,
        p_other_signer_name: null,
        p_remarks: "Inspected",
        p_no_pictures_reason: "none",
    })
    if (signed.error) throw new Error(`technical stage: ${signed.error.message}`)
    expect(await slipState(slipId)).toBe("awaiting_check")
}

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

describe("Technical inspection refusals, by list and by rule", () => {
    it("refuses a Technical rating from the Warehouse list and from a plain employee", async () => {
        const slip = await submittedSlip(await raiseIpas())
        await toTechnical(slip)

        for (const who of ["warehouse", "ordinary"]) {
            const { error } = await rate(who, slip)
            expect(error, `${who} rated a Technical line`).toBeTruthy()
        }
        expect(await slipState(slip)).toBe("technical_inspection")
    })

    it("refuses an NA without a remark, and an in-charge off the Technical list", async () => {
        const slip = await submittedSlip(await raiseIpas())
        await toTechnical(slip)
        const [line] = await linesOf(slip)

        const noRemark = await rpc("technical", "transmittal_rate", {
            p_transmittal_id: slip,
            p_line_ratings: [{ line_id: line.id, rating: "na", remark: " " }],
        })
        expect(noRemark.error).toBeTruthy()

        const offList = await rpc("technical", "transmittal_rate", {
            p_transmittal_id: slip,
            p_line_ratings: [{ line_id: line.id, rating: "gc", in_charge_id: ids.warehouse }],
        })
        expect(offList.error).toBeTruthy()
    })

    it("refuses completing Technical inspection with an unrated line, with no picture and no reason, and from off the list", async () => {
        const slip = await submittedSlip(await raiseIpas())
        await toTechnical(slip)
        const complete = (who, patch = {}) =>
            rpc(who, "transmittal_complete_stage", {
                p_transmittal_id: slip,
                p_stage: "technical_inspection",
                p_other_signer_id: ids.dealOwner,
                p_other_signer_name: null,
                p_remarks: null,
                p_no_pictures_reason: "none",
                ...patch,
            })

        const unrated = await complete("technical")
        expect(unrated.error?.message ?? "").toMatch(/still need a GC or NA rating from Technical/)

        await rate("technical", slip)
        const noReason = await complete("technical", { p_no_pictures_reason: null })
        expect(noReason.error?.message ?? "").toMatch(/picture or video, or give the reason none/)

        for (const who of ["warehouse", "ordinary"]) {
            const { error } = await complete(who)
            expect(error, `${who} signed Technical inspection`).toBeTruthy()
        }
        expect(await slipState(slip)).toBe("technical_inspection")
    })
})

describe("Technical inspection: signing as either signatory, and the quantity received (review of #251)", () => {
    it("records Technical's quantity received on a slip with no Warehouse checking", async () => {
        const slipId = await submittedSlip(await raiseIpas(), { check_warehouse: false })
        expect(await slipState(slipId)).toBe("technical_inspection")
        const [line] = await linesOf(slipId)
        const { error } = await rpc("technical", "transmittal_rate", {
            p_transmittal_id: slipId,
            p_line_ratings: [{ line_id: line.id, rating: "gc", remark: null, quantity_received: 4 }],
        })
        expect(error).toBeNull()
        expect(Number((await linesOf(slipId))[0].quantity_received)).toBe(4)
    })

    it("lets the completer sign as Inspected by; the named Received by confirms the first slot", async () => {
        const slipId = await submittedSlip(await raiseIpas())
        await toTechnical(slipId)
        expect((await rate("technical", slipId)).error).toBeNull()
        const signed = await rpc("technical", "transmittal_complete_stage", {
            p_transmittal_id: slipId,
            p_stage: "technical_inspection",
            p_other_signer_id: ids.dealOwner,
            p_other_signer_name: null,
            p_remarks: null,
            p_no_pictures_reason: "none",
            p_sign_as_second: true,
        })
        expect(signed.error).toBeNull()
        const stageRow = async () =>
            (await svc().from("transmittal_stages").select("*").eq("transmittal_id", slipId).eq("stage", "technical_inspection").single()).data
        expect(await stageRow()).toMatchObject({
            first_signer_id: ids.dealOwner,
            first_confirmed: false,
            second_signer_id: ids.technical,
            second_confirmed: true,
        })

        const stageId = (await stageRow()).id
        const byCompleter = await rpc("technical", "transmittal_confirm_signature", { p_stage_id: stageId, p_confirm: false })
        expect(byCompleter.error?.message).toMatch(/only the co-signer/)
        const confirmed = await rpc("dealOwner", "transmittal_confirm_signature", { p_stage_id: stageId, p_confirm: true })
        expect(confirmed.error).toBeNull()
        expect(await stageRow()).toMatchObject({ first_confirmed: true, second_confirmed: true })
    })

    it("refuses signing releasing as Received by", async () => {
        const slipId = await submittedSlip(await raiseIpas())
        expect((await rate("warehouse", slipId)).error).toBeNull()
        const checking = await rpc("warehouse", "transmittal_complete_stage", {
            p_transmittal_id: slipId,
            p_stage: "warehouse_checking",
            p_other_signer_id: ids.dealOwner,
            p_other_signer_name: null,
            p_remarks: null,
            p_no_pictures_reason: "none",
        })
        expect(checking.error).toBeNull()
        const { error } = await rpc("warehouse", "transmittal_complete_stage", {
            p_transmittal_id: slipId,
            p_stage: "warehouse_releasing",
            p_other_signer_id: ids.technical,
            p_other_signer_name: null,
            p_remarks: null,
            p_no_pictures_reason: "none",
            p_sign_as_second: true,
        })
        expect(error?.message).toMatch(/Released by/)
    })
})

describe("Check by refusals, in both directions", () => {
    it("refuses Check by before every required stage is done", async () => {
        const slip = await submittedSlip(await raiseIpas())
        await toTechnical(slip)
        const { error } = await rpc("checkByTwo", "transmittal_check", { p_transmittal_id: slip, p_slot: 1 })
        expect(error).toBeTruthy()
        expect(await slipState(slip)).toBe("technical_inspection")
    })

    it("refuses the preparer, a Super Admin off the list, a plain employee, and the same person in both slots", async () => {
        const slip = await submittedSlip(await raiseIpas())
        await toAwaitingCheck(slip)
        await rpc("warehouse", "transmittal_received_in_odoo", { p_transmittal_id: slip, p_ref: "WH/IN/CHK-1" })

        for (const who of ["warehouse", "superAdmin", "ordinary"]) {
            const { error } = await rpc(who, "transmittal_check", { p_transmittal_id: slip, p_slot: 1 })
            expect(error, `${who} checked the slip`).toBeTruthy()
        }

        const first = await rpc("checkByTwo", "transmittal_check", { p_transmittal_id: slip, p_slot: 1 })
        expect(first.error).toBeNull()
        const same = await rpc("checkByTwo", "transmittal_check", { p_transmittal_id: slip, p_slot: 2 })
        expect(same.error, "the same person signed both slots").toBeTruthy()
        expect(await slipState(slip)).toBe("awaiting_check")
    })

    it("refuses a PO slip with no Received in Odoo by, and accepts it once recorded", async () => {
        const slip = await submittedSlip(await raiseIpas())
        await toAwaitingCheck(slip)

        const early = await rpc("checkByTwo", "transmittal_check", { p_transmittal_id: slip, p_slot: 1 })
        expect(early.error?.message ?? "").toMatch(/record Received in Odoo first/)

        await rpc("warehouse", "transmittal_received_in_odoo", { p_transmittal_id: slip, p_ref: "WH/IN/CHK-2" })
        const ok = await rpc("checkByTwo", "transmittal_check", { p_transmittal_id: slip, p_slot: 1 })
        expect(ok.error).toBeNull()
    })
})

describe("the second Check by closes the slip, and a closed slip is frozen for everyone", () => {
    it("closes on the second signature, and refuses change from the service role", async () => {
        const slip = await submittedSlip(await raiseIpas())
        await toAwaitingCheck(slip)
        await rpc("warehouse", "transmittal_received_in_odoo", { p_transmittal_id: slip, p_ref: "WH/IN/CHK-3" })
        expect((await rpc("checkByTwo", "transmittal_check", { p_transmittal_id: slip, p_slot: 1 })).error).toBeNull()

        const closing = await rpc("dealOwner", "transmittal_check", { p_transmittal_id: slip, p_slot: 2 })
        expect(closing.error).toBeNull()
        expect(await slipState(slip)).toBe("closed")

        const [line] = await linesOf(slip)
        const rating = await svc().from("transmittal_lines").update({ tech_rating: "na", tech_remark: "late" }).eq("id", line.id)
        expect(rating.error, "a closed slip's line changed").toBeTruthy()

        const header = await svc().from("transmittals").update({ priority: "low" }).eq("id", slip)
        expect(header.error, "a closed slip's header changed").toBeTruthy()

        const again = await rpc("checkByTwo", "transmittal_check", { p_transmittal_id: slip, p_slot: 1 })
        expect(again.error).toBeTruthy()
    })

    it("lets a Check by signer decline and re-apply their stored signature, even once closed; nobody else", async () => {
        const slip = await submittedSlip(await raiseIpas())
        await toAwaitingCheck(slip)
        await rpc("warehouse", "transmittal_received_in_odoo", { p_transmittal_id: slip, p_ref: "WH/IN/CHK-4" })
        expect((await rpc("checkByTwo", "transmittal_check", { p_transmittal_id: slip, p_slot: 1 })).error).toBeNull()
        expect((await rpc("dealOwner", "transmittal_check", { p_transmittal_id: slip, p_slot: 2 })).error).toBeNull()
        expect(await slipState(slip)).toBe("closed")

        const declined = async () =>
            (await svc().from("transmittals").select("check_by_first_signature_declined, check_by_second_signature_declined").eq("id", slip).single()).data

        const byOther = await rpc("dealOwner", "transmittal_check_signature", { p_transmittal_id: slip, p_slot: 1, p_decline: true })
        expect(byOther.error?.message).toMatch(/only the person who signed/)

        expect((await rpc("checkByTwo", "transmittal_check_signature", { p_transmittal_id: slip, p_slot: 1, p_decline: true })).error).toBeNull()
        expect(await declined()).toEqual({ check_by_first_signature_declined: true, check_by_second_signature_declined: false })

        expect((await rpc("checkByTwo", "transmittal_check_signature", { p_transmittal_id: slip, p_slot: 1, p_decline: false })).error).toBeNull()
        expect((await declined()).check_by_first_signature_declined).toBe(false)

        const header = await svc().from("transmittals").update({ priority: "low", check_by_second_signature_declined: true }).eq("id", slip)
        expect(header.error, "a decline smuggled a header change past the freeze").toBeTruthy()
    })
})
