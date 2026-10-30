import { describe, expect, it } from "vitest"

import { CONDITION_KINDS, CONDITION_STATUS, evaluateCondition, NEW_CONDITION_KINDS } from "@/constants/stageGate"
import { describeFailing, evaluateOrderCondition, isOrderKind } from "./orderConditions"

const condition = (kind) => ({ id: "c1", kind, label: kind, config: {} })
const slips = [{ number: "TG03-581", state: "closed" }]
const orders = [{ number: "IPAS_0171", state: "filed" }]

describe("isOrderKind", () => {
  it("knows Goods checked", () => {
    expect(isOrderKind("goods_checked")).toBe(true)
    expect(isOrderKind("costing_settled")).toBe(false)
  })
})

describe("goods_checked (#465)", () => {
  it("is met when a Transmittal names the SOR and none is left open, and names each one", () => {
    expect(evaluateOrderCondition("goods_checked", { unclosed_slips: 0, unfiled_orders: 4, slips })).toEqual({
      met: true,
      failing: [],
      messages: [],
      basis: [{ number: "TG03-581", state: "Closed" }],
    })
  })

  it("is unmet for an SOR no Transmittal names: nothing is ticked without a basis", () => {
    expect(evaluateOrderCondition("goods_checked", { unclosed_slips: 0, slips: [] })).toEqual({
      met: false,
      failing: ["no_slips"],
      messages: ["No Transmittal names this SOR yet."],
      basis: [],
    })
    expect(evaluateOrderCondition("goods_checked", { unclosed_slips: 0 }).failing).toEqual(["no_slips"])
  })

  it("is unmet while any slip is not Closed, and says how many", () => {
    const open = [{ number: "TG03-590", state: "technical_inspection" }]
    expect(evaluateOrderCondition("goods_checked", { unclosed_slips: 1, slips: open })).toEqual({
      met: false,
      failing: ["slips_not_closed"],
      messages: ["1 Transmittal naming this SOR is not Closed yet."],
      basis: [{ number: "TG03-590", state: "Waiting on Technical" }],
    })
    expect(evaluateOrderCondition("goods_checked", { unclosed_slips: 3, slips: open }).messages).toEqual([
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

  it("is satisfied when the evidence says nothing is open, and keeps the Transmittals as its basis", () => {
    const result = evaluateCondition(condition("goods_checked"), { orderInputs: { unclosed_slips: 0, slips } })
    expect(result.status).toBe(CONDITION_STATUS.SATISFIED)
    expect(result.detail.basis).toEqual([{ number: "TG03-581", state: "Closed" }])
  })

  it("is unsatisfied and carries the failing checks as detail", () => {
    const result = evaluateCondition(condition("goods_checked"), { orderInputs: { unclosed_slips: 2, slips } })
    expect(result.status).toBe(CONDITION_STATUS.UNSATISFIED)
    expect(result.detail).toEqual({
      failing: ["slips_not_closed"],
      messages: ["2 Transmittals naming this SOR are not Closed yet."],
      basis: [{ number: "TG03-581", state: "Closed" }],
    })
  })

  it("is unsatisfied when no Transmittal names the SOR", () => {
    const result = evaluateCondition(condition("goods_checked"), { orderInputs: { unclosed_slips: 0, slips: [] } })
    expect(result.status).toBe(CONDITION_STATUS.UNSATISFIED)
    expect(result.detail.failing).toEqual(["no_slips"])
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
  it("is met when an IPAS names the SOR and none is left unfiled, and names each one", () => {
    expect(evaluateOrderCondition("orders_filed", { unclosed_slips: 4, unfiled_orders: 0, orders })).toEqual({
      met: true,
      failing: [],
      messages: [],
      basis: [{ number: "IPAS_0171", state: "Filed" }],
    })
  })

  it("is unmet for an SOR no IPAS names: nothing is ticked without a basis", () => {
    expect(evaluateOrderCondition("orders_filed", { unfiled_orders: 0, orders: [] })).toEqual({
      met: false,
      failing: ["no_orders"],
      messages: ["No IPAS names this SOR yet."],
      basis: [],
    })
  })

  it("is unmet while any IPAS is unfiled, and says how many", () => {
    expect(evaluateOrderCondition("orders_filed", { unfiled_orders: 1, orders }).messages).toEqual([
      "1 IPAS naming this SOR is not filed yet.",
    ])
    expect(evaluateOrderCondition("orders_filed", { unfiled_orders: 2, orders }).messages).toEqual([
      "2 IPAS naming this SOR are not filed yet.",
    ])
  })

  it("does not read the Transmittals, nor Goods checked the IPAS", () => {
    expect(evaluateOrderCondition("orders_filed", { unclosed_slips: 9, unfiled_orders: 0, orders, slips: [] }).met).toBe(true)
    expect(evaluateOrderCondition("goods_checked", { unclosed_slips: 0, unfiled_orders: 9, slips, orders: [] }).met).toBe(true)
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
    expect(evaluateCondition(condition("orders_filed"), { orderInputs: { unfiled_orders: 0, orders } }).status).toBe(CONDITION_STATUS.SATISFIED)
  })

  it("is unsatisfied and carries the failing checks as detail", () => {
    const result = evaluateCondition(condition("orders_filed"), { orderInputs: { unfiled_orders: 3, orders } })
    expect(result.status).toBe(CONDITION_STATUS.UNSATISFIED)
    expect(result.detail).toEqual({
      failing: ["orders_not_filed"],
      messages: ["3 IPAS naming this SOR are not filed yet."],
      basis: [{ number: "IPAS_0171", state: "Filed" }],
    })
  })

  it("is unsatisfied with no evidence", () => {
    expect(evaluateCondition(condition("orders_filed")).status).toBe(CONDITION_STATUS.UNSATISFIED)
  })
})
