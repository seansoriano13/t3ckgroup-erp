import { supabase } from "../lib/supabase";
import { notificationService } from "./notificationService";
import { opportunityService } from "./opportunityService";
import { taskActivityService } from "./tasks/taskActivityService";
import { taskMutationService } from "./tasks/taskMutationService";
import { systemAuditLogService } from "./systemAuditLogService";
import { TASK_STATUS } from "../constants/status";
import {
  PO_VERIFICATION,
  PROCUREMENT_OUTCOME,
  PROCUREMENT_OUTCOME_LABELS,
  buildRequisitionTitle,
  isResolved,
  requisitionBatchNumber,
  isValidPoNumber,
  normalizePoNumber,
  outcomeRequiresPo,
  PO_NUMBER_HINT,
} from "../constants/procurement";
import { completenessForOutcome } from "../constants/projectEvaluation";
import { formatDueDate } from "../utils/formatDate";
import { sameDepartment } from "../utils/compareDepartment";

/**
 * Procurement requests raised from a SOR.
 *
 * A request is free text: a client asked for a product the company does not
 * carry, so there is nothing in Odoo to flag — the SOR's product list is
 * pulled from the Odoo sales order and everything on it already exists there.
 * Named products — never a mention on its own — create one purchasing task
 * carrying them as a checklist. Purchasing resolves each product individually,
 * because sourcing two of three is the normal case and a task that can only
 * succeed or fail forces the purchaser to lie in one direction.
 *
 * See docs/sor-procurement-flow-decisions.md.
 */

const REQUEST_SELECT = `
  *,
  requester:employees!sor_procurement_requests_requested_by_fkey(id, name, avatar_path),
  assignee:employees!sor_procurement_requests_assigned_to_fkey(id, name, avatar_path, department),
  resolver:employees!sor_procurement_requests_resolved_by_fkey(id, name, avatar_path)
`;

/**
 * The queue's row. REQUEST_SELECT plus the deal it came from, because a
 * cross-SOR list is unreadable without it — "Hydraulic hose kit" means nothing
 * until you know which project asked for it.
 *
 * A Scratch SOR (0046) runs identical code paths and so raises real request
 * rows. They stay visible on the SOR itself, which is what watching a flow
 * means; a purchaser's work list is not the place to make somebody triage a
 * rehearsal.
 */
const QUEUE_SELECT = `
  *,
  requester:employees!sor_procurement_requests_requested_by_fkey(id, name, avatar_path),
  assignee:employees!sor_procurement_requests_assigned_to_fkey(id, name, avatar_path, department),
  opportunity:sales_opportunities!sor_procurement_requests_opportunity_id_fkey!inner(
    id, sales_reference, client_name, project_title, status, is_deleted, is_scratch
  )
`;

/** How an opportunity is named in a notification or audit line. */
const dealLabel = (opportunity) =>
  opportunity?.sales_reference || opportunity?.client_name || "an opportunity";

/**
 * Finds the head an employee reports to, matching notifyHeadByDepartment's
 * rule: a sub-department head wins over a department-level one, and a
 * department head only owns employees with no sub-department of their own.
 */
async function findHeadFor(employee) {
  if (!employee?.department && !employee?.sub_department) return null;

  const { data: heads } = await supabase
    .from("employees")
    .select("id, name, department, sub_department")
    .eq("is_head", true)
    .neq("is_deleted", true);

  if (!heads?.length) return null;

  return (
    heads.find((h) => sameDepartment(h.sub_department, employee.sub_department)) ||
    heads.find((h) => sameDepartment(h.department, employee.department) && !h.sub_department) ||
    null
  );
}

/**
 * Best-effort category for the purchasing task.
 *
 * tasks.category_id is nullable, and a requisition does not map cleanly onto
 * the department's existing category list. Picking the assignee's department
 * category keeps the task inside the reporting the rest of the app already
 * does; finding none is not an error.
 */
async function categoryFor(employee) {
  if (!employee?.department) return null;
  const { data } = await supabase
    .from("categories")
    .select("category_id, sub_department")
    .eq("department", employee.department)
    .limit(50);

  if (!data?.length) return null;
  const match =
    employee.sub_department &&
    data.find((c) => sameDepartment(c.sub_department, employee.sub_department));
  return (match || data[0]).category_id;
}

/**
 * The buyer's still-open requisition for this deal, if they have one.
 *
 * INCOMPLETE only, deliberately. A task that has been submitted, approved or
 * deleted is a closed cycle: reusing it would drag a row back out of the
 * head's approval queue on a sales action, which is not sales' call to make.
 * A send arriving after that opens a fresh task instead.
 */
