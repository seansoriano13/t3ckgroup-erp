import { describe, expect, it } from "vitest"
import {
  analyticNames,
  changeNoteSummary,
  filterIpas,
  formatAmount,
  ipasEntity,
  ipasErrorMessage,
  odooStatuses,
  odooValueOf,
  overridesOf,
  parseSalesReferences,
  salesReferencesIn,
  shapeChangeNote,
  shapeIpas,
  sorMismatch,
} from "./ipas"

describe("parseSalesReferences", () => {
  it("finds every S number once, in order, upper-cased", () => {
    expect(parseSalesReferences("1pc S06070 Las Nieves & 1pc s04602 Brgy. Wack-Wack, again S06070")).toEqual([
      "S06070",
      "S04602",
    ])
  })

  it("ignores words that merely contain an S and digits", () => {
    expect(parseSalesReferences("RS232 cable, PS5 bundle, STS-12", "Stock")).toEqual([])
  })

  it("reads several texts and skips blanks", () => {
    expect(parseSalesReferences("S1", null, undefined, ["S2 Capas", 5])).toEqual(["S1", "S2"])
  })
})

describe("salesReferencesIn", () => {
  it("says where each reference was mentioned", () => {
    const copy = {
      po: { origin: "S07920 Capas  Municipal Government" },
      lines: [{ analytic: ["S07920 Capas", "S06070 Rescue Vehicle"] }, { analytic: [] }, {}],
    }
    expect(salesReferencesIn(copy)).toEqual({ S07920: ["origin", "analytic"], S06070: ["analytic"] })
  })

  it("is empty for a copy that names nothing, or no copy", () => {
    expect(salesReferencesIn({ po: { origin: "Stock" }, lines: [] })).toEqual({})
    expect(salesReferencesIn(null)).toEqual({})
  })
})

describe("analyticNames", () => {
  it("lists each distinct account once", () => {
    const copy = { lines: [{ analytic: ["A", "B"] }, { analytic: ["B"] }, {}] }
    expect(analyticNames(copy)).toEqual(["A", "B"])
  })
})

describe("shapeIpas", () => {
  it("reads entity, supplier, currency and lines out of the stored copy", () => {
    const row = {
      id: "1",
      purpose: "project",
      odoo_copy: {
        po: { company: "TG Enterprise", currency: "USD", state: "cancel" },
        supplier: { name: "Redleaf" },
        lines: [{ line_id: 1 }],
      },
    }
    const shaped = shapeIpas(row, [
      { opportunity_id: "o1", sales_reference: "S07983", project_title: "ERV", current_stage_name: "Quotation" },
    ])
    expect(shaped).toMatchObject({
      entity: "TG Enterprise",
      supplier: "Redleaf",
      currency: "USD",
      poCancelledInOdoo: true,
      isProject: true,
      sors: [{ id: "o1", salesReference: "S07983", projectTitle: "ERV", stageName: "Quotation" }],
    })
    expect(shaped.lines).toHaveLength(1)
  })

  it("copes with a copy that has no lines or supplier", () => {
    expect(shapeIpas({ id: "1", purpose: "events", odoo_copy: {} })).toMatchObject({
      entity: null,
      supplier: null,
      lines: [],
      sors: [],
    })
    expect(shapeIpas(null)).toBeNull()
  })
})

describe("filterIpas", () => {
  const rows = [
    { number: "TGIPAS_049", po_number: "P02552", supplier: "Scorpe", entity: "T3ck Trading", purpose: "project", state: "open", sors: [{ salesReference: "S07920", projectTitle: "Capas LGU" }] },
    { number: "TGIPAS_050", po_number: "P02553", supplier: "Redleaf", entity: "TG Enterprise", purpose: "supplies", state: "filed", sors: [] },
    { number: "TGIPAS_051", po_number: "P02554", supplier: "Scorpe", entity: "T3ck Trading", purpose: "supplies", state: "cancelled", sors: [] },
  ]
  const numbers = (filter) => filterIpas(rows, filter).map((r) => r.number)

  it("slices by state, entity and Purpose", () => {
    expect(numbers({ state: "open" })).toEqual(["TGIPAS_049"])
    expect(numbers({ state: "all" })).toHaveLength(3)
    expect(numbers({ entity: "T3ck Trading", purpose: "supplies" })).toEqual(["TGIPAS_051"])
  })

  it("searches number, PO, supplier and SORs", () => {
    expect(numbers({ search: "050" })).toEqual(["TGIPAS_050"])
    expect(numbers({ search: "p02554" })).toEqual(["TGIPAS_051"])
    expect(numbers({ search: "scorpe" })).toEqual(["TGIPAS_049", "TGIPAS_051"])
    expect(numbers({ search: "capas" })).toEqual(["TGIPAS_049"])
  })
})

