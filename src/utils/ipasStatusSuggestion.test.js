import { describe, expect, it } from "vitest"

import { suggestStatus } from "./ipasStatusSuggestion"

const ipasOf = (over = {}) => ({
  state: "open",
  source: "import",
  status: "order_draft",
  statuses: { purchaseOrder: { ticked: false }, receivedInOdoo: { ticked: false } },
  signoffSections: { 1: { prepared: null } },
  slips: [],
  ...over,
})
const poConfirmed = { purchaseOrder: { ticked: true }, receivedInOdoo: { ticked: false } }

describe("suggestStatus (#1155)", () => {
  it("suggests nothing when no fact matches", () => {
    expect(suggestStatus(ipasOf())).toBeNull()
  })

  it("suggests Payment Approval when section 1 is prepared", () => {
    expect(suggestStatus(ipasOf({ signoffSections: { 1: { prepared: { id: "s1" } } } }))).toMatchObject({ step: "payment_approval" })
  })

  it("suggests only the furthest step: a confirmed PO gives Ordered, not Payment Approval", () => {
    const hit = suggestStatus(ipasOf({ statuses: poConfirmed, signoffSections: { 1: { prepared: { id: "s1" } } } }))
    expect(hit).toMatchObject({ step: "ordered", label: "Ordered", because: "Odoo says this PO is confirmed." })
  })

  it("suggests nothing once the status has reached or passed the step", () => {
    expect(suggestStatus(ipasOf({ status: "ordered", statuses: poConfirmed }))).toBeNull()
    expect(suggestStatus(ipasOf({ status: "in_transit", statuses: poConfirmed }))).toBeNull()
  })

  it("suggests Delivered from an Odoo receipt or a Transmittal", () => {
    const received = { purchaseOrder: { ticked: true }, receivedInOdoo: { ticked: true } }
    expect(suggestStatus(ipasOf({ status: "in_transit", statuses: received }))).toMatchObject({ step: "delivered" })
    expect(suggestStatus(ipasOf({ status: "out_for_delivery", slips: [{ id: "t1" }] }))).toMatchObject({ step: "delivered" })
  })

  it("ignores Transmittals on a Direct delivery, but not the Odoo receipt", () => {
    expect(suggestStatus(ipasOf({ status: "out_for_delivery", slips: [{ id: "t1" }], directDelivery: true }))).toBeNull()
    const received = { purchaseOrder: { ticked: true }, receivedInOdoo: { ticked: true } }
    expect(suggestStatus(ipasOf({ status: "ordered", statuses: received, directDelivery: true }))).toMatchObject({ step: "delivered" })
  })

  it("suggests nothing on a filed or cancelled IPAS", () => {
    expect(suggestStatus(ipasOf({ state: "filed", statuses: poConfirmed }))).toBeNull()
    expect(suggestStatus(ipasOf({ state: "cancelled", statuses: poConfirmed }))).toBeNull()
  })
})