async function findOpenTaskFor(opportunityId, assigneeId) {
  if (!opportunityId || !assigneeId) return null;

  const { data: requests, error: reqError } = await supabase
    .from("sor_procurement_requests")
    .select("task_id")
    .eq("opportunity_id", opportunityId)
    .eq("assigned_to", assigneeId)
    .not("task_id", "is", null);

  if (reqError || !requests?.length) return null;

  const taskIds = [...new Set(requests.map((r) => r.task_id).filter(Boolean))];
  if (!taskIds.length) return null;

  const { data: tasks, error: taskError } = await supabase
    .from("tasks")
    .select("id, status, task_description, created_at")
    .in("id", taskIds)
    .eq("status", TASK_STATUS.INCOMPLETE)
    .order("created_at", { ascending: false });

  if (taskError || !tasks?.length) return null;
  return tasks[0];
}

/**
 * Tells the buyer that more products landed on a requisition they already hold.
 *
 * The task's own title is deliberately left alone. Restating the item count
 * means a direct `.update()` on `tasks` from a sales user, outside the
 * SECURITY DEFINER path migration 0018 exists to provide — the same RLS wall
 * that blocks the insert. The activity entry below already records that more
 * was added, so the title stays as the original send wrote it.
 *
 * The head is not notified: they were told about this task when it opened.
 */
async function announceAddedToTask({ task, opportunity, assignee, items, requesterId }) {
  const { data: requester } = await supabase
    .from("employees")
    .select("name")
    .eq("id", requesterId)
    .single();

  const count = items.length;
  const requesterName = requester?.name || "Sales";
  const plural = count === 1 ? "" : "s";

  taskActivityService.addSystemEvent(
    task.id,
    `${requesterName} added ${count} more product${plural} to source.`,
    {
      event: "PROCUREMENT_ITEMS_ADDED",
      submittedById: requesterId,
      submittedByName: requesterName,
      count,
    },
  );

  await notificationService.createNotification({
    recipient_id: assignee.id,
    sender_id: requesterId,
    type: "TASK_ASSIGNED",
    title: "Procurement items added",
    message: `${requesterName} added ${count} more product${plural} to source for ${dealLabel(
      opportunity,
    )}.`,
    reference_id: task.id,
  });
}

/**
 * Carries purchasing's answer back onto the Inclusion the request came from
 * (issue #45).
 *
 * Without this the spec check is only as current as whoever remembered to
 * update it in two places, which is exactly the failure the breakdown exists to
 * remove. What an outcome means in completeness terms is
 * constants/projectEvaluation.js's answer, not this file's.
 *
 * Logged rather than thrown. The resolution is the act the purchaser performed
 * and it has already been written; failing their save because a derived field
 * could not be updated would lose the answer they just gave. A request raised
 * on its own — the majority — has no link and returns immediately.
 */
async function writeBackToInclusion(request) {
  if (!request?.inclusion_id) return;

  const completeness = completenessForOutcome(request.outcome);
  if (!completeness) return;

  const { error } = await supabase
    .from("sor_inclusions")
    .update({ completeness })
    .eq("id", request.inclusion_id);

  if (error) {
    console.error("Failed to carry a procurement outcome back to its inclusion:", error);
  }
}

/** Remarks are stored as one text column; lines are joined with this. */
const NEWLINE = "\n";