describe("formatAmount", () => {
  it("formats a PHP and a USD amount", () => {
    expect(formatAmount(1250, "Php")).toMatch(/1,250\.00/)
    expect(formatAmount(1250, "USD")).toMatch(/1,250\.00/)
  })

  it("never throws on a currency name that isn't an ISO code, or a bad number", () => {
    expect(formatAmount(10, "Not a code")).toBe("Not a code 10.00")
    expect(formatAmount("abc", "PHP")).toBe("—")
    expect(formatAmount(5, null)).toBe("5.00")
  })
})

describe("ipasErrorMessage", () => {
  it("drops the function name the database leads with", () => {
    expect(ipasErrorMessage({ message: "ipas_create: P02552 already has a live IPAS (TGIPAS_049)" })).toBe(
      "P02552 already has a live IPAS (TGIPAS_049)",
    )
    expect(ipasErrorMessage({})).toBe("Something went wrong.")
  })

  it("drops any function name, not only an IPAS one, and starts with a capital", () => {
    expect(ipasErrorMessage({ message: "transmittal_check: the preparer can't check their own slip" })).toBe(
      "The preparer can't check their own slip",
    )
    expect(ipasErrorMessage({ message: "packing_list_pack: add a box first" })).toBe("Add a box first")
  })

  it("says a dropped connection in plain words, whatever the browser calls it", () => {
    const offline = "Can't reach the server. Check your connection and try again."
    expect(ipasErrorMessage(new TypeError("Failed to fetch"))).toBe(offline)
    expect(ipasErrorMessage({ message: "TypeError: Failed to fetch" })).toBe(offline)
    expect(ipasErrorMessage({ message: "Load failed" })).toBe(offline)
    expect(ipasErrorMessage({ message: "NetworkError when attempting to fetch resource." })).toBe(offline)
  })
})

describe("overrides", () => {
  const copy = {
    po: { company: "T3ck Trading", origin: "S07920 Capas" },
    lines: [{ analytic: ["S07920 Capas", "Ops"] }, { analytic: ["Ops"] }],
  }

  it("reads Odoo's value of each overridable field from the copy", () => {
    expect(odooValueOf(copy, "entity")).toBe("T3ck Trading")
    expect(odooValueOf(copy, "source_doc")).toBe("S07920 Capas")
    expect(odooValueOf(copy, "analytic")).toBe("S07920 Capas · Ops")
    expect(odooValueOf(copy, "currency")).toBeNull()
    expect(odooValueOf({}, "entity")).toBeNull()
  })

  it("uses the override when there is one and keeps Odoo's value beside it", () => {
    const row = { odoo_copy: copy, entity_override: " TG Enterprise ", source_doc_override: null, analytic_override: "  " }
    const { entity, source_doc: sourceDoc, analytic } = overridesOf(row)

    expect(entity).toMatchObject({ overridden: true, override: "TG Enterprise", odoo: "T3ck Trading", value: "TG Enterprise" })
    expect(sourceDoc).toMatchObject({ overridden: false, override: null, value: "S07920 Capas" })
    // A blank override isn't one.
    expect(analytic).toMatchObject({ overridden: false, value: "S07920 Capas · Ops" })
  })

  it("books the IPAS to the overriding entity", () => {
    expect(ipasEntity({ odoo_copy: copy })).toBe("T3ck Trading")
    expect(ipasEntity({ odoo_copy: copy, entity_override: "TG Enterprise" })).toBe("TG Enterprise")
  })
})

describe("odooStatuses", () => {
  it("ticks Purchase Order for a purchase or a locked order, never an RFQ or a cancelled one", () => {
    expect(odooStatuses({ po: { state: "purchase" } }).purchaseOrder.ticked).toBe(true)
    expect(odooStatuses({ po: { state: "done" } }).purchaseOrder.ticked).toBe(true)
    for (const state of ["draft", "sent", "to approve", "cancel", undefined]) {
      expect(odooStatuses({ po: { state } }).purchaseOrder.ticked, String(state)).toBe(false)
    }
  })

  it("distinguishes received, partly received and not received", () => {
    const received = (receipts) => odooStatuses({ po: {}, receipts }).receivedInOdoo
    expect(received({ status: "full", done: 2, total: 2 })).toMatchObject({ ticked: true, partial: false })
    expect(received({ status: "partial", done: 1, total: 2 })).toMatchObject({ ticked: false, partial: true })
    expect(received({ status: "pending", done: 1, total: 2 })).toMatchObject({ ticked: false, partial: true })
    expect(received({ status: "pending", done: 0, total: 2 })).toMatchObject({ ticked: false, partial: false })
    expect(received(null)).toMatchObject({ ticked: false, partial: false })
  })

  it("counts draft bills for Create Bill, and says when only drafts exist", () => {
    const bill = (bills) => odooStatuses({ po: {}, bills }).createBill
    expect(bill({ count: 0, draft: 0 })).toMatchObject({ ticked: false, draftsOnly: false })
    expect(bill({ count: 1, draft: 1 })).toMatchObject({ ticked: true, draftsOnly: true })
    expect(bill({ count: 2, draft: 1 })).toMatchObject({ ticked: true, draftsOnly: false, drafts: 1 })
  })

  it("marks all three as stamped from Odoo", () => {
    const all = odooStatuses({ po: { state: "purchase" } })
    expect(Object.values(all).every((status) => status.stampedFromOdoo === true)).toBe(true)
  })
})

