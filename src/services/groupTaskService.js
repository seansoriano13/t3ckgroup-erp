import { supabase } from "../lib/supabase";
import { notificationService } from "./notificationService";
import { groupTaskActivityService } from "./groupTaskActivityService";
import { formatTaskPreview } from "../utils/taskFormatters";

const logGroupTaskActivity = async (groupTaskId, action, details = {}, actorId = null) => {
  try {
    await supabase.from("committee_task_logs").insert({
      committee_task_id: groupTaskId,
      action,
      details,
      actor_id: actorId,
    });
  } catch (err) {
    console.error("Failed to log group task activity", err);
  }
};

const upsertGroupChecklistActivity = async (groupTaskId, memberId, taskDescription, actorId = null) => {
  try {
    const { data: existingLogs } = await supabase
      .from("committee_task_logs")
      .select("id, details")
      .eq("committee_task_id", groupTaskId)
      .eq("action", "CHECKLIST_UPDATED")
      .eq("details->>memberId", memberId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (existingLogs && existingLogs.length > 0) {
      const existingLog = existingLogs[0];
      const newDetails = {
        ...existingLog.details,
        taskDescription,
      };
      await supabase
        .from("committee_task_logs")
        .update({ details: newDetails, created_at: new Date().toISOString() })
        .eq("id", existingLog.id);
    } else {
      await supabase.from("committee_task_logs").insert({
        committee_task_id: groupTaskId,
        action: "CHECKLIST_UPDATED",
        details: { memberId, taskDescription },
        actor_id: actorId,
      });
    }
  } catch (err) {
    console.error("Failed to upsert group task activity", err);
  }
};

export const groupTaskService = {
  // CREATE
  async createGroupTask(payload) {
    const { title, description, dueDate, createdBy, members, templateId, opportunityId, stageActionId, stageVisitId } = payload;

    if (!members || members.length === 0) {
      throw new Error("Add at least one member to the group task");
    }

    const { data: groupTask, error: groupError } = await supabase
      .from("committee_tasks")
      .insert([
        {
          title,
          description,
          due_date: dueDate ? new Date(dueDate).toISOString() : null,
          created_by: createdBy,
          status: "ACTIVE",
          template_id: templateId ?? null,
          opportunity_id: opportunityId ?? null,
          // Issue #204 Part 2 — direct linkage to the Stage Action/Stage
          // Visit that created this group task.
          stage_action_id: stageActionId ?? null,
          stage_visit_id: stageVisitId ?? null,
        },
      ])
      .select()
      .single();

    if (groupError) throw groupError;

    // role/custom_role used to be dropped here even though the create form
    // collected them and the columns exist, which is why roles picked at
    // creation time never showed up again. addMemberToTask has always written
    // them; this brings create in line.
    const memberPayloads = members.map((m) => ({
      committee_task_id: groupTask.id,
      employee_id: m.employeeId,
      task_description: m.taskDescription || "",
      checklist: m.checklist || null,
      role: m.role || null,
      custom_role: m.customRole || null,
      status: "PENDING",
    }));

    const { error: membersError } = await supabase
      .from("committee_task_members")
      .insert(memberPayloads);

    if (membersError) {
      // rollback if needed
      await supabase.from("committee_tasks").delete().eq("id", groupTask.id);
      throw membersError;
    }

    await logGroupTaskActivity(groupTask.id, "CREATED", { title }, createdBy);
    groupTaskActivityService.addSystemEvent(
      groupTask.id,
      `Group task created: "${title}" by ${(await supabase.from("employees").select("name").eq("id", createdBy).single()).data?.name || "a manager"}.`,
      { event: "CREATED", title },
    ).catch(console.error);

    // Notifications
    const { data: creator } = await supabase
      .from("employees")
      .select("name")
      .eq("id", createdBy)
      .single();

    for (const member of members) {
      notificationService.createNotification({
        recipient_id: member.employeeId,
        sender_id: createdBy,
        type: "GROUP_ASSIGNED",
        title: "Assigned to Group Task",
        // An assignment can now be checklist-only, which would leave this
        // message trailing off after the colon. formatTaskPreview falls back
        // to an item count when there is no description text.
        message: `${creator?.name || "A Head"} assigned you to "${title}": ${formatTaskPreview(member.taskDescription, member.checklist)}`,
        reference_id: groupTask.id,
      });
    }

    return groupTask;
  },

  // UPDATE - Global Group Task fields
  async updateGroupTask(id, payload, actorId) {
    const { title, description, dueDate } = payload;
    
    const { data: oldTask, error: fetchError } = await supabase
      .from("committee_tasks")
      .select("title, description, due_date")
      .eq("id", id)
      .single();
    if (fetchError) throw fetchError;

    const { data: groupTask, error } = await supabase
      .from("committee_tasks")
      .update({
        title,
        description,
        due_date: dueDate ? new Date(dueDate).toISOString() : null,
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    await logGroupTaskActivity(
      id,
      "TASK_UPDATED",
      {
        old: oldTask,
        new: { title, description, due_date: dueDate },
      },
      actorId
    );
    
    groupTaskActivityService.addSystemEvent(
      id,
      "Group task details were updated.",
      { event: "TASK_UPDATED" },
    ).catch(console.error);

    return groupTask;
  },

  // READ (Heads see all they created or are part of, super admin sees all, employees see where they are members)
  async getGroupTasks(userId, isHead, isSuperAdmin) {
    let query = supabase
      .from("committee_tasks")
      .select(`
        *,
        creator:employees!committee_tasks_created_by_fkey(name, department, sub_department, avatar_path),
        members:committee_task_members(
          id, employee_id, task_description, checklist, status, grade, grade_remarks, rated_at, rated_by, role, custom_role, attachments,
          employee:employees!committee_task_members_employee_id_fkey(name, avatar_path, department, sub_department)
        )
      `)
      .neq("status", "CANCELLED")
      .order("created_at", { ascending: false });

    const { data, error } = await query;
    if (error) throw error;

    if (isSuperAdmin) return data;

    // Filter locally if needed
    return data.filter((ct) => {
      if (ct.created_by === userId) return true; // Created by this head
      return ct.members.some((m) => m.employee_id === userId); // Is a member
    });
  },

  async getGroupTaskById(id) {
    const { data, error } = await supabase
      .from("committee_tasks")
      .select(`
        *,
        creator:employees!committee_tasks_created_by_fkey(name, department, sub_department, avatar_path),
        opportunity:sales_opportunities(client_name, sales_reference),
        members:committee_task_members(
          id, employee_id, task_description, checklist, status, grade, grade_remarks, rated_at, rated_by, role, custom_role, attachments,
          employee:employees!committee_task_members_employee_id_fkey(name, avatar_path, department)
        )
      `)
      .eq("id", id)
      .single();

    if (error) throw error;
    return data;
  },

  // UPDATE - Member Status (Employee marks done)
  async updateMemberStatus(memberId, status, userId) {
    const { data: member, error: fetchErr } = await supabase
      .from("committee_task_members")
      .select("*, committee_tasks(*)")
      .eq("id", memberId)
      .single();

    if (fetchErr) throw fetchErr;
    if (member.employee_id !== userId && member.committee_tasks.created_by !== userId) {
      throw new Error("Unauthorized to update this task");
    }

    const { error } = await supabase
      .from("committee_task_members")
      .update({ status })
      .eq("id", memberId);

    if (error) throw error;

    await logGroupTaskActivity(
      member.committee_task_id,
      status === "DONE" ? "MEMBER_DONE" : "MEMBER_PENDING",
      { memberId, employeeId: member.employee_id, taskDescription: member.task_description },
      userId
    );
    groupTaskActivityService.addSystemEvent(
      member.committee_task_id,
      status === "DONE"
        ? `Member marked their assignment as done: "${member.task_description || ""}".`
        : `Member un-marked their assignment: "${member.task_description || ""}".`,
      { event: status === "DONE" ? "MEMBER_DONE" : "MEMBER_PENDING", memberId },
    ).catch(console.error);

    // Notify creator when a member marks DONE (only if the actor is not the creator)
    if (status === "DONE") {
      const creatorId = member.committee_tasks?.created_by;
      if (creatorId && creatorId !== userId) {
        const { data: employee } = await supabase
          .from("employees")
          .select("name")
          .eq("id", userId)
          .single();

        notificationService.createNotification({
          recipient_id: creatorId,
          sender_id: userId,
          type: "GROUP_MEMBER_DONE",
          title: "Member Completed Their Task",
          message: `${employee?.name || "A member"} marked their assignment as done: "${member.task_description || "assignment"}" in group task "${member.committee_tasks?.title || "a group task"}".`,
          reference_id: member.committee_task_id,
        });
      }
    }



    return true;
  },

  async addMemberAttachment(memberId, attachment, userId) {
    const { data: member, error: fetchErr } = await supabase
      .from("committee_task_members")
      .select("*, committee_tasks(*)")
      .eq("id", memberId)
      .single();

    if (fetchErr) throw fetchErr;

    const existing = member.attachments || [];
    const newAttachments = [...existing, attachment];

    const { error } = await supabase
      .from("committee_task_members")
      .update({ attachments: newAttachments })
      .eq("id", memberId);

    if (error) throw error;

    const { data: currentUser } = await supabase.from("employees").select("name").eq("id", userId).single();
    const userName = currentUser?.name || "A member";

    await groupTaskActivityService.addComment(
      member.committee_task_id,
      userId,
      `${userName} uploaded a file.`,
      { attachments: [attachment] }
    );
    
    return true;
  },

  async updateMemberDescription(memberId, taskDescription, oldDescription, userId) {
    const { data: member, error: fetchErr } = await supabase
      .from("committee_task_members")
      .select("*, committee_tasks(*)")
      .eq("id", memberId)
      .single();

    if (fetchErr) throw fetchErr;
    if (member.employee_id !== userId && member.committee_tasks.created_by !== userId) {
      throw new Error("Unauthorized to update this task description");
    }

    const { error } = await supabase
      .from("committee_task_members")
      .update({ task_description: taskDescription })
      .eq("id", memberId);

    if (error) throw error;

    await logGroupTaskActivity(
      member.committee_task_id,
      "DESCRIPTION_UPDATED",
      {
        memberId,
        old: oldDescription,
        new: taskDescription,
      },
      userId
    );
  },

  // UPDATE - Mark Complete manually
  async markGroupTaskComplete(groupTaskId, actorId) {
    const { data, error } = await supabase
      .from("committee_tasks")
      .update({ status: "COMPLETED", hr_remarks: null })
      .eq("id", groupTaskId)
      .select()
      .single();

    if (error) throw error;

    // Any pending members are auto-marked as skipped or just leave them? Let's leave them or mark DONE.
    // For now, if head forces complete, they remain what they are, but head can rate them.

    await logGroupTaskActivity(groupTaskId, "COMPLETED", {}, actorId);
    groupTaskActivityService.addSystemEvent(
      groupTaskId,
      "Group task marked as completed.",
      { event: "COMPLETED" },
    ).catch(console.error);

    return data;
  },

  // RATE EMPLOYEES
  async rateMembers(groupTaskId, ratings, actorId) {
    // ratings = [{ memberId, grade, gradeRemarks }]
    for (const r of ratings) {
      await supabase
        .from("committee_task_members")
        .update({
          grade: r.grade,
          grade_remarks: r.gradeRemarks,
          rated_at: new Date().toISOString(),
          rated_by: actorId,
        })
        .eq("id", r.memberId);
    }

    // Once rated, move the group task to HR_PENDING (clear any previous HR rejection remarks)
    const { error } = await supabase
      .from("committee_tasks")
      .update({ status: "HR_PENDING", hr_remarks: null })
      .eq("id", groupTaskId);

    if (error) throw error;

    await logGroupTaskActivity(
      groupTaskId,
      "RATED",
      { ratings: ratings.map(r => ({ memberId: r.memberId, grade: r.grade })) },
      actorId
    );
    groupTaskActivityService.addApprovalEntry(
      groupTaskId,
      actorId,
      `Members graded. Submitted to HR for verification.`,
      { event: "RATED", ratings: ratings.map(r => ({ memberId: r.memberId, grade: r.grade })) },
    ).catch(console.error);

    // Notify HR
    const { data: ct } = await supabase
      .from("committee_tasks")
      .select("*, creator:employees!committee_tasks_created_by_fkey(name)")
      .eq("id", groupTaskId)
      .single();

    notificationService.broadcastToRole(["HR"], {
      sender_id: actorId,
      type: "GROUP_TASK_READY_FOR_HR",
      title: "Group Task Ready",
      message: `Group task "${ct.title}" by ${ct.creator?.name} has been completed and graded. Ready for Verification.`,
      reference_id: groupTaskId,
      excludeSuperAdmin: true,
    });

    return true;
  },

  // CANCEL / DELETE
  async cancelGroupTask(id, actorId) {
    const { error } = await supabase
      .from("committee_tasks")
      .update({ status: "CANCELLED" })
      .eq("id", id);
    if (error) throw error;

    await logGroupTaskActivity(id, "CANCELLED", {}, actorId);
    groupTaskActivityService.addSystemEvent(
      id,
      "Group task was cancelled.",
      { event: "CANCELLED" },
    ).catch(console.error);

    return true;
  },

  /**
   * Ticks/unticks checklist items on a member's assignment.
   *
   * Only the assignee may do this, and only before they mark the assignment
   * DONE — the same rule the DONE button itself follows. DONE is what opens a
   * member up to being graded, so the checklist has to stop being editable at
   * the same moment, otherwise the evidence could change after submission.
   */
  async updateMemberChecklist(memberId, checklist, groupTaskId = null, actorId = null) {
    const { data: member, error: readError } = await supabase
      .from("committee_task_members")
      .select("employee_id, status")
      .eq("id", memberId)
      .single();

    if (readError) throw readError;
    if (actorId && member.employee_id !== actorId) {
      throw new Error("Only the assigned member can update this checklist.");
    }
    if (member.status === "DONE") {
      throw new Error(
        "This assignment is already marked done and can no longer be edited.",
      );
    }

    const { error } = await supabase
      .from("committee_task_members")
      .update({ checklist: checklist || null })
      .eq("id", memberId);
    if (error) throw error;

    if (groupTaskId && actorId) {
      await upsertGroupChecklistActivity(
        groupTaskId,
        memberId,
        typeof checklist === "string" ? checklist : JSON.stringify(checklist),
        actorId,
      );
    }

    return true;
  },

  async updateMemberAssignment(memberId, groupTaskId, payload, actorId) {
    const { taskDescription, checklist, role, customRole } = payload;

    const updates = {
      task_description: taskDescription ?? "",
      role: role || null,
      custom_role: customRole || null,
    };
    // Only touch checklist when the caller actually supplied it, so an edit
    // that leaves the checklist alone does not wipe it.
    if (checklist !== undefined) updates.checklist = checklist || null;

    const { error } = await supabase
      .from("committee_task_members")
      .update(updates)
      .eq("id", memberId);

    if (error) throw error;

    await logGroupTaskActivity(
      groupTaskId,
      "MEMBER_UPDATED",
      { memberId, role: customRole || role, taskDescription },
      actorId
    );
    groupTaskActivityService.addSystemEvent(
      groupTaskId,
      `Member assignment updated.`,
      { event: "MEMBER_UPDATED", memberId, role: customRole || role },
    ).catch(console.error);

    return true;
  },

  async removeMemberFromTask(memberId, groupTaskId, actorId) {
    const { error } = await supabase
      .from("committee_task_members")
      .delete()
      .eq("id", memberId);

    if (error) throw error;

    await logGroupTaskActivity(
      groupTaskId,
      "MEMBER_REMOVED",
      { memberId },
      actorId
    );
    groupTaskActivityService.addSystemEvent(
      groupTaskId,
      "A member was removed from the group.",
      { event: "MEMBER_REMOVED", memberId },
    ).catch(console.error);

    return true;
  },

  // HR VERIFICATION
  async verifyGroupTask(id, actorId, remarks = "") {
    const { error } = await supabase
      .from("committee_tasks")
      .update({
        status: "HR_VERIFIED",
        hr_verified: true,
        hr_verified_at: new Date().toISOString(),
        hr_verified_by: actorId,
        hr_remarks: remarks,
      })
      .eq("id", id);

    if (error) throw error;

    await logGroupTaskActivity(id, "HR_VERIFIED", { remarks }, actorId);
    groupTaskActivityService.addHrEntry(
      id,
      actorId,
      remarks ? `HR verified. Remarks: ${remarks}` : "HR verified the group task.",
      { event: "HR_VERIFIED", remarks },
    ).catch(console.error);

    return true;
  },

  async rejectGroupTask(id, actorId, remarks) {
    // Reset member statuses to PENDING so they can resubmit
    const { data: members } = await supabase
      .from("committee_task_members")
      .select("id")
      .eq("committee_task_id", id);

    if (members && members.length > 0) {
      // Update each member individually to avoid RLS policies blocking bulk updates
      for (const member of members) {
        await supabase
          .from("committee_task_members")
          .update({ status: "PENDING", grade: null, grade_remarks: null, rated_at: null, rated_by: null })
          .eq("id", member.id);
      }
    }

    const { error } = await supabase
      .from("committee_tasks")
      .update({
        status: "ACTIVE", // Goes back to ACTIVE so members can resubmit
        hr_remarks: remarks,
      })
      .eq("id", id);
      
    if (error) throw error;

    await logGroupTaskActivity(id, "HR_REJECTED", { remarks }, actorId);
    groupTaskActivityService.addSystemEvent(
      id,
      remarks ? `HR rejected — task returned for revision. Remarks: ${remarks}` : "HR rejected — task returned for revision.",
      { event: "HR_REJECTED", remarks },
    ).catch(console.error);

    return true;
  },

  // GET HISTORY
  async getGroupTaskHistory(taskId) {
    const { data, error } = await supabase
      .from("committee_task_logs")
      .select("*, actor:employees!committee_task_logs_actor_id_fkey(name, avatar_path)")
      .eq("committee_task_id", taskId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data;
  },

  // ADD MEMBER ON THE FLY
  async addMemberToTask(groupTaskId, payload, actorId) {
    const { employeeId, taskDescription, checklist, role, customRole } = payload;

    const { error } = await supabase
      .from("committee_task_members")
      .insert({
        committee_task_id: groupTaskId,
        employee_id: employeeId,
        task_description: taskDescription || "",
        checklist: checklist || null,
        role: role || null,
        custom_role: customRole || null,
        status: "PENDING"
      });

    if (error) throw error;

    await logGroupTaskActivity(
      groupTaskId,
      "MEMBER_ADDED",
      { addedEmployeeId: employeeId, role: customRole || role },
      actorId
    );
    groupTaskActivityService.addSystemEvent(
      groupTaskId,
      `New member added to the group.`,
      { event: "MEMBER_ADDED", employeeId, role: customRole || role },
    ).catch(console.error);

    // Get creator and task to notify
    const { data: ct } = await supabase
      .from("committee_tasks")
      .select("*, creator:employees!committee_tasks_created_by_fkey(name, avatar_path)")
      .eq("id", groupTaskId)
      .single();

    // A new member arrives PENDING, with work still to do — a task the group
    // had already closed out (COMPLETED, or somewhere in the HR hand-off) is
    // no longer an accurate description of it, and every "mark done" control
    // in the UI is gated on ACTIVE, which would leave the new member with no
    // way to ever mark their assignment done. Reopen it so it does not sit
    // permanently locked at a status that predates the new work.
    if (ct && ["COMPLETED", "HR_PENDING", "HR_VERIFIED"].includes(ct.status)) {
      const { error: reopenError } = await supabase
        .from("committee_tasks")
        .update({ status: "ACTIVE", hr_remarks: null })
        .eq("id", groupTaskId);
      if (reopenError) throw reopenError;

      await logGroupTaskActivity(
        groupTaskId,
        "REOPENED",
        { reason: "MEMBER_ADDED", employeeId },
        actorId
      );
      groupTaskActivityService.addSystemEvent(
        groupTaskId,
        "Group task reopened — a new member was added after it was closed out.",
        { event: "REOPENED" },
      ).catch(console.error);
    }

    notificationService.createNotification({
      recipient_id: employeeId,
      sender_id: actorId,
      type: "GROUP_ASSIGNED",
      title: "Added to Active Group Task",
      message: `${ct?.creator?.name || "A Head"} added you to "${ct?.title}": ${formatTaskPreview(taskDescription, checklist)}`,
      reference_id: groupTaskId,
    });

    return true;
  }
};