export const purchasingService = {
  // ── Reads ─────────────────────────────────────────────────────────────────

  async listForOpportunity(opportunityId) {
    if (!opportunityId) return [];
    const { data, error } = await supabase
      .from("sor_procurement_requests")
      .select(REQUEST_SELECT)
      .eq("opportunity_id", opportunityId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data || [];
  },

  async listForTask(taskId) {
    if (!taskId) return [];
    const { data, error } = await supabase
      .from("sor_procurement_requests")
      .select(REQUEST_SELECT)
      .eq("task_id", taskId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data || [];
  },

  /**
   * Every unresolved request across every SOR — the Purchasing Module's queue.
   *
   * The other reads here each answer a question about one thing: one deal, one
   * task, one purchaser. None of them answers "what is purchasing sourcing
   * this week", and answering it by opening Tasks one at a time is why that
   * answer currently lives in a spreadsheet.
   *
   * "Open" here is `isResolved`'s definition, not "outcome is null": 0019 made
   * IN_PROGRESS a real stored outcome meaning purchasing is actively canvassing
   * suppliers. Those are precisely the rows a purchaser is working on, so a
   * null-only filter would empty the queue of the week's actual work.
   *
   * The opportunity is joined `!inner` rather than left, because both filters
   * below sit on it: without `!inner` PostgREST empties the embed and keeps the
   * parent row, so a withdrawn deal's requests would still appear — with a null
   * SOR next to them, which is worse than either outcome.
   */
  async listOpenQueue() {
    const { data, error } = await supabase
      .from("sor_procurement_requests")
      .select(QUEUE_SELECT)
      .or(`outcome.is.null,outcome.eq.${PROCUREMENT_OUTCOME.IN_PROGRESS}`)
      .eq("opportunity.is_deleted", false)
      .eq("opportunity.is_scratch", false)
      .eq("opportunity.is_retail", false)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data || [];
  },

  /**
   * The SOR a requisition task was raised from, or null if it is not one.
   *
   * A task carries no `opportunity_id` of its own — the link lives on the
   * requests it holds, and a task only ever gathers requests from a single
   * deal (`findOpenTaskFor` keys reuse on opportunity and assignee together).
   * So the first request's SOR is the task's SOR.
   *
   * Purchasing reads this to see which deal they are buying for. Org-wide
   * SELECT on the register is what makes it legible to them; being able to
   * edit it is a separate question that `canEditSor` answers.
   */
  async sorForTask(taskId) {
    if (!taskId) return null;

    const { data, error } = await supabase
      .from("sor_procurement_requests")
      .select(
        `opportunity:sales_opportunities!sor_procurement_requests_opportunity_id_fkey(
          id, sales_reference, client_name, project_title, status, expected_value,
          registered_by, deal_owner_id, support_sales_1_id, support_sales_2_id,
          sales_director_id,
          deal_owner:employees!sales_opportunities_deal_owner_id_fkey(id, name)
        )`,
      )
      .eq("task_id", taskId)
      .limit(1);

    if (error) throw error;
    return data?.[0]?.opportunity || null;
  },

  /** Open requests assigned to one purchaser, for their own queue. */
  async listOpenFor(employeeId) {
    if (!employeeId) return [];
    const { data, error } = await supabase
      .from("sor_procurement_requests")
      .select(REQUEST_SELECT)
      .eq("assigned_to", employeeId)
      .is("outcome", null)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data || [];
  },

  // ── Raising a request ─────────────────────────────────────────────────────

  /**
   * Raises a request for the given named products.
   *
   * With an `assigneeId` the purchasing task is created immediately. Without
   * one — the "mentioned the team" case — the rows are created unassigned and
   * the team head is notified to assign, because a task needs a single named
   * owner and there is nobody to name yet. That is the whole point of routing
   * through the head: they know who is on leave and who owns the supplier
   * relationship.
   *
   * Callers must not pass an empty `items`: an empty composer submitted is a
   * comment, not a requisition, and creating a task for it is what bloats the
   * task list.
   */
  async createRequest({
    opportunityId,
    items,
    assigneeId = null,
    department = null,
    subDepartment = null,
    requesterId,
  }) {
    if (!opportunityId) throw new Error("An opportunity is required.");
    if (!requesterId) throw new Error("A requester is required.");
    if (!items?.length) {
      throw new Error(
        "Name at least one product before sending a procurement request.",
      );
    }

    const { data: opportunity, error: oppError } = await supabase
      .from("sales_opportunities")
      .select("id, sales_reference, client_name, project_title, deal_owner_id, registered_by")
      .eq("id", opportunityId)
      .single();
    if (oppError) throw oppError;

    let assignee = null;
    if (assigneeId) {
      const { data } = await supabase
        .from("employees")
        .select("id, name, department, sub_department")
        .eq("id", assigneeId)
        .single();
      assignee = data || null;
    }

    let taskId = null;
    if (assignee) {
      const existingTask = await findOpenTaskFor(opportunityId, assignee.id);
      if (existingTask) {
        taskId = existingTask.id;
        await announceAddedToTask({
          task: existingTask,
          opportunity,
          assignee,
          items,
          requesterId,
        });
      } else {
        taskId = await purchasingService.openTaskFor({
          opportunity,
          assignee,
          items,
          requesterId,
        });
      }
    }

    const rows = items.map((item) => ({
      opportunity_id: opportunityId,
      task_id: taskId,
      requested_name: item.product_name,
      requested_unit: (item.unit || "").trim() || null,
      requested_quantity: Number(item.quantity) || 0,
      requested_description: item.description?.trim() || null,
      requested_images: item.images || [],
      // Issue #45. Null for a product that was never on a spec sheet, which is
      // the original 0017 case and stays the common one.
      inclusion_id: item.inclusionId || null,
      requested_by: requesterId,
      assigned_to: assignee?.id || null,
    }));

    const { data: created, error } = await supabase
      .from("sor_procurement_requests")
      .insert(rows)
      .select();
    if (error) throw error;

    const count = rows.length;
    const summary = `${count} product${count === 1 ? "" : "s"} sent to purchasing`;

    await purchasingService.addOpportunityNote(
      opportunityId,
      `${summary}${assignee ? ` — assigned to ${assignee.name}` : " — awaiting assignment"}.`,
      { event: "PROCUREMENT_REQUESTED", count, assigneeId: assignee?.id || null },
      requesterId,
    );

    // Nobody named yet: the head has to pick an owner before there is a task.
    if (!assignee) {
      const { data: requester } = await supabase
        .from("employees")
        .select("name")
        .eq("id", requesterId)
        .single();

      // Purchasing is a sub-department (OPERATIONS › PURCHASING). Only the
      // narrower of the two is passed, deliberately:
      //
      //   * department alone matches the head with NO sub-department — the
      //     Operations Manager — which is the wrong desk entirely.
      //   * both together match either branch of notifyHeadByDepartment's
      //     filter, so the Purchasing Manager AND their boss are notified on
      //     every single requisition. That is how a notification stream becomes
      //     one people stop reading.
      //
      // A team with no sub-department falls back to the department, which hits
      // the second branch and is correct for it.
      await notificationService.notifyHeadByDepartment(
        subDepartment ? null : department,
        subDepartment,
        {
          sender_id: requesterId,
          type: "OPPORTUNITY_PROCUREMENT_REQUESTED",
          title: "Procurement request needs an owner",
          message: `${requester?.name || "Sales"} requested ${count} product${
            count === 1 ? "" : "s"
          } on ${dealLabel(opportunity)}. Assign a buyer.`,
          reference_id: opportunityId,
        },
      );
    }

    return created || [];
  },

  /**
   * Creates the purchasing task for a set of requested products and returns its id.
   *
   * The task is a regular `tasks` row with one named owner, not a group task.
   * A group task containing the whole department is what produced the existing
   * pile of never-completed purchasing rows: completion needs every member to
   * act, so nobody does.
   */
  async openTaskFor({ opportunity, assignee, items, requesterId }) {
    const { data: requester } = await supabase
      .from("employees")
      .select("name")
      .eq("id", requesterId)
      .single();

    const head = await findHeadFor(assignee);
    const categoryId = await categoryFor(assignee);

    // Check prior tasks for this opportunity to number subsequent batches
    const { data: existingRequests } = await supabase
      .from("sor_procurement_requests")
      .select("task_id")
      .eq("opportunity_id", opportunity.id)
      .not("task_id", "is", null);

    const priorTaskIds = [...new Set((existingRequests || []).map((r) => r.task_id).filter(Boolean))];
    const batchNumber = priorTaskIds.length + 1;

    const description = buildRequisitionTitle({
      salesReference: opportunity.sales_reference,
      clientName: opportunity.client_name,
      itemCount: items.length,
      batchNumber,
    });

    const remarks = [
      `Raised from SOR by ${requester?.name || "sales"}.`,
      "Open the task to see each product's description and any screenshots.",
      "Record the Odoo PO number against each product as you resolve it.",
    ]
      .filter(Boolean)
      .join(NEWLINE);

    // Inserted through a SECURITY DEFINER function rather than a plain insert.
    // The task is owned by the buyer, not by the salesperson raising it, and
    // the RLS policy on `tasks` rejects inserting a row for somebody else —
    // see migration 0018 for why this is a function and not a new policy.
    const { data: taskId, error } = await supabase.rpc("sor_raise_procurement_task", {
      p_opportunity_id: opportunity.id,
      p_assignee_id: assignee.id,
      p_description: description,
      p_checklist: null,
      p_project_title: opportunity.project_title || null,
      p_category_id: categoryId,
      p_reported_to: head?.id || null,
      p_remarks: remarks,
    });
    if (error) throw new Error(error.message);

    // taskMutationService.createTask normally posts these; going around it for
    // the insert means posting them here, or the task appears with no trail and
    // nobody is told it exists.
    taskActivityService.addSystemEvent(
      taskId,
      `Procurement request raised by ${requester?.name || "sales"}${
        head?.name ? `. Reported to: ${head.name}.` : "."
      }`,
      {
        event: "TASK_CREATED",
        submittedById: requesterId,
        submittedByName: requester?.name || null,
        reportedToId: head?.id || null,
      },
    );

    await Promise.all(
      [
        notificationService.createNotification({
          recipient_id: assignee.id,
          sender_id: requesterId,
          type: "TASK_ASSIGNED",
          title: "Procurement request assigned",
          message: `${requester?.name || "Sales"} asked you to source ${items.length} product${
            items.length === 1 ? "" : "s"
          } for ${dealLabel(opportunity)}.`,
          reference_id: taskId,
        }),
        head?.id && head.id !== assignee.id
          ? notificationService.createNotification({
              recipient_id: head.id,
              sender_id: requesterId,
              type: "NEW_TASK_SUBMITTED",
              title: "New Task Submitted",
              message: `${assignee.name} was asked to source ${items.length} product${
                items.length === 1 ? "" : "s"
              } for ${dealLabel(opportunity)}.`,
              reference_id: taskId,
            })
          : null,
      ].filter(Boolean),
    );

    return taskId;
  },

  /**
   * Assigns unassigned requests to a buyer and opens their task. This is the
   * head's move after a department-level mention.
   */
  async assignRequests(requestIds, assigneeId, actorId) {
    if (!requestIds?.length) throw new Error("Nothing to assign.");
    if (!assigneeId) throw new Error("Choose a buyer to assign this to.");

    const { data: requests, error: readError } = await supabase
      .from("sor_procurement_requests")
      .select("*")
      .in("id", requestIds);
    if (readError) throw readError;
    if (!requests?.length) throw new Error("Those requests no longer exist.");

    const { data: opportunity } = await supabase
      .from("sales_opportunities")
      .select("id, sales_reference, client_name, project_title")
      .eq("id", requests[0].opportunity_id)
      .single();

    const { data: assignee } = await supabase
      .from("employees")
      .select("id, name, department, sub_department")
      .eq("id", assigneeId)
      .single();

    const items = requests.map((r) => ({
      product_name: r.requested_name,
      quantity: r.requested_quantity,
      unit: r.requested_unit,
      description: r.requested_description,
      images: r.requested_images,
    }));

    const existingTask = await findOpenTaskFor(opportunity.id, assigneeId);
    let taskId = null;

    if (existingTask) {
      taskId = existingTask.id;
      await announceAddedToTask({
        task: existingTask,
        opportunity,
        assignee,
        items,
        requesterId: requests[0].requested_by,
      });
    } else {
      taskId = await purchasingService.openTaskFor({
        opportunity,
        assignee,
        items,
        requesterId: requests[0].requested_by,
      });
    }

    const { error } = await supabase
      .from("sor_procurement_requests")
      .update({ assigned_to: assigneeId, task_id: taskId })
      .in("id", requestIds);
    if (error) throw error;

    await purchasingService.addOpportunityNote(
      requests[0].opportunity_id,
      `Procurement assigned to ${assignee?.name || "a buyer"}.`,
      { event: "PROCUREMENT_ASSIGNED", assigneeId, taskId },
      actorId,
    );

    return taskId;
  },

  // ── Editing / Cancelling (Sales before PO) ─────────────────────────────────

  /**
   * Updates an open procurement request before purchasing commits a PO.
   */
  async updateRequest(
    requestId,
    { product_name, quantity, unit, description, images },
    actorId,
  ) {
    if (!requestId) throw new Error("A request ID is required.");
    const name = (product_name || "").trim();
    if (!name) throw new Error("Product name is required.");

    const { data: existing, error: fetchErr } = await supabase
      .from("sor_procurement_requests")
      .select("id, opportunity_id, outcome, po_number, requested_name, task_id")
      .eq("id", requestId)
      .single();

    if (fetchErr || !existing) throw new Error("Request not found.");

    if (
      existing.po_number ||
      (existing.outcome && existing.outcome !== PROCUREMENT_OUTCOME.IN_PROGRESS)
    ) {
      throw new Error(
        "Cannot edit a request that has already been ordered or resolved by purchasing.",
      );
    }

    const qty = Number(quantity) || 1;
    const patch = {
      requested_name: name,
      requested_quantity: Math.max(1, qty),
      requested_unit: (unit || "").trim() || "unit",
      requested_description: description?.trim() || null,
      requested_images: images || [],
    };

    const { data: updated, error: updateErr } = await supabase
      .from("sor_procurement_requests")
      .update(patch)
      .eq("id", requestId)
      .select()
      .single();

    if (updateErr) throw updateErr;

    const { data: actor } = await supabase
      .from("employees")
      .select("name")
      .eq("id", actorId)
      .single();

    await purchasingService.addOpportunityNote(
      existing.opportunity_id,
      `Procurement request updated by ${actor?.name || "sales"}: ${name} (Qty: ${qty} ${patch.requested_unit}).`,
      { event: "PROCUREMENT_UPDATED", requestId, productName: name, quantity: qty },
      actorId,
    );

    return updated;
  },

  /**
   * Deletes / cancels an open procurement request before a PO is recorded.
   */
  async deleteRequest(requestId, actorId) {
    if (!requestId) throw new Error("A request ID is required.");

    const { data: existing, error: fetchErr } = await supabase
      .from("sor_procurement_requests")
      .select("id, opportunity_id, outcome, po_number, requested_name, task_id")
      .eq("id", requestId)
      .single();

    if (fetchErr || !existing) throw new Error("Request not found.");

    if (
      existing.po_number ||
      (existing.outcome && existing.outcome !== PROCUREMENT_OUTCOME.IN_PROGRESS)
    ) {
      throw new Error(
        "Cannot delete a request that has already been ordered or resolved by purchasing.",
      );
    }

    const { error: delErr } = await supabase
      .from("sor_procurement_requests")
      .delete()
      .eq("id", requestId);

    if (delErr) throw delErr;

    const { data: actor } = await supabase
      .from("employees")
      .select("name")
      .eq("id", actorId)
      .single();

    if (existing.task_id) {
      const { data: remaining } = await supabase
        .from("sor_procurement_requests")
        .select("id")
        .eq("task_id", existing.task_id);

      if (!remaining || remaining.length === 0) {
        await supabase
          .from("tasks")
          .update({
            status: TASK_STATUS.DELETED,
            remarks: `Cancelled: All procurement items for this task were cancelled by ${actor?.name || "sales"}.`,
          })
          .eq("id", existing.task_id);
      } else {
        const { data: currentTask } = await supabase
          .from("tasks")
          .select("task_description")
          .eq("id", existing.task_id)
          .single();

        if (currentTask) {
          const { data: opp } = await supabase
            .from("sales_opportunities")
            .select("sales_reference, client_name")
            .eq("id", existing.opportunity_id)
            .single();

          const batchNumber = requisitionBatchNumber(currentTask.task_description);
          const newDescription = buildRequisitionTitle({
            salesReference: opp?.sales_reference,
            clientName: opp?.client_name,
            itemCount: remaining.length,
            batchNumber,
          });

          await supabase
            .from("tasks")
            .update({ task_description: newDescription })
            .eq("id", existing.task_id);

          taskActivityService.addSystemEvent(
            existing.task_id,
            `Product "${existing.requested_name}" was cancelled by ${actor?.name || "sales"} (updated to ${remaining.length} item${remaining.length === 1 ? "" : "s"}).`,
            {
              event: "PROCUREMENT_ITEM_CANCELLED",
              cancelledProductName: existing.requested_name,
              remainingCount: remaining.length,
              newDescription,
            },
          );
        }
      }
    }

    await purchasingService.addOpportunityNote(
      existing.opportunity_id,
      `Procurement request for "${existing.requested_name}" was cancelled by ${actor?.name || "sales"}.`,
      { event: "PROCUREMENT_DELETED", requestId, productName: existing.requested_name },
      actorId,
    );

    return existing;
  },

  // ── Resolving ─────────────────────────────────────────────────────────────

  /**
   * Records purchasing's answer for one requested product.
   *
   * The PO number is required for outcomes that imply a buy, and is verified
   * against Odoo. Verification soft-fails: an unreachable Odoo marks the row
   * PENDING_VERIFICATION and lets the purchaser finish, because blocking a
   * task completion on an integration hiccup is worse than a row that says
   * "not checked yet".
   */
  async resolveRequest(
    requestId,
    { outcome, poNumber = "", odooProductRef = "", eta = null, note = "" },
    actorId,
  ) {
    if (!requestId) throw new Error("A request is required.");
    if (!PROCUREMENT_OUTCOME[outcome]) throw new Error("Choose an outcome.");

    const needsPo = outcomeRequiresPo(outcome);
    const cleanedPo = normalizePoNumber(poNumber);

    if (needsPo && !cleanedPo) {
      throw new Error(
        `"${PROCUREMENT_OUTCOME_LABELS[outcome]}" needs the Odoo PO number that proves the buy.`,
      );
    }
    if (cleanedPo && !isValidPoNumber(cleanedPo)) throw new Error(PO_NUMBER_HINT);

    const verification = cleanedPo
      ? await purchasingService.verifyPoNumber(cleanedPo)
      : { state: PO_VERIFICATION.UNVERIFIED, productRef: null };

    const isRevertingToInProgress = outcome === PROCUREMENT_OUTCOME.IN_PROGRESS;
    const finalPo = isRevertingToInProgress ? null : cleanedPo || null;
    const finalVerification = isRevertingToInProgress
      ? PO_VERIFICATION.UNVERIFIED
      : verification.state;
    const finalProductRef = isRevertingToInProgress
      ? null
      : verification.productRef || odooProductRef?.trim() || null;
    const finalVendor = isRevertingToInProgress ? null : verification.vendor || null;

    const patch = {
      outcome,
      outcome_note: note?.trim() || null,
      po_number: finalPo,
      odoo_product_ref: finalProductRef,
      odoo_vendor: finalVendor,
      eta: isRevertingToInProgress ? null : eta || null,
      verification: finalVerification,
      resolved_by: actorId,
      resolved_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("sor_procurement_requests")
      .update(patch)
      .eq("id", requestId)
      .select(REQUEST_SELECT)
      .single();
    if (error) throw error;

    await writeBackToInclusion(data);

    await purchasingService.announceIfComplete(data, actorId);

    // Record milestone update in Opportunity Log Notes on PURCHASED and DELIVERED
    if (
      data.opportunity_id &&
      (outcome === PROCUREMENT_OUTCOME.PURCHASED || outcome === PROCUREMENT_OUTCOME.DELIVERED)
    ) {
      try {
        const outcomeLabel = PROCUREMENT_OUTCOME_LABELS[outcome] || outcome;
        await opportunityService.addSystemNote(
          data.opportunity_id,
          `Procurement: "${data.requested_name}" → ${outcomeLabel}`,
          {
            event: "PROCUREMENT_UPDATE",
            requested_name: data.requested_name,
            outcome,
            po_number: data.po_number,
            odoo_product_ref: data.odoo_product_ref,
            eta: data.eta,
            note: note?.trim() || null,
          },
          actorId,
        );
      } catch (err) {
        console.warn("Could not post procurement milestone note to opportunity:", err);
      }
    }

    // Record detailed update in Purchasing Task Activity timeline if linked
    if (data.task_id) {
      try {
        const outcomeLabel = PROCUREMENT_OUTCOME_LABELS[outcome] || outcome;
        const parts = [
          `Procurement: "${data.requested_name}" → ${outcomeLabel}`,
          data.po_number ? `PO: ${data.po_number}` : null,
          data.odoo_product_ref ? `Product: ${data.odoo_product_ref}` : null,
          data.eta ? `ETA: ${formatDueDate(data.eta)}` : null,
          note?.trim() ? `Remarks: ${note.trim()}` : null,
        ].filter(Boolean);

        taskActivityService.addSystemEvent(
          data.task_id,
          parts.join(" · "),
          {
            event: "STATUS_CHANGE",
            requestId: data.id,
            outcome,
            poNumber: data.po_number,
            productRef: data.odoo_product_ref,
          },
        );
      } catch (err) {
        console.warn("Could not post procurement update to task activity:", err);
      }
    }

    if (outcome === PROCUREMENT_OUTCOME.DELIVERED && data.task_id) {
      try {
        const taskRequests = await purchasingService.listForTask(data.task_id);
        const isAllDelivered =
          taskRequests.length > 0 &&
          taskRequests.every(
            (r) =>
              r.outcome === PROCUREMENT_OUTCOME.DELIVERED ||
              r.outcome === PROCUREMENT_OUTCOME.ALREADY_EXISTS ||
              r.outcome === PROCUREMENT_OUTCOME.SUBSTITUTED ||
              r.outcome === PROCUREMENT_OUTCOME.UNAVAILABLE,
          );
        if (isAllDelivered) {
          await taskMutationService.updateTask(data.task_id, {
            status: TASK_STATUS.AWAITING_APPROVAL,
            endAt: new Date().toISOString(),
            editedBy: actorId,
          });
          data.taskAutoSubmitted = true;
        }
      } catch (err) {
        console.error("Failed to auto-submit task for review on delivery:", err);
      }
    }

    return data;
  },

  /**
   * Checks a PO number against Odoo. Never throws — a failed check is a state
   * on the row, not an error the purchaser has to deal with.
   */
  async verifyPoNumber(poNumber) {
    try {
      const { data, error } = await supabase.functions.invoke("odoo-po-verify", {
        body: { poNumber },
      });
      if (error) return { state: PO_VERIFICATION.PENDING, productRef: null };
      if (data?.found) {
        const rawDate =
          data.order?.date_planned ||
          data.order?.ordered_on ||
          data.products?.[0]?.date_planned;
        const etaDate = rawDate ? String(rawDate).trim().replace(" ", "T") : null;

        return {
          state: PO_VERIFICATION.VERIFIED,
          productRef: data.products?.[0]?.name || null,
          vendor: data.order?.supplier || null,
          eta: etaDate,
          unitPrice: data.products?.[0]?.price_unit || null,
          totalAmount: data.order?.amount_total || null,
        };
      }
      // Odoo answered and does not have it. That is a real answer, not an
      // outage, so it must not read as "we could not check".
      if (data?.success) return { state: PO_VERIFICATION.NOT_FOUND, productRef: null };
      return { state: PO_VERIFICATION.PENDING, productRef: null };
    } catch {
      return { state: PO_VERIFICATION.PENDING, productRef: null };
    }
  },

  /**
   * Tells sales once every product on a request has an answer. Fires on the
   * last resolution rather than on task completion, because what unblocks the
   * quotation is the products existing in Odoo, not the head's approval.
   *
   * "Has an answer" is isResolved, not merely "has an outcome": IN_PROGRESS is
   * an outcome value but it is the opposite of an answer, and counting it as
   * one produced the announcement "Procurement resolved — 3 In progress".
   */
  async announceIfComplete(request, actorId) {
    const siblings = await purchasingService.listForOpportunity(request.opportunity_id);
    const unresolved = siblings.filter((r) => !isResolved(r));
    if (unresolved.length) return false;

    const { data: opportunity } = await supabase
      .from("sales_opportunities")
      .select("id, sales_reference, client_name, deal_owner_id, registered_by")
      .eq("id", request.opportunity_id)
      .single();

    const tally = siblings.reduce((acc, r) => {
      acc[r.outcome] = (acc[r.outcome] || 0) + 1;
      return acc;
    }, {});

    const summary = Object.entries(tally)
      .map(([outcome, n]) => `${n} ${PROCUREMENT_OUTCOME_LABELS[outcome] || outcome}`)
      .join(", ");

    const recipients = [
      ...new Set([opportunity?.deal_owner_id, opportunity?.registered_by].filter(Boolean)),
    ];

    await Promise.all(
      recipients.map((recipient_id) =>
        notificationService.createNotification({
          recipient_id,
          sender_id: actorId,
          // No "TASK" substring: notificationRouter falls through on
          // type.includes("TASK") and would send sales to the task pages. Their
          // next move is finishing the quotation, which happens on the SOR.
          type: "OPPORTUNITY_PROCUREMENT_RESOLVED",
          title: "Procurement resolved",
          message: `Purchasing answered on ${dealLabel(opportunity)} — ${summary}.`,
          reference_id: request.opportunity_id,
        }),
      ),
    );

    systemAuditLogService
      .addSystemEvent(
        "OPPORTUNITY",
        request.opportunity_id,
        `Procurement resolved on ${dealLabel(opportunity)} — ${summary}.`,
        { event: "PROCUREMENT_RESOLVED", tally, employeeId: actorId },
        actorId,
      )
      .catch(console.error);

    return true;
  },

  // ── Deal died mid-flight ──────────────────────────────────────────────────

  /**
   * Warns purchasing that the deal behind their open requests was lost.
   *
   * Deliberately does not close anything. By this point real money may already
   * be committed to a supplier, and a task that silently vanished would take
   * the evidence of that spend with it. Purchasing closes it themselves, with
   * an outcome.
   */
  async notifyDealClosed(opportunityId, actorId, reason = "") {
    const requests = await purchasingService.listForOpportunity(opportunityId);
    const open = requests.filter((r) => !r.outcome && r.assigned_to);
    if (!open.length) return 0;

    const { data: opportunity } = await supabase
      .from("sales_opportunities")
      .select("sales_reference, client_name")
      .eq("id", opportunityId)
      .single();

    const label = dealLabel(opportunity);
    const suffix = reason ? ` — ${reason}` : "";
    const buyers = [...new Set(open.map((r) => r.assigned_to))];
    const taskIds = [...new Set(open.map((r) => r.task_id).filter(Boolean))];

    await Promise.all([
      ...buyers.map((recipient_id) =>
        notificationService.createNotification({
          recipient_id,
          sender_id: actorId,
          // Purchasing's own notification keeps task routing — their open
          // requisition is the thing they need to look at.
          type: "PROCUREMENT_TASK_DEAL_LOST",
          title: "Deal closed with procurement open",
          message: `${label} was closed lost${suffix}. Check before committing to a supplier.`,
          reference_id: taskIds[0] || null,
        }),
      ),
      ...taskIds.map((taskId) =>
        taskActivityService.addSystemEvent(
          taskId,
          `${label} was closed lost${suffix}. This requisition was left open deliberately — close it with an outcome once you know where the spend stands.`,
          { event: "PROCUREMENT_DEAL_LOST", opportunityId },
        ),
      ),
    ]);

    return open.length;
  },

  // ── SOR Deleted ─────────────────────────────────────────────────────────

  /**
   * Handles cleanup when an SOR / Sales Opportunity is deleted.
   * - If no PO was issued: Cancels the linked task and notifies the buyer.
   * - If a PO was already issued: Keeps the task with a warning so spend records aren't lost.
   */
  async handleOpportunityDeleted(opportunityId, actorId, opportunity) {
    const requests = await purchasingService.listForOpportunity(opportunityId);
    if (!requests.length) return;

    const taskIds = [...new Set(requests.map((r) => r.task_id).filter(Boolean))];
    const buyerIds = [...new Set(requests.map((r) => r.assigned_to).filter(Boolean))];
    const opLabel = dealLabel(opportunity);

    for (const taskId of taskIds) {
      const taskRequests = requests.filter((r) => r.task_id === taskId);
      const hasPurchasedPo = taskRequests.some((r) => Boolean(r.po_number));

      if (!hasPurchasedPo) {
        // Soft-cancel task when nothing was bought yet
        const { error: cancelError } = await supabase
          .from("tasks")
          .update({
            status: TASK_STATUS.DELETED,
            edited_by: actorId,
            edited_at: new Date().toISOString(),
          })
          .eq("id", taskId);
        if (cancelError) throw cancelError;

        taskActivityService.addSystemEvent(
          taskId,
          `Task automatically cancelled: Linked Sales Opportunity (${opLabel}) was deleted.`,
          { event: "TASK_CANCELLED_SOR_DELETED", opportunityId },
        );
      } else {
        // PO already issued — keep task intact and log high-priority warning
        taskActivityService.addSystemEvent(
          taskId,
          `⚠️ Notice: Linked Sales Opportunity (${opLabel}) was deleted, but active POs exist on this task. Review with Purchasing Head.`,
          { event: "SOR_DELETED_ACTIVE_PO", opportunityId },
        );
      }
    }

    // Notify assigned buyers
    await Promise.all(
      buyerIds.map((buyerId) =>
        notificationService.createNotification({
          recipient_id: buyerId,
          sender_id: actorId,
          type: "OPPORTUNITY_DELETED",
          title: "Sales Opportunity Deleted",
          message: `The Sales Opportunity "${opLabel}" linked to your procurement task was deleted.`,
          reference_id: opportunityId,
        }),
      ),
    );
  },

  // ── Shared ────────────────────────────────────────────────────────────────

  /** Timeline note on the opportunity. Mirrors opportunityService.addSystemNote. */
  async addOpportunityNote(opportunityId, content, metadata, actorId) {
    const { error } = await supabase.from("sales_opportunity_logs").insert({
      opportunity_id: opportunityId,
      author_id: actorId || null,
      type: "SYSTEM",
      content,
      metadata,
    });
    if (error) throw error;
  },
};
