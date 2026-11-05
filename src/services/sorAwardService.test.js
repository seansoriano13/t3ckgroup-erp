import { describe, expect, it } from "vitest"
import { sorAwardService } from "./sorAwardService"
import { notificationService } from "./notificationService"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { stubRpc } from "@/test/msw/server"

/**
 * #746 / #890: filling an SOR's Date of Award tells the people buying for it.
 * Who those are is decided by sor_award_notice_recipients (a policy test proves
 * the rule against Postgres); here the RPC is stubbed and we check the wiring.
 */
describe("sorAwardService", () => {
  it("notifies exactly the recipients the database names, nobody else", async () => {
    const buyer = makeEmployee({ has_purchasing_flow: true })
    const otherPurchaser = makeEmployee({ has_purchasing_flow: true })
    const outsider = makeEmployee({ has_purchasing_flow: false })
    const sor = makeOpportunity({ sales_reference: "S0-0042", date_of_award: "2026-11-12" })
    stubRpc("sor_award_notice_recipients", [buyer.id])

    await sorAwardService.notifyPurchasing(sor, outsider.id)

    const mine = await notificationService.getMyNotifications(buyer.id)
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ type: "SOR_AWARDED", reference_id: sor.id })
    expect(mine[0].message).toContain("S0-0042")
    expect(await notificationService.getMyNotifications(otherPurchaser.id)).toEqual([])
    expect(await notificationService.getMyNotifications(outsider.id)).toEqual([])
  })

  it("sends nothing when the database names no recipients", async () => {
    const purchaser = makeEmployee({ has_purchasing_flow: true })
    const sor = makeOpportunity({ date_of_award: "2026-11-12" })
    stubRpc("sor_award_notice_recipients", [])

    await sorAwardService.notifyPurchasing(sor)

    expect(await notificationService.getMyNotifications(purchaser.id)).toEqual([])
  })

  it("sends nothing when the SOR has no Date of Award", async () => {
    const buyer = makeEmployee({ has_purchasing_flow: true })
    const sor = makeOpportunity({ date_of_award: null })
    stubRpc("sor_award_notice_recipients", [buyer.id])

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
