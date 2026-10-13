import { describe, expect, it } from "vitest"
import {
  buildBuyerTrack,
  filingChecklist,
  kindMatchesSource,
  kindsToAdd,
  missingSuggestions,
  shapeDocuments,
  supplierOriginOf,
  unfiledDocuments,
} from "./ipasDocuments"
import { odooStatuses } from "./ipas"

const kind = (id, label, applies_to, used_for, over = {}) => ({
  id, list: "document_kind", label, applies_to, used_for, sort: 0, active: true, ...over,
})

const OPTIONS = [
  kind("k1", "Quotation", "local", "documentation", { sort: 10 }),
  kind("k2", "Bill of Lading (BL)", "import", "both", { sort: 20 }),
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
    expect(missingSuggestions(OPTIONS, [], "import").map((k) => k.label)).toEqual(["Bill of Lading (BL)", "BIR 2307"])
    expect(missingSuggestions(OPTIONS, [{ kind_id: "k2" }], "import").map((k) => k.label)).toEqual(["BIR 2307"])
    expect(missingSuggestions(OPTIONS, [], "local").map((k) => k.label)).toEqual(["Quotation", "BIR 2307"])
  })

  it("offers every active kind not yet on the IPAS to add by hand, whatever its Source", () => {
    expect(kindsToAdd(OPTIONS, [{ kind_id: "k1" }]).map((k) => k.label)).toEqual(["Bill of Lading (BL)", "BIR 2307"])
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
    expect(docs.map((d) => d.label)).toEqual(["Bill of Lading (BL)", "BIR 2307", "Retired", "Memo"])
    expect(docs.find((d) => d.id === "d3")).toMatchObject({ label: "Memo", byHand: true, isFiling: false })
    expect(docs.find((d) => d.id === "d4").label).toBe("Retired")
  })

  it("puts kind rows in the list's order and hand-added ones last", () => {
    const docs = shapeDocuments(rows, [
      kind("k2", "Bill of Lading (BL)", "import", "both", { sort: 20 }),
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
      ["Bill of Lading (BL)", false],
      ["Retired", false],
    ])
    expect(unfiledDocuments(docs).map((d) => d.label).sort()).toEqual(["Bill of Lading (BL)", "Retired"])
  })
})

describe("Supplier Origin", () => {
  const dated = { shipped_out_on: "2026-10-01", onboard_on: null, arrived_in_ph_on: "2026-10-09", arrived_in_whs_on: null }

  it("reads the four dates on an Import IPAS", () => {
    expect(supplierOriginOf({ source: "import", ...dated })).toEqual({
      shippedOut: "2026-10-01", onboard: null, arrivedInPh: "2026-10-09", arrivedInWhs: null,
    })
  })

  it("reads nothing on a Local IPAS, whatever the row holds", () => {
    expect(supplierOriginOf({ source: "local", ...dated })).toBeNull()
    expect(supplierOriginOf(null)).toBeNull()
  })
})

describe("the buyer track", () => {
  const odoo = odooStatuses({ po: { state: "purchase" }, receipts: { status: "pending", done: 0, total: 1 }, bills: { count: 0, draft: 0 } })
  const keys = (items) => items.map((i) => i.key)

  it("is in the sheet's order, with Import Clearance on Import only", () => {
    expect(keys(buildBuyerTrack({ source: "import" }, odoo))).toEqual([
      "purchase_order", "with_pop", "import_clearance", "delivered", "received_in_odoo", "create_bill", "actual_checking",
    ])
    expect(keys(buildBuyerTrack({ source: "local" }, odoo))).not.toContain("import_clearance")
  })

  it("derives With P.O.P from proof of payment and says how many payments carry it", () => {
    const none = buildBuyerTrack({ source: "local" }, odoo, { hasProof: false }).find((i) => i.key === "with_pop")
    const two = buildBuyerTrack({ source: "local" }, odoo, { hasProof: true, proofCount: 2 }).find((i) => i.key === "with_pop")
    expect(none).toMatchObject({ ticked: false, source: "derived" })
    expect(two).toMatchObject({ ticked: true, source: "derived", detail: "2 payments carry proof of payment" })
  })

  it("carries who typed or stamped a status, and when", () => {
    const row = {
      source: "import",
      import_clearance_on: "2026-10-05",
      import_clearance_typer: { id: "e1", name: "Buyer" },
      import_clearance_typed_at: "2026-10-05T01:00:00Z",
      delivered_on: null,
      actual_checking_by: "e1",
      actual_checker: { id: "e1", name: "Buyer" },
      actual_checking_at: "2026-10-06T01:00:00Z",
    }
    const items = Object.fromEntries(buildBuyerTrack(row, odoo).map((i) => [i.key, i]))
    expect(items.import_clearance).toMatchObject({ ticked: true, on: "2026-10-05", by: { id: "e1", name: "Buyer" }, source: "typed" })
    expect(items.delivered).toMatchObject({ ticked: false, by: null })
    expect(items.actual_checking).toMatchObject({ ticked: true, by: { name: "Buyer" }, at: "2026-10-06T01:00:00Z", source: "stamped" })
  })
})
