/**
 * Packing Lists (#255, spec #251): who makes one, the packed freeze, and who
 * reads one, against the real database. Builds on 68 to 71 (the same cast).
 *
 * `outsider` holds Purchasing access. `warehouse` is on the Warehouse list with
 * no flags, so the create rule is proven in both directions: a Warehouse-list
 * member makes a list, and `ordinary` (neither) is refused. `dealOwner` owns the
 * SOR, so reads through the SOR are proven against `ordinary`, who does not.
 *
 * The freeze is proven against the service role, which bypasses row level
 * security but not a trigger.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { canRead } from "./support/access.js"
import { makeSor } from "./support/rows.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

async function makeList(who, opportunityId) {
    const { data, error } = await rpc(who, "packing_list_create", { p_opportunity_id: opportunityId, p_odoo_delivery_ref: null })
    if (error) throw new Error(`packing_list_create: ${error.message}`)
    return data
}

async function addBox(who, listId, marks = "A") {
    const { data, error } = await rpc(who, "packing_list_add_box", { p_packing_list_id: listId, p_marks: marks, p_seal_no: null, p_gross_weight_kg: null })
    if (error) throw new Error(`packing_list_add_box: ${error.message}`)
    return data
}

async function setContents(who, boxId, contents) {
    return rpc(who, "packing_list_set_contents", { p_box_id: boxId, p_contents: contents })
}

async function listState(listId) {
    const { data, error } = await svc().from("packing_lists").select("state").eq("id", listId).single()
    if (error) throw error
    return data.state
}

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
    const { error } = await svc()
        .from("ipas_signer_lists")
        .upsert({ list_key: "transmittal_warehouse", employee_id: ids.warehouse }, { onConflict: "list_key,employee_id" })
    if (error) throw new Error(`Seeding the Warehouse list: ${error.message}`)
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
})

describe("who makes a Packing List", () => {
    it("lets a Warehouse-list member with no flags make one, and refuses an employee with neither access nor the list", async () => {
        const sor = await makeSor({ registeredBy: ids.outsider, dealOwnerId: ids.dealOwner })

        const made = await makeList("warehouse", sor)
        expect(made.number).toMatch(/^PKL_\d+$/)

        const refused = await rpc("ordinary", "packing_list_create", { p_opportunity_id: sor, p_odoo_delivery_ref: null })
        expect(refused.error, "an employee with neither access nor the list made a Packing List").toBeTruthy()
    })

    it("lets Purchasing make one too", async () => {
        const sor = await makeSor({ registeredBy: ids.outsider, dealOwnerId: ids.dealOwner })
        const made = await rpc("outsider", "packing_list_create", { p_opportunity_id: sor, p_odoo_delivery_ref: null })
        expect(made.error).toBeNull()
    })
})

describe("a packed Packing List is frozen for everyone, the service role included", () => {
    it("refuses packing with no box, or with a box that has no contents, then packs and freezes", async () => {
        const sor = await makeSor({ registeredBy: ids.outsider, dealOwnerId: ids.dealOwner })
        const made = await makeList("warehouse", sor)

        const none = await rpc("warehouse", "packing_list_pack", { p_packing_list_id: made.id })
        expect(none.error?.message ?? "").toMatch(/has no boxes/)

        const box = await addBox("warehouse", made.id, "C")
        const empty = await rpc("warehouse", "packing_list_pack", { p_packing_list_id: made.id })
        expect(empty.error?.message ?? "").toMatch(/box\(es\) with no contents/)

        const filled = await setContents("warehouse", box.id, [{ description: "Cable", quantity: 3, unit: "m" }])
        expect(filled.error).toBeNull()

        const packed = await rpc("warehouse", "packing_list_pack", { p_packing_list_id: made.id })
        expect(packed.error).toBeNull()
        expect(await listState(made.id)).toBe("packed")

        const lateBox = await addBox("warehouse", made.id, "D").catch((e) => e)
        expect(lateBox.error ?? lateBox.message).toBeTruthy()

        const header = await svc().from("packing_lists").update({ odoo_delivery_ref: "changed" }).eq("id", made.id)
        expect(header.error, "a packed list's header changed").toBeTruthy()

        const boxRow = await svc().from("packing_list_boxes").update({ marks: "changed" }).eq("id", box.id)
        expect(boxRow.error, "a packed list's box changed").toBeTruthy()

        const contents = await svc().from("packing_list_contents").insert({ box_id: box.id, description: "late", quantity: 1, unit: "pc" })
        expect(contents.error, "a packed list's contents changed").toBeTruthy()
    })
})

describe("who reads a Packing List", () => {
    it("lets the SOR's deal owner read it, and refuses an employee who cannot read the SOR", async () => {
        const sor = await makeSor({ registeredBy: ids.outsider, dealOwnerId: ids.dealOwner })
        const made = await makeList("warehouse", sor)

        expect(await canRead(await clientFor("dealOwner"), "packing_lists", made.id)).toBe(true)
        expect(await canRead(await clientFor("ordinary"), "packing_lists", made.id)).toBe(false)
    })
})
