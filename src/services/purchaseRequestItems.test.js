import { beforeEach, describe, expect, it } from "vitest"
import { purchaseRequestService } from "./purchaseRequestService"
import { opportunityService } from "./opportunityService"
import { db } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { stubRpc } from "@/test/msw/server"
import { stubPurchaseRequestItemRpcs } from "@/test/stubs/purchaseRequestItemRpc"
import { syncRequestItems } from "@/test/stubs/sorItemSync"
import { isFromS0 } from "@/utils/requestedItem"

/**
 * Requested Items (#305, #678) through the service, against the fake database with the item
 * RPCs and the S0-line triggers re-implemented on its store. What the next person reads: one item
 * per S0 line, kept in step with it, and the post in the request. Who may add is the policy
 * tier's (39-purchase-request-items.test.js, 136-requested-item-follows-s0.test.js).
 */
describe("purchaseRequestService — Requested Items", () => {
  let salesperson
  let opportunity
  let request

  const productList = [
    { product_name: "Full Body Harness", unit: "pc", quantity: 10, unit_price: 5998.1, odoo_product_id: 101, odoo_line_id: 9001 },
    { product_name: "Rope Access Kit", unit: "set", quantity: 2, unit_price: 30000, odoo_product_id: 202, odoo_line_id: 9002 },
  ]

  const readS0 = (items) => opportunityService.updateOpportunity(opportunity.id, { items }, salesperson.id)

  beforeEach(async () => {
    salesperson = makeEmployee({ name: "Sales Person", department: "SALES" })
    opportunity = makeOpportunity({ registered_by: salesperson.id, deal_owner_id: salesperson.id })
    await readS0(productList)

    request = db.seed("purchase_requests", { opportunity_id: opportunity.id, created_by: salesperson.id })
    db.seed("purchase_request_members", { request_id: request.id, employee_id: salesperson.id, side: "sales" })
    stubPurchaseRequestItemRpcs({ actorId: salesperson.id })
    // The request opened: the trigger makes an item for every line already on the SOR.
    syncRequestItems(opportunity.id)
  })

  it("makes one Not checked item for every S0 line, with nobody typing", async () => {
    const items = await purchaseRequestService.listItems(request.id)

    expect(items).toHaveLength(2)
    expect(items.map((i) => [i.name, i.quantity, i.unit, i.status, isFromS0(i)])).toEqual([
      ["Full Body Harness", 10, "pc", "not_checked", true],
      ["Rope Access Kit", 2, "set", "not_checked", true],
    ])
    expect(items[0]).toMatchObject({ source: "sor_line", odoo_product_id: 101, removed_from_s0: false })
  })

  it("adds no duplicates when the S0 is read again, and keeps each item's status", async () => {
    const [harness] = await purchaseRequestService.listItems(request.id)
    db.internal.rowsOf("purchase_request_items").find((i) => i.id === harness.id).status = "to_purchase"

    await readS0(productList)
    await readS0(productList)

    const items = await purchaseRequestService.listItems(request.id)
    expect(items).toHaveLength(2)
    expect(items.find((i) => i.id === harness.id).status).toBe("to_purchase")
  })

  it("shows a quantity changed in Odoo on the item", async () => {
    await readS0([{ ...productList[0], quantity: 12 }, productList[1]])

    const [harness] = await purchaseRequestService.listItems(request.id)
    expect(harness).toMatchObject({ quantity: 12, unit: "pc", sor_line_snapshot: { quantity: 12 } })
  })

  it("adds an item for a line Odoo adds later", async () => {
    await readS0([...productList, { product_name: "Carabiner", unit: "pc", quantity: 20, unit_price: 100, odoo_product_id: 303, odoo_line_id: 9003 }])

    const items = await purchaseRequestService.listItems(request.id)
    expect(items.map((i) => i.name)).toEqual(["Full Body Harness", "Rope Access Kit", "Carabiner"])
  })

  it("keeps the item of a line Odoo dropped, marked Removed from S0", async () => {
    await readS0([productList[0]])

    const items = await purchaseRequestService.listItems(request.id)
    expect(items).toHaveLength(2)
    const kit = items.find((i) => i.name === "Rope Access Kit")
    expect(kit).toMatchObject({ removed_from_s0: true, quantity: 2 })
    expect(isFromS0(kit)).toBe(true)
  })

  it("lists a new product as an Other request, with no SOR line", async () => {
    const images = [{ url: "https://res.cloudinary.com/demo/bracket.jpg", name: "bracket.jpg", type: "image/jpeg", bytes: 2048 }]

    await purchaseRequestService.addNewItem(request.id, {
      name: "Custom mounting bracket",
      quantity: 4,
      unit: "pc",
      description: "Stainless, per the client's drawing",
      images,
    })

    const other = (await purchaseRequestService.listItems(request.id)).find((i) => i.name === "Custom mounting bracket")
    expect(other).toMatchObject({
      source: "new",
      status: "not_checked",
      quantity: 4,
      description: "Stainless, per the client's drawing",
      images,
      sor_line_snapshot: null,
      requester: { id: salesperson.id, name: "Sales Person" },
    })
    expect(isFromS0(other)).toBe(false)
  })

  it("posts an added Other request in the request", async () => {
    await purchaseRequestService.addNewItem(request.id, { name: "Custom mounting bracket", quantity: 1 })

    const other = (await purchaseRequestService.listItems(request.id)).find((i) => i.name === "Custom mounting bracket")
    const posts = db.rows("purchase_request_messages").filter((m) => m.request_id === request.id)
    expect(posts.map((m) => m.metadata)).toEqual([{ event: "item_added", item_id: other.id, source: "new" }])
  })

  it("sends a new product's fields as the RPC names them", async () => {
    let sent
    stubRpc("purchase_request_add_new_item", (args) => {
      sent = args
      return "item-1"
    })

    const id = await purchaseRequestService.addNewItem("r1", { name: "Bracket", quantity: "3" })

    expect(id).toBe("item-1")
    expect(sent).toEqual({
      p_request_id: "r1",
      p_name: "Bracket",
      p_quantity: 3,
      p_unit: null,
      p_description: null,
      p_images: [],
    })
  })
})

