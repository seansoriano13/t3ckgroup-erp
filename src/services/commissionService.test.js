import { beforeEach, describe, expect, it } from "vitest"
import { commissionService } from "./commissionService"
import {
  makeCommissionDepartment,
  makeCommissionPosition,
  makeCommissionRate,
  makeCommissionSplit,
  makeEmployee,
  makeOpportunity,
  makeSuperAdmin,
} from "@/test/factories"

const seedRates = () => {
  makeCommissionRate({ rate_type: "VAT", percent: 12, effective_from: "2000-01-01" })
  makeCommissionRate({ rate_type: "WITHHOLDING", percent: 8, effective_from: "2000-01-01" })
  makeCommissionRate({ rate_type: "POOL", percent: 1, effective_from: "2000-01-01" })
}

const seedDepartments = () => {
  makeCommissionDepartment({ key: "sales", name: "Sales", allocation_percent: 50 })
  makeCommissionDepartment({ key: "operations", name: "Operations", allocation_percent: 25 })
  makeCommissionDepartment({ key: "administration", name: "Administration", allocation_percent: 15 })
  makeCommissionDepartment({ key: "human_resources", name: "Human Resources", allocation_percent: 5 })
  makeCommissionDepartment({ key: "finance_accounting", name: "Finance & Accounting", allocation_percent: 5 })
}

