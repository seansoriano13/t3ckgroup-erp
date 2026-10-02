import { describe, it, expect } from "vitest"
import { ODOO_BASE_URL, odooSaleOrderUrl } from "./odooLinks"

describe("odooSaleOrderUrl", () => {
  it("opens the sale order form in Odoo's backend", () => {
    expect(odooSaleOrderUrl(8286)).toBe(
      "https://t3ckgrouponline.odoo.com/web#id=8286&model=sale.order&view_type=form",
    )
  })

  it("is built on the company's Odoo, not the customer portal", () => {
    expect(odooSaleOrderUrl(1).startsWith(ODOO_BASE_URL)).toBe(true)
    expect(odooSaleOrderUrl(1)).not.toContain("/my/orders")
  })

  it("gives each order its own link", () => {
    expect(odooSaleOrderUrl(1)).not.toBe(odooSaleOrderUrl(2))
  })

  it("reads an id that arrives as a numeric string", () => {
    expect(odooSaleOrderUrl("8286")).toBe(odooSaleOrderUrl(8286))
  })

  it("has no link for an order the sync has not given an Odoo id yet", () => {
    for (const id of [null, undefined, "", 0, -3, 1.5, "abc", NaN]) {
      expect(odooSaleOrderUrl(id)).toBeNull()
    }
  })
})
