import { describe, expect, it } from "vitest"
import {
  buildBuyerFacts,
  filingChecklist,
  kindMatchesSource,
  kindsToAdd,
  missingSuggestions,
  shapeDocuments,
  unfiledDocuments,
} from "./ipasDocuments"
import { odooStatuses } from "./ipas"

const kind = (id, label, applies_to, used_for, over = {}) => ({
  id, list: "document_kind", label, applies_to, used_for, sort: 0, active: true, ...over,
})

const OPTIONS = [
  kind("k1", "Quotation (Local)", "local", "documentation", { sort: 10 }),
  kind("k2", "BL or Waybill", "import", "both", { sort: 20 }),
  kind("k3", "BIR 2307", "both", "filing", { sort: 30 }),
  kind("k4", "Retired", "import", "filing", { active: false, sort: 40 }),
  { id: "p1", list: "payment_method", label: "Cash", active: true },
]

describe("document kinds and Source", () => {
  it("matches a kind to its own Source and to Both, never to the other", () => {
    expect(kindMatchesSource(OPTIONS[0], "local")).toBe(true)
    expect(kindMatchesSource(OPTIONS[0], "import")).toBe(false)
    expect(kindMatchesSource(OPTIONS[1], "import")).toBe(true)
    expect(kindMatchesSource(OPTIONS[2], "import")).toBe(true)
    expect(kindMatchesSource(OPTIONS[2], "local")).toBe(true)
  })

  it("never matches an option from another list", () => {
    expect(kindMatchesSource(OPTIONS[4], "import")).toBe(false)
  })

  it("suggests the active kinds for a Source that the IPAS has no row for", () => {
    expect(missingSuggestions(OPTIONS, [], "import").map((k) => k.label)).toEqual(["BL or Waybill", "BIR 2307"])
    expect(missingSuggestions(OPTIONS, [{ kind_id: "k2" }], "import").map((k) => k.label)).toEqual(["BIR 2307"])
    expect(missingSuggestions(OPTIONS, [], "local").map((k) => k.label)).toEqual(["Quotation (Local)", "BIR 2307"])
  })

  it("offers every active kind not yet on the IPAS to add by hand, whatever its Source", () => {
    expect(kindsToAdd(OPTIONS, [{ kind_id: "k1" }]).map((k) => k.label)).toEqual(["BL or Waybill", "BIR 2307"])
  })
})

describe("shaping documents", () => {
  const rows = [
    { id: "d3", ipas_id: "i", kind_id: null, label: " Memo ", purchasing_has: true, finance_has: false, created_at: "2026-10-02" },
    { id: "d2", ipas_id: "i", kind_id: "k3", label: null, purchasing_has: false, finance_has: true, attachment_url: "https://x.test/2307.pdf" },
    { id: "d1", ipas_id: "i", kind_id: "k2", label: null, purchasing_has: false, finance_has: false },
    { id: "d4", ipas_id: "i", kind_id: "k4", label: null, purchasing_has: false, finance_has: false },
  ]

  it("labels a kind row by its kind, even a deactivated one, and a hand-added row by its own name", () => {
    const docs = shapeDocuments(rows, OPTIONS)
    expect(docs.map((d) => d.label)).toEqual(["BL or Waybill", "BIR 2307", "Retired", "Memo"])
    expect(docs.find((d) => d.id === "d3")).toMatchObject({ label: "Memo", byHand: true, isFiling: false })
    expect(docs.find((d) => d.id === "d4").label).toBe("Retired")
  })

  it("puts kind rows in the list's order and hand-added ones last", () => {
    const docs = shapeDocuments(rows, [
      kind("k2", "BL or Waybill", "import", "both", { sort: 20 }),
      kind("k3", "BIR 2307", "both", "filing", { sort: 10 }),
      kind("k4", "Retired", "import", "filing", { sort: 30 }),
    ])
    expect(docs.map((d) => d.id)).toEqual(["d2", "d1", "d4", "d3"])
  })

  it("marks filing items and counts either tick as ticked", () => {
    const docs = shapeDocuments(rows, OPTIONS)
    expect(docs.find((d) => d.id === "d2")).toMatchObject({ isFiling: true, financeHas: true, purchasingHas: false, ticked: true, attachmentUrl: "https://x.test/2307.pdf" })
    expect(docs.find((d) => d.id === "d1")).toMatchObject({ isFiling: true, ticked: false })
    expect(docs.find((d) => d.id === "d3")).toMatchObject({ ticked: true, isFiling: false })
  })

  it("reads the filing checklist off the same rows, hand-added ones excluded", () => {
    const docs = shapeDocuments(rows, OPTIONS)
    expect(filingChecklist(docs).map((d) => [d.label, d.ticked]).sort()).toEqual([
      ["BIR 2307", true],
      ["BL or Waybill", false],
      ["Retired", false],
    ])
    expect(unfiledDocuments(docs).map((d) => d.label).sort()).toEqual(["BL or Waybill", "Retired"])
  })
})