/**
 * Adding a new item, adding a substitute and opening a Direct request build
 * one new product's fields the same way (#500): what each sends, pinned.
 */
describe("purchaseRequestService — a new product's fields, on every path", () => {
  const sentTo = (fn) => {
    const calls = []
    stubRpc(fn, (args) => {
      calls.push(args)
      return "id-1"
    })
    return calls
  }
  const fields = { name: "Bracket", quantity: "3", unit: "", description: "" }

  it("sends a substitute's fields as the RPC names them", async () => {
    const sent = sentTo("purchase_request_add_substitute")

    await purchaseRequestService.addSubstitute("item-9", {
      name: "Harness, other brand",
      quantity: "10",
      unit: "pc",
      description: "Same rating",
      images: null,
    })

    expect(sent).toEqual([
      {
        p_item_id: "item-9",
        p_name: "Harness, other brand",
        p_quantity: 10,
        p_unit: "pc",
        p_description: "Same rating",
        p_images: [],
      },
    ])
  })

  it("sends the same name, quantity, unit and description on all three", async () => {
    const added = sentTo("purchase_request_add_new_item")
    const substituted = sentTo("purchase_request_add_substitute")
    const opened = sentTo("purchase_request_open")

    await purchaseRequestService.addNewItem("r1", fields)
    await purchaseRequestService.addSubstitute("item-9", fields)
    await purchaseRequestService.openDirect("Office", [fields])

    const expected = { name: "Bracket", quantity: 3, unit: null, description: null }
    const args = { p_name: "Bracket", p_quantity: 3, p_unit: null, p_description: null, p_images: [] }
    expect(added).toEqual([{ p_request_id: "r1", ...args }])
    expect(substituted).toEqual([{ p_item_id: "item-9", ...args }])
    // A Direct request's items go as one list, and carry no images.
    expect(opened).toEqual([{ p_title: "Office", p_items: [expected] }])
  })
})
