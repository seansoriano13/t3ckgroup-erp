import { describe, expect, it } from "vitest"
import { sorAwardService } from "./sorAwardService"
import { notificationService } from "./notificationService"
import { makeEmployee, makeOpportunity } from "@/test/factories"

/** #746: filling an SOR's Date of Award tells every Purchasing holder, once each. */
describe("sorAwardService", () => {
  it("notifies every Purchasing holder and nobody else", async () => {
    const buyerA = makeEmployee({ has_purchasing_flow: true })
    const buyerB = makeEmployee({ has_purchasing_flow: true })
    const outsider = makeEmployee({ has_purchasing_flow: false })
    const gone = makeEmployee({ has_purchasing_flow: true, is_deleted: true })
    const sor = makeOpportunity({ sales_reference: "S0-0042", date_of_award: "2026-11-12" })

    await sorAwardService.notifyPurchasing(sor, outsider.id)

    for (const buyer of [buyerA, buyerB]) {
      const mine = await notificationService.getMyNotifications(buyer.id)
      expect(mine).toHaveLength(1)
      expect(mine[0]).toMatchObject({ type: "SOR_AWARDED", reference_id: sor.id })
      expect(mine[0].message).toContain("S0-0042")
    }
    expect(await notificationService.getMyNotifications(outsider.id)).toEqual([])
    expect(await notificationService.getMyNotifications(gone.id)).toEqual([])
  })

  it("sends nothing when the SOR has no Date of Award", async () => {
    const buyer = makeEmployee({ has_purchasing_flow: true })
    const sor = makeOpportunity({ date_of_award: null })

    await sorAwardService.notifyPurchasing(sor)

    expect(await notificationService.getMyNotifications(buyer.id)).toEqual([])
  })

  it("maps SOR ids to their Date of Award, leaving out SORs without one", async () => {
    const awarded = makeOpportunity({ date_of_award: "2026-11-12" })
    const open = makeOpportunity({ date_of_award: null })

    const map = await sorAwardService.forSors([awarded.id, open.id])

    expect(map.get(awarded.id)).toBe("2026-11-12")
    expect(map.has(open.id)).toBe(false)
  })
})
