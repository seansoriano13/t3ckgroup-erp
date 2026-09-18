import { describe, expect, it } from "vitest"
import { companyService, matchesCompanyFilter } from "./companyService"
import { makeCompany } from "@/test/factories"

describe("companyService", () => {
  describe("getCompanies", () => {
    it("lists active companies ordered by sort_order", async () => {
      makeCompany({ name: "TG Global Trade OPC", sort_order: 4 })
      makeCompany({ name: "T3CK Trading", sort_order: 1 })
      makeCompany({ name: "Store CDO", sort_order: 5 })

      const companies = await companyService.getCompanies()
      expect(companies.map((c) => c.name)).toEqual(["T3CK Trading", "TG Global Trade OPC", "Store CDO"])
    })

    it("excludes inactive companies by default", async () => {
      makeCompany({ name: "Active Co", sort_order: 1, is_active: true })
      makeCompany({ name: "Retired Co", sort_order: 2, is_active: false })

      const companies = await companyService.getCompanies()
      expect(companies.map((c) => c.name)).toEqual(["Active Co"])
    })

    it("includes inactive companies when asked", async () => {
      makeCompany({ name: "Active Co", sort_order: 1, is_active: true })
      makeCompany({ name: "Retired Co", sort_order: 2, is_active: false })

      const companies = await companyService.getCompanies(true)
      expect(companies.map((c) => c.name)).toEqual(["Active Co", "Retired Co"])
    })
  })

  describe("matchesCompanyFilter", () => {
    it("passes everything when the filter is ALL", () => {
      expect(matchesCompanyFilter("co-1", "ALL")).toBe(true)
      expect(matchesCompanyFilter(null, "ALL")).toBe(true)
    })

    it("isolates records with no company when the filter is NONE", () => {
      expect(matchesCompanyFilter(null, "NONE")).toBe(true)
      expect(matchesCompanyFilter(undefined, "NONE")).toBe(true)
      expect(matchesCompanyFilter("co-1", "NONE")).toBe(false)
    })

    it("matches a specific company id exactly", () => {
      expect(matchesCompanyFilter("co-1", "co-1")).toBe(true)
      expect(matchesCompanyFilter("co-2", "co-1")).toBe(false)
      expect(matchesCompanyFilter(null, "co-1")).toBe(false)
    })
  })
})