describe("sorMismatch", () => {
  const sor = (salesReference) => ({ salesReference })
  const copy = (origin, analytic = []) => ({ po: { origin }, lines: [{ analytic }] })

  it("is null when Odoo and the IPAS name the same S numbers, in any order or case", () => {
    expect(sorMismatch(copy("S06070 Las Nieves & s04602 Wack"), [sor("S04602"), sor("S06070")])).toBeNull()
  })

  it("says what only Odoo names and what only the IPAS names", () => {
    const result = sorMismatch(copy("S06070 Las Nieves", ["S07920 Capas"]), [sor("S06070"), sor("S01111")])
    expect(result).toEqual({
      odoo: ["S06070", "S07920"],
      ipas: ["S06070", "S01111"],
      onlyInOdoo: ["S07920"],
      onlyInIpas: ["S01111"],
    })
  })

  it("has nothing to compare when Odoo names no S number", () => {
    expect(sorMismatch(copy("Stock replenishment"), [sor("S06070")])).toBeNull()
    expect(sorMismatch(copy(null), [])).toBeNull()
  })

  it("warns for a non-Project IPAS when Odoo names an SOR it doesn't", () => {
    expect(sorMismatch(copy("S06070"), [])).toMatchObject({ onlyInOdoo: ["S06070"], onlyInIpas: [] })
  })
})

describe("shapeIpas warnings", () => {
  const base = {
    id: "i1",
    state: "open",
    purpose: "inventory",
    odoo_copy: { po: { state: "purchase", origin: null }, supplier: { name: "S" }, lines: [] },
  }

  it("warns of a PO cancelled in Odoo without changing the state", () => {
    const shaped = shapeIpas({ ...base, odoo_copy: { ...base.odoo_copy, po: { state: "cancel" } } })
    expect(shaped.state).toBe("open")
    expect(shaped.warnings.map((w) => w.code)).toEqual(["po_cancelled_in_odoo"])
  })

  it("stops warning about the PO once the IPAS itself is cancelled", () => {
    const shaped = shapeIpas({ ...base, state: "cancelled", odoo_copy: { ...base.odoo_copy, po: { state: "cancel" } } })
    expect(shaped.warnings).toEqual([])
  })

  it("shows 'Odoo has changed since filing' only on a filed IPAS", () => {
    expect(shapeIpas({ ...base, state: "filed", odoo_changed_since_filing: true }).warnings.map((w) => w.code)).toEqual([
      "odoo_changed_since_filing",
    ])
    expect(shapeIpas({ ...base, odoo_changed_since_filing: true }).warnings).toEqual([])
  })

  it("marks a contact and P.I # still equal to Odoo's as filled from Odoo", () => {
    const copy = { ...base.odoo_copy, po: { state: "purchase", partner_ref: "PI-1" }, supplier: { name: "S", contact: "Ms. K" } }
    expect(shapeIpas({ ...base, odoo_copy: copy, supplier_contact: "Ms. K", pi_number: "PI-1" })).toMatchObject({
      contact: "Ms. K",
      contactFromOdoo: true,
      piNumber: "PI-1",
      piNumberFromOdoo: true,
    })
    expect(shapeIpas({ ...base, odoo_copy: copy, supplier_contact: "Typed", pi_number: null })).toMatchObject({
      contactFromOdoo: false,
      piNumber: null,
      piNumberFromOdoo: false,
    })
  })
})

describe("the change note", () => {
  it("is null without a note, and summarises additions, removals and changes", () => {
    expect(shapeChangeNote(null)).toBeNull()
    const note = shapeChangeNote({
      at: "2026-10-13T01:00:00Z",
      added: [{ line_id: 3 }, { line_id: 4 }],
      removed: [{ line_id: 2 }],
      changed: [{ line_id: 1 }],
      total_from: 400,
      total_to: 580,
    })
    expect(changeNoteSummary(note)).toBe("2 lines added, 1 removed, 1 quantity or price changed")
    expect(note).toMatchObject({ totalFrom: 400, totalTo: 580 })
    expect(changeNoteSummary(shapeChangeNote({ added: [{}] }))).toBe("1 line added")
    expect(changeNoteSummary(shapeChangeNote({ total_from: 1, total_to: 2 }))).toBe("total changed")
    expect(changeNoteSummary(null)).toBe("")
  })
})
