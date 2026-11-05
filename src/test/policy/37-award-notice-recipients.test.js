/**
 * #890: who the "SOR Awarded" notice goes to.
 *
 *   - The Buyers of the SOR's Purchase Requests, and nobody else on Purchasing.
 *   - With no Buyer on any request, the Purchasing heads (is_head AND
 *     has_purchasing_flow). A head without the Purchasing flow is not one.
 *   - A soft-deleted Buyer never counts.
 *   - Only a signed-in employee may ask.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, anonymousClient, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { makeSor } from "./support/rows.js"

let sorWithBuyer, sorWithoutBuyer, sorWithDeletedBuyer
const touched = { ids: [ids.stageParticipant, ids.head, ids.subHead, ids.deleted] }
const originalFlags = {}

const recipients = async (client, opportunityId) =>
    client.rpc("sor_award_notice_recipients", { p_opportunity_id: opportunityId })

async function setFlags(employeeId, patch) {
    const { error } = await serviceClient().from("employees").update(patch).eq("id", employeeId)
    if (error) throw new Error(`Setting employee flags: ${error.message}`)
}

async function addRequest(opportunityId, assignedTo) {
    const { error } = await serviceClient().from("sor_procurement_requests").insert({
        opportunity_id: opportunityId,
        requested_name: "[policy-tier] Rope",
        requested_by: ids.dealOwner,
        assigned_to: assignedTo,
    })
    if (error) throw new Error(`Seeding a Purchase Request: ${error.message}`)
}

beforeAll(async () => {
    await ensureCastLoaded()
    const { data } = await serviceClient()
        .from("employees")
        .select("id, has_purchasing_flow, is_head, is_deleted")
        .in("id", touched.ids)
    for (const row of data) originalFlags[row.id] = row

    // The buyer is a plain employee given the Purchasing flow; the head has it too.
    await setFlags(ids.stageParticipant, { has_purchasing_flow: true })
    await setFlags(ids.head, { has_purchasing_flow: true })
    await setFlags(ids.subHead, { has_purchasing_flow: false })
    await setFlags(ids.deleted, { has_purchasing_flow: true })

    sorWithBuyer = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    sorWithoutBuyer = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    sorWithDeletedBuyer = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    await addRequest(sorWithBuyer, ids.stageParticipant)
    await addRequest(sorWithDeletedBuyer, ids.deleted)
})

afterAll(async () => {
    const svc = serviceClient()
    await svc
        .from("sor_procurement_requests")
        .delete()
        .in("opportunity_id", [sorWithBuyer, sorWithoutBuyer, sorWithDeletedBuyer])
    await svc.from("sales_opportunities").delete().in("id", [sorWithBuyer, sorWithoutBuyer, sorWithDeletedBuyer])
    for (const id of touched.ids) {
        const row = originalFlags[id]
        if (row) {
            await setFlags(id, { has_purchasing_flow: row.has_purchasing_flow })
        }
    }
})

describe("who the SOR Awarded notice goes to", () => {
    it("is the Buyer of the SOR's Purchase Request, and nobody else", async () => {
        const { data, error } = await recipients(await clientFor("ordinary"), sorWithBuyer)
        expect(error).toBeNull()
        expect(data).toEqual([ids.stageParticipant])
    })

    it("falls back to the Purchasing heads when no request has a Buyer yet", async () => {
        const { data, error } = await recipients(await clientFor("ordinary"), sorWithoutBuyer)
        expect(error).toBeNull()
        expect(data).toContain(ids.head)
        expect(data).not.toContain(ids.subHead)
        expect(data).not.toContain(ids.ordinary)
        expect(data).not.toContain(ids.stageParticipant)
    })

    it("does not count a soft-deleted Buyer, so the heads are named instead", async () => {
        const { data, error } = await recipients(await clientFor("ordinary"), sorWithDeletedBuyer)
        expect(error).toBeNull()
        expect(data).not.toContain(ids.deleted)
        expect(data).toContain(ids.head)
    })

    it("refuses a caller who is not signed in", async () => {
        const { error } = await recipients(anonymousClient(), sorWithBuyer)
        expect(error).not.toBeNull()
    })
})
