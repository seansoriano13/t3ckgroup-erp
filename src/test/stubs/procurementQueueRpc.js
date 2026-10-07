import { stubRpc } from "@/test/msw/server"
import { db, insertRow, updateRow } from "@/test/db/store"
import { pgrstError } from "@/test/db/schema"
import { isClosedStatus } from "@/constants/purchaseRequest"

const rowsOf = (table) => db.internal.rowsOf(table)
const findRow = (table, id) => rowsOf(table).find((row) => row.id === id)

/**
 * Issue #308 — the Procurement Queue's RPCs re-implemented on the fake
 * database's store: `pr_queue` (20261007180800_procurement_queue.sql), and
 * #307's `pr_take` / `pr_set_buyer` with the member they add and the event
 * they post. The fake has no signed-in identity or RLS, so `actorId` stands in
 * for get_employee_id(), every request is readable, and `canManage` stands in
 * for purchase_request_can_manage_members. Who may read and take is proven
 * in the policy tier (44-procurement-queue, 41-purchase-request-chat-and-buyer).
 */
export function stubProcurementQueueRpcs({ actorId, canManage = false }) {
  const queueRow = (r) => {
    const sor = findRow("sales_opportunities", r.opportunity_id)
    const stage = sor?.flow_stage_id ? findRow("flow_stages", sor.flow_stage_id) : null
    const buyer = r.buyer_id ? findRow("employees", r.buyer_id) : null
    const items = rowsOf("purchase_request_items").filter((i) => i.request_id === r.id)
    const lastMessage = rowsOf("purchase_request_messages")
      .filter((m) => m.request_id === r.id)
      .map((m) => m.created_at)
      .sort()
      .at(-1)
    return {
      id: r.id,
      opportunity_id: r.opportunity_id,
      sales_reference: sor?.sales_reference || sor?.opportunity_no || null,
      project_title: sor?.project_title ?? null,
      stage_name: stage?.name ?? null,
      buyer_id: r.buyer_id ?? null,
      buyer_name: buyer?.name ?? null,
      buyer_avatar_path: buyer?.avatar_path ?? null,
      created_at: r.created_at,
      updated_at: r.updated_at,
      item_count: items.length,
      open_count: items.filter((i) => !isClosedStatus(i.status)).length,
      last_activity_at: [r.updated_at, lastMessage].filter(Boolean).sort().at(-1) ?? null,
    }
  }

  stubRpc("pr_queue", (args) =>
    rowsOf("purchase_requests")
      .filter((r) => !args?.p_request_id || r.id === args.p_request_id)
      .map(queueRow)
      .sort((a, b) => String(b.last_activity_at).localeCompare(String(a.last_activity_at))),
  )

  stubRpc("purchase_request_can_manage_members", () => canManage)

  const ensureMember = (requestId, employeeId) => {
    const inside = rowsOf("purchase_request_members").some(
      (m) => m.request_id === requestId && m.employee_id === employeeId,
    )
    if (!inside) {
      insertRow("purchase_request_members", {
        request_id: requestId,
        employee_id: employeeId,
        side: "purchasing",
        added_by: actorId,
      })
    }
  }
  const postBuyerEvent = (requestId, buyerId, previous, content) =>
    insertRow("purchase_request_messages", {
      request_id: requestId,
      author_id: actorId,
      content,
      metadata: { event: "buyer_set", buyer_id: buyerId, previous_buyer_id: previous },
    })

  stubRpc("pr_take", (args) => {
    const request = findRow("purchase_requests", args.p_request_id)
    if (!request) throw pgrstError("P0002", "pr_take: request not found")
    if (request.buyer_id) {
      const name = findRow("employees", request.buyer_id)?.name || "someone else"
      throw pgrstError("55000", `pr_take: ${name} is already the Buyer`)
    }
    const updated = updateRow("purchase_requests", request, { buyer_id: actorId })
    ensureMember(request.id, actorId)
    const name = findRow("employees", actorId)?.name || "Someone"
    postBuyerEvent(request.id, actorId, null, `${name} took the request as Buyer.`)
    return updated
  })

  stubRpc("pr_set_buyer", (args) => {
    const request = findRow("purchase_requests", args.p_request_id)
    if (!request) throw pgrstError("P0002", "pr_set_buyer: request not found")
    const next = args.p_employee_id || null
    const updated = updateRow("purchase_requests", request, { buyer_id: next })
    if (next) ensureMember(request.id, next)
    postBuyerEvent(
      request.id,
      next,
      request.buyer_id ?? null,
      next ? `${findRow("employees", next)?.name || "Someone"} is the Buyer.` : "The request has no Buyer now; it is back in the queue.",
    )
    return updated
  })
}
