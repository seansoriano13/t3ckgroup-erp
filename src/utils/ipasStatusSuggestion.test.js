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

  it("no longer suggests a removed step: a prepared section 1 or a P.I and its amount say nothing (#1221)", () => {
    const pi = { label: "Proforma Invoice", hasFile: true, kind: { system_key: "proforma_invoice" } }
    expect(suggestStatus(ipasOf({ signoffSections: { 1: { prepared: { id: "s1" } } } }))).toBeNull()
    expect(suggestStatus(ipasOf({ documents: [pi], pi_qt_amount: 8400 }))).toBeNull()
  })

  it("suggests a confirmed PO as Ordered", () => {
    const hit = suggestStatus(ipasOf({ statuses: poConfirmed, signoffSections: { 1: { prepared: { id: "s1" } } } }))
    expect(hit).toMatchObject({ step: "ordered", label: "Ordered", because: "Odoo says this PO is confirmed." })
  })

  it("suggests Ordered when a payment closed an ask, not when it was withdrawn (#1209)", () => {
    const base = { status: "order_draft" }
    const paid = { closed_at: "2026-11-24T01:00:00Z", closed_reason: "paid" }
    const withdrawn = { closed_at: "2026-11-24T01:00:00Z", closed_reason: "withdrawn" }
    expect(suggestStatus(ipasOf({ ...base, payment_asks: [paid] }))).toMatchObject({ step: "ordered", label: "Ordered" })
    expect(suggestStatus(ipasOf({ ...base, payment_asks: [withdrawn] }))).toBeNull()
    expect(suggestStatus(ipasOf({ ...base, payment_asks: [{ closed_at: null, closed_reason: null }] }))).toBeNull()
    expect(suggestStatus(ipasOf({ status: "ordered", payment_asks: [paid] }))).toBeNull()
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
    expect(suggestStatus(ipasOf({ status: "out_for_delivery", slips: [{ id: "t1" }], direct_delivery: true }))).toBeNull()
    const received = { purchaseOrder: { ticked: true }, receivedInOdoo: { ticked: true } }
    expect(suggestStatus(ipasOf({ status: "ordered", statuses: received, direct_delivery: true }))).toMatchObject({ step: "delivered" })
  })

  it("suggests nothing on a filed or cancelled IPAS", () => {
    expect(suggestStatus(ipasOf({ state: "filed", statuses: poConfirmed }))).toBeNull()
    expect(suggestStatus(ipasOf({ state: "cancelled", statuses: poConfirmed }))).toBeNull()
  })
})
