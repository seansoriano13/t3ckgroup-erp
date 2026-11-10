/**
 * Three supplier slots (#721, ADR 0047): a winner needs Offers plus "No other supplier" slots to
 * number three. A test that is about something else and still has to pick a winner calls
 * `coverSlots` first, which explains whichever of slots 2 and 3 have no Offer, with the service
 * role (the table has no direct write for anyone else).
 */
import { serviceClient } from "./stack.js"

export async function coverSlots(canvassId, reason = "Test: no other supplier") {
    const svc = serviceClient()
    const { data: offers, error } = await svc.from("sor_canvass_offers").select("id").eq("canvass_id", canvassId)
    if (error) throw new Error(`coverSlots offers: ${error.message}`)
    const missing = [2, 3].filter((slot) => offers.length < slot)
    if (missing.length === 0) return
    const { error: markError } = await svc
        .from("sor_canvass_no_other_supplier")
        .upsert(missing.map((slot) => ({ canvass_id: canvassId, slot, reason })), { onConflict: "canvass_id,slot" })
    if (markError) throw new Error(`coverSlots marks: ${markError.message}`)
}
