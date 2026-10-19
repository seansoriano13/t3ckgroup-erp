import { describe, expect, it } from "vitest"

import { CONDITION_KINDS, CONDITION_STATUS, evaluateCondition, NEW_CONDITION_KINDS } from "@/constants/stageGate"
import { describeFailing, evaluateOrderCondition, isOrderKind } from "./orderConditions"

const condition = (kind) => ({ id: "c1", kind, label: kind, config: {} })

describe("isOrderKind", () => {
  it("knows Goods checked", () => {
    expect(isOrderKind("goods_checked")).toBe(true)
    expect(isOrderKind("costing_settled")).toBe(false)
  })
})

describe("goods_checked (#465)", () => {
  it("is met when no submitted Transmittal is left open", () => {
    expect(evaluateOrderCondition("goods_checked", { unclosed_slips: 0, unfiled_orders: 4 })).toEqual({
      met: true,
      failing: [],
      messages: [],
    })
  })

  it("is met for an SOR no Transmittal names (the evidence is all zero)", () => {
    expect(evaluateOrderCondition("goods_checked", { unclosed_slips: 0 }).met).toBe(true)
  })

  it("is unmet while any slip is not Closed, and says how many", () => {
    expect(evaluateOrderCondition("goods_checked", { unclosed_slips: 1 })).toEqual({
      met: false,
      failing: ["slips_not_closed"],
      messages: ["1 Transmittal naming this SOR is not Closed yet."],
    })
    expect(evaluateOrderCondition("goods_checked", { unclosed_slips: 3 }).messages).toEqual([
      "3 Transmittals naming this SOR are not Closed yet.",
    ])
  })

  it("fails closed when nobody loaded the evidence", () => {
    const result = evaluateOrderCondition("goods_checked", undefined)
    expect(result.met).toBe(false)
    expect(result.messages).toHaveLength(1)
  })

  it("is unmet for an unknown kind", () => {
    expect(evaluateOrderCondition("nonsense", { unclosed_slips: 0 }).met).toBe(false)
  })

  it("describes an unknown check by its key", () => {
    expect(describeFailing(["mystery"], {})).toEqual(["mystery"])
  })
})

describe("evaluateCondition: goods_checked kind", () => {
  it("is offered in the picker", () => {
    expect(NEW_CONDITION_KINDS).toContain(CONDITION_KINDS.GOODS_CHECKED)
  })

  it("is satisfied when the evidence says nothing is open", () => {
    const result = evaluateCondition(condition("goods_checked"), { orderInputs: { unclosed_slips: 0 } })
    expect(result.status).toBe(CONDITION_STATUS.SATISFIED)
  })

  it("is unsatisfied and carries the failing checks as detail", () => {
    const result = evaluateCondition(condition("goods_checked"), { orderInputs: { unclosed_slips: 2 } })
    expect(result.status).toBe(CONDITION_STATUS.UNSATISFIED)
    expect(result.detail).toEqual({
      failing: ["slips_not_closed"],
      messages: ["2 Transmittals naming this SOR are not Closed yet."],
    })
  })

  it("is unsatisfied with no evidence", () => {
    expect(evaluateCondition(condition("goods_checked")).status).toBe(CONDITION_STATUS.UNSATISFIED)
  })

  it("is not applicable once archived", () => {
    const archived = { ...condition("goods_checked"), archived_at: "2026-10-01T00:00:00Z" }
    expect(evaluateCondition(archived, { orderInputs: { unclosed_slips: 5 } }).status).toBe(CONDITION_STATUS.NOT_APPLICABLE)
  })
})

describe("orders_filed (#466)", () => {
  it("is met when no IPAS is left unfiled", () => {
    expect(evaluateOrderCondition("orders_filed", { unclosed_slips: 4, unfiled_orders: 0 })).toEqual({
      met: true,
      failing: [],
      messages: [],
    })
  })

  it("is unmet while any IPAS is unfiled, and says how many", () => {
    expect(evaluateOrderCondition("orders_filed", { unfiled_orders: 1 })).toEqual({
      met: false,
      failing: ["orders_not_filed"],
      messages: ["1 IPAS naming this SOR is not filed yet."],
    })
    expect(evaluateOrderCondition("orders_filed", { unfiled_orders: 2 }).messages).toEqual([
      "2 IPAS naming this SOR are not filed yet.",
    ])
  })

  it("does not read the Transmittal count, nor Goods checked the IPAS count", () => {
    expect(evaluateOrderCondition("orders_filed", { unclosed_slips: 9, unfiled_orders: 0 }).met).toBe(true)
    expect(evaluateOrderCondition("goods_checked", { unclosed_slips: 0, unfiled_orders: 9 }).met).toBe(true)
  })

  it("fails closed when nobody loaded the evidence", () => {
    expect(evaluateOrderCondition("orders_filed", undefined).met).toBe(false)
  })
})

describe("evaluateCondition: orders_filed kind", () => {
  it("is offered in the picker", () => {
    expect(NEW_CONDITION_KINDS).toContain(CONDITION_KINDS.ORDERS_FILED)
    expect(isOrderKind("orders_filed")).toBe(true)
  })

  it("is satisfied when every IPAS is filed", () => {
    expect(evaluateCondition(condition("orders_filed"), { orderInputs: { unfiled_orders: 0 } }).status).toBe(CONDITION_STATUS.SATISFIED)
  })

  it("is unsatisfied and carries the failing checks as detail", () => {
    const result = evaluateCondition(condition("orders_filed"), { orderInputs: { unfiled_orders: 3 } })
    expect(result.status).toBe(CONDITION_STATUS.UNSATISFIED)
    expect(result.detail).toEqual({
      failing: ["orders_not_filed"],
      messages: ["3 IPAS naming this SOR are not filed yet."],
    })
  })

  it("is unsatisfied with no evidence", () => {
    expect(evaluateCondition(condition("orders_filed")).status).toBe(CONDITION_STATUS.UNSATISFIED)
  })
})
