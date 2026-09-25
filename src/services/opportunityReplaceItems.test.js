/**
 * SOR S07229's Product List, and with it its Estimated Value, doubled on prod
 * on 2026-09-23. SorModal auto-syncs an SOR's items from Odoo on every open
 * (#53), and two overlapping opens (two tabs, or two people on the same deal)
 * each ran replaceItems at once. When replaceItems is two round trips (delete
 * all, then insert), the calls can interleave as delete_A, delete_B, insert_A,
 * insert_B, and both sets land.
 *
 * The real service against the fake Supabase: the fake lets the two calls
 * interleave exactly as the network does. The lock itself is proven against
 * real Postgres in src/test/policy/18-sor-items-atomic-replace.test.js.
 */
import { describe, it, expect } from "vitest"

import { makeEmployee, makeOpportunity } from "../test/factories"
import { opportunityService } from "./opportunityService"

describe("opportunityService.replaceItems under two overlapping saves", () => {
  it("leaves exactly one save's Product List, never both stacked", async () => {
    const owner = makeEmployee()
    const opportunity = makeOpportunity({ registered_by: owner.id })

    const fromTabA = [
      { product_name: "Full Body Harness", unit: "pc", quantity: 10, unit_price: 59981.03 },
      { product_name: "Rope Access Kit", unit: "set", quantity: 2, unit_price: 300000 },
    ]
    const fromTabB = [{ product_name: "Full Body Harness", unit: "pc", quantity: 10, unit_price: 59981.03 }]

    await Promise.all([
      opportunityService.replaceItems(opportunity.id, fromTabA),
      opportunityService.replaceItems(opportunity.id, fromTabB),
    ])

    const items = await opportunityService.getItems(opportunity.id)
    expect([fromTabA.length, fromTabB.length]).toContain(items.length)
  })
})
