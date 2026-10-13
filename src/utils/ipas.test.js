import { describe, expect, it } from "vitest"
import {
  analyticNames,
  filterIpas,
  formatAmount,
  ipasErrorMessage,
  parseSalesReferences,
  salesReferencesIn,
  shapeIpas,
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
      { opportunity_id: "o1", sales_reference: "S07983", project_title: "ERV", client_name: "Palmer" },
    ])
    expect(shaped).toMatchObject({
      entity: "TG Enterprise",
      supplier: "Redleaf",
      currency: "USD",
      poCancelledInOdoo: true,
      isProject: true,
      sors: [{ id: "o1", salesReference: "S07983", projectTitle: "ERV", clientName: "Palmer" }],
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
})
