/**
 * #890 (spec #907, decision 6): who the "SOR Awarded" notice goes to.
 *
 *   - The Buyer of the SOR's Purchase Request, the SOR's Purchasing Incharge
 *     (costing matrix) and the request's purchasing members.
 *   - With no Buyer on any request, the Purchasing heads (is_head AND
 *     has_purchasing_flow). A head without the Purchasing flow is not one.
 *   - A soft-deleted person never counts.
 *   - Only a signed-in employee may ask.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, anonymousClient, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { makeSor } from "./support/rows.js"
import { purgeCostingForSors } from "./support/costing.js"

let sorBuyerAndMembers, sorHeadsOnly, sorDeletedBuyer
// Filled in beforeAll: `ids` is empty until the cast is loaded.
let touched = []
const originalFlags = {}

const recipients = async (client, opportunityId) =>
    client.rpc("sor_award_notice_recipients", { p_opportunity_id: opportunityId })

async function setFlags(employeeId, patch) {
    const { error } = await serviceClient().from("employees").update(patch).eq("id", employeeId)
    if (error) throw new Error(`Setting employee flags: ${error.message}`)
}

/** One Purchase Request per SOR (unique on opportunity_id). */
async function addRequest(opportunityId, buyerId) {
    const { data, error } = await serviceClient()
        .from("purchase_requests")
        .insert({ opportunity_id: opportunityId, buyer_id: buyerId, created_by: ids.dealOwner })
        .select("id")
        .single()
    if (error) throw new Error(`Seeding a Purchase Request: ${error.message}`)
    return data.id
}

beforeAll(async () => {
    await ensureCastLoaded()
    touched = [ids.stageParticipant, ids.head, ids.subHead, ids.deleted, ids.ordinary]
    const { data, error: readError } = await serviceClient()
        .from("employees")
        .select("id, has_purchasing_flow")
        .in("id", touched)
    if (readError) throw new Error(`Reading employee flags: ${readError.message}`)
    for (const row of data) originalFlags[row.id] = row.has_purchasing_flow

    // The buyer, the head and the deleted person have the Purchasing flow; the
    // sub-head is a head without it.
    await setFlags(ids.stageParticipant, { has_purchasing_flow: true })
    await setFlags(ids.head, { has_purchasing_flow: true })
    await setFlags(ids.subHead, { has_purchasing_flow: false })
    await setFlags(ids.deleted, { has_purchasing_flow: true })
    await setFlags(ids.ordinary, { has_purchasing_flow: true })

    sorBuyerAndMembers = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    sorHeadsOnly = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    sorDeletedBuyer = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })

    const requestId = await addRequest(sorBuyerAndMembers, ids.stageParticipant)
    const { error: memberError } = await serviceClient().from("purchase_request_members").insert({
        request_id: requestId,
        employee_id: ids.ordinary,
        side: "purchasing",
    })
    if (memberError) throw new Error(`Seeding a request member: ${memberError.message}`)
    // A Purchasing Incharge must have Purchasing access to be named (costing_incharge
    // check). The sub-head gets the flag only for this insert, then loses it again so
    // the heads fallback still treats them as a head without the Purchasing flow.
    await setFlags(ids.subHead, { has_purchasing_flow: true })
    const { error: matrixError } = await serviceClient().from("costing_matrices").insert({
        opportunity_id: sorBuyerAndMembers,
        purchasing_incharge_id: ids.subHead,
    })
    await setFlags(ids.subHead, { has_purchasing_flow: false })
    if (matrixError) throw new Error(`Seeding a costing matrix: ${matrixError.message}`)

    await addRequest(sorDeletedBuyer, ids.deleted)
})

afterAll(async () => {
    const svc = serviceClient()
    const sors = [sorBuyerAndMembers, sorHeadsOnly, sorDeletedBuyer]
    // Costing history is append-only, so a plain delete of the matrix is refused.
    await purgeCostingForSors(sors)
    await svc.from("purchase_requests").delete().in("opportunity_id", sors)
    await svc.from("sales_opportunities").delete().in("id", sors)
    for (const id of touched) {
        if (originalFlags[id] !== undefined) {
            await setFlags(id, { has_purchasing_flow: originalFlags[id] })
        }
    }
})

describe("who the SOR Awarded notice goes to", () => {
    it("is the Buyer, the Purchasing Incharge and the purchasing members, and nobody else", async () => {
        const { data, error } = await recipients(await clientFor("ordinary"), sorBuyerAndMembers)
        expect(error).toBeNull()
        expect([...data].sort()).toEqual([ids.stageParticipant, ids.subHead, ids.ordinary].sort())
        expect(data).not.toContain(ids.head)
    })

    it("falls back to the Purchasing heads when the SOR has no Buyer", async () => {
        const { data, error } = await recipients(await clientFor("ordinary"), sorHeadsOnly)
        expect(error).toBeNull()
        expect(data).toEqual([ids.head])
    })

    it("does not count a soft-deleted Buyer, so the heads are named instead", async () => {
        const { data, error } = await recipients(await clientFor("ordinary"), sorDeletedBuyer)
        expect(error).toBeNull()
        expect(data).not.toContain(ids.deleted)
        expect(data).toContain(ids.head)
    })

    it("refuses a caller who is not signed in", async () => {
        const { error } = await recipients(anonymousClient(), sorBuyerAndMembers)
        expect(error).not.toBeNull()
    })
})
