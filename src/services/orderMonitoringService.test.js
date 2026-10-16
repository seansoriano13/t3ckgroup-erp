import { describe, expect, it } from "vitest"
import { orderMonitoringService } from "./orderMonitoringService"
import { ORDER_AGEING_STEPS } from "@/constants/orderMonitoring"

/**
 * Order Monitoring ageing rules (#262, spec #261), against the fake database.
 * Every step has at most one rule; a step with no rule reads back as null.
 * Who may write, and the database's own refusals, are the policy tier's
 * (75-order-ageing-rules). Here the service's reading and its checks are proven.
 */

const KEYS = ORDER_AGEING_STEPS.map((step) => step.key)
const daysOf = (rules, step) => rules.find((rule) => rule.step === step).days

describe("orderMonitoringService ageing rules", () => {
  it("lists every step in order, each with no rule, before anyone sets one", async () => {
    const rules = await orderMonitoringService.getRules()

    expect(rules.map((rule) => rule.step)).toEqual(KEYS)
    expect(rules.every((rule) => rule.days === null)).toBe(true)
  })

  it("reads back the days once a rule is set", async () => {
    await orderMonitoringService.setRule("import_clearance", 3)

    expect(daysOf(await orderMonitoringService.getRules(), "import_clearance")).toBe(3)
  })

  it("replaces a rule rather than adding a second one for the same step", async () => {
    await orderMonitoringService.setRule("create_bill", 7)
    await orderMonitoringService.setRule("create_bill", 10)

    const rules = await orderMonitoringService.getRules()
    expect(rules).toHaveLength(KEYS.length)
    expect(daysOf(rules, "create_bill")).toBe(10)
  })

  it("clearing a rule reads back as no rule", async () => {
    await orderMonitoringService.setRule("import_clearance", 3)
    await orderMonitoringService.setRule("import_clearance", null)

    expect(daysOf(await orderMonitoringService.getRules(), "import_clearance")).toBeNull()
  })

  it("refuses a day count that is not a positive whole number, and writes nothing", async () => {
    await expect(orderMonitoringService.setRule("create_bill", 0)).rejects.toThrow()
    await expect(orderMonitoringService.setRule("create_bill", -2)).rejects.toThrow()
    await expect(orderMonitoringService.setRule("create_bill", 2.5)).rejects.toThrow()

    expect(daysOf(await orderMonitoringService.getRules(), "create_bill")).toBeNull()
  })

  it("refuses a step that is not one of the ten", async () => {
    await expect(orderMonitoringService.setRule("not_a_step", 3)).rejects.toThrow()
  })
})
