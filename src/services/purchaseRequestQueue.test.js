/**
 * The Procurement Queue's service (#308): `listQueue` reads `purchase_request_queue` and
 * slices it with `filterQueue`; `get` reads one request. What `purchase_request_queue`
 * returns to whom is the policy tier's (44-procurement-queue).
 */
import { beforeEach, describe, expect, it } from "vitest"
import { stubRpc } from "@/test/msw/server"
import {
  QUEUE_BUYER,
  QUEUE_KIND,
  QUEUE_STATE,
  filterQueue,
  isRequestClosed,
  purchaseRequestService,
} from "./purchaseRequestService"

const ME = "me"
const rows = [
  { id: "a", buyer_id: null, item_count: 0, open_count: 0 },
  { id: "b", buyer_id: null, item_count: 2, open_count: 1 },
  { id: "c", buyer_id: ME, item_count: 1, open_count: 1 },
  { id: "d", buyer_id: ME, item_count: 2, open_count: 0 },
  { id: "e", buyer_id: "someone", item_count: 1, open_count: 0 },
]
const ids = (list) => list.map((r) => r.id)

describe("filterQueue", () => {
  it("a request with nothing asked for yet is open; one whose items are all closed is closed", () => {
    expect(isRequestClosed(rows[0])).toBe(false)
    expect(isRequestClosed(rows[1])).toBe(false)
    expect(isRequestClosed(rows[3])).toBe(true)
  })

  it("slices by Buyer and by open or closed, together", () => {
    expect(ids(filterQueue(rows, { buyer: QUEUE_BUYER.UNASSIGNED }))).toEqual(["a", "b"])
    expect(ids(filterQueue(rows, { buyer: QUEUE_BUYER.MINE }, ME))).toEqual(["c", "d"])
    expect(ids(filterQueue(rows, { buyer: QUEUE_BUYER.MINE }))).toEqual([])
    expect(ids(filterQueue(rows, { state: QUEUE_STATE.OPEN }))).toEqual(["a", "b", "c"])
    expect(ids(filterQueue(rows, { state: QUEUE_STATE.CLOSED }))).toEqual(["d", "e"])
    expect(ids(filterQueue(rows, { buyer: QUEUE_BUYER.MINE, state: QUEUE_STATE.OPEN }, ME))).toEqual(["c"])
    expect(ids(filterQueue(rows, {}))).toEqual(["a", "b", "c", "d", "e"])
  })

  it("narrows by kind: Project has an SOR, Direct has none (#179)", () => {
    const mixed = [
      { id: "p", opportunity_id: "o1", item_count: 1, open_count: 1 },
      { id: "d", opportunity_id: null, title: "Toner", item_count: 1, open_count: 1 },
    ]
    expect(ids(filterQueue(mixed, { kind: QUEUE_KIND.PROJECT }))).toEqual(["p"])
    expect(ids(filterQueue(mixed, { kind: QUEUE_KIND.DIRECT }))).toEqual(["d"])
    expect(ids(filterQueue(mixed, { kind: QUEUE_KIND.ALL }))).toEqual(["p", "d"])
  })
})

describe("opening a Direct request", () => {
  it("sends the title and the items as the RPC wants them", async () => {
    let sent
    stubRpc("purchase_request_open", (args) => {
      sent = args
      return "r9"
    })

    const id = await purchaseRequestService.openDirect("Office", [
      { name: "Toner", quantity: "2", unit: "pc", description: "" },
    ])

    expect(id).toBe("r9")
    expect(sent).toEqual({
      p_title: "Office",
      p_items: [{ name: "Toner", quantity: 2, unit: "pc", description: null }],
      p_for_opportunity_id: null,
    })
  })
})

describe("purchaseRequestService queue reads", () => {
  let calls
  beforeEach(() => {
    calls = []
    stubRpc("purchase_request_queue", (args) => {
      calls.push(args)
      return args?.p_request_id ? rows.filter((r) => r.id === args.p_request_id) : rows
    })
  })

  it("listQueue reads purchase_request_queue and applies the filter", async () => {
    expect(ids(await purchaseRequestService.listQueue())).toEqual(["a", "b", "c", "d", "e"])
    expect(
      ids(await purchaseRequestService.listQueue({ filter: { buyer: QUEUE_BUYER.MINE, state: QUEUE_STATE.OPEN }, userId: ME })),
    ).toEqual(["c"])
  })

  it("get reads one request, or null", async () => {
    expect(await purchaseRequestService.get("c")).toMatchObject({ id: "c" })
    expect(calls.at(-1)).toEqual({ p_request_id: "c" })
    expect(await purchaseRequestService.get("zzz")).toBeNull()
    expect(await purchaseRequestService.get(null)).toBeNull()
  })
})
