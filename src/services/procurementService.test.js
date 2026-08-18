import { beforeEach, describe, expect, it } from "vitest"
import { procurementService } from "./procurementService"
import { opportunityService } from "./opportunityService"
import { db, updateRow } from "@/test/db/store"
import { makeEmployee, makeOpportunity, makeCategory } from "@/test/factories"
import { waitForNetworkIdle } from "@/test/network"
import { stubEdgeFunction, stubRpc } from "@/test/msw/server"
import { PROCUREMENT_OUTCOME, PO_VERIFICATION } from "@/constants/procurement"
import { TASK_STATUS } from "@/constants/status"

/**
 * SOR → Purchasing procurement, exercised through the service's public methods
 * against the fake PostgREST.
 *
 * What is asserted is what the next person reads out of the system: who was
 * asked, what came back per product, and who got told — not how the service got
 * there. See docs/sor-procurement-flow-decisions.md.
 */
describe("procurementService", () => {
  let salesperson
  let buyer
  let purchasingHead
  let operationsHead
  let opportunity

  const items = [
    {
      product_name: "Hydraulic hose kit",
      quantity: 5,
      unit: "set",
      description: "5m, high-pressure, client sent a spec sheet",
      images: [],
    },
    {
      product_name: "Safety harness",
      quantity: 3,
      unit: "pc",
      description: "",
      images: [{ url: "https://res.cloudinary.com/t3ck/harness.jpg", name: "harness.jpg" }],
    },
  ]

  beforeEach(() => {
    salesperson = makeEmployee({ name: "Ana Reyes", department: "SALES" })

    // Mirrors the real org: purchasing is a sub-department under OPERATIONS,
    // which has its own department-level head. Flattening this in the fixture
    // would hide the routing bug it exists to catch.
    operationsHead = makeEmployee({
      name: "Gracean Escobedo",
      department: "OPERATIONS",
      sub_department: null,
      is_head: true,
    })
    purchasingHead = makeEmployee({
      name: "Raquel Galacgac",
      department: "OPERATIONS",
      sub_department: "PURCHASING",
      is_head: true,
    })
    buyer = makeEmployee({
      name: "Cjay Espina",
      department: "OPERATIONS",
      sub_department: "PURCHASING",
    })
    makeCategory({
      category_id: "OPS-PUR-1",
      department: "OPERATIONS",
      sub_department: "PURCHASING",
    })
    opportunity = makeOpportunity({
      registered_by: salesperson.id,
      deal_owner_id: salesperson.id,
      client_name: "ACME Corp",
      sales_reference: "S01237",
    })

    // Verification is soft-fail by design, so the default here is the outage
    // case — an unstubbed edge function 404s, which is what the service sees
    // when Odoo cannot be reached. Tests that care about the answer stub it.

    // The requisition task is inserted through a SECURITY DEFINER function
    // (migration 0018) because the salesperson raising it may not insert a
    // task owned by the buyer. The fake database has no functions, so this
    // stands in for it — and it really writes the row, so every assertion
    // about what lands in `tasks` still means something.
    stubRpc("sor_raise_procurement_task", (args) => {
      const task = db.seed("tasks", {
        id: args.p_id || undefined,
        task_description: args.p_description,
        checklist: args.p_checklist,
        project_title: args.p_project_title,
        category_id: args.p_category_id,
        logged_by: args.p_assignee_id,
        reported_to: args.p_reported_to,
        remarks: args.p_remarks,
        priority: "MEDIUM",
        status: "INCOMPLETE",
      })
      return task.id
    })
  })

  const raise = (overrides = {}) =>
    procurementService.createRequest({
      opportunityId: opportunity.id,
      items,
      assigneeId: buyer.id,
      requesterId: salesperson.id,
      ...overrides,
    })

  describe("raising a request", () => {
    it("refuses to create anything with no named products", async () => {
      // An empty composer submitted is a comment, not a request. Creating a
      // task for it is what fills the purchasing task list with chatter.
      await expect(raise({ items: [] })).rejects.toThrow(/name at least one product/i)
      expect(db.rows("tasks")).toHaveLength(0)
    })

    it("creates one task carrying every flagged product, not one task each", async () => {
      await raise()
      await waitForNetworkIdle()

      expect(db.rows("tasks")).toHaveLength(1)
      const [task] = db.rows("tasks")
      expect(task.checklist).toBeNull()
      expect(task.logged_by).toBe(buyer.id)
    })

    it("titles the task so the S-number is searchable in approvals", async () => {
      await raise()
      const [task] = db.rows("tasks")
      expect(task.task_description).toBe("[PR] S01237 — ACME Corp — 2 items to source")
    })

    it("reports the task to the buyer's own sub-department head", async () => {
      // Cjay sits in OPERATIONS › PURCHASING, so approval belongs to the
      // Purchasing Manager — not the Operations Manager two rungs up, who has
      // no view of what was bought.
      await raise()
      const [task] = db.rows("tasks")
      expect(task.reported_to).toBe(purchasingHead.id)
      expect(task.reported_to).not.toBe(operationsHead.id)
    })

    it("freezes what sales asked for, including the client's own wording and images", async () => {
      await raise()
      const requests = await procurementService.listForOpportunity(opportunity.id)

      expect(requests).toHaveLength(2)
      expect(requests[0]).toMatchObject({
        requested_name: "Hydraulic hose kit",
        requested_quantity: 5,
        requested_unit: "set",
        requested_description: "5m, high-pressure, client sent a spec sheet",
        assigned_to: buyer.id,
        outcome: null,
      })
      expect(requests[1].requested_images).toEqual([
        { url: "https://res.cloudinary.com/t3ck/harness.jpg", name: "harness.jpg" },
      ])
    })

    it("leaves the description null rather than an empty string when nothing was written", async () => {
      await raise()
      const requests = await procurementService.listForOpportunity(opportunity.id)
      expect(requests[1].requested_description).toBeNull()
    })

    it("records the ask on the opportunity timeline", async () => {
      await raise()
      const notes = await opportunityService.getNotes(opportunity.id)
      expect(notes.at(-1).content).toContain("2 products sent to purchasing")
    })

    it("reuses an existing open incomplete task for the same opportunity and buyer", async () => {
      await raise()
      await waitForNetworkIdle()

      const [firstTask] = db.rows("tasks")
      expect(db.rows("tasks")).toHaveLength(1)

      // Send another product to the same buyer on the same deal
      await procurementService.createRequest({
        opportunityId: opportunity.id,
        items: [
          {
            product_name: "Extension cord 20m",
            quantity: 1,
            unit: "pc",
            description: "",
            images: [],
          },
        ],
        assigneeId: buyer.id,
        requesterId: salesperson.id,
      })
      await waitForNetworkIdle()

      // Should still be only 1 task, reused
      expect(db.rows("tasks")).toHaveLength(1)

      const requests = await procurementService.listForOpportunity(opportunity.id)
      expect(requests).toHaveLength(3)
      expect(requests.every((r) => r.task_id === firstTask.id)).toBe(true)

      // The title keeps the original send's count. Restating it means a direct
      // .update() on tasks from a sales user, which is the write RLS rejects —
      // the activity entry carries the news instead.
      const [updatedTask] = db.rows("tasks")
      expect(updatedTask.task_description).toBe("[PR] S01237 — ACME Corp — 2 items to source")

      // Check task activity system event was posted
      const activities = db.rows("task_activity").filter((a) => a.task_id === firstTask.id)
      expect(activities.some((a) => a.content?.includes("added 1 more product"))).toBe(true)
    })

    it("opens a fresh task rather than reopening one already sent for approval", async () => {
      await raise()
      await waitForNetworkIdle()

      const [firstTask] = db.internal.rowsOf("tasks")
      // Buyer submitted task for review
      updateRow("tasks", firstTask, { status: TASK_STATUS.AWAITING_APPROVAL, end_at: "2026-08-18T10:00:00Z" })

      // Sales adds another item before head approves
      await procurementService.createRequest({
        opportunityId: opportunity.id,
        items: [{ product_name: "Extension cord 20m", quantity: 1, unit: "pc" }],
        assigneeId: buyer.id,
        requesterId: salesperson.id,
      })
      await waitForNetworkIdle()

      // A submitted task is a closed cycle. Pulling it back out of the head's
      // approval queue is not a decision sales gets to make by sending again.
      const tasks = db.rows("tasks")
      expect(tasks).toHaveLength(2)

      const [submitted] = tasks
      expect(submitted.status).toBe(TASK_STATUS.AWAITING_APPROVAL)
      expect(submitted.end_at).toBe("2026-08-18T10:00:00Z")

      expect(tasks[1].task_description).toBe("[PR #2] S01237 — ACME Corp — 1 item to source")
    })

    it("opens a fresh task titled [PR #2] if the previous task is already completed", async () => {
      await raise()
      await waitForNetworkIdle()

      const [firstTask] = db.internal.rowsOf("tasks")
      // Head approved and completed the first task
      updateRow("tasks", firstTask, { status: TASK_STATUS.COMPLETE })

      // Send another product
      await procurementService.createRequest({
        opportunityId: opportunity.id,
        items: [{ product_name: "Extension cord 20m", quantity: 1, unit: "pc" }],
        assigneeId: buyer.id,
        requesterId: salesperson.id,
      })
      await waitForNetworkIdle()

      // Should create a brand new task
      const tasks = db.rows("tasks")
      expect(tasks).toHaveLength(2)
      expect(tasks[1].task_description).toBe("[PR #2] S01237 — ACME Corp — 1 item to source")
    })
  })

  describe("mentioning a team instead of a person", () => {
    const mentionPurchasing = () =>
      raise({ assigneeId: null, department: "OPERATIONS", subDepartment: "PURCHASING" })

    it("does not open a task until somebody owns it", async () => {
      // A task with no named owner is the group-task failure mode: everyone
      // can see it, nobody is accountable for it.
      await mentionPurchasing()
      await waitForNetworkIdle()

      expect(db.rows("tasks")).toHaveLength(0)
      const requests = await procurementService.listForOpportunity(opportunity.id)
      expect(requests.every((r) => r.assigned_to === null)).toBe(true)
    })

    it("asks the purchasing head to name a buyer, not the operations head", async () => {
      // The sub-department is load-bearing. Passing the department alone
      // resolves to the head with no sub-department — the Operations Manager —
      // which puts the requisition on a desk that does not own it.
      await mentionPurchasing()
      await waitForNetworkIdle()

      const notified = db.rows("notifications")
      expect(notified).toHaveLength(1)
      expect(notified[0]).toMatchObject({
        recipient_id: purchasingHead.id,
        type: "OPPORTUNITY_PROCUREMENT_REQUESTED",
      })
      expect(notified[0].recipient_id).not.toBe(operationsHead.id)
    })

    it("opens the task once the head assigns it", async () => {
      await mentionPurchasing()
      const requests = await procurementService.listForOpportunity(opportunity.id)

      const taskId = await procurementService.assignRequests(
        requests.map((r) => r.id),
        buyer.id,
        purchasingHead.id,
      )
      await waitForNetworkIdle()

      expect(db.rows("tasks")).toHaveLength(1)
      const after = await procurementService.listForOpportunity(opportunity.id)
      expect(after.every((r) => r.assigned_to === buyer.id)).toBe(true)
      expect(after.every((r) => r.task_id === taskId)).toBe(true)
    })

    it("reuses the buyer's open task when the head assigns a second batch", async () => {
      // The reuse check has to sit on this path too, not just the sales
      // composer's. A head assigning a follow-up ask to the same buyer on the
      // same deal is the same situation: they already hold a requisition for it.
      await mentionPurchasing()
      const first = await procurementService.listForOpportunity(opportunity.id)
      const taskId = await procurementService.assignRequests(
        first.map((r) => r.id),
        buyer.id,
        purchasingHead.id,
      )
      await waitForNetworkIdle()

      // The client comes back wanting one more thing on the same deal.
      await raise({
        assigneeId: null,
        department: "OPERATIONS",
        subDepartment: "PURCHASING",
        items: [{ product_name: "Extension cord 20m", quantity: 1, unit: "pc" }],
      })
      await waitForNetworkIdle()

      const unassigned = (
        await procurementService.listForOpportunity(opportunity.id)
      ).filter((r) => !r.assigned_to)
      expect(unassigned).toHaveLength(1)

      const secondTaskId = await procurementService.assignRequests(
        unassigned.map((r) => r.id),
        buyer.id,
        purchasingHead.id,
      )
      await waitForNetworkIdle()

      expect(secondTaskId).toBe(taskId)
      expect(db.rows("tasks")).toHaveLength(1)

      const all = await procurementService.listForOpportunity(opportunity.id)
      expect(all).toHaveLength(3)
      expect(all.every((r) => r.task_id === taskId)).toBe(true)
    })
  })

  describe("resolving", () => {
    let requests

    beforeEach(async () => {
      await raise()
      requests = await procurementService.listForOpportunity(opportunity.id)
    })

    it("demands the PO number for an outcome that claims a buy happened", async () => {
      await expect(
        procurementService.resolveRequest(
          requests[0].id,
          { outcome: PROCUREMENT_OUTCOME.PURCHASED },
          buyer.id,
        ),
      ).rejects.toThrow(/PO number/i)
    })

    it("does not demand one when nothing was bought", async () => {
      const row = await procurementService.resolveRequest(
        requests[0].id,
        { outcome: PROCUREMENT_OUTCOME.ALREADY_EXISTS, odooProductRef: "BOOM LIFT, 12M" },
        buyer.id,
      )
      expect(row.outcome).toBe(PROCUREMENT_OUTCOME.ALREADY_EXISTS)
      expect(row.po_number).toBeNull()
    })

    it("clears the PO number, product ref and vendor when reverting to IN_PROGRESS", async () => {
      // First purchase it
      stubEdgeFunction("odoo-po-verify", {
        success: true,
        found: true,
        order: { supplier: "Firewolf Motors" },
        products: [{ name: "HOSE KIT, HYD, 5M" }],
      })
      const purchased = await procurementService.resolveRequest(
        requests[0].id,
        { outcome: PROCUREMENT_OUTCOME.PURCHASED, poNumber: "P01234" },
        buyer.id,
      )
      expect(purchased.odoo_vendor).toBe("Firewolf Motors")

      // Revert to In Progress
      const reverted = await procurementService.resolveRequest(
        requests[0].id,
        { outcome: PROCUREMENT_OUTCOME.IN_PROGRESS, poNumber: "P01234" },
        buyer.id,
      )
      expect(reverted.outcome).toBe(PROCUREMENT_OUTCOME.IN_PROGRESS)
      expect(reverted.po_number).toBeNull()
      expect(reverted.odoo_product_ref).toBeNull()
      expect(reverted.odoo_vendor).toBeNull()
      expect(reverted.verification).toBe(PO_VERIFICATION.UNVERIFIED)
    })

    it("rejects a sales order number typed in the PO field", async () => {
      await expect(
        procurementService.resolveRequest(
          requests[0].id,
          { outcome: PROCUREMENT_OUTCOME.PURCHASED, poNumber: "S01237" },
          buyer.id,
        ),
      ).rejects.toThrow(/P" followed by digits/i)
    })

    it("parks the row rather than failing when Odoo cannot be reached", async () => {
      const row = await procurementService.resolveRequest(
        requests[0].id,
        { outcome: PROCUREMENT_OUTCOME.PURCHASED, poNumber: "P01234" },
        buyer.id,
      )
      // The buy is recorded either way — blocking a task completion on an
      // integration hiccup is worse than a row that says "not checked yet".
      expect(row.po_number).toBe("P01234")
      expect(row.verification).toBe(PO_VERIFICATION.PENDING)
    })

    it("confirms the PO and adopts Odoo's own product name and vendor", async () => {
      stubEdgeFunction("odoo-po-verify", {
        success: true,
        found: true,
        order: { supplier: "Firewolf Motors" },
        products: [{ name: "HOSE KIT, HYD, 5M" }],
      })

      const row = await procurementService.resolveRequest(
        requests[0].id,
        { outcome: PROCUREMENT_OUTCOME.PURCHASED, poNumber: "P01234" },
        buyer.id,
      )

      expect(row.verification).toBe(PO_VERIFICATION.VERIFIED)
      expect(row.odoo_product_ref).toBe("HOSE KIT, HYD, 5M")
      expect(row.odoo_vendor).toBe("Firewolf Motors")
    })

    it("leaves vendor unset when Odoo has no vendor on the order", async () => {
      stubEdgeFunction("odoo-po-verify", {
        success: true,
        found: true,
        products: [{ name: "HOSE KIT, HYD, 5M" }],
      })

      const row = await procurementService.resolveRequest(
        requests[0].id,
        { outcome: PROCUREMENT_OUTCOME.PURCHASED, poNumber: "P01234" },
        buyer.id,
      )

      expect(row.odoo_vendor).toBeNull()
    })

    it("distinguishes 'Odoo says no' from 'Odoo did not answer'", async () => {
      stubEdgeFunction("odoo-po-verify", { success: true, found: false })

      const row = await procurementService.resolveRequest(
        requests[0].id,
        { outcome: PROCUREMENT_OUTCOME.PURCHASED, poNumber: "P09999" },
        buyer.id,
      )
      expect(row.verification).toBe(PO_VERIFICATION.NOT_FOUND)
    })

    it("stays quiet until every product has an answer", async () => {
      await procurementService.resolveRequest(
        requests[0].id,
        { outcome: PROCUREMENT_OUTCOME.UNAVAILABLE, note: "Discontinued" },
        buyer.id,
      )
      await waitForNetworkIdle()

      // Partial results are the normal case; telling sales on every one would
      // train them to ignore it.
      const resolved = db
        .rows("notifications")
        .filter((n) => n.type === "OPPORTUNITY_PROCUREMENT_RESOLVED")
      expect(resolved).toHaveLength(0)
    })

    it("tells sales once the last product is answered, and says what happened", async () => {
      await procurementService.resolveRequest(
        requests[0].id,
        { outcome: PROCUREMENT_OUTCOME.UNAVAILABLE, note: "Discontinued" },
        buyer.id,
      )
      await procurementService.resolveRequest(
        requests[1].id,
        { outcome: PROCUREMENT_OUTCOME.PURCHASED, poNumber: "P01234" },
        buyer.id,
      )
      await waitForNetworkIdle()

      const resolved = db
        .rows("notifications")
        .filter((n) => n.type === "OPPORTUNITY_PROCUREMENT_RESOLVED")

      expect(resolved).toHaveLength(1)
      expect(resolved[0].recipient_id).toBe(salesperson.id)
      // The summary is the point — a green tick that means "mostly" is what
      // per-item outcomes exist to avoid.
      expect(resolved[0].message).toContain("Cannot source")
      expect(resolved[0].message).toContain("Purchased")
    })

    it("points sales at the deal, not at purchasing's task", async () => {
      await procurementService.resolveRequest(
        requests[0].id,
        { outcome: PROCUREMENT_OUTCOME.UNAVAILABLE },
        buyer.id,
      )
      await procurementService.resolveRequest(
        requests[1].id,
        { outcome: PROCUREMENT_OUTCOME.UNAVAILABLE },
        buyer.id,
      )
      await waitForNetworkIdle()

      const [resolved] = db
        .rows("notifications")
        .filter((n) => n.type === "OPPORTUNITY_PROCUREMENT_RESOLVED")

      // Sales' next move is finishing the quotation, which happens on the SOR.
      expect(resolved.reference_id).toBe(opportunity.id)
    })
  })

  describe("when the deal dies mid-flight", () => {
    it("warns the buyer without closing anything they might have committed to", async () => {
      await raise()
      await waitForNetworkIdle()

      await opportunityService.updateStatus(
        opportunity.id,
        "CLOSED_LOST",
        salesperson.id,
        "Client went with a competitor",
      )
      await waitForNetworkIdle()

      const warned = db
        .rows("notifications")
        .filter((n) => n.type === "PROCUREMENT_TASK_DEAL_LOST")

      expect(warned).toHaveLength(1)
      expect(warned[0].recipient_id).toBe(buyer.id)

      // Nothing of purchasing's is touched: real money may already be spent,
      // and a task that vanished would take the evidence with it.
      const [task] = db.rows("tasks")
      expect(task.status).toBe("INCOMPLETE")
      const requests = await procurementService.listForOpportunity(opportunity.id)
      expect(requests.every((r) => r.outcome === null)).toBe(true)
    })

    it("says nothing when purchasing was never involved", async () => {
      await opportunityService.updateStatus(
        opportunity.id,
        "CLOSED_LOST",
        salesperson.id,
        "Budget cut",
      )
      await waitForNetworkIdle()

      expect(
        db.rows("notifications").filter((n) => n.type === "PROCUREMENT_TASK_DEAL_LOST"),
      ).toHaveLength(0)
    })
  })

  describe("sales editing and cancelling requests", () => {
    it("updates product name, quantity and notes before a PO is recorded", async () => {
      const [req] = await procurementService.createRequest({
        opportunityId: opportunity.id,
        items: [
          {
            product_name: "Original Hose",
            quantity: 2,
            unit: "pcs",
            description: "Old notes",
            images: [],
          },
        ],
        assigneeId: buyer.id,
        requesterId: salesperson.id,
      })

      const updated = await procurementService.updateRequest(
        req.id,
        {
          product_name: "Updated Hose (Heavy Duty)",
          quantity: 5,
          unit: "set",
          description: "New client specs",
          images: [],
        },
        salesperson.id,
      )

      expect(updated.requested_name).toBe("Updated Hose (Heavy Duty)")
      expect(updated.requested_quantity).toBe(5)
      expect(updated.requested_unit).toBe("set")
      expect(updated.requested_description).toBe("New client specs")
    })

    it("rejects edit when item is already purchased with a PO", async () => {
      const [req] = await procurementService.createRequest({
        opportunityId: opportunity.id,
        items: [{ product_name: "Original Hose", quantity: 2, unit: "pcs" }],
        assigneeId: buyer.id,
        requesterId: salesperson.id,
      })

      await procurementService.resolveRequest(
        req.id,
        { outcome: PROCUREMENT_OUTCOME.PURCHASED, poNumber: "P01234" },
        buyer.id,
      )

      await expect(
        procurementService.updateRequest(
          req.id,
          { product_name: "New Name", quantity: 3, unit: "pcs" },
          salesperson.id,
        ),
      ).rejects.toThrow(/already been ordered/i)
    })

    it("deletes/cancels an open request before a PO is recorded", async () => {
      const [req] = await procurementService.createRequest({
        opportunityId: opportunity.id,
        items: [{ product_name: "Cancelled Item", quantity: 1, unit: "unit" }],
        assigneeId: buyer.id,
        requesterId: salesperson.id,
      })

      await procurementService.deleteRequest(req.id, salesperson.id)

      const remaining = await procurementService.listForOpportunity(opportunity.id)
      expect(remaining.find((r) => r.id === req.id)).toBeUndefined()
    })
  })

  describe("when SOR / Opportunity is deleted", () => {
    const mentionPurchasing = () =>
      raise({ assigneeId: null, department: "OPERATIONS", subDepartment: "PURCHASING" })

    it("soft-cancels the linked purchasing task when no PO was issued", async () => {
      await mentionPurchasing()
      const requests = await procurementService.listForOpportunity(opportunity.id)
      const taskId = await procurementService.assignRequests(
        requests.map((r) => r.id),
        buyer.id,
        purchasingHead.id,
      )

      await procurementService.handleOpportunityDeleted(opportunity.id, salesperson.id, opportunity)
      await waitForNetworkIdle()

      const task = db.rows("tasks").find((t) => t.id === taskId)
      expect(task.status).toBe(TASK_STATUS.DELETED)
    })
  })
})
