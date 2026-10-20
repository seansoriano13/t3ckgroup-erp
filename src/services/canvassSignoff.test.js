import { beforeEach, describe, expect, it } from "vitest"

import { canvassService } from "./canvassService"
import { db } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { seedCanvass, stubCanvassMoneyRpc, stubCanvassSignoffRpcs, stubCanvassWinnerRpcs } from "@/test/stubs/canvassRpc"
import { CANVASS_NOTIFICATION } from "@/constants/canvass"

/**
 * Canvass sign-off (#279): the approver signs with two Offers and the count is recorded; any later
 * change to the Offers, a price, the winner or the reason unsigns it with a reason; the list is
 * told when a Canvass is ready. Through canvassService on the fake PostgREST, with the three
 * sign-off RPCs re-implemented on its store and the clearing triggers mirrored
 * (src/test/db/triggers.js). Who may sign, and the refusals, are the policy tier's
 * (92-canvass-signoff.test.js).
 */
describe("signing a Canvass off", () => {
  let purchaser
  let approver
  let canvass
  let redleaf
  let ferno

  const stored = () => db.rows("sor_canvasses").find((c) => c.id === canvass.id)

  beforeEach(async () => {
    stubCanvassMoneyRpc({ money: true })
    purchaser = makeEmployee({ name: "Marco Dizon", has_purchasing_flow: true })
    approver = makeEmployee({ name: "Ana Reyes" })
    const deal = makeOpportunity({ registered_by: purchaser.id, sales_reference: "S07983" })
    const matrix = db.seed("costing_matrices", { opportunity_id: deal.id })
    const line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1 })
    const component = db.seed("costing_components", { tender_line_id: line.id, position: 1, name: "Ambulance Folding Stretcher" })
    stubCanvassWinnerRpcs({ bands: ["purchasing"] })
    stubCanvassSignoffRpcs({ actorId: approver.id, approverIds: [approver.id] })

    canvass = await seedCanvass({ componentId: component.id }, purchaser.id)
    redleaf = await canvassService.addOffer(canvass.id, { supplierName: "Redleaf Inc.", brand: "Redleaf", unitPrice: 78000 }, purchaser.id)
    ferno = await canvassService.addOffer(canvass.id, { supplierName: "Ferno", brand: "Ferno", unitPrice: 82500 }, purchaser.id)
    await canvassService.markWinner(canvass.id, redleaf.id)
    await canvassService.setReason(canvass.id, "Cheapest quote that meets the 227 kg load.")
  })

  it("signs with two Offers, recording the count", async () => {
    const result = await canvassService.sign(canvass.id)
    expect(result.offer_count).toBe(2)

    expect(stored()).toMatchObject({ signed_off_by: approver.id })
    expect(stored().signed_off_at).toBeTruthy()

    const history = await canvassService.signoffHistory(canvass.id)
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ kind: "signed", offer_count: 2, reason: "Cheapest quote that meets the 227 kg load." })
  })

  it("is unsigned again when an Offer is added afterwards, with the reason recorded", async () => {
    await canvassService.sign(canvass.id)
    await canvassService.addOffer(canvass.id, { supplierName: "Hong Kong", currency: "USD", unitPrice: 1280, comparisonRate: 56.5625 }, purchaser.id)

    expect(stored().signed_off_at).toBeNull()
    expect(stored().signed_off_by).toBeNull()
    const history = await canvassService.signoffHistory(canvass.id)
    expect(history.map((h) => h.kind)).toEqual(["signed", "cleared"])
    expect(history[1]).toMatchObject({ reason: "An Offer was added", offer_count: 3 })
  })

  it.each([
    ["a price changes", () => canvassService.updateOffer(ferno.id, { unitPrice: 80000 }), "A price changed"],
    ["an Offer is edited", () => canvassService.updateOffer(ferno.id, { brand: "Ferno Inc." }), "An Offer was changed"],
    ["an Offer is removed", () => canvassService.removeOffer(ferno.id), "An Offer was removed"],
    ["the winner changes", () => canvassService.markWinner(canvass.id, ferno.id), "The winner changed"],
    ["the reason changes", () => canvassService.setReason(canvass.id, "Ferno ships faster."), "The reason changed"],
  ])("is unsigned when %s", async (_what, change, reason) => {
    await canvassService.sign(canvass.id)
    await change()
    expect(stored().signed_off_at).toBeNull()
    const history = await canvassService.signoffHistory(canvass.id)
    expect(history.at(-1)).toMatchObject({ kind: "cleared", reason })
  })

  it("stays signed through a plain re-ordering", async () => {
    await canvassService.sign(canvass.id)
    await canvassService.reorderOffers(canvass.id, [ferno.id, redleaf.id])
    expect(stored().signed_off_at).toBeTruthy()
  })

  describe("telling the list", () => {
    const told = () => db.rows("notifications").filter((n) => n.type === CANVASS_NOTIFICATION.READY_TO_SIGN)

    it("tells the approvers once the Canvass has a winner and a reason, not before", async () => {
      expect(told().map((n) => n.recipient_id)).toEqual([approver.id])
      expect(told()[0]).toMatchObject({ reference_id: canvass.id })
      expect(told()[0].title).toContain(canvass.number)
    })

    it("tells nobody while the reason is missing", async () => {
      const before = told().length
      const count = await canvassService.notifyApprovers(
        (await seedCanvass({ componentId: db.seed("costing_components", { tender_line_id: db.rows("costing_tender_lines")[0].id, position: 2, name: "Spine board" }).id }, purchaser.id)).id,
      )
      expect(count).toBe(0)
      expect(told()).toHaveLength(before)
    })

    it("does not tell the person who opened it", async () => {
      stubCanvassSignoffRpcs({ actorId: approver.id, approverIds: [approver.id, purchaser.id] })
      const before = told().length
      await canvassService.notifyApprovers(canvass.id)
      const added = told().slice(before).map((n) => n.recipient_id)
      expect(added).toEqual([approver.id])
    })
  })

  describe("the Approval Center queue", () => {
    it("lists a ready, unsigned Canvass for a list member", async () => {
      const rows = await canvassService.pendingSignoffs()
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ canvassId: canvasId(), number: canvass.number, offerCount: 2, winnerSupplier: "Redleaf Inc.", creatorName: "Marco Dizon" })
    })

    it("drops it once signed, and brings it back when a change unsigns it", async () => {
      await canvassService.sign(canvass.id)
      expect(await canvassService.pendingSignoffs()).toHaveLength(0)
      await canvassService.updateOffer(ferno.id, { brand: "Ferno Inc." })
      expect(await canvassService.pendingSignoffs()).toHaveLength(1)
    })

    it("is empty for someone off the list", async () => {
      stubCanvassSignoffRpcs({ actorId: purchaser.id, approverIds: [approver.id] })
      expect(await canvassService.pendingSignoffs()).toEqual([])
    })
  })

  function canvasId() {
    return canvass.id
  }
})
