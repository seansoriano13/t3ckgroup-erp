import { supabase } from "../lib/supabase";
import { notificationService } from "./notificationService";
import { canRemoveParticipant } from "../utils/sorPermissions";

/**
 * Issue #294 — the Stage Participant access window's lifecycle: opened by a
 * call-in (action task, Assignment condition, or day-one registration),
 * closed automatically by `close_stage_participant_windows()`
 * (20260925000000_stage_participants.sql, mirrored in
 * `src/test/db/triggers.js`), and removable by hand by the Deal Owner or a
 * Super Admin.
 *
 * Opening is deliberately idempotent per (opportunity, employee, source,
 * source_id, opened_visit_id): re-running the same call-in on the same
 * visit — a retried action task, a re-satisfied condition — should not stack
 * duplicate windows for the same person.
 */
export const sorStageParticipantService = {
  async listForOpportunity(opportunityId, { includeClosed = false } = {}) {
    if (!opportunityId) return [];

    let query = supabase
      .from("sor_stage_participants")
      .select("*")
      .eq("opportunity_id", opportunityId)
      .order("created_at", { ascending: true });
    if (!includeClosed) query = query.is("closed_at", null);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  /**
   * Opens a Stage Participant window for `employeeId`, called in at
   * `openedVisitId` (the Stage Visit the call-in happened on). `access` is
   * the calling action/condition's `config.access` — `{until, stageId}` —
   * defaulting to "stage_left" (the calling Stage itself) when a config
   * predates this feature or never set one.
   */
  async openWindow({ opportunityId, employeeId, source, sourceId = null, openedVisitId, access, notify = true }, actorId) {
    if (!opportunityId || !employeeId || !openedVisitId) {
      throw new Error("openWindow needs an opportunity, an employee, and the Stage Visit that called them in.");
    }

    const untilRule = access?.until || "stage_left";
    const untilStageId = ["stage_entered", "later_stage_left"].includes(untilRule)
      ? access?.stageId ?? null
      : null;

    const { data: existing, error: existingError } = await supabase
      .from("sor_stage_participants")
      .select("*")
      .eq("opportunity_id", opportunityId)
      .eq("employee_id", employeeId)
      .eq("source", source)
      .eq("opened_visit_id", openedVisitId)
      .is("closed_at", null)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) return existing;

    const { data, error } = await supabase
      .from("sor_stage_participants")
      .insert({
        opportunity_id: opportunityId,
        employee_id: employeeId,
        source,
        source_id: sourceId,
        opened_visit_id: openedVisitId,
        until_rule: untilRule,
        until_stage_id: untilStageId,
      })
      .select()
      .single();
    if (error) throw error;

    // `notify: false` when the thing that called this person in has already
    // told them, and told them something more useful. A task-creating Stage
    // Action sends its own "you have a task" notification, which names the
    // task and opens it; "Added to a deal" arriving beside it is a second
    // notification for one event, and the vaguer of the two.
    if (notify) {
      await notifyParticipant(opportunityId, employeeId, actorId).catch((err) =>
        console.error("Stage Participant notification failed:", err),
      );
    }

    return data;
  },

  /**
   * Deal Owner / Super Admin only. Closes the window with reason "removed"
   * rather than deleting the row — the same soft-close every rule-driven
   * close uses, so a participant's history on this SOR stays intact.
   */
  async removeParticipant(id, actorId) {
    const { data: participant, error: fetchError } = await supabase
      .from("sor_stage_participants")
      .select("*, opportunity:sales_opportunities(id, deal_owner_id)")
      .eq("id", id)
      .single();
    if (fetchError) throw fetchError;

    const { data: actor, error: actorError } = await supabase
      .from("employees")
      .select("id, is_super_admin")
      .eq("id", actorId)
      .single();
    if (actorError) throw actorError;

    if (!canRemoveParticipant(actor, participant.opportunity)) {
      throw new Error("Only the Deal Owner or a Super Admin can remove a Stage Participant.");
    }

    const { data, error } = await supabase
      .from("sor_stage_participants")
      .update({ closed_at: new Date().toISOString(), closed_reason: "removed", removed_by: actorId })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;

    return data;
  },
};

async function notifyParticipant(opportunityId, employeeId, actorId) {
  const { data: opportunity, error } = await supabase
    .from("sales_opportunities")
    .select("sales_reference, project_title, flow_stage_id")
    .eq("id", opportunityId)
    .single();
  if (error) throw error;

  let stageName = "this Stage";
  if (opportunity.flow_stage_id) {
    const { data: stage } = await supabase
      .from("flow_stages")
      .select("name")
      .eq("id", opportunity.flow_stage_id)
      .single();
    if (stage?.name) stageName = stage.name;
  }

  const label = [opportunity.sales_reference, opportunity.project_title].filter(Boolean).join(" · ");

  await notificationService.createNotification({
    recipient_id: employeeId,
    sender_id: actorId,
    type: "SOR_STAGE_PARTICIPANT_ADDED",
    title: "Added to a deal",
    message: `You were added to ${label || "a deal"} at ${stageName}.`,
    reference_id: opportunityId,
  });
}
