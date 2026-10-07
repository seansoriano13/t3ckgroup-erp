import { describe, it, expect } from "vitest"
import { itemsForVisit, openItems, requestedItemForLine, shapeSorOverview } from "./sorPurchaseRequest"

const item = (over) => ({ id: "i", name: "Hose", source: "sor_line", odoo_product_id: null, status: "requested", created_at: "2026-01-05T00:00:00Z", ...over })

describe("requestedItemForLine", () => {
  it("matches by Odoo product, whatever the line's id or name now is", () => {
    const items = [item({ id: "a", odoo_product_id: 7, name: "Old name" })]
    expect(requestedItemForLine({ id: "new-id", odoo_product_id: 7, product_name: "Renamed" }, items)?.id).toBe("a")
  })

  it("falls back to name for lines and items without an Odoo product", () => {
    const items = [item({ id: "a", name: "  fire HOSE " })]
    expect(requestedItemForLine({ product_name: "Fire Hose" }, items)?.id).toBe("a")
  })

  it("does not name-match an item that has a different Odoo product", () => {
    const items = [item({ id: "a", odoo_product_id: 9, name: "Hose" })]
    expect(requestedItemForLine({ product_name: "Hose" }, items)).toBeNull()
  })

  it("ignores new-product items", () => {
    expect(requestedItemForLine({ product_name: "Hose" }, [item({ source: "new" })])).toBeNull()
  })

  it("prefers an open item, then the newest", () => {
    const items = [
      item({ id: "old-open", odoo_product_id: 7, created_at: "2026-01-01T00:00:00Z" }),
      item({ id: "closed", odoo_product_id: 7, status: "received", created_at: "2026-01-09T00:00:00Z" }),
      item({ id: "new-open", odoo_product_id: 7, created_at: "2026-01-08T00:00:00Z" }),
    ]
    expect(requestedItemForLine({ odoo_product_id: 7 }, items)?.id).toBe("new-open")
    expect(requestedItemForLine({ odoo_product_id: 7 }, items.slice(1, 2))?.id).toBe("closed")
  })

  it("is null with no items", () => {
    expect(requestedItemForLine({ odoo_product_id: 7 }, [])).toBeNull()
    expect(requestedItemForLine({ odoo_product_id: 7 }, null)).toBeNull()
  })
})

describe("itemsForVisit", () => {
  const items = [
    item({ id: "before", created_at: "2026-01-09T23:59:59Z" }),
    item({ id: "at-entry", created_at: "2026-01-10T00:00:00Z" }),
    item({ id: "during", created_at: "2026-01-15T00:00:00Z" }),
    item({ id: "at-exit", created_at: "2026-01-20T00:00:00Z" }),
  ]
  it("owns items created from entry up to leaving", () => {
    const ids = itemsForVisit(items, { enteredAt: "2026-01-10T00:00:00Z", leftAt: "2026-01-20T00:00:00Z" }).map((i) => i.id)
    expect(ids).toEqual(["at-entry", "during"])
  })
  it("an open visit owns everything since entry", () => {
    const ids = itemsForVisit(items, { enteredAt: "2026-01-10T00:00:00Z", leftAt: null }).map((i) => i.id)
    expect(ids).toEqual(["at-entry", "during", "at-exit"])
  })
})

describe("openItems / shapeSorOverview", () => {
  it("counts items not in a closed status", () => {
    expect(openItems([{ status: "requested" }, { status: "ordered" }, { status: "cancelled" }])).toHaveLength(2)
  })
  it("no row is no request", () => {
    expect(shapeSorOverview(undefined)).toBeNull()
  })
  it("shapes the Buyer and items", () => {
    expect(shapeSorOverview({ request_id: "r", buyer_id: "b", buyer_name: "Bo", items: [{ id: "1" }] })).toMatchObject({
      requestId: "r",
      buyer: { id: "b", name: "Bo", avatarPath: null },
      items: [{ id: "1" }],
    })
    expect(shapeSorOverview({ request_id: "r", buyer_id: null, items: null })).toMatchObject({ buyer: null, items: [] })
  })
})
