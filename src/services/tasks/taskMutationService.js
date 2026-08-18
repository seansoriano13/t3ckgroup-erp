import { supabase } from "../../lib/supabase";
import { notificationService } from "../notificationService";
import { taskActivityService } from "./taskActivityService";
import { TASK_STATUS } from "../../constants/status";
import { procurementDeletionBlock } from "../procurementTaskLinks";

/**
 * Extracts a readable plain-text snippet from a task description.
 * Handles both plain text and JSON checklist format (e.g. [{"text":"...","checked":true}]).
 */
function formatTaskDescription(desc, maxLen = 30) {
  if (!desc) return "(no description)";
  const trimmed = String(desc).trim();
  let text = trimmed;
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.length > 0) {
        text = parsed.map((item) => item.text || "").filter(Boolean).join(", ");
      } else if (parsed?.text) {
        text = parsed.text;
      }
    } catch {
      // Not valid JSON — use as-is
    }
  }
  return text.length > maxLen ? text.substring(0, maxLen) + "..." : text;
}

export const taskMutationService = {
  // 3. CREATE
  async createTask(payload) {
    let initialStatus = TASK_STATUS.INCOMPLETE;
    let hrVerified = false;
    let hrVerifiedAt = null;
    let evaluatedBy = null;
    let evaluatedAt = null;

    if (payload.isAutoVerified) {
      initialStatus = TASK_STATUS.COMPLETE;
      hrVerified = true;
      hrVerifiedAt = new Date().toISOString();
      evaluatedBy = payload.submittedById;
      evaluatedAt = new Date().toISOString();
    }

    const dbPayload = {
      task_description: payload.taskDescription,
      checklist: payload.checklist || null,
      project_title: payload.projectTitle || null,
      category_id: payload.categoryId,
      logged_by: payload.loggedById,
      start_at: payload.startAt
        ? new Date(payload.startAt).toISOString()
        : new Date().toISOString(),
      end_at: payload.endAt ? new Date(payload.endAt).toISOString() : null,
      status: initialStatus,
      priority: payload.priority || "LOW",
      remarks: payload.remarks || "",
      hr_verified: hrVerified,
      hr_verified_at: hrVerifiedAt,
      evaluated_by: evaluatedBy,
      evaluated_at: evaluatedAt,
      payment_voucher: payload.paymentVoucher || null,
      attachment_urls: payload.attachments || [],
      reported_to: payload.reportedTo || null,
    };

    let { data, error } = await supabase.from("tasks").insert([dbPayload]).select();

    if (error && error.message?.includes("checklist")) {
      delete dbPayload.checklist;
      if (payload.checklist) {
        dbPayload.task_description =
          typeof payload.checklist === "string"
            ? payload.checklist
            : JSON.stringify(payload.checklist);
      }
      const retry = await supabase.from("tasks").insert([dbPayload]).select();
      if (retry.error) throw retry.error;
      data = retry.data;
    } else if (error) {
      throw error;
    }

    const taskId = data[0].id;

    // Log system activity: Task created
    let logMsg = `Task submitted by ${payload.submittedByName || "an employee"}.`;
    if (payload.reportedTo) {
      const { data: head } = await supabase
        .from("employees")
        .select("name")
        .eq("id", payload.reportedTo)
        .single();
      if (head?.name) {
        logMsg += ` Reported to: ${head.name}.`;
      }
    }

    taskActivityService.addSystemEvent(taskId, logMsg, {
      event: "TASK_CREATED",
      submittedById: payload.submittedById || payload.loggedById || null,
      submittedByName: payload.submittedByName || null,
      reportedToId: payload.reportedTo || null,
    });

    // Trigger Notification: New Task Submitted -> Head
    const { data: creator } = await supabase
      .from("employees")
      .select("name, department, sub_department")
      .eq("id", payload.loggedById)
      .single();

      const descSnippet = formatTaskDescription(
        payload.taskDescription || payload.checklist,
      );
      if (creator) {
        const notificationPayload = {
          sender_id: payload.submittedById || payload.loggedById,
          type: "NEW_TASK_SUBMITTED",
          title: "New Task Submitted",
          message: `${creator.name} submitted a new task: "${descSnippet}".`,
          reference_id: taskId,
        };

      // NEW: If reported_to is set, notify ONLY that specific head
      if (payload.reportedTo) {
        notificationService.createNotification({
          recipient_id: payload.reportedTo,
          ...notificationPayload,
        });
      } else {
        // FALLBACK: broadcast to department heads (legacy behavior)
        notificationService.notifyHeadByDepartment(
          creator.department,
          creator.sub_department,
          notificationPayload,
        );
      }

      // Special Notification: If someone else (HR/Admin) created this task for the employee
      if (
        payload.submittedById &&
        payload.submittedById !== payload.loggedById
      ) {
          const descSnippet2 = formatTaskDescription(
            payload.taskDescription || payload.checklist,
          );
          notificationService.createNotification({
            recipient_id: payload.loggedById,
            sender_id: payload.submittedById,
            type: "TASK_ASSIGNED",
            title: "New Task Assigned",
            message: `${payload.submittedByName || "An administrator"} assigned you a new task: "${descSnippet2}".`,
            reference_id: taskId,
          });
      }
    }

    return data[0];
  },

  // 4. UPDATE (Used for Employee Edits AND Manager Grading)
  async updateTask(taskId, payload) {
    const updateData = {};

    // --- Guard rails for pipeline integrity ---
    if (
      payload?.hrVerified === true &&
      payload?.status !== TASK_STATUS.COMPLETE
    ) {
      payload = { ...payload, status: TASK_STATUS.COMPLETE };
    }

    if (payload?.status === TASK_STATUS.INCOMPLETE) {
      updateData.hr_verified = false;
      updateData.hr_verified_at = null;
      updateData.hr_remarks = "";
      if (payload?.endAt === undefined) {
        updateData.end_at = null;
      }
    }

    if (payload?.status === TASK_STATUS.NOT_APPROVED) {
      updateData.hr_verified = false;
      updateData.hr_verified_at = null;
      // Preserve existing hr_remarks unless caller explicitly provided hrRemarks.
      if (payload?.hrRemarks !== undefined) {
        updateData.hr_remarks = payload.hrRemarks;
      }
    }

    let current = null;
    const { data: cur, error: curErr } = await supabase
      .from("tasks")
      .select(
        "status, hr_verified, evaluated_by, logged_by, reported_to, task_description, checklist, project_title, category_id, priority, start_at, end_at, remarks, grade, payment_voucher, attachment_urls, category:categories(description), creator:employees!tasks_logged_by_fk(name, department, sub_department)",
      )
      .eq("id", taskId)
      .single();
    if (curErr) throw curErr;
    current = cur;

    const isHeadApprove =
      payload?.status === TASK_STATUS.COMPLETE &&
      payload?.evaluatedBy !== undefined;
    const isHeadReject =
      payload?.status === TASK_STATUS.NOT_APPROVED &&
      payload?.evaluatedBy !== undefined;
    const isHrReject =
      payload?.status === TASK_STATUS.NOT_APPROVED &&
      payload?.evaluatedBy === undefined;

    const isHeadReEval =
      payload?.status === TASK_STATUS.COMPLETE &&
      payload?.evaluatedBy !== undefined &&
      current?.status === TASK_STATUS.COMPLETE &&
      current?.hr_verified === false;

    if (isHeadApprove && !isHeadReEval) {
      if (
        current?.status !== TASK_STATUS.INCOMPLETE &&
        current?.status !== TASK_STATUS.AWAITING_APPROVAL
      ) {
        throw new Error(
          `Invalid pipeline transition: can only approve tasks from INCOMPLETE or AWAITING APPROVAL`,
        );
      }
    }

    if (isHeadReject) {
      if (
        current?.status !== TASK_STATUS.INCOMPLETE &&
        current?.status !== TASK_STATUS.AWAITING_APPROVAL
      ) {
        throw new Error(
          `Invalid pipeline transition: can only reject tasks from INCOMPLETE or AWAITING APPROVAL`,
        );
      }
    }

    if (
      payload?.status === TASK_STATUS.COMPLETE &&
      payload?.evaluatedBy === undefined &&
      payload?.hrVerified !== true &&
      payload?.hrVerified !== false
    ) {
      throw new Error(
        `Invalid pipeline state: status=COMPLETE requires evaluatedBy`,
      );
    }

    if (
      payload?.status === TASK_STATUS.NOT_APPROVED &&
      payload?.evaluatedBy === undefined &&
      payload?.hrVerified !== false
    ) {
      throw new Error(
        `Invalid pipeline state: status=NOT APPROVED requires evaluatedBy`,
      );
    }

    if (isHrReject) {
      if (
        current?.status !== TASK_STATUS.COMPLETE ||
        current?.hr_verified !== false
      ) {
        throw new Error(
          `Invalid pipeline transition: HR reject requires status=COMPLETE and hrVerified=false`,
        );
      }
    }

    if (payload?.hrVerified === true) {
      if (
        current?.status !== TASK_STATUS.COMPLETE ||
        current?.hr_verified !== false
      ) {
        throw new Error(
          `Invalid pipeline transition: HR verify requires status=COMPLETE and hrVerified=false`,
        );
      }
      if (current?.evaluated_by == null) {
        throw new Error(
          `Invalid pipeline state: HR verification requires evaluatedBy`,
        );
      }
    }

    const isHrUndo =
      payload?.hrVerified === false &&
      payload?.status === TASK_STATUS.COMPLETE &&
      payload?.evaluatedBy === undefined;

    if (isHrUndo) {
      if (
        current?.status !== TASK_STATUS.COMPLETE ||
        current?.hr_verified !== true
      ) {
        throw new Error(
          `Invalid pipeline transition: HR undo requires status=COMPLETE and hrVerified=true`,
        );
      }
    }

    // IMMUTABILITY GUARD
    if (current?.hr_verified === true && !isHrUndo) {
      const attemptedCoreEdits = [
        payload.taskDescription,
        payload.checklist,
        payload.projectTitle,
        payload.categoryId,
        payload.priority,
        payload.startAt,
        payload.endAt,
        payload.attachments,
        payload.grade,
        payload.remarks,
      ].some((val) => val !== undefined);

      if (attemptedCoreEdits) {
        throw new Error(
          "Cannot edit core details of a task that has already been verified by HR.",
        );
      }
    }

    // Auto-fill end time when submitting for review
    if (
      payload?.status === TASK_STATUS.AWAITING_APPROVAL &&
      current?.status !== TASK_STATUS.AWAITING_APPROVAL &&
      !current?.end_at &&
      payload.endAt === undefined
    ) {
      updateData.end_at = new Date().toISOString();
    }

    // Employee Edit Fields
    if (payload.taskDescription !== undefined)
      updateData.task_description = payload.taskDescription;
    if (payload.projectTitle !== undefined)
      updateData.project_title = payload.projectTitle || null;
    if (payload.categoryId !== undefined)
      updateData.category_id = payload.categoryId;
    if (payload.priority !== undefined) updateData.priority = payload.priority;
    if (payload.startAt !== undefined) {
      updateData.start_at = payload.startAt
        ? new Date(payload.startAt).toISOString()
        : null;
    }
    if (payload.endAt !== undefined) {
      updateData.end_at = payload.endAt
        ? new Date(payload.endAt).toISOString()
        : null;
    }
    if (payload.paymentVoucher !== undefined) {
      updateData.payment_voucher = payload.paymentVoucher || null;
    }
    if (payload.checklist !== undefined) {
      updateData.checklist = payload.checklist;
    }

    // Manager/HR Fields
    if (payload.status !== undefined) updateData.status = payload.status;
    if (payload.remarks !== undefined) updateData.remarks = payload.remarks;
    if (payload.grade !== undefined) updateData.grade = payload.grade;
    if (payload.hrVerified !== undefined) {
      updateData.hr_verified = payload.hrVerified;
      updateData.hr_verified_at = payload.hrVerified
        ? new Date().toISOString()
        : null;
    }

    if (payload.evaluatedBy !== undefined) {
      updateData.evaluated_by = payload.evaluatedBy;
      updateData.evaluated_at = new Date().toISOString();
    }

    if (payload.hrRemarks !== undefined)
      updateData.hr_remarks = payload.hrRemarks;

    if (payload.attachments !== undefined) {
      updateData.attachment_urls = payload.attachments;
    }

    // The Audit Trail Hookup
    if (payload.editedBy) {
      updateData.edited_by = payload.editedBy;
      updateData.edited_at = new Date().toISOString();
    }

    // Detect resubmission (NOT APPROVED → INCOMPLETE). This has to be decided
    // BEFORE the write: a resubmitted task goes back for a fresh evaluation, so
    // the previous grade, evaluator, HR sign-off and remarks must be cleared in
    // the same update rather than left on the record.
    const isResubmission =
      payload?.status === TASK_STATUS.INCOMPLETE &&
      current?.status === TASK_STATUS.NOT_APPROVED;

    if (isResubmission) {
      updateData.grade = 0;
      updateData.evaluated_by = null;
      updateData.evaluated_at = null;
      updateData.hr_verified = false;
      updateData.hr_verified_at = null;
      updateData.hr_remarks = "";
      updateData.remarks = "";
    }

    let { data, error } = await supabase
      .from("tasks")
      .update(updateData)
      .eq("id", taskId)
      .select()
      .single();

    if (error && error.message?.includes("checklist")) {
      delete updateData.checklist;
      if (payload.checklist !== undefined) {
        updateData.task_description =
          typeof payload.checklist === "string"
            ? payload.checklist
            : JSON.stringify(payload.checklist);
      }
      const retry = await supabase
        .from("tasks")
        .update(updateData)
        .eq("id", taskId)
        .select()
        .single();
      if (retry.error) throw retry.error;
      data = retry.data;
    } else if (error) {
      throw error;
    }

    // ===========================
    // ACTIVITY TIMELINE ENTRIES
    // ===========================
    if (current && payload.editedBy) {
      const { data: editor } = await supabase
        .from("employees")
        .select("name")
        .eq("id", payload.editedBy)
        .single();

      const editorName = editor?.name || "Someone";

      // --- Status transition events ---
      const isEmployeeSelfComplete =
        payload?.status === TASK_STATUS.AWAITING_APPROVAL &&
        current?.status !== TASK_STATUS.AWAITING_APPROVAL;

      if (isEmployeeSelfComplete) {
        // Detect if this is a re-submission by checking prior RESUBMITTED activity
        let submitVerb = "submitted";
        try {
          const { data: resubmitEvents } = await supabase
            .from("task_activity")
            .select("id")
            .eq("task_id", taskId)
            .eq("metadata->>event", "RESUBMITTED")
            .limit(1);
          if (resubmitEvents && resubmitEvents.length > 0)
            submitVerb = "resubmitted";
        } catch {
          // The verb is cosmetic; a failed lookup keeps the default wording.
        }

        taskActivityService.addSystemEvent(
          taskId,
          `${current.creator?.name || "Employee"} ${submitVerb} task for review.`,
          {
            event: "STATUS_CHANGE",
            old_status: current.status,
            new_status: TASK_STATUS.AWAITING_APPROVAL,
          },
        );
      }

      if (isHeadApprove && !isHeadReEval) {
        taskActivityService.upsertActivityEntry(
          taskId,
          payload.editedBy,
          "APPROVAL",
          "APPROVED",
          payload.activityMessage ||
            payload.remarks ||
            `Task approved by ${editorName}`,
          { event: "APPROVED", grade: payload.grade },
        );
      }

      if (isHeadReEval) {
        taskActivityService.upsertActivityEntry(
          taskId,
          payload.editedBy,
          "APPROVAL",
          "GRADE_UPDATED",
          payload.activityMessage ||
            `${editorName} updated the grade to ${payload.grade}${payload.remarks ? ` — "${payload.remarks}"` : ""}.`,
          { event: "GRADE_UPDATED", grade: payload.grade },
        );
      }

      if (isHeadReject) {
        taskActivityService.upsertActivityEntry(
          taskId,
          payload.editedBy,
          "APPROVAL",
          "REJECTED",
          payload.activityMessage ||
            payload.remarks ||
            `Task rejected by ${editorName}`,
          { event: "REJECTED", grade: 0 },
        );
      }

      if (payload.hrVerified === true && current.hr_verified === false) {
        taskActivityService.upsertActivityEntry(
          taskId,
          payload.editedBy,
          "HR_NOTE",
          "HR_VERIFIED",
          payload.activityMessage || `Task verified by HR (${editorName})`,
          { event: "HR_VERIFIED" },
        );
      }

      if (isHrReject) {
        taskActivityService.upsertActivityEntry(
          taskId,
          payload.editedBy,
          "HR_NOTE",
          "HR_REJECTED",
          payload.activityMessage ||
            payload.hrRemarks ||
            `Task rejected by HR (${editorName})`,
          { event: "HR_REJECTED" },
        );
      }

      if (isHrUndo) {
        taskActivityService.upsertActivityEntry(
          taskId,
          payload.editedBy,
          "SYSTEM",
          "HR_UNDO",
          `HR verification undone by ${editorName}.`,
          { event: "HR_UNDO" },
        );
      }

      // Self-verify
      const isSelfVerify =
        payload?.status === TASK_STATUS.COMPLETE &&
        payload?.evaluatedBy !== undefined &&
        payload?.remarks === "Self-Verified (System Bypass)";
      if (isSelfVerify) {
        taskActivityService.addSystemEvent(
          taskId,
          `Self-verified by ${editorName} (System Bypass).`,
          { event: "SELF_VERIFIED", grade: payload.grade },
        );
      }

      // Task recalled (from AWAITING_APPROVAL)
      const isRecall =
        payload?.status === TASK_STATUS.INCOMPLETE &&
        current?.status === TASK_STATUS.AWAITING_APPROVAL;
      if (isRecall) {
        taskActivityService.addSystemEvent(
          taskId,
          `Task recalled by ${editorName}.`,
          {
            event: "STATUS_CHANGE",
            old_status: TASK_STATUS.AWAITING_APPROVAL,
            new_status: TASK_STATUS.INCOMPLETE,
          },
        );
      }

      // Task resubmitted (from HR rejection back to head queue)
      if (isResubmission) {
        taskActivityService.addSystemEvent(
          taskId,
          `Task resubmitted for approval by ${current.creator?.name || editorName}.`,
          {
            event: "RESUBMITTED",
            old_status: TASK_STATUS.NOT_APPROVED,
            new_status: TASK_STATUS.INCOMPLETE,
          },
        );
      }

      // Check for core field edits — log a separate, detailed entry per changed field
      if (
        !isEmployeeSelfComplete &&
        !isHeadApprove &&
        !isHeadReject &&
        !isHrReject &&
        !isRecall &&
        payload.status === undefined
      ) {
        const fmtDate = (iso) => {
          if (!iso) return "(none)";
          return new Date(iso).toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
          });
        };
        const truncate = (str, len = 60) =>
          str
            ? str.length > len
              ? str.substring(0, len) + "…"
              : str
            : "(none)";

        // Task description (plain text — checklist now has its own field)
        if (
          payload.taskDescription !== undefined &&
          payload.taskDescription !== current.task_description
        ) {
          taskActivityService.addSystemEvent(
            taskId,
            `${editorName} changed the task description.\n  From: "${truncate(current.task_description)}"\n  To: "${truncate(payload.taskDescription)}"`,
            {
              event: "TASK_EDITED",
              field: "task_description",
              old: current.task_description,
              new: payload.taskDescription,
            },
          );
        }

        // Checklist (dedicated column)
        if (
          payload.checklist !== undefined &&
          JSON.stringify(payload.checklist) !== JSON.stringify(current.checklist)
        ) {
          const parseItems = (val) => {
            if (!val) return [];
            if (Array.isArray(val)) return val;
            if (typeof val === "string") {
              try {
                const parsed = JSON.parse(val);
                return Array.isArray(parsed) ? parsed : parsed?.items || [];
              } catch { return []; }
            }
            return val?.items || [];
          };

          const oldItems = parseItems(current.checklist);
          const newItems = parseItems(payload.checklist);

          let checkedItemText = "";
          let uncheckedItemText = "";
          let editedItemText = "";

          for (
            let i = 0;
            i < Math.max(oldItems.length, newItems.length);
            i++
          ) {
            const oldItem = oldItems[i];
            const newItem = newItems[i];

            if (oldItem && newItem) {
              if (!oldItem.checked && newItem.checked) {
                checkedItemText = newItem.text;
              } else if (oldItem.checked && !newItem.checked) {
                uncheckedItemText = newItem.text;
              } else if (oldItem.text !== newItem.text) {
                editedItemText = newItem.text;
              }
            }
          }

          let msg = `${editorName} updated the task checklist.`;
          if (checkedItemText)
            msg = `${editorName} completed a checklist item: "${truncate(checkedItemText)}"`;
          else if (uncheckedItemText)
            msg = `${editorName} unchecked a checklist item: "${truncate(uncheckedItemText)}"`;
          else if (editedItemText)
            msg = `${editorName} edited a checklist item: "${truncate(editedItemText)}"`;
          else if (newItems.length > oldItems.length)
            msg = `${editorName} added items to the checklist.`;
          else if (newItems.length < oldItems.length)
            msg = `${editorName} removed items from the checklist.`;

          taskActivityService.upsertChecklistEvent(taskId, msg, {
            event: "CHECKLIST_UPDATED",
            field: "checklist",
            old: current.checklist,
            new: payload.checklist,
          });
        }

        // Project title
        if (
          payload.projectTitle !== undefined &&
          (payload.projectTitle || null) !== (current.project_title || null)
        ) {
          const oldProj = current.project_title || "(none)";
          const newProj = payload.projectTitle || "(none)";
          taskActivityService.addSystemEvent(
            taskId,
            `${editorName} changed the project title from "${oldProj}" to "${newProj}".`,
            {
              event: "TASK_EDITED",
              field: "project_title",
              old: current.project_title,
              new: payload.projectTitle,
            },
          );
        }

        // Category
        if (
          payload.categoryId !== undefined &&
          payload.categoryId !== current.category_id
        ) {
          // Fetch new category name
          let newCatName = payload.categoryId;
          try {
            const { data: newCat } = await supabase
              .from("categories")
              .select("description")
              .eq("id", payload.categoryId)
              .single();
            newCatName = newCat?.description || payload.categoryId;
          } catch {
            // Falls back to the raw category id in the activity entry.
          }
          const oldCatName =
            current.category?.description || current.category_id || "(none)";
          taskActivityService.addSystemEvent(
            taskId,
            `${editorName} changed the category from "${oldCatName}" to "${newCatName}".`,
            {
              event: "TASK_EDITED",
              field: "category_id",
              old: current.category_id,
              new: payload.categoryId,
            },
          );
        }

        // Priority
        if (
          payload.priority !== undefined &&
          payload.priority !== current.priority
        ) {
          taskActivityService.addSystemEvent(
            taskId,
            `${editorName} changed the priority from ${current.priority} to ${payload.priority}.`,
            {
              event: "TASK_EDITED",
              field: "priority",
              old: current.priority,
              new: payload.priority,
            },
          );
        }

        // Start date
        if (payload.startAt !== undefined) {
          const newStart = payload.startAt
            ? new Date(payload.startAt).toISOString()
            : null;
          // Compare only the date portion (YYYY-MM-DD) to avoid sub-second / timezone false positives
          const oldStartDay = current.start_at
            ? current.start_at.substring(0, 10)
            : null;
          const newStartDay = newStart ? newStart.substring(0, 10) : null;
          if (newStartDay !== oldStartDay) {
            taskActivityService.addSystemEvent(
              taskId,
              `${editorName} changed the start date from ${fmtDate(current.start_at)} to ${fmtDate(newStart)}.`,
              {
                event: "TASK_EDITED",
                field: "start_at",
                old: current.start_at,
                new: newStart,
              },
            );
          }
        }

        // End date
        if (payload.endAt !== undefined) {
          const newEnd = payload.endAt
            ? new Date(payload.endAt).toISOString()
            : null;
          // Compare only the date portion (YYYY-MM-DD)
          const oldEndDay = current.end_at
            ? current.end_at.substring(0, 10)
            : null;
          const newEndDay = newEnd ? newEnd.substring(0, 10) : null;
          if (newEndDay !== oldEndDay) {
            taskActivityService.addSystemEvent(
              taskId,
              `${editorName} changed the end date from ${fmtDate(current.end_at)} to ${fmtDate(newEnd)}.`,
              {
                event: "TASK_EDITED",
                field: "end_at",
                old: current.end_at,
                new: newEnd,
              },
            );
          }
        }

        // Remarks
        if (
          payload.remarks !== undefined &&
          payload.remarks !== current.remarks
        ) {
          taskActivityService.addSystemEvent(
            taskId,
            `${editorName} updated the remarks.\n  From: "${truncate(current.remarks || "(none)")}"\n  To: "${truncate(payload.remarks || "(none)")}"`,
            {
              event: "TASK_EDITED",
              field: "remarks",
              old: current.remarks,
              new: payload.remarks,
            },
          );
        }

        // Payment voucher
        if (
          payload.paymentVoucher !== undefined &&
          (payload.paymentVoucher || null) !== (current.payment_voucher || null)
        ) {
          const oldPv = current.payment_voucher || null;
          const newPv = payload.paymentVoucher || null;
          let pvMsg;
          if (!oldPv && newPv) {
            pvMsg = `${editorName} added a payment voucher: "${newPv}".`;
          } else if (oldPv && !newPv) {
            pvMsg = `${editorName} removed the payment voucher (was: "${oldPv}").`;
          } else {
            pvMsg = `${editorName} changed the payment voucher from "${oldPv}" to "${newPv}".`;
          }
          taskActivityService.addSystemEvent(taskId, pvMsg, {
            event: "TASK_EDITED",
            field: "payment_voucher",
            old: oldPv,
            new: newPv,
          });
        }

        // Attachments — only log if the actual count changed
        if (payload.attachments !== undefined) {
          const oldCount = (current.attachment_urls || []).length;
          const newCount = (payload.attachments || []).length;
          const diff = newCount - oldCount;
          if (diff !== 0) {
            let attMsg;
            if (oldCount === 0 && newCount > 0) {
              attMsg = `${editorName} uploaded ${newCount} attachment${newCount !== 1 ? "s" : ""}.`;
            } else if (newCount === 0 && oldCount > 0) {
              attMsg = `${editorName} removed all ${oldCount} attachment${oldCount !== 1 ? "s" : ""}.`;
            } else if (diff > 0) {
              attMsg = `${editorName} added ${diff} attachment${diff !== 1 ? "s" : ""} (${newCount} total).`;
            } else {
              attMsg = `${editorName} removed ${Math.abs(diff)} attachment${Math.abs(diff) !== 1 ? "s" : ""} (${newCount} remaining).`;
            }
            taskActivityService.addSystemEvent(taskId, attMsg, {
              event: "TASK_EDITED",
              field: "attachments",
              old_count: oldCount,
              new_count: newCount,
              old: current.attachment_urls || [],
              new: payload.attachments || [],
            });
          }
        }
      }
    }

    // NOTIFICATION TRIGGERS
    if (current && payload.editedBy) {
      const taskNameSnippet = `"${formatTaskDescription(current.task_description)}"`;

      const isEmployeeSelfComplete =
        payload?.status === TASK_STATUS.AWAITING_APPROVAL &&
        current?.status !== TASK_STATUS.AWAITING_APPROVAL;
      if (isEmployeeSelfComplete) {
        // NEW: If task has reported_to, notify ONLY that head
        if (current.reported_to) {
          notificationService.createNotification({
            recipient_id: current.reported_to,
            sender_id: payload.editedBy,
            type: "TASK_AWAITING_APPROVAL",
            title: "Task Awaiting Approval",
            message: `${current.creator?.name} has submitted a task for your approval: ${taskNameSnippet}.`,
            reference_id: taskId,
          });
        } else {
          // FALLBACK: broadcast to all heads + super admins
          notificationService.broadcastToRole(["SUPER_ADMIN"], {
            sender_id: payload.editedBy,
            type: "TASK_AWAITING_APPROVAL",
            title: "Task Awaiting Approval",
            message: `${current.creator?.name} has submitted a task for your approval: ${taskNameSnippet}.`,
            reference_id: taskId,
          });

          const empSubDept = current.creator?.sub_department;
          if (empSubDept || current.creator?.department) {
            notificationService.notifyHeadByDepartment(
              current.creator?.department,
              empSubDept,
              {
                sender_id: payload.editedBy,
                type: "TASK_AWAITING_APPROVAL",
                title: "Task Awaiting Approval",
                message: `${current.creator?.name} has submitted a task for your approval: ${taskNameSnippet}.`,
                reference_id: taskId,
              },
            );
          }
        }
      }

      if (isHeadApprove) {
        // Notify HR only
        notificationService.broadcastToRole(["HR"], {
          sender_id: payload.editedBy,
          type: "TASK_APPROVED_BY_HEAD",
          title: "Task Ready for HR",
          message: `A Head approved task ${taskNameSnippet} from ${current.creator?.name}. Ready for Verification.`,
          reference_id: taskId,
          excludeSuperAdmin: true,
        });
      }

      if (isHeadReject || isHrReject) {
        notificationService.createNotification({
          recipient_id: current.logged_by,
          sender_id: payload.editedBy,
          type: "TASK_REJECTED",
          title: "Task Revision Required",
          message: `Your task ${taskNameSnippet} was rejected for revision. Check the remarks.`,
          reference_id: taskId,
        });
      }

      if (isResubmission) {
        // Notify the head that the employee resubmitted for re-evaluation
        const resubNotif = {
          sender_id: payload.editedBy,
          type: "NEW_TASK_SUBMITTED",
          title: "Task Resubmitted for Review",
          message: `${current.creator?.name} resubmitted ${taskNameSnippet} after HR rejection. Please re-evaluate.`,
          reference_id: taskId,
        };
        if (current.reported_to) {
          notificationService.createNotification({
            recipient_id: current.reported_to,
            ...resubNotif,
          });
        } else {
          notificationService.notifyHeadByDepartment(
            current.creator?.department,
            current.creator?.sub_department,
            resubNotif,
          );
        }
      }

      if (payload.hrVerified === true && current.hr_verified === false) {
        // Notify the owner
        notificationService.createNotification({
          recipient_id: current.logged_by,
          sender_id: payload.editedBy,
          type: "TASK_VERIFIED",
          title: "Task HR Verified",
          message: `Your task ${taskNameSnippet} has been officially verified by HR!`,
          reference_id: taskId,
        });

        // Also keep the Head in the loop — use reported_to if available
        if (current.reported_to) {
          notificationService.createNotification({
            recipient_id: current.reported_to,
            sender_id: payload.editedBy,
            type: "TASK_VERIFIED",
            title: "Staff Task Verified by HR",
            message: `Task ${taskNameSnippet} by ${current.creator?.name} under your team was verified by HR.`,
            reference_id: taskId,
          });
        } else {
          const empSubDept = current.creator?.sub_department;
          if (empSubDept || current.creator?.department) {
            notificationService.notifyHeadByDepartment(
              current.creator?.department,
              empSubDept,
              {
                sender_id: payload.editedBy,
                type: "TASK_VERIFIED",
                title: "Staff Task Verified by HR",
                message: `Task ${taskNameSnippet} by ${current.creator?.name} under your department was verified by HR.`,
                reference_id: taskId,
              },
            );
          }
        }

        // Notify Super Admin
        notificationService.broadcastToRole(["SUPER_ADMIN"], {
          sender_id: payload.editedBy,
          type: "TASK_COMPLETED",
          title: "Task Completed",
          message: `Task ${taskNameSnippet} by ${current.creator?.name} has been verified by HR and is now marked as complete.`,
          reference_id: taskId,
        });
      }

      if (
        payload.grade !== undefined &&
        payload.grade > 0 &&
        payload.status === TASK_STATUS.COMPLETE &&
        current.evaluated_by == null
      ) {
        notificationService.createNotification({
          recipient_id: current.logged_by,
          sender_id: payload.editedBy,
          type: "TASK_GRADED",
          title: "Task Successfully Graded",
          message: `You earned a grade of ${payload.grade} for ${taskNameSnippet}!`,
          reference_id: taskId,
        });
      }
    }

    return data;
  },

  // 5. DELETE
  async deleteTask(taskId, userId) {
    const { data: userRole } = await supabase
      .from("employees")
      .select("is_super_admin, is_head, is_hr")
      .eq("id", userId)
      .single();

    const { data: task } = await supabase
      .from("tasks")
      .select("logged_by, hr_verified, attachment_urls")
      .eq("id", taskId)
      .single();

    if (!task) throw new Error("Task not found");

    const isManager =
      userRole?.is_super_admin || userRole?.is_head || userRole?.is_hr;

    if (task.logged_by !== userId && !isManager) {
      throw new Error("Unauthorized to delete this task");
    }

    if (task.hr_verified === true && !userRole?.is_super_admin) {
      throw new Error("Cannot delete tasks that are already verified by HR.");
    }

    const procurementBlock = await procurementDeletionBlock(taskId);
    if (procurementBlock) throw new Error(procurementBlock);

    // NOTE: Attachments are intentionally preserved during soft deletes
    // to maintain audit trail integrity. Physical cleanup should only
    // happen during hard deletes or scheduled maintenance.

    const { error } = await supabase
      .from("tasks")
      .update({
        status: TASK_STATUS.DELETED,
        edited_by: userId,
        edited_at: new Date().toISOString(),
      })
      .eq("id", taskId);

    if (error) throw error;

    // Log deletion to activity timeline
    const { data: deleter } = await supabase
      .from("employees")
      .select("name")
      .eq("id", userId)
      .single();

    taskActivityService.addSystemEvent(
      taskId,
      `Task deleted by ${deleter?.name || "someone"}.`,
      { event: "DELETED" },
    );

    return true;
  },

  // 6. BULK APPROVE
  async bulkApproveTasks(
    taskIds,
    adminId,
    grade = 3,
    remarks = "Bulk approved via system bypass",
  ) {
    if (!taskIds || taskIds.length === 0) return;

    const { data: admin } = await supabase
      .from("employees")
      .select("is_super_admin, is_head, name")
      .eq("id", adminId)
      .single();

    if (!admin?.is_super_admin && !admin?.is_head) {
      throw new Error(
        "Unauthorized: Only Admins/Heads can bulk approve tasks.",
      );
    }

    const { data, error } = await supabase
      .from("tasks")
      .update({
        status: TASK_STATUS.COMPLETE,
        grade: grade, // Default neutral grade
        remarks: remarks,
        evaluated_by: adminId,
        evaluated_at: new Date().toISOString(),
        edited_by: adminId,
        edited_at: new Date().toISOString(),
      })
      .in("id", taskIds)
      .select(
        "*, creator:employees!tasks_logged_by_fk(name, department, sub_department)",
      );

    if (error) throw error;

    // Log activity for each bulk-approved task
    for (const task of data) {
      taskActivityService.addApprovalEntry(task.id, adminId, remarks, {
        event: "APPROVED",
        grade: grade,
        bulk: true,
      });
      taskActivityService.addSystemEvent(
        task.id,
        `Task bulk-approved by ${admin?.name || "Admin"} — Grade: ${grade}`,
        {
          event: "STATUS_CHANGE",
          old_status: "BULK",
          new_status: TASK_STATUS.COMPLETE,
          grade: grade,
        },
      );
    }

    // Notify HR that tasks were bulk-approved
    notificationService
      .broadcastToRole(["HR"], {
        sender_id: adminId,
        type: "TASK_APPROVED_BY_HEAD",
        title: "Bulk Tasks Approved",
        message: `${admin?.name || "An Admin"} bulk-approved ${data.length} task(s). Ready for Verification.`,
        excludeSuperAdmin: true,
      })
      .catch(console.error);

    // Notify each affected employee that their task was graded
    const byEmployee = {};
    data.forEach((t) => {
      if (!byEmployee[t.logged_by]) byEmployee[t.logged_by] = [];
      byEmployee[t.logged_by].push(
        t.task_description?.substring(0, 30) || "a task",
      );
    });

    await Promise.allSettled(
      Object.entries(byEmployee).map(([empId, descriptions]) =>
        notificationService.createNotification({
          recipient_id: empId,
          sender_id: adminId,
          type: "TASK_GRADED",
          title: "Tasks Approved",
          message: `${descriptions.length} task(s) bulk-approved with grade 3: ${descriptions.slice(0, 3).join(", ")}${descriptions.length > 3 ? "…" : ""}`,
        }),
      ),
    );

    return data;
  },

  async bulkDeclineTasks(taskIds, adminId, remarks = "Bulk rejected by admin") {
    if (!taskIds || taskIds.length === 0) return;

    const { data: admin } = await supabase
      .from("employees")
      .select("is_super_admin, is_head, name")
      .eq("id", adminId)
      .single();

    if (!admin?.is_super_admin && !admin?.is_head) {
      throw new Error("Unauthorized: Only Admins/Heads can bulk reject tasks.");
    }

    const { data, error } = await supabase
      .from("tasks")
      .update({
        status: TASK_STATUS.NOT_APPROVED,
        grade: 0,
        remarks: remarks,
        evaluated_by: adminId,
        evaluated_at: new Date().toISOString(),
        edited_by: adminId,
        edited_at: new Date().toISOString(),
      })
      .in("id", taskIds)
      .select(
        "*, creator:employees!tasks_logged_by_fk(name, department, sub_department)",
      );

    if (error) throw error;

    // Log activity for each bulk-rejected task
    for (const task of data) {
      taskActivityService.addApprovalEntry(task.id, adminId, remarks, {
        event: "REJECTED",
        grade: 0,
        bulk: true,
      });
      taskActivityService.addSystemEvent(
        task.id,
        `Task bulk-rejected by ${admin?.name || "Admin"}.`,
        {
          event: "STATUS_CHANGE",
          old_status: "BULK",
          new_status: TASK_STATUS.NOT_APPROVED,
          grade: 0,
        },
      );
    }

    // Notify each affected employee that their task was rejected
    const byEmployee = {};
    data.forEach((t) => {
      if (!byEmployee[t.logged_by]) byEmployee[t.logged_by] = [];
      byEmployee[t.logged_by].push(
        t.task_description?.substring(0, 30) || "a task",
      );
    });

    await Promise.allSettled(
      Object.entries(byEmployee).map(([empId, descriptions]) =>
        notificationService.createNotification({
          recipient_id: empId,
          sender_id: adminId,
          type: "TASK_REJECTED",
          title: "Tasks Rejected",
          message: `${descriptions.length} task(s) bulk-rejected: ${descriptions.slice(0, 3).join(", ")}${descriptions.length > 3 ? "…" : ""}. Check remarks.`,
        }),
      ),
    );

    return data;
  },

  async undoBulkApproval(taskIds, adminId) {
    if (!taskIds || taskIds.length === 0) return;

    // Reset workflow to AWAITING_APPROVAL
    const { data, error } = await supabase
      .from("tasks")
      .update({
        status: TASK_STATUS.AWAITING_APPROVAL,
        grade: 0,
        remarks: "",
        hr_verified: false,
        hr_verified_at: null,
        evaluated_by: null,
        evaluated_at: null,
        edited_by: adminId,
        edited_at: new Date().toISOString(),
      })
      .in("id", taskIds)
      .select();

    if (error) throw error;

    for (const task of data) {
      taskActivityService.addSystemEvent(
        task.id,
        "Bulk approval reverted by Manager.",
        { event: "STATUS_CHANGE", new_status: TASK_STATUS.AWAITING_APPROVAL },
      );
    }
    return true;
  },

  // HR BULK VERIFY — sets hr_verified=true only, never touches grade or evaluated_by
  async bulkVerifyTasks(taskIds, hrId, notes = "") {
    if (!taskIds || taskIds.length === 0) return;

    const { data: hr } = await supabase
      .from("employees")
      .select("is_hr, is_super_admin, name")
      .eq("id", hrId)
      .single();

    if (!hr?.is_hr && !hr?.is_super_admin) {
      throw new Error("Unauthorized: Only HR/Admins can bulk verify tasks.");
    }

    // Guard: only verify tasks that are COMPLETE + not yet hr_verified + have been evaluated
    const { data: tasks, error: fetchErr } = await supabase
      .from("tasks")
      .select("id, status, hr_verified, evaluated_by")
      .in("id", taskIds);

    if (fetchErr) throw fetchErr;

    const eligible = tasks.filter(
      (t) =>
        t.status === TASK_STATUS.COMPLETE &&
        t.hr_verified === false &&
        t.evaluated_by != null,
    );

    if (eligible.length === 0) {
      throw new Error(
        "None of the selected tasks are eligible for HR verification. Tasks must be COMPLETE, graded by a Head, and not yet verified.",
      );
    }

    const eligibleIds = eligible.map((t) => t.id);

    const { data, error } = await supabase
      .from("tasks")
      .update({
        hr_verified: true,
        hr_verified_at: new Date().toISOString(),
        hr_remarks: notes || "",
        edited_by: hrId,
        edited_at: new Date().toISOString(),
      })
      .in("id", eligibleIds)
      .select();

    if (error) throw error;

    for (const task of data) {
      taskActivityService.addHrEntry(
        task.id,
        hrId,
        notes || "Bulk verified by HR",
        { event: "HR_VERIFIED", bulk: true },
      );
      taskActivityService.addSystemEvent(
        task.id,
        `Task bulk-verified by HR (${hr?.name || "HR"}).`,
        { event: "HR_VERIFIED", bulk: true },
      );
    }

    // Notify super admin
    notificationService
      .broadcastToRole(["SUPER_ADMIN"], {
        sender_id: hrId,
        type: "TASK_COMPLETED",
        title: "Bulk HR Verification Complete",
        message: `${hr?.name || "HR"} bulk-verified ${data.length} task(s) for payroll.`,
      })
      .catch(console.error);

    return data;
  },

  async bulkUnverifyTasks(taskIds, hrId) {
    if (!taskIds || taskIds.length === 0) return;

    const { data: hr } = await supabase
      .from("employees")
      .select("is_hr, is_super_admin, name")
      .eq("id", hrId)
      .single();

    if (!hr?.is_hr && !hr?.is_super_admin) {
      throw new Error("Unauthorized: Only HR/Admins can unverify tasks.");
    }

    const { data, error } = await supabase
      .from("tasks")
      .update({
        hr_verified: false,
        hr_verified_at: null,
        hr_remarks: "",
        edited_by: hrId,
        edited_at: new Date().toISOString(),
      })
      .in("id", taskIds)
      .select();

    if (error) throw error;

    for (const task of data) {
      taskActivityService.addSystemEvent(
        task.id,
        `HR verification undone by ${hr?.name || "HR"}.`,
        { event: "HR_UNDO" },
      );
    }
    return true;
  },
};
