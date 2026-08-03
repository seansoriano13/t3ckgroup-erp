import { supabase } from "../lib/supabase";
import { systemAuditLogService } from "./systemAuditLogService";
import { STAGE_LABELS, formatPHP } from "../constants/sor";

const PARTICIPANT_SELECT = `
  *,
  registrar:employees!sales_opportunities_registered_by_fkey(id, name, avatar_path),
  deal_owner:employees!sales_opportunities_deal_owner_id_fkey(id, name, avatar_path),
  support_1:employees!sales_opportunities_support_sales_1_id_fkey(id, name, avatar_path),
  support_2:employees!sales_opportunities_support_sales_2_id_fkey(id, name, avatar_path),
  sales_director:employees!sales_opportunities_sales_director_id_fkey(id, name, avatar_path)
`;

export const opportunityService = {
  async getOpportunities() {
    const { data, error } = await supabase
      .from("sales_opportunities")
      .select(PARTICIPANT_SELECT)
      .neq("is_deleted", true)
      .order("registration_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data || [];
  },

  async getOpportunityById(id) {
    if (!id) return null;
    const { data, error } = await supabase
      .from("sales_opportunities")
      .select(PARTICIPANT_SELECT)
      .eq("id", id)
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Registers a new opportunity. `opportunity_no` is deliberately NOT sent —
   * a BEFORE INSERT trigger assigns it from a Postgres sequence so concurrent
   * registrations cannot collide.
   */
  async createOpportunity(payload, actorId) {
    const { data, error } = await supabase
      .from("sales_opportunities")
      .insert({
        registration_date: payload.registration_date,
        registered_by: actorId,
        lead_source: payload.lead_source,
        lead_source_detail: payload.lead_source_detail || null,
        client_name: payload.client_name,
        contact_person: payload.contact_person || null,
        project_title: payload.project_title,
        project_type: payload.project_type,
        expected_value: Number(payload.expected_value) || 0,
        expected_award_date: payload.expected_award_date || null,
        deal_owner_id: payload.deal_owner_id || null,
        support_sales_1_id: payload.support_sales_1_id || null,
        support_sales_2_id: payload.support_sales_2_id || null,
        sales_director_id: payload.sales_director_id || null,
        status: payload.status || "LEAD",
      })
      .select(PARTICIPANT_SELECT)
      .single();

    if (error) throw error;

    await opportunityService.addSystemNote(
      data.id,
      `Opportunity ${data.opportunity_no} registered — ${data.client_name}, ${formatPHP(data.expected_value)}.`,
      { event: "OPPORTUNITY_REGISTERED", employeeId: actorId },
    );

    systemAuditLogService.addSystemEvent(
      "OPPORTUNITY",
      data.id,
      `Sales opportunity ${data.opportunity_no} registered for ${data.client_name} (${formatPHP(data.expected_value)}).`,
      { event: "OPPORTUNITY_REGISTERED", employeeId: actorId },
      actorId,
    ).catch(console.error);

    return data;
  },

  async updateOpportunity(id, payload, actorId) {
    const { data, error } = await supabase
      .from("sales_opportunities")
      .update({
        lead_source: payload.lead_source,
        lead_source_detail: payload.lead_source_detail || null,
        client_name: payload.client_name,
        contact_person: payload.contact_person || null,
        project_title: payload.project_title,
        project_type: payload.project_type,
        expected_value: Number(payload.expected_value) || 0,
        expected_award_date: payload.expected_award_date || null,
        deal_owner_id: payload.deal_owner_id || null,
        support_sales_1_id: payload.support_sales_1_id || null,
        support_sales_2_id: payload.support_sales_2_id || null,
        sales_director_id: payload.sales_director_id || null,
      })
      .eq("id", id)
      .select(PARTICIPANT_SELECT)
      .single();

    if (error) throw error;

    systemAuditLogService.addSystemEvent(
      "OPPORTUNITY",
      id,
      `Sales opportunity ${data.opportunity_no} details updated.`,
      { event: "OPPORTUNITY_UPDATED", employeeId: actorId },
      actorId,
    ).catch(console.error);

    return data;
  },

  /**
   * Moves an opportunity to a new pipeline stage and records the move on its
   * timeline. `lostReason` is required when moving to CLOSED_LOST.
   */
  async updateStatus(id, nextStatus, actorId, lostReason = null) {
    const { data: existing, error: readError } = await supabase
      .from("sales_opportunities")
      .select("id, opportunity_no, status")
      .eq("id", id)
      .single();
    if (readError) throw readError;

    if (existing.status === nextStatus) return existing;

    const { data, error } = await supabase
      .from("sales_opportunities")
      .update({
        status: nextStatus,
        lost_reason: nextStatus === "CLOSED_LOST" ? lostReason : null,
      })
      .eq("id", id)
      .select(PARTICIPANT_SELECT)
      .single();

    if (error) throw error;

    const from = STAGE_LABELS[existing.status] || existing.status;
    const to = STAGE_LABELS[nextStatus] || nextStatus;
    const suffix = nextStatus === "CLOSED_LOST" && lostReason ? ` — ${lostReason}` : "";

    await opportunityService.addSystemNote(id, `Stage moved: ${from} → ${to}${suffix}`, {
      event: "STAGE_CHANGED",
      from: existing.status,
      to: nextStatus,
      employeeId: actorId,
    });

    systemAuditLogService.addSystemEvent(
      "OPPORTUNITY",
      id,
      `Sales opportunity ${existing.opportunity_no}: ${from} → ${to}${suffix}`,
      { event: "STAGE_CHANGED", from: existing.status, to: nextStatus, employeeId: actorId },
      actorId,
    ).catch(console.error);

    return data;
  },

  async deleteOpportunity(id, actorId) {
    const { data, error } = await supabase
      .from("sales_opportunities")
      .update({ is_deleted: true })
      .eq("id", id)
      .select("opportunity_no")
      .single();

    if (error) throw error;

    systemAuditLogService.addSystemEvent(
      "OPPORTUNITY",
      id,
      `Sales opportunity ${data.opportunity_no} deleted.`,
      { event: "OPPORTUNITY_DELETED", employeeId: actorId },
      actorId,
    ).catch(console.error);

    return data;
  },

  // ── Notes / timeline ──────────────────────────────────────────────────────

  async getNotes(opportunityId) {
    if (!opportunityId) return [];
    const { data, error } = await supabase
      .from("sales_opportunity_logs")
      .select("*, author:employees!sales_opportunity_logs_author_id_fkey(id, name, avatar_path)")
      .eq("opportunity_id", opportunityId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data || [];
  },

  async addNote(opportunityId, authorId, content) {
    const trimmed = (content || "").trim();
    if (!trimmed) throw new Error("Note cannot be empty.");

    const { data, error } = await supabase
      .from("sales_opportunity_logs")
      .insert({
        opportunity_id: opportunityId,
        author_id: authorId,
        type: "COMMENT",
        content: trimmed,
      })
      .select("*, author:employees!sales_opportunity_logs_author_id_fkey(id, name, avatar_path)")
      .single();

    if (error) throw error;
    return data;
  },

  /** System entries carry a null author_id. Fire-and-forget: a failed note must
   *  never roll back the mutation that produced it. */
  async addSystemNote(opportunityId, content, metadata = null) {
    const { error } = await supabase.from("sales_opportunity_logs").insert({
      opportunity_id: opportunityId,
      author_id: null,
      type: "SYSTEM",
      content,
      metadata,
    });
    if (error) console.error("Failed to write opportunity system note:", error);
  },
};