describe("the buyer facts", () => {
  const odoo = odooStatuses({ po: { state: "purchase" }, receipts: { status: "pending", done: 0, total: 1 }, bills: { count: 0, draft: 0 } })
  const keys = (items) => items.map((i) => i.key)

  it("holds only the facts that stay beside the IPAS Status, the same on either Source", () => {
    const facts = ["with_pop", "received_in_odoo", "create_bill", "actual_checking"]
    expect(keys(buildBuyerFacts({ source: "import" }, odoo))).toEqual(facts)
    expect(keys(buildBuyerFacts({ source: "local" }, odoo))).toEqual(facts)
  })

  it("derives With P.O.P from proof of payment and says how many payments carry it", () => {
    const none = buildBuyerFacts({ source: "local" }, odoo, { hasProof: false }).find((i) => i.key === "with_pop")
    const two = buildBuyerFacts({ source: "local" }, odoo, { hasProof: true, proofCount: 2 }).find((i) => i.key === "with_pop")
    expect(none).toMatchObject({ ticked: false, source: "derived" })
    expect(two).toMatchObject({ ticked: true, source: "derived", detail: "2 payments carry proof of payment" })
  })

  it("carries who typed or stamped a status, and when", () => {
    const row = {
      source: "import",
      actual_checking_by: "e1",
      actual_checker: { id: "e1", name: "Buyer" },
      actual_checking_at: "2026-10-06T01:00:00Z",
    }
    const items = Object.fromEntries(buildBuyerFacts(row, odoo).map((i) => [i.key, i]))
    expect(items.actual_checking).toMatchObject({ ticked: true, by: { name: "Buyer" }, at: "2026-10-06T01:00:00Z", source: "stamped" })
  })
})

describe("the buyer facts' reasons", () => {
  const reasons = (copy) =>
    Object.fromEntries(
      buildBuyerFacts({ source: "local" }, odooStatuses(copy)).map((i) => [i.key, i.reason ?? null]),
    )

  it("says why each unticked Odoo line is not ticked", () => {
    const r = reasons({ po: { state: "draft" }, receipts: { status: "pending", done: 0, total: 2 }, bills: { count: 0, draft: 0 } })
    expect(r.received_in_odoo).toBe("0 of 2 receipts done")
    expect(r.create_bill).toBe("No bill yet")
  })

  it("keeps Partly received for a part-done receipt, and copes with no receipts or no state", () => {
    const partial = reasons({ po: { state: "purchase" }, receipts: { status: "partial", done: 1, total: 2 }, bills: { count: 0, draft: 0 } })
    expect(partial.received_in_odoo).toBe("Partly received · 1 of 2 receipts done")
    const none = reasons({ receipts: { total: 0 } })
    expect(none.received_in_odoo).toBe("No receipts in Odoo yet")
  })

  it("gives no reason once a line is ticked", () => {
    const r = reasons({ po: { state: "purchase" }, receipts: { status: "full", done: 2, total: 2 }, bills: { count: 1, draft: 0 } })
    expect(r).toMatchObject({ received_in_odoo: null, create_bill: null })
  })
})
