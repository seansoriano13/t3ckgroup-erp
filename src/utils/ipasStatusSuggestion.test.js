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

  it("suggests Ordered when a payment closed an ask, not when it was withdrawn (#1209)", () => {
    const base = { status: "for_payment" }
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

  describe("P.I fact (#1191)", () => {
    const pi = { label: "Proforma Invoice", hasFile: true, kind: { system_key: "proforma_invoice" } }
    const quote = { label: "Quotation (Local)", hasFile: true, kind: { system_key: "quotation" } }
    it("suggests Payment Approval from a P.I file plus a typed amount", () => {
      expect(suggestStatus(ipasOf({ documents: [pi], pi_qt_amount: 8400 }))).toMatchObject({ step: "payment_approval" })
    })
    it("needs both the file and the amount", () => {
      expect(suggestStatus(ipasOf({ documents: [pi], pi_qt_amount: null }))).toBeNull()
      expect(suggestStatus(ipasOf({ documents: [{ ...pi, hasFile: false }], pi_qt_amount: 8400 }))).toBeNull()
    })
    it("on a Local order the Quotation plays the P.I", () => {
      expect(suggestStatus(ipasOf({ source: "local", documents: [quote], pi_qt_amount: 100 }))).toMatchObject({ step: "payment_approval" })
      expect(suggestStatus(ipasOf({ source: "local", documents: [pi], pi_qt_amount: 100 }))).toBeNull()
    })
    it("still suggests after the kind is renamed: the key counts, not the label", () => {
      const renamedPi = { ...pi, label: "Supplier Quote Sheet" }
      const renamedQuote = { ...quote, label: "Price offer" }
      expect(suggestStatus(ipasOf({ documents: [renamedPi], pi_qt_amount: 8400 }))).toMatchObject({ step: "payment_approval" })
      expect(suggestStatus(ipasOf({ source: "local", documents: [renamedQuote], pi_qt_amount: 100 }))).toMatchObject({ step: "payment_approval" })
    })
    it("a document labelled like a P.I but without the key does not count", () => {
      const lookalike = { label: "Proforma Invoice", hasFile: true, kind: { system_key: null } }
      expect(suggestStatus(ipasOf({ documents: [lookalike], pi_qt_amount: 8400 }))).toBeNull()
    })
    it("suggests nothing at or past Payment Approval", () => {
      expect(suggestStatus(ipasOf({ status: "payment_approval", documents: [pi], pi_qt_amount: 1 }))).toBeNull()
      expect(suggestStatus(ipasOf({ status: "ordered", documents: [pi], pi_qt_amount: 1 }))).toBeNull()
    })
  })
})
