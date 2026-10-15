/**
 * Transmittals (TG03, #253, spec #251): the Warehouse's checking, releasing,
 * co-signer confirmation, Received in Odoo and the evidence bucket, against the
 * real database. Builds on 68 (the tracer bullet) and its helpers.
 *
 * `warehouse` is on the Warehouse list. `dealOwner` is seeded onto it here as a
 * second Warehouse member (the co-signer), and taken off again in afterAll.
 * `technical` is on the Technical list. `ordinary` is a plain employee, refused
 * everything Warehouse.
 *
 * Refusals are proven as the signed-in employee. The freezes are proven against
 * the service role, which bypasses row level security but not a trigger.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { canRead } from "./support/access.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

let poSeq = 0
const nextPo = () => `P8${String(20000 + (poSeq += 1)).padStart(6, "0")}`

const odooCopy = (po) => ({
    po: { id: 991000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: { id: 553, name: "Scorpe Technologies", contact: null },
    lines: [
        { line_id: 941000 + poSeq * 10, product_id: 5350, name: "Cutter", quantity: 6, unit: "Unit", price_unit: 1250, price_subtotal: 7500, taxes: [], analytic: [], brand: "SCORPE" },
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
const WAREHOUSE_ONLY = { ...HEADER, check_technical: false }

/** A submitted slip (as the warehouse member), with one PO line. Returns its id. */
async function submittedSlip(ipas, header = HEADER) {
    const { data: made, error } = await rpc("warehouse", "transmittal_create", {
        p_fields: header,
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

async function stageOf(slipId, stage) {
    const { data, error } = await svc().from("transmittal_stages").select("*").eq("transmittal_id", slipId).eq("stage", stage).maybeSingle()
    if (error) throw error
    return data
}

async function slipState(slipId) {
    const { data, error } = await svc().from("transmittals").select("state").eq("id", slipId).single()
    if (error) throw error
    return data.state
}

async function rateAll(slipId, who = "warehouse", rating = "gc") {
    const lines = await linesOf(slipId)
    const { error } = await rpc(who, "transmittal_rate", {
        p_transmittal_id: slipId,
        p_line_ratings: lines.map((line) => ({ line_id: line.id, rating, remark: rating === "na" ? "Dented" : null })),
    })
    if (error) throw new Error(`transmittal_rate: ${error.message}`)
}

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
    const lists = [
        ["warehouse", "transmittal_warehouse"],
        ["dealOwner", "transmittal_warehouse"],
        ["technical", "transmittal_technical"],
        ["checkByTwo", "transmittal_check_by"],
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
    await svc()
        .from("ipas_signer_lists")
        .delete()
        .eq("list_key", "transmittal_warehouse")
        .eq("employee_id", ids.dealOwner)
})

describe("who rates and signs the Warehouse stages", () => {
    it("refuses a rating from a plain employee and from the Technical list", async () => {
        const ipas = await raiseIpas()
        const slip = await submittedSlip(ipas)

        for (const who of ["ordinary", "technical"]) {
            const { error } = await rpc(who, "transmittal_rate", {
                p_transmittal_id: slip,
                p_line_ratings: [{ line_id: (await linesOf(slip))[0].id, rating: "gc" }],
            })
            expect(error, `${who} rated a Warehouse line`).toBeTruthy()
        }
    })

    it("refuses an NA without a remark, and an in-charge off the Warehouse list", async () => {
        const ipas = await raiseIpas()
        const slip = await submittedSlip(ipas)
        const [line] = await linesOf(slip)

        const noRemark = await rpc("warehouse", "transmittal_rate", {
            p_transmittal_id: slip,
            p_line_ratings: [{ line_id: line.id, rating: "na", remark: " " }],
        })
        expect(noRemark.error).toBeTruthy()

        const offList = await rpc("warehouse", "transmittal_rate", {
            p_transmittal_id: slip,
            p_line_ratings: [{ line_id: line.id, rating: "gc", in_charge_id: ids.technical }],
        })
        expect(offList.error).toBeTruthy()
    })

    it("refuses checking with an unrated line, with no picture and no reason, and with a co-signer off the list", async () => {
        const ipas = await raiseIpas()
        const slip = await submittedSlip(ipas)
        const checking = (await stageOf(slip, "warehouse_checking")).id

        const unrated = await rpc("warehouse", "transmittal_complete_stage", {
            p_transmittal_id: slip,
            p_stage: "warehouse_checking",
            p_other_signer_id: ids.dealOwner,
            p_other_signer_name: null,
            p_remarks: null,
            p_no_pictures_reason: "none",
        })
        expect(unrated.error?.message ?? "").toMatch(/still need a GC or NA rating/)

        await rateAll(slip)
        const noReason = await rpc("warehouse", "transmittal_complete_stage", {
            p_transmittal_id: slip,
            p_stage: "warehouse_checking",
            p_other_signer_id: ids.dealOwner,
            p_other_signer_name: null,
            p_remarks: null,
            p_no_pictures_reason: null,
        })
        expect(noReason.error?.message ?? "").toMatch(/picture or video, or give the reason none/)

        const offList = await rpc("warehouse", "transmittal_complete_stage", {
            p_transmittal_id: slip,
            p_stage: "warehouse_checking",
            p_other_signer_id: ids.technical,
            p_other_signer_name: null,
            p_remarks: null,
            p_no_pictures_reason: "none",
        })
        expect(offList.error).toBeTruthy()

        expect((await stageOf(slip, "warehouse_checking")).id).toBe(checking)
        expect(await slipState(slip)).toBe("warehouse_checking")
    })

    it("refuses a stage signature from a plain employee", async () => {
        const ipas = await raiseIpas()
        const slip = await submittedSlip(ipas)
        const { error } = await rpc("ordinary", "transmittal_complete_stage", {
            p_transmittal_id: slip,
            p_stage: "warehouse_checking",
            p_other_signer_id: ids.warehouse,
            p_other_signer_name: null,
            p_remarks: null,
            p_no_pictures_reason: "none",
        })
        expect(error).toBeTruthy()
    })
})

describe("releasing's Received by follows the Technical list on a Technical slip", () => {
    it("refuses a Received by off the Technical list, then opens Technical inspection", async () => {
        const ipas = await raiseIpas()
        const slip = await submittedSlip(ipas)
        await rateAll(slip)
        const done = await rpc("warehouse", "transmittal_complete_stage", {
            p_transmittal_id: slip,
            p_stage: "warehouse_checking",
            p_other_signer_id: ids.dealOwner,
            p_other_signer_name: null,
            p_remarks: null,
            p_no_pictures_reason: "none",
        })
        expect(done.error).toBeNull()
        expect(await slipState(slip)).toBe("warehouse_releasing")

        const offList = await rpc("warehouse", "transmittal_complete_stage", {
            p_transmittal_id: slip,
            p_stage: "warehouse_releasing",
            p_other_signer_id: ids.dealOwner,
            p_other_signer_name: null,
            p_remarks: null,
            p_no_pictures_reason: null,
        })
        expect(offList.error).toBeTruthy()

        const onList = await rpc("warehouse", "transmittal_complete_stage", {
            p_transmittal_id: slip,
            p_stage: "warehouse_releasing",
            p_other_signer_id: ids.technical,
            p_other_signer_name: null,
            p_remarks: null,
            p_no_pictures_reason: null,
        })
        expect(onList.error).toBeNull()
        expect(await slipState(slip)).toBe("technical_inspection")
    })

    it("lets releasing on a Warehouse-only slip be signed, with a typed receiver, before close", async () => {
        const ipas = await raiseIpas()
        const slip = await submittedSlip(ipas, WAREHOUSE_ONLY)
        await rateAll(slip)
        await rpc("warehouse", "transmittal_complete_stage", {
            p_transmittal_id: slip,
            p_stage: "warehouse_checking",
            p_other_signer_id: ids.dealOwner,
            p_other_signer_name: null,
            p_remarks: null,
            p_no_pictures_reason: "none",
        })
        expect(await slipState(slip)).toBe("awaiting_check")

        const { error } = await rpc("warehouse", "transmittal_complete_stage", {
            p_transmittal_id: slip,
            p_stage: "warehouse_releasing",
            p_other_signer_id: null,
            p_other_signer_name: "Typed Receiver",
            p_remarks: null,
            p_no_pictures_reason: null,
        })
        expect(error).toBeNull()
        expect((await stageOf(slip, "warehouse_releasing")).second_signer_name).toBe("Typed Receiver")
        expect(await slipState(slip)).toBe("awaiting_check")
    })
})

describe("a signed stage is frozen for everyone, the service role included", () => {
    it("refuses ratings, remarks and new files on a signed checking stage; the co-signer may still confirm", async () => {
        const ipas = await raiseIpas()
        const slip = await submittedSlip(ipas, WAREHOUSE_ONLY)
        await rateAll(slip)
        await rpc("warehouse", "transmittal_complete_stage", {
            p_transmittal_id: slip,
            p_stage: "warehouse_checking",
            p_other_signer_id: ids.dealOwner,
            p_other_signer_name: null,
            p_remarks: "Looks fine",
            p_no_pictures_reason: "none",
        })
        const [line] = await linesOf(slip)
        const stage = await stageOf(slip, "warehouse_checking")

        const rating = await svc().from("transmittal_lines").update({ wh_rating: "na", wh_remark: "late" }).eq("id", line.id)
        expect(rating.error, "a signed checking stage's rating changed").toBeTruthy()

        const remarks = await svc().from("transmittal_stages").update({ remarks: "rewritten" }).eq("id", stage.id)
        expect(remarks.error, "a signed stage's remarks changed").toBeTruthy()

        const file = await svc()
            .from("pms_evidence")
            .insert({
                record_type: "transmittal_stage",
                record_id: stage.id,
                transmittal_id: slip,
                kind: "picture",
                storage_path: `${slip}/${stage.id}/late.png`,
                file_name: "late.png",
                size_bytes: 10,
            })
        expect(file.error, "a file was added to a signed stage").toBeTruthy()

        const notCosigner = await rpc("warehouse", "transmittal_confirm_signature", { p_stage_id: stage.id, p_confirm: true })
        expect(notCosigner.error).toBeTruthy()

        const cosigner = await rpc("dealOwner", "transmittal_confirm_signature", { p_stage_id: stage.id, p_confirm: true })
        expect(cosigner.error).toBeNull()
        expect((await stageOf(slip, "warehouse_checking")).second_confirmed).toBe(true)
    })
})

describe("Received in Odoo", () => {
    it("is recorded by the Warehouse list or Purchasing, once, from submission until close", async () => {
        const ipas = await raiseIpas()
        const slip = await submittedSlip(ipas)

        const outsiderTry = await rpc("ordinary", "transmittal_received_in_odoo", { p_transmittal_id: slip, p_ref: "WH/IN/1" })
        expect(outsiderTry.error).toBeTruthy()

        const ok = await rpc("warehouse", "transmittal_received_in_odoo", { p_transmittal_id: slip, p_ref: "WH/IN/01234" })
        expect(ok.error).toBeNull()
        const row = await svc().from("transmittals").select("odoo_received_by, odoo_received_at, odoo_receipt_ref").eq("id", slip).single()
        expect(row.data).toMatchObject({ odoo_received_by: ids.warehouse, odoo_receipt_ref: "WH/IN/01234" })
        expect(row.data.odoo_received_at).toBeTruthy()

        const again = await rpc("warehouse", "transmittal_received_in_odoo", { p_transmittal_id: slip, p_ref: "again" })
        expect(again.error).toBeTruthy()
    })
})

describe("pictures and videos are readable by the Transmittal's readers and refused to anyone else", () => {
    it("reads a stage's file as a reader of the slip, and refuses it to an ordinary employee", async () => {
        const ipas = await raiseIpas()
        const slip = await submittedSlip(ipas, WAREHOUSE_ONLY)
        const stage = await stageOf(slip, "warehouse_checking")
        const path = `${slip}/${stage.id}/${crypto.randomUUID()}-dent.png`
        const bytes = new Blob(["png"], { type: "image/png" })

        const upload = await (await clientFor("warehouse")).storage.from("pms-evidence").upload(path, bytes, { contentType: "image/png" })
        expect(upload.error).toBeNull()
        const attach = await rpc("warehouse", "transmittal_attach_evidence", {
            p_stage_id: stage.id,
            p_kind: "picture",
            p_path: path,
            p_file_name: "dent.png",
            p_mime: "image/png",
            p_size: 3,
        })
        expect(attach.error).toBeNull()

        const technicalRead = await (await clientFor("technical")).storage.from("pms-evidence").download(path)
        expect(technicalRead.error).toBeNull()

        const plainRead = await (await clientFor("ordinary")).storage.from("pms-evidence").download(path)
        expect(plainRead.error, "an ordinary employee read a Transmittal's file").toBeTruthy()
    })

    it("names the Warehouse list on a staff list for a picker, to a reader of the slip only", async () => {
        const ipas = await raiseIpas()
        const slip = await submittedSlip(ipas)
        expect(await canRead(await clientFor("technical"), "transmittals", slip)).toBe(true)
        const { data, error } = await rpc("technical", "transmittal_stage_list_members", {
            p_transmittal_id: slip,
            p_list_key: "transmittal_warehouse",
        })
        expect(error).toBeNull()
        expect(data.map((m) => m.id)).toEqual(expect.arrayContaining([ids.warehouse, ids.dealOwner]))
    })
})
