import { beforeEach, describe, expect, it } from "vitest"
import { purchaseRequestService } from "./purchaseRequestService"
import { opportunityService } from "./opportunityService"
import { db } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { stubRpc } from "@/test/msw/server"
import { stubPurchaseRequestItemRpcs } from "@/test/stubs/purchaseRequestItemRpc"
import { sorLineChange, SOR_LINE_CHANGE } from "@/utils/requestedItem"

/**
 * Requested Items (#305) through the service, against the fake database with
 * the item RPCs re-implemented on its store. What the next person reads: the
 * item as picked, what its SOR line says now, and the post in the request.
 * Who may add is the policy tier's (39-purchase-request-items.test.js).
 */
describe("purchaseRequestService — Requested Items", () => {
  let salesperson
  let opportunity
  let request

  const productList = [
    { product_name: "Full Body Harness", unit: "pc", quantity: 10, unit_price: 5998.1, odoo_product_id: 101 },
    { product_name: "Rope Access Kit", unit: "set", quantity: 2, unit_price: 30000, odoo_product_id: 202 },
  ]

  const lineNamed = async (name) =>
    (await opportunityService.getItems(opportunity.id)).find((l) => l.product_name === name)

  beforeEach(async () => {
    salesperson = makeEmployee({ name: "Sales Person", department: "SALES" })
    opportunity = makeOpportunity({ registered_by: salesperson.id, deal_owner_id: salesperson.id })
    await opportunityService.updateOpportunity(opportunity.id, { items: productList }, salesperson.id)

    request = db.seed("purchase_requests", { opportunity_id: opportunity.id, created_by: salesperson.id })
    db.seed("purchase_request_members", { request_id: request.id, employee_id: salesperson.id, side: "sales" })
    stubPurchaseRequestItemRpcs({ actorId: salesperson.id })
  })

  it("keeps what was picked after updateOpportunity replaces the lines, and reports the new quantity", async () => {
    const harness = await lineNamed("Full Body Harness")
    await purchaseRequestService.addItemFromLine(request.id, harness.id)

    await opportunityService.updateOpportunity(
      opportunity.id,
      { items: [{ ...productList[0], quantity: 12 }, productList[1]] },
      salesperson.id,
    )

    const [item] = await purchaseRequestService.listItems(request.id)
    expect(item).toMatchObject({
      source: "sor_line",
      status: "requested",
      odoo_product_id: 101,
      name: "Full Body Harness",
      quantity: 10,
      unit: "pc",
      sor_line_snapshot: { name: "Full Body Harness", quantity: 10, unit: "pc" },
    })
    expect(sorLineChange(item)).toMatchObject({ kind: SOR_LINE_CHANGE.CHANGED, label: "SOR line now says 12 pc" })
  })

  it("says nothing while the SOR line still says what was picked", async () => {
    const kit = await lineNamed("Rope Access Kit")
    await purchaseRequestService.addItemFromLine(request.id, kit.id)

    // A re-save with the same lines re-creates every line under a new id.
    await opportunityService.updateOpportunity(opportunity.id, { items: productList }, salesperson.id)

    const [item] = await purchaseRequestService.listItems(request.id)
    expect(item.sorLine).toEqual({ found: true, quantity: 2, unit: "set" })
    expect(sorLineChange(item)).toBeNull()
  })

  it("follows the SOR line: the item takes the new quantity, and the request says so", async () => {
    await purchaseRequestService.addItemFromLine(request.id, (await lineNamed("Full Body Harness")).id)
    await opportunityService.updateOpportunity(
      opportunity.id,
      { items: [{ ...productList[0], quantity: 12 }, productList[1]] },
      salesperson.id,
    )

    await purchaseRequestService.updateItemFromSor((await purchaseRequestService.listItems(request.id))[0].id)

    const [item] = await purchaseRequestService.listItems(request.id)
    expect(item).toMatchObject({ quantity: 12, sor_line_snapshot: { quantity: 12, unit: "pc" } })
    expect(sorLineChange(item)).toBeNull()
    const posted = db.internal.rowsOf("purchase_request_messages").find((m) => m.metadata?.event === "item_followed_sor")
    expect(posted.content).toBe("Updated Full Body Harness from 10 pc to 12 pc, as the SOR now says.")
  })

  it("wants a reason once the item is Ordered, and posts it", async () => {
    await purchaseRequestService.addItemFromLine(request.id, (await lineNamed("Full Body Harness")).id)
    const [added] = await purchaseRequestService.listItems(request.id)
    db.internal.rowsOf("purchase_request_items").find((i) => i.id === added.id).status = "ordered"
    await opportunityService.updateOpportunity(
      opportunity.id,
      { items: [{ ...productList[0], quantity: 12 }, productList[1]] },
      salesperson.id,
    )

    await expect(purchaseRequestService.updateItemFromSor(added.id)).rejects.toThrow(/say why/)
    await purchaseRequestService.updateItemFromSor(added.id, "Client added two")
    const posted = db.internal.rowsOf("purchase_request_messages").find((m) => m.metadata?.event === "item_followed_sor")
    expect(posted.content).toMatch(/Reason: Client added two$/)
  })

  it("keeps an item as asked: the flag goes quiet until the SOR changes again", async () => {
    await purchaseRequestService.addItemFromLine(request.id, (await lineNamed("Full Body Harness")).id)
    await opportunityService.updateOpportunity(
      opportunity.id,
      { items: [{ ...productList[0], quantity: 12 }, productList[1]] },
      salesperson.id,
    )
    const [flagged] = await purchaseRequestService.listItems(request.id)
    expect(sorLineChange(flagged)?.kind).toBe(SOR_LINE_CHANGE.CHANGED)

    await purchaseRequestService.keepItemAsAsked(flagged.id)
    expect(sorLineChange((await purchaseRequestService.listItems(request.id))[0])).toBeNull()

    await opportunityService.updateOpportunity(
      opportunity.id,
      { items: [{ ...productList[0], quantity: 15 }, productList[1]] },
      salesperson.id,
    )
    expect(sorLineChange((await purchaseRequestService.listItems(request.id))[0])?.quantity).toBe(15)
  })

  it("says the line is gone once the SOR drops it", async () => {
    const kit = await lineNamed("Rope Access Kit")
    await purchaseRequestService.addItemFromLine(request.id, kit.id)

    await opportunityService.updateOpportunity(opportunity.id, { items: [productList[0]] }, salesperson.id)

    const [item] = await purchaseRequestService.listItems(request.id)
    expect(item.quantity).toBe(2)
    expect(sorLineChange(item)).toEqual({ kind: SOR_LINE_CHANGE.REMOVED, label: "SOR line removed" })
  })

  it("adds a new product with its description and images, and it appears in the request", async () => {
    const images = [{ url: "https://res.cloudinary.com/demo/bracket.jpg", name: "bracket.jpg", type: "image/jpeg", bytes: 2048 }]

    await purchaseRequestService.addNewItem(request.id, {
      name: "Custom mounting bracket",
      quantity: 4,
      unit: "pc",
      description: "Stainless, per the client's drawing",
      images,
    })

    const [item] = await purchaseRequestService.listItems(request.id)
    expect(item).toMatchObject({
      source: "new",
      status: "requested",
      name: "Custom mounting bracket",
      quantity: 4,
      description: "Stainless, per the client's drawing",
      images,
      sor_line_snapshot: null,
      requester: { id: salesperson.id, name: "Sales Person" },
    })
    expect(item.sorLine).toBeUndefined()
  })

  it("posts every added item in the request", async () => {
    const harness = await lineNamed("Full Body Harness")
    await purchaseRequestService.addItemFromLine(request.id, harness.id)
    await purchaseRequestService.addNewItem(request.id, { name: "Custom mounting bracket", quantity: 1 })

    const items = await purchaseRequestService.listItems(request.id)
    const posts = db.rows("purchase_request_messages").filter((m) => m.request_id === request.id)
    expect(posts.map((m) => m.metadata)).toEqual(
      items.map((i) => ({ event: "item_added", item_id: i.id, source: i.source })),
    )
    expect(items.every((i) => i.status === "requested")).toBe(true)
  })

  it("surfaces the refusal of a line the SOR has since re-saved", async () => {
    const harness = await lineNamed("Full Body Harness")
    await opportunityService.updateOpportunity(opportunity.id, { items: productList }, salesperson.id)

    await expect(purchaseRequestService.addItemFromLine(request.id, harness.id)).rejects.toThrow(
      "no longer on this SOR's Product List",
    )
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