describe("commissionService", () => {
  beforeEach(() => {
    seedRates()
    seedDepartments()
  })

  describe("getEffectiveRates", () => {
    it("resolves the currently-effective VAT, Withholding, and Pool percentages", async () => {
      const rates = await commissionService.getEffectiveRates()

      expect(rates).toEqual({ vatPercent: 12, withholdingPercent: 8, poolPercent: 1 })
    })

    it("picks the latest rate on or before the given date when multiple exist", async () => {
      makeCommissionRate({ rate_type: "POOL", percent: 2, effective_from: "2026-06-01" })

      const before = await commissionService.getEffectiveRates("2026-05-01")
      const after = await commissionService.getEffectiveRates("2026-07-01")

      expect(before.poolPercent).toBe(1)
      expect(after.poolPercent).toBe(2)
    })

    it("throws when a rate type has no effective row for the given date", async () => {
      await expect(commissionService.getEffectiveRates("1999-01-01")).rejects.toThrow(/No effective Commission Rate/)
    })
  })

  describe("getDepartments", () => {
    it("returns every Commission Department with its allocation percentage", async () => {
      const departments = await commissionService.getDepartments()

      expect(departments).toHaveLength(5)
      expect(departments.find((d) => d.name === "Sales")).toMatchObject({ allocationPercent: 50 })
    })
  })

  describe("getCommissionBreakdownForOpportunity", () => {
    it("attributes the entire Sales share to the deal owner on a Single Salesperson Project", async () => {
      const owner = makeEmployee({ name: "Ben Cruz" })
      const opportunity = makeOpportunity({
        project_type: "SSP",
        expected_value: 1_000_000,
        deal_owner_id: owner.id,
      })

      const breakdown = await commissionService.getCommissionBreakdownForOpportunity(opportunity.id)

      expect(breakdown.commissionableRevenue).toBeCloseTo(821_428.57, 2)
      expect(breakdown.commissionPool).toBeCloseTo(8_214.29, 2)
      expect(breakdown.departmentShares).toHaveLength(5)
      expect(breakdown.salesRoleShares).toHaveLength(1)
      expect(breakdown.salesRoleShares[0].role).toBe("deal_owner")
      expect(breakdown.salesRoleShares[0].employee).toMatchObject({ id: owner.id, name: "Ben Cruz" })
      expect(breakdown.salesRoleShares[0].amount).toBeCloseTo(4_107.14, 2)
    })

    it("returns no Sales role shares for a non-SSP project", async () => {
      const opportunity = makeOpportunity({ project_type: "CP", expected_value: 500_000 })

      const breakdown = await commissionService.getCommissionBreakdownForOpportunity(opportunity.id)

      expect(breakdown.salesRoleShares).toEqual([])
    })

    it("is visible for an opportunity at any pipeline stage, including Lead", async () => {
      const opportunity = makeOpportunity({ status: "LEAD", expected_value: 200_000 })

      const breakdown = await commissionService.getCommissionBreakdownForOpportunity(opportunity.id)

      expect(breakdown.commissionPool).toBeGreaterThan(0)
    })

    it("splits a Collaborative Project's Sales share across deal owner, both support salespeople, and sales director", async () => {
      makeCommissionSplit({ project_type: "CP", share_role: "deal_owner", percent: 40 })
      makeCommissionSplit({ project_type: "CP", share_role: "supporting_salesperson", percent: 30 })
      makeCommissionSplit({ project_type: "CP", share_role: "sales_director", percent: 30 })

      const owner = makeEmployee({ name: "Deal Owner" })
      const support1 = makeEmployee({ name: "Support One" })
      const support2 = makeEmployee({ name: "Support Two" })
      const director = makeEmployee({ name: "Director" })
      const opportunity = makeOpportunity({
        project_type: "CP",
        expected_value: 1_000_000,
        deal_owner_id: owner.id,
        support_sales_1_id: support1.id,
        support_sales_2_id: support2.id,
        sales_director_id: director.id,
      })

      const breakdown = await commissionService.getCommissionBreakdownForOpportunity(opportunity.id)

      expect(breakdown.salesRoleShares).toHaveLength(4)
      const byRole = (role) => breakdown.salesRoleShares.filter((s) => s.role === role)
      expect(byRole("deal_owner")).toHaveLength(1)
      expect(byRole("supporting_salesperson")).toHaveLength(2)
      expect(byRole("sales_director")).toHaveLength(1)

      const [s1, s2] = byRole("supporting_salesperson")
      expect(s1.amount).toBeCloseTo(s2.amount, 5)
      expect(s1.employee.name).toBe("Support One")
      expect(s2.employee.name).toBe("Support Two")
    })

    it("treats the support-salesperson pair as unordered — one filled slot gets the full supporting share", async () => {
      makeCommissionSplit({ project_type: "CP", share_role: "deal_owner", percent: 40 })
      makeCommissionSplit({ project_type: "CP", share_role: "supporting_salesperson", percent: 30 })
      makeCommissionSplit({ project_type: "CP", share_role: "sales_director", percent: 30 })

      const owner = makeEmployee({ name: "Deal Owner" })
      const support2 = makeEmployee({ name: "Only Support" })
      const opportunity = makeOpportunity({
        project_type: "CP",
        expected_value: 1_000_000,
        deal_owner_id: owner.id,
        support_sales_1_id: null,
        support_sales_2_id: support2.id,
        sales_director_id: null,
      })

      const breakdown = await commissionService.getCommissionBreakdownForOpportunity(opportunity.id)

      const supporting = breakdown.salesRoleShares.filter((s) => s.role === "supporting_salesperson")
      expect(supporting).toHaveLength(1)
      expect(supporting[0].employee.name).toBe("Only Support")

      const salesShare = breakdown.departmentShares.find((d) => d.name === "Sales").amount
      expect(supporting[0].amount).toBeCloseTo(salesShare * 0.3, 5)
    })

    it("anchors to the rate effective on the opportunity's Contract Date once it has one", async () => {
      makeCommissionRate({ rate_type: "POOL", percent: 2, effective_from: "2026-06-01" })
      const opportunity = makeOpportunity({
        expected_value: 1_000_000,
        contract_date: "2026-03-01",
      })

      const breakdown = await commissionService.getCommissionBreakdownForOpportunity(opportunity.id)

      // Contract Date (2026-03-01) predates the newer 2% Pool rate
      // (effective 2026-06-01), so the original 1% still applies.
      expect(breakdown.commissionPool).toBeCloseTo(8_214.29, 2)
      expect(breakdown.rateAsOfDate).toBe("2026-03-01")
    })

    it("uses the newer rate once the Contract Date is on or after its effective date", async () => {
      makeCommissionRate({ rate_type: "POOL", percent: 2, effective_from: "2026-06-01" })
      const opportunity = makeOpportunity({
        expected_value: 1_000_000,
        contract_date: "2026-07-01",
      })

      const breakdown = await commissionService.getCommissionBreakdownForOpportunity(opportunity.id)

      expect(breakdown.commissionPool).toBeCloseTo(16_428.57, 2)
    })
  })

  describe("listRateHistory", () => {
    it("returns every rate, most recent first", async () => {
      makeCommissionRate({ rate_type: "POOL", percent: 2, effective_from: "2026-06-01" })

      const history = await commissionService.listRateHistory()

      expect(history[0]).toMatchObject({ rate_type: "POOL", percent: 2, effective_from: "2026-06-01" })
    })
  })

  describe("createRate", () => {
    it("adds a new dated rate that the next lookup picks up", async () => {
      const admin = makeSuperAdmin()

      await commissionService.createRate({ rateType: "POOL", percent: 3, effectiveFrom: "2027-01-01" }, admin.id)

      const rates = await commissionService.getEffectiveRates("2027-02-01")
      expect(rates.poolPercent).toBe(3)
    })

    it("rejects an unknown rate type", async () => {
      const admin = makeSuperAdmin()

      await expect(
        commissionService.createRate({ rateType: "SALES_TAX", percent: 1, effectiveFrom: "2027-01-01" }, admin.id),
      ).rejects.toThrow(/Rate type must be one of/)
    })

    it("rejects a non-Super-Admin without writing anything", async () => {
      const regular = makeEmployee()
      const before = await commissionService.listRateHistory()

      await expect(
        commissionService.createRate({ rateType: "POOL", percent: 3, effectiveFrom: "2027-01-01" }, regular.id),
      ).rejects.toThrow(/Only a Super Admin/)

      expect(await commissionService.listRateHistory()).toEqual(before)
    })
  })

  describe("saveDepartmentAllocations", () => {
    it("persists new allocation percentages that sum to 100", async () => {
      const admin = makeSuperAdmin()
      const departments = await commissionService.getDepartments()

      await commissionService.saveDepartmentAllocations(
        departments.map((d) => ({
          id: d.id,
          name: d.name,
          allocationPercent: d.name === "Sales" ? 60 : d.allocationPercent - 2.5,
        })),
        admin.id,
      )

      const updated = await commissionService.getDepartments()
      expect(updated.find((d) => d.name === "Sales").allocationPercent).toBe(60)
    })

    it("rejects a set that does not sum to 100 without writing anything", async () => {
      const admin = makeSuperAdmin()
      const before = await commissionService.getDepartments()

      await expect(
        commissionService.saveDepartmentAllocations([{ id: before[0].id, name: "Sales", allocationPercent: 60 }], admin.id),
      ).rejects.toThrow(/must sum to 100/)

      const after = await commissionService.getDepartments()
      expect(after).toEqual(before)
    })

    it("rejects a non-Super-Admin without writing anything", async () => {
      const regular = makeEmployee()
      const before = await commissionService.getDepartments()

      await expect(
        commissionService.saveDepartmentAllocations(
          before.map((d) => ({ id: d.id, name: d.name, allocationPercent: d.allocationPercent })),
          regular.id,
        ),
      ).rejects.toThrow(/Only a Super Admin/)

      expect(await commissionService.getDepartments()).toEqual(before)
    })
  })

  describe("getPositions / savePositionAllocations", () => {
    it("lists positions scoped to their department", async () => {
      const sales = makeCommissionDepartment({ name: "Sales Dept" })
      const ops = makeCommissionDepartment({ name: "Ops Dept" })
      makeCommissionPosition({ department_id: sales.id, name: "Account Executive", allocation_percent: 100 })
      makeCommissionPosition({ department_id: ops.id, name: "Ops Staff", allocation_percent: 100 })

      const positions = await commissionService.getPositions(sales.id)

      expect(positions).toEqual([
        expect.objectContaining({ name: "Account Executive", allocationPercent: 100 }),
      ])
    })

    it("rejects a position set that does not sum to 100", async () => {
      const admin = makeSuperAdmin()
      const dept = makeCommissionDepartment({ name: "Ops Dept 2" })

      await expect(
        commissionService.savePositionAllocations(dept.id, [{ name: "Manager", allocationPercent: 60 }], admin.id),
      ).rejects.toThrow(/must sum to 100/)
    })

    it("rejects a non-Super-Admin without writing anything", async () => {
      const regular = makeEmployee()
      const dept = makeCommissionDepartment({ name: "Ops Dept 3" })
      makeCommissionPosition({ department_id: dept.id, name: "Manager", allocation_percent: 100 })
      const before = await commissionService.getPositions(dept.id)

      await expect(
        commissionService.savePositionAllocations(dept.id, [{ name: "Someone Else", allocationPercent: 100 }], regular.id),
      ).rejects.toThrow(/Only a Super Admin/)

      expect(await commissionService.getPositions(dept.id)).toEqual(before)
    })

    it("adds new positions and removes ones no longer in the saved set", async () => {
      const admin = makeSuperAdmin()
      const dept = makeCommissionDepartment({ name: "Ops Dept 4" })
      const toRemove = makeCommissionPosition({ department_id: dept.id, name: "Old Role", allocation_percent: 100 })

      await commissionService.savePositionAllocations(
        dept.id,
        [{ name: "New Role", allocationPercent: 100 }],
        admin.id,
      )

      const after = await commissionService.getPositions(dept.id)
      expect(after.map((p) => p.name)).toEqual(["New Role"])
      expect(after.find((p) => p.id === toRemove.id)).toBeUndefined()
    })
  })

  describe("isSalesDirector", () => {
    it("is true for an employee set as sales_director_id on any opportunity", async () => {
      const director = makeEmployee({ name: "Director" })
      makeOpportunity({ sales_director_id: director.id })

      expect(await commissionService.isSalesDirector(director.id)).toBe(true)
    })

    it("is false for an employee never set as a sales director", async () => {
      const regular = makeEmployee()

      expect(await commissionService.isSalesDirector(regular.id)).toBe(false)
    })
  })

  describe("saveSplitsForProjectType", () => {
    it("persists split percentages that the next breakdown picks up", async () => {
      const admin = makeSuperAdmin()
      const owner = makeEmployee({ name: "Deal Owner" })
      const opportunity = makeOpportunity({ project_type: "CP", expected_value: 1_000_000, deal_owner_id: owner.id })

      await commissionService.saveSplitsForProjectType(
        "CP",
        [{ shareRole: "deal_owner", percent: 100 }],
        admin.id,
      )

      const breakdown = await commissionService.getCommissionBreakdownForOpportunity(opportunity.id)
      expect(breakdown.salesRoleShares).toHaveLength(1)
      expect(breakdown.salesRoleShares[0].amount).toBeCloseTo(breakdown.departmentShares.find((d) => d.name === "Sales").amount, 5)
    })

    it("rejects a split set that does not sum to 100", async () => {
      const admin = makeSuperAdmin()

      await expect(
        commissionService.saveSplitsForProjectType("CP", [{ shareRole: "deal_owner", percent: 50 }], admin.id),
      ).rejects.toThrow(/must sum to 100/)
    })

    it("allows an opportunity's own Sales Director to edit", async () => {
      const director = makeEmployee({ name: "Director" })
      makeOpportunity({ sales_director_id: director.id })

      await expect(
        commissionService.saveSplitsForProjectType("CP", [{ shareRole: "deal_owner", percent: 100 }], director.id),
      ).resolves.not.toThrow()
    })

    it("rejects an ordinary salesperson who is not a Sales Director on any opportunity", async () => {
      const salesperson = makeEmployee({ has_sales_flow: true })

      await expect(
        commissionService.saveSplitsForProjectType("CP", [{ shareRole: "deal_owner", percent: 100 }], salesperson.id),
      ).rejects.toThrow(/Only a Sales Director or Super Admin/)
    })
  })
})
