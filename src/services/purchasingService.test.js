import { beforeEach, describe, expect, it } from "vitest"
import { purchasingService } from "./purchasingService"
import { opportunityService } from "./opportunityService"
import { projectEvaluationService } from "./projectEvaluationService"
import { db, updateRow } from "@/test/db/store"
import { makeEmployee, makeOpportunity, makeCategory } from "@/test/factories"
import { waitForNetworkIdle } from "@/test/network"
import { stubEdgeFunction, stubRpc } from "@/test/msw/server"
import { PROCUREMENT_OUTCOME, PO_VERIFICATION } from "@/constants/procurement"
import { TASK_STATUS } from "@/constants/status"
import { COMPLETENESS, summariseCompleteness } from "@/constants/projectEvaluation"

/**
 * SOR → Purchasing procurement, exercised through the service's public methods
 * against the fake PostgREST.
 *
 * What is asserted is what the next person reads out of the system: who was
 * asked, what came back per product, and who got told — not how the service got
 * there. See docs/sor-procurement-flow-decisions.md.
 */
describe("purchasingService", () => {
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
    purchasingService.createRequest({
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
      const requests = await purchasingService.listForOpportunity(opportunity.id)

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
      const requests = await purchasingService.listForOpportunity(opportunity.id)
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
      await purchasingService.createRequest({
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

      const requests = await purchasingService.listForOpportunity(opportunity.id)
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
      await purchasingService.createRequest({
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
      await purchasingService.createRequest({
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
      const requests = await purchasingService.listForOpportunity(opportunity.id)
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
      const requests = await purchasingService.listForOpportunity(opportunity.id)

      const taskId = await purchasingService.assignRequests(
        requests.map((r) => r.id),
        buyer.id,
        purchasingHead.id,
      )
      await waitForNetworkIdle()

      expect(db.rows("tasks")).toHaveLength(1)
      const after = await purchasingService.listForOpportunity(opportunity.id)
      expect(after.every((r) => r.assigned_to === buyer.id)).toBe(true)
      expect(after.every((r) => r.task_id === taskId)).toBe(true)
    })

    it("reuses the buyer's open task when the head assigns a second batch", async () => {
      // The reuse check has to sit on this path too, not just the sales
      // composer's. A head assigning a follow-up ask to the same buyer on the
      // same deal is the same situation: they already hold a requisition for it.
      await mentionPurchasing()
      const first = await purchasingService.listForOpportunity(opportunity.id)
      const taskId = await purchasingService.assignRequests(
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
        await purchasingService.listForOpportunity(opportunity.id)
      ).filter((r) => !r.assigned_to)
      expect(unassigned).toHaveLength(1)

      const secondTaskId = await purchasingService.assignRequests(
        unassigned.map((r) => r.id),
        buyer.id,
        purchasingHead.id,
      )
      await waitForNetworkIdle()

      expect(secondTaskId).toBe(taskId)
      expect(db.rows("tasks")).toHaveLength(1)

      const all = await purchasingService.listForOpportunity(opportunity.id)
      expect(all).toHaveLength(3)
      expect(all.every((r) => r.task_id === taskId)).toBe(true)
    })
  })

  describe("resolving", () => {
    let requests

    beforeEach(async () => {
      await raise()
      requests = await purchasingService.listForOpportunity(opportunity.id)
    })

    it("demands the PO number for an outcome that claims a buy happened", async () => {
      await expect(
        purchasingService.resolveRequest(
          requests[0].id,
          { outcome: PROCUREMENT_OUTCOME.PURCHASED },
          buyer.id,
        ),
      ).rejects.toThrow(/PO number/i)
    })

    it("does not demand one when nothing was bought", async () => {
      const row = await purchasingService.resolveRequest(
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
      const purchased = await purchasingService.resolveRequest(
        requests[0].id,
        { outcome: PROCUREMENT_OUTCOME.PURCHASED, poNumber: "P01234" },
        buyer.id,
      )
      expect(purchased.odoo_vendor).toBe("Firewolf Motors")

      // Revert to In Progress
      const reverted = await purchasingService.resolveRequest(
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
        purchasingService.resolveRequest(
          requests[0].id,
          { outcome: PROCUREMENT_OUTCOME.PURCHASED, poNumber: "S01237" },
          buyer.id,
        ),
      ).rejects.toThrow(/P" followed by digits/i)
    })

    it("parks the row rather than failing when Odoo cannot be reached", async () => {
      const row = await purchasingService.resolveRequest(
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

      const row = await purchasingService.resolveRequest(
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

      const row = await purchasingService.resolveRequest(
        requests[0].id,
        { outcome: PROCUREMENT_OUTCOME.PURCHASED, poNumber: "P01234" },
        buyer.id,
      )

      expect(row.odoo_vendor).toBeNull()
    })

    it("distinguishes 'Odoo says no' from 'Odoo did not answer'", async () => {
      stubEdgeFunction("odoo-po-verify", { success: true, found: false })

      const row = await purchasingService.resolveRequest(
        requests[0].id,
        { outcome: PROCUREMENT_OUTCOME.PURCHASED, poNumber: "P09999" },
        buyer.id,
      )
      expect(row.verification).toBe(PO_VERIFICATION.NOT_FOUND)
    })

    it("stays quiet until every product has an answer", async () => {
      await purchasingService.resolveRequest(
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
      await purchasingService.resolveRequest(
        requests[0].id,
        { outcome: PROCUREMENT_OUTCOME.UNAVAILABLE, note: "Discontinued" },
        buyer.id,
      )
      await purchasingService.resolveRequest(
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
      await purchasingService.resolveRequest(
        requests[0].id,
        { outcome: PROCUREMENT_OUTCOME.UNAVAILABLE },
        buyer.id,
      )
      await purchasingService.resolveRequest(
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
      const requests = await purchasingService.listForOpportunity(opportunity.id)
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
      const [req] = await purchasingService.createRequest({
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

      const updated = await purchasingService.updateRequest(
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
      const [req] = await purchasingService.createRequest({
        opportunityId: opportunity.id,
        items: [{ product_name: "Original Hose", quantity: 2, unit: "pcs" }],
        assigneeId: buyer.id,
        requesterId: salesperson.id,
      })

      await purchasingService.resolveRequest(
        req.id,
        { outcome: PROCUREMENT_OUTCOME.PURCHASED, poNumber: "P01234" },
        buyer.id,
      )

      await expect(
        purchasingService.updateRequest(
          req.id,
          { product_name: "New Name", quantity: 3, unit: "pcs" },
          salesperson.id,
        ),
      ).rejects.toThrow(/already been ordered/i)
    })

    it("deletes/cancels an open request before a PO is recorded", async () => {
      const [req] = await purchasingService.createRequest({
        opportunityId: opportunity.id,
        items: [{ product_name: "Cancelled Item", quantity: 1, unit: "unit" }],
        assigneeId: buyer.id,
        requesterId: salesperson.id,
      })

      await purchasingService.deleteRequest(req.id, salesperson.id)

      const remaining = await purchasingService.listForOpportunity(opportunity.id)
      expect(remaining.find((r) => r.id === req.id)).toBeUndefined()
    })
  })

  describe("when SOR / Opportunity is deleted", () => {
    const mentionPurchasing = () =>
      raise({ assigneeId: null, department: "OPERATIONS", subDepartment: "PURCHASING" })

    it("soft-cancels the linked purchasing task when no PO was issued", async () => {
      await mentionPurchasing()
      const requests = await purchasingService.listForOpportunity(opportunity.id)
      const taskId = await purchasingService.assignRequests(
        requests.map((r) => r.id),
        buyer.id,
        purchasingHead.id,
      )

      await purchasingService.handleOpportunityDeleted(opportunity.id, salesperson.id, opportunity)
      await waitForNetworkIdle()

      const task = db.rows("tasks").find((t) => t.id === taskId)
      expect(task.status).toBe(TASK_STATUS.DELETED)
    })
  })

  /**
   * The Purchasing queue (issue #39).
   *
   * Every read the service already has is scoped to one thing — one
   * opportunity, one task, one purchaser. None of them answers "what is
   * purchasing sourcing this week", which is the question the Module exists
   * for, and which is why that answer currently lives in a spreadsheet.
   */
  describe("the purchasing queue", () => {
    it("gathers open requests from every SOR, not just one", async () => {
      const second = makeOpportunity({
        registered_by: salesperson.id,
        deal_owner_id: salesperson.id,
        client_name: "Beta Industries",
        sales_reference: "S01238",
      })

      await raise()
      await raise({ opportunityId: second.id, items: [{ product_name: "Winch", quantity: 1 }] })

      const queue = await purchasingService.listOpenQueue()

      expect(queue.map((r) => r.requested_name).sort()).toEqual([
        "Hydraulic hose kit",
        "Safety harness",
        "Winch",
      ])
    })

    it("carries the SOR, the requester and the assignee on every row", async () => {
      await raise()

      const [row] = await purchasingService.listOpenQueue()

      expect(row.opportunity.sales_reference).toBe("S01237")
      expect(row.opportunity.client_name).toBe("ACME Corp")
      expect(row.requester.name).toBe("Ana Reyes")
      expect(row.assignee.name).toBe("Cjay Espina")
    })

    // 0019 made IN_PROGRESS a stored outcome meaning "actively canvassing
    // suppliers". Filtering on `outcome is null` alone would empty the queue of
    // exactly the rows somebody is working on this week.
    it("keeps a request that purchasing has started but not answered", async () => {
      await raise()
      const [first] = await purchasingService.listForOpportunity(opportunity.id)

      await purchasingService.resolveRequest(
        first.id,
        { outcome: PROCUREMENT_OUTCOME.IN_PROGRESS },
        buyer.id,
      )
      await waitForNetworkIdle()

      const queue = await purchasingService.listOpenQueue()
      expect(queue.map((r) => r.id)).toContain(first.id)
    })

    it("drops a request once purchasing has answered it", async () => {
      await raise()
      const [first] = await purchasingService.listForOpportunity(opportunity.id)

      await purchasingService.resolveRequest(
        first.id,
        { outcome: PROCUREMENT_OUTCOME.ALREADY_EXISTS, note: "in Odoo as HOSE-5M" },
        buyer.id,
      )
      await waitForNetworkIdle()

      const queue = await purchasingService.listOpenQueue()
      expect(queue.map((r) => r.id)).not.toContain(first.id)
    })

    // A withdrawn deal is not work. The request rows survive the soft delete
    // by design — they are the record of what was asked for — so the queue
    // has to be the thing that stops showing them.
    it("shows nothing from a soft-deleted SOR", async () => {
      await raise()
      updateRow("sales_opportunities", db.internal.rowsOf("sales_opportunities").find((o) => o.id === opportunity.id), { is_deleted: true })

      const queue = await purchasingService.listOpenQueue()
      expect(queue).toEqual([])
    })

    // Consistent with 0046: a Scratch SOR runs identical code paths, so it can
    // and does raise real request rows. They stay visible on the SOR itself —
    // that is what watching a flow means — but a cross-deal work list is not
    // the place to make a purchaser triage a rehearsal.
    it("shows nothing from a Scratch SOR", async () => {
      await raise()
      updateRow("sales_opportunities", db.internal.rowsOf("sales_opportunities").find((o) => o.id === opportunity.id), { is_scratch: true })

      const queue = await purchasingService.listOpenQueue()
      expect(queue).toEqual([])
    })

    // Issue #170/#171 — a retail SOR never raises a procurement request in
    // practice, but the join-level guard must match its scratch sibling.
    it("shows nothing from a Retail SOR", async () => {
      await raise()
      updateRow("sales_opportunities", db.internal.rowsOf("sales_opportunities").find((o) => o.id === opportunity.id), { is_retail: true })

      const queue = await purchasingService.listOpenQueue()
      expect(queue).toEqual([])
    })

    it("puts the newest ask at the top", async () => {
      const second = makeOpportunity({
        registered_by: salesperson.id,
        deal_owner_id: salesperson.id,
        sales_reference: "S01239",
      })

      await raise({ items: [{ product_name: "Older ask", quantity: 1 }] })
      const [older] = db.internal.rowsOf("sor_procurement_requests")
      updateRow("sor_procurement_requests", older, {
        created_at: "2026-01-01T00:00:00.000Z",
      })

      await raise({
        opportunityId: second.id,
        items: [{ product_name: "Newer ask", quantity: 1 }],
      })

      const queue = await purchasingService.listOpenQueue()
      expect(queue[0].requested_name).toBe("Newer ask")
    })

    it("is empty rather than failing when nothing is outstanding", async () => {
      expect(await purchasingService.listOpenQueue()).toEqual([])
    })
  })
  /**
   * Purchasing's answer, carried back to the client's specification (#45).
   *
   * Without this the spec check is only as current as whoever remembered to
   * update it in two places — which is the failure the breakdown exists to
   * remove.
   */
  describe("answering an item on the client's breakdown", () => {
    const raiseFromInclusion = async (description = "Hydraulic rescue tool") => {
      const inclusion = await projectEvaluationService.addInclusion(
        { opportunityId: opportunity.id, description },
        salesperson.id,
      )
      await purchasingService.createRequest({
        opportunityId: opportunity.id,
        items: [{ product_name: description, quantity: 1, inclusionId: inclusion.id }],
        assigneeId: buyer.id,
        requesterId: salesperson.id,
      })
      const requests = await purchasingService.listForOpportunity(opportunity.id)
      return { inclusion, request: requests.find((r) => r.inclusion_id === inclusion.id) }
    }

    const completenessOf = async (inclusionId) => {
      const rows = await projectEvaluationService.listInclusions(opportunity.id)
      return rows.find((r) => r.id === inclusionId)?.completeness
    }

    it("remembers which item on the breakdown it was raised for", async () => {
      const { inclusion, request } = await raiseFromInclusion()
      expect(request.inclusion_id).toBe(inclusion.id)
    })

    it("marks the item missing when it cannot be sourced", async () => {
      const { inclusion, request } = await raiseFromInclusion()

      await purchasingService.resolveRequest(
        request.id,
        { outcome: PROCUREMENT_OUTCOME.UNAVAILABLE, note: "Discontinued" },
        buyer.id,
      )
      await waitForNetworkIdle()

      expect(await completenessOf(inclusion.id)).toBe(COMPLETENESS.MISSING)
    })

    it("marks the item substituted when purchasing sourced something else", async () => {
      const { inclusion, request } = await raiseFromInclusion()

      await purchasingService.resolveRequest(
        request.id,
        {
          outcome: PROCUREMENT_OUTCOME.SUBSTITUTED,
          // A substitution means something was bought, so the PO is required —
          // outcomeRequiresPo, unchanged by this ticket.
          poNumber: "P02561",
          note: "Equivalent from another brand",
        },
        buyer.id,
      )
      await waitForNetworkIdle()

      expect(await completenessOf(inclusion.id)).toBe(COMPLETENESS.SUBSTITUTED)
    })

    it("marks the item covered once it is bought", async () => {
      const { inclusion, request } = await raiseFromInclusion()

      await purchasingService.resolveRequest(
        request.id,
        { outcome: PROCUREMENT_OUTCOME.PURCHASED, poNumber: "P02560" },
        buyer.id,
      )
      await waitForNetworkIdle()

      expect(await completenessOf(inclusion.id)).toBe(COMPLETENESS.COVERED)
    })

    // Purchasing found it in Odoo under another name and bought nothing. The
    // client gets what they asked for, so sales has nothing to re-price.
    it("marks the item covered when it turned out to exist already", async () => {
      const { inclusion, request } = await raiseFromInclusion()

      await purchasingService.resolveRequest(
        request.id,
        { outcome: PROCUREMENT_OUTCOME.ALREADY_EXISTS, note: "Odoo: HYD-TOOL-01" },
        buyer.id,
      )
      await waitForNetworkIdle()

      expect(await completenessOf(inclusion.id)).toBe(COMPLETENESS.COVERED)
    })

    it("un-answers the item when purchasing reverts to still working on it", async () => {
      const { inclusion, request } = await raiseFromInclusion()

      await purchasingService.resolveRequest(
        request.id,
        { outcome: PROCUREMENT_OUTCOME.PURCHASED, poNumber: "P02560" },
        buyer.id,
      )
      await purchasingService.resolveRequest(
        request.id,
        { outcome: PROCUREMENT_OUTCOME.IN_PROGRESS },
        buyer.id,
      )
      await waitForNetworkIdle()

      expect(await completenessOf(inclusion.id)).toBe(COMPLETENESS.MISSING)
    })

    it("moves the SOR's completeness figure without anyone re-entering it", async () => {
      const { request } = await raiseFromInclusion("Hydraulic rescue tool")
      await projectEvaluationService.addInclusion(
        { opportunityId: opportunity.id, description: "Stretcher" },
        salesperson.id,
      )

      await purchasingService.resolveRequest(
        request.id,
        { outcome: PROCUREMENT_OUTCOME.PURCHASED, poNumber: "P02560" },
        buyer.id,
      )
      await waitForNetworkIdle()

      const rows = await projectEvaluationService.listInclusions(opportunity.id)
      expect(summariseCompleteness(rows)).toMatchObject({ counted: 2, answered: 1, percent: 50 })
    })

    // The 0017 case, and still the common one: a product that was never on a
    // spec sheet. It must resolve exactly as it always has.
    it("changes no breakdown when the request was raised on its own", async () => {
      const inclusion = await projectEvaluationService.addInclusion(
        { opportunityId: opportunity.id, description: "Stretcher" },
        salesperson.id,
      )
      await raise()
      const [standalone] = await purchasingService.listForOpportunity(opportunity.id)

      await purchasingService.resolveRequest(
        standalone.id,
        { outcome: PROCUREMENT_OUTCOME.UNAVAILABLE },
        buyer.id,
      )
      await waitForNetworkIdle()

      expect(standalone.inclusion_id).toBeNull()
      expect(await completenessOf(inclusion.id)).toBe(COMPLETENESS.MISSING)
    })
  })

  /**
   * A requisition task holds no `opportunity_id` of its own — the tie to the
   * deal lives on the request rows it carries. Purchasing reads back through
   * that tie to see who they are buying for.
   */
  describe("the SOR behind a requisition task", () => {
    it("reads back the deal a task was raised from", async () => {
      await raise()
      await waitForNetworkIdle()
      const [task] = db.rows("tasks")

      const sor = await purchasingService.sorForTask(task.id)

      expect(sor).toMatchObject({
        id: opportunity.id,
        sales_reference: "S01237",
        client_name: "ACME Corp",
      })
    })

    it("names the deal owner, so the buyer knows who to ask", async () => {
      await raise()
      await waitForNetworkIdle()
      const [task] = db.rows("tasks")

      const sor = await purchasingService.sorForTask(task.id)

      expect(sor.deal_owner).toMatchObject({ id: salesperson.id })
    })

    it("has nothing to say about a task that is not a requisition", async () => {
      expect(await purchasingService.sorForTask("not-a-requisition")).toBeNull()
      expect(await purchasingService.sorForTask(null)).toBeNull()
    })
  })

})
