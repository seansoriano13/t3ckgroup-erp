import { supabase } from "../lib/supabase";
import { systemAuditLogService } from "./systemAuditLogService";
import {
  STAGE_LABELS,
  formatPHP,
  isValidSalesReference,
  normalizeSalesReference,
  requiresSalesReference,
  SALES_REFERENCE_HINT,
} from "../constants/sor";

const PARTICIPANT_SELECT = `
  *,
  registrar:employees!sales_opportunities_registered_by_fkey(id, name, avatar_path),
  deal_owner:employees!sales_opportunities_deal_owner_id_fkey(id, name, avatar_path, department, sub_department, is_super_admin),
  support_1:employees!sales_opportunities_support_sales_1_id_fkey(id, name, avatar_path),
  support_2:employees!sales_opportunities_support_sales_2_id_fkey(id, name, avatar_path),
  sales_director:employees!sales_opportunities_sales_director_id_fkey(id, name, avatar_path)
`;

/**
 * Trims/uppercases a Sales Reference and rejects anything that isn't an Odoo
 * quotation number. Empty is allowed here — the stage gate is what makes it
 * mandatory, not the field itself.
 */
function cleanSalesReference(value) {
  const ref = normalizeSalesReference(value);
  if (!ref) return null;
  if (!isValidSalesReference(ref)) throw new Error(SALES_REFERENCE_HINT);
  return ref;
}

/**
 * Strips a leading "[SKU-CODE] " prefix so change logs read as plain product
 * names instead of raw catalog codes.
 */
function stripProductCode(name) {
  return (name || "").replace(/^\[[^\]]*\]\s*/, "");
}

/**
 * How an opportunity is named in the GLOBAL audit log, which mixes records
 * from every module and so needs to identify which one it is talking about.
 *
 * The Odoo Sales Reference is the only external number this product carries —
 * the retired opportunity_no shared its S0#### format and pointed at unrelated
 * Odoo orders (see migration 0012). A deal has no reference until it leaves
 * the Lead stage, so before then it is named by client instead.
 *
 * Per-opportunity timeline notes deliberately carry no identifier at all:
 * they are already displayed inside the record they describe.
 */
function auditLabel({ sales_reference, client_name }) {
  return sales_reference
    ? `Sales opportunity ${sales_reference}`
    : `Sales opportunity for ${client_name}`;
}

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
        sales_reference: cleanSalesReference(payload.sales_reference),
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

    // expected_value is trigger-maintained from the product list — insert the
    // items first, then re-read the row to pick up the computed total before
    // it's quoted in the notes below.
    await opportunityService.replaceItems(data.id, payload.items);
    const final = await opportunityService.getOpportunityById(data.id);

    await opportunityService.addSystemNote(
      final.id,
      `Registered — ${final.client_name}, ${formatPHP(final.expected_value)}.`,
      { event: "OPPORTUNITY_REGISTERED", employeeId: actorId },
      actorId,
    );

    systemAuditLogService.addSystemEvent(
      "OPPORTUNITY",
      final.id,
      `Sales opportunity registered for ${final.client_name} (${formatPHP(final.expected_value)}).`,
      { event: "OPPORTUNITY_REGISTERED", employeeId: actorId },
      actorId,
    ).catch(console.error);

    return final;
  },

  async updateOpportunity(id, payload, actorId) {
    const existing = await opportunityService.getOpportunityById(id);
    const existingItems = await opportunityService.getItems(id);

    const { data, error } = await supabase
      .from("sales_opportunities")
      .update({
        lead_source: payload.lead_source,
        lead_source_detail: payload.lead_source_detail || null,
        client_name: payload.client_name,
        contact_person: payload.contact_person || null,
        project_title: payload.project_title,
        project_type: payload.project_type,
        sales_reference: cleanSalesReference(payload.sales_reference),
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

    await opportunityService.replaceItems(id, payload.items);
    const final = await opportunityService.getOpportunityById(id);

    const changes = [];
    const checkField = (field, label) => {
      if (existing[field] !== final[field]) {
        changes.push(`${label} changed from "${existing[field] || 'None'}" to "${final[field] || 'None'}"`);
      }
    };

    checkField('lead_source', 'Lead Source');
    checkField('lead_source_detail', 'Referral');
    checkField('client_name', 'Client');
    checkField('contact_person', 'Contact Person');
    checkField('project_title', 'Project');
    checkField('project_type', 'Sales Division');
    checkField('sales_reference', 'Sales Reference');
    checkField('expected_award_date', 'Purchase Date/Order');

    const checkEmployee = (idField, objField, label) => {
      if (existing[idField] !== final[idField]) {
        const oldName = existing[objField]?.name || 'None';
        const newName = final[objField]?.name || 'None';
        changes.push(`${label} changed from "${oldName}" to "${newName}"`);
      }
    };

    checkEmployee('deal_owner_id', 'deal_owner', 'Deal Owner');
    checkEmployee('sales_director_id', 'sales_director', 'Sales Director');
    checkEmployee('support_sales_1_id', 'support_1', 'Support Sales 1');
    checkEmployee('support_sales_2_id', 'support_2', 'Support Sales 2');

    const newItems = payload.items || [];
    const oldProducts = existingItems.map((i) => i.product_name?.trim()).filter(Boolean);
    const newProducts = newItems.map((i) => i.product_name?.trim()).filter(Boolean);

    const addedProducts = newProducts.filter((p) => !oldProducts.includes(p));
    const removedProducts = oldProducts.filter((p) => !newProducts.includes(p));
    const modifiedProducts = [];

    newProducts.forEach((p) => {
      const oldItem = existingItems.find((i) => i.product_name?.trim() === p);
      const newItem = newItems.find((i) => i.product_name?.trim() === p);
      if (oldItem && newItem) {
        if (
          Number(oldItem.quantity) !== Number(newItem.quantity) ||
          Number(oldItem.unit_price) !== Number(newItem.unit_price) ||
          (oldItem.unit || "") !== (newItem.unit || "").trim()
        ) {
          modifiedProducts.push(p);
        }
      }
    });

    const addedNames = addedProducts.map(stripProductCode);
    const removedNames = removedProducts.map(stripProductCode);
    const modifiedNames = modifiedProducts.map(stripProductCode);

    if (addedNames.length > 0) changes.push(`Added product(s): ${addedNames.join(', ')}`);
    if (removedNames.length > 0) changes.push(`Removed product(s): ${removedNames.join(', ')}`);
    if (modifiedNames.length > 0) changes.push(`Modified product(s): ${modifiedNames.join(', ')}`);

    if (Number(existing.expected_value) !== Number(final.expected_value)) {
      changes.push(`Expected Value changed from ₱${Number(existing.expected_value).toLocaleString()} to ₱${Number(final.expected_value).toLocaleString()}`);
    }

    if (changes.length > 0) {
      const diffString = changes.join(", ");
      const productChanges = [
        ...addedNames.map((name) => ({ type: "added", name })),
        ...removedNames.map((name) => ({ type: "removed", name })),
        ...modifiedNames.map((name) => ({ type: "modified", name })),
      ];

      await opportunityService.addSystemNote(
        id,
        `Details updated: ${diffString}`,
        { event: "OPPORTUNITY_UPDATED", employeeId: actorId, changes, productChanges },
        actorId,
      );

      systemAuditLogService.addSystemEvent(
        "OPPORTUNITY",
        id,
        `${auditLabel(data)} details updated: ${diffString}`,
        { event: "OPPORTUNITY_UPDATED", employeeId: actorId, changes },
        actorId,
      ).catch(console.error);
    } else {
      systemAuditLogService.addSystemEvent(
        "OPPORTUNITY",
        id,
        `${auditLabel(data)} items updated.`,
        { event: "OPPORTUNITY_UPDATED", employeeId: actorId },
        actorId,
      ).catch(console.error);
    }

    return final;
  },

  /**
   * Moves an opportunity to a new pipeline stage and records the move on its
   * timeline. `lostReason` is required when moving to CLOSED_LOST;
   * `salesReference` is required when leaving Lead and none is on record yet
   * (mirrored by a trigger — see migration 0011).
   */
  async updateStatus(id, nextStatus, actorId, lostReason = null, salesReference = null) {
    const { data: existing, error: readError } = await supabase
      .from("sales_opportunities")
      .select("id, client_name, status, sales_reference")
      .eq("id", id)
      .single();
    if (readError) throw readError;

    if (existing.status === nextStatus) return existing;

    const providedRef = cleanSalesReference(salesReference);

    if (
      requiresSalesReference(existing.status, nextStatus) &&
      !(providedRef || existing.sales_reference)
    ) {
      throw new Error(
        "A Sales Reference is required before this opportunity can leave Lead — enter the Odoo sales quotation number (e.g. S01237).",
      );
    }

    const patch = {
      status: nextStatus,
      lost_reason: nextStatus === "CLOSED_LOST" ? lostReason : null,
    };
    const recordsRef = providedRef && providedRef !== existing.sales_reference;
    if (recordsRef) patch.sales_reference = providedRef;

    const { data, error } = await supabase
      .from("sales_opportunities")
      .update(patch)
      .eq("id", id)
      .select(PARTICIPANT_SELECT)
      .single();

    if (error) throw error;

    if (recordsRef) {
      await opportunityService.addSystemNote(
        id,
        `Sales Reference recorded: ${providedRef}`,
        { event: "SALES_REFERENCE_SET", salesReference: providedRef, employeeId: actorId },
        actorId,
      );

      systemAuditLogService.addSystemEvent(
        "OPPORTUNITY",
        id,
        `${auditLabel(existing)}: Sales Reference recorded as ${providedRef}.`,
        { event: "SALES_REFERENCE_SET", salesReference: providedRef, employeeId: actorId },
        actorId,
      ).catch(console.error);
    }

    const from = STAGE_LABELS[existing.status] || existing.status;
    const to = STAGE_LABELS[nextStatus] || nextStatus;
    const suffix = nextStatus === "CLOSED_LOST" && lostReason ? ` — ${lostReason}` : "";

    await opportunityService.addSystemNote(id, `Stage moved: ${from} → ${to}${suffix}`, {
      event: "STAGE_CHANGED",
      from: existing.status,
      to: nextStatus,
      employeeId: actorId,
    }, actorId);

    systemAuditLogService.addSystemEvent(
      "OPPORTUNITY",
      id,
      // Uses the reference just recorded when there is one, so the audit line
      // carries the Odoo number rather than falling back to the client name.
      `${auditLabel({ ...existing, sales_reference: providedRef || existing.sales_reference })}: ${from} → ${to}${suffix}`,
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
      .select("client_name, sales_reference")
      .single();

    if (error) throw error;

    systemAuditLogService.addSystemEvent(
      "OPPORTUNITY",
      id,
      `${auditLabel(data)} deleted.`,
      { event: "OPPORTUNITY_DELETED", employeeId: actorId },
      actorId,
    ).catch(console.error);

    return data;
  },

  // ── Product list / items ──────────────────────────────────────────────────

  async getItems(opportunityId) {
    if (!opportunityId) return [];
    const { data, error } = await supabase
      .from("sales_opportunity_items")
      .select("*")
      .eq("opportunity_id", opportunityId)
      .order("sort_order", { ascending: true });

    if (error) throw error;
    return data || [];
  },

  /**
   * Full replace-set: deletes all existing rows for the opportunity and
   * inserts the given list. Items don't carry their own audit/dispute
   * significance the way the opportunity record does, so unlike notes there's
   * no need to track per-row history — this keeps the editor UI simple (no
   * id-diffing) at the cost of not preserving item-level created_at across
   * edits. A `sales_opportunities` trigger recomputes `expected_value` from
   * whatever ends up in the table after this runs.
   */
  async replaceItems(opportunityId, items) {
    const { error: delError } = await supabase
      .from("sales_opportunity_items")
      .delete()
      .eq("opportunity_id", opportunityId);
    if (delError) throw delError;

    const rows = (items || [])
      .filter((it) => (it.product_name || "").trim())
      .map((it, idx) => ({
        opportunity_id: opportunityId,
        product_name: it.product_name.trim(),
        unit: (it.unit || "").trim() || null,
        quantity: Number(it.quantity) || 0,
        unit_price: Number(it.unit_price) || 0,
        sort_order: idx,
      }));

    if (rows.length > 0) {
      const { error: insError } = await supabase
        .from("sales_opportunity_items")
        .insert(rows);
      if (insError) throw insError;
    }
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

  /**
   * `attachments` are Cloudinary descriptors ({ url, name, type, bytes }) —
   * uploaded by the caller before the note is written, and stored on the log's
   * existing `metadata` column the same way task comments store theirs. A note
   * carrying files needs no text.
   */
  async addNote(opportunityId, authorId, content, attachments = []) {
    const trimmed = (content || "").trim();
    const files = (attachments || []).filter((a) => a?.url);
    if (!trimmed && files.length === 0)
      throw new Error("Add a note or attach a file.");

    const { data, error } = await supabase
      .from("sales_opportunity_logs")
      .insert({
        opportunity_id: opportunityId,
        author_id: authorId,
        type: "COMMENT",
        content: trimmed,
        metadata: files.length > 0 ? { attachments: files } : null,
      })
      .select("*, author:employees!sales_opportunity_logs_author_id_fkey(id, name, avatar_path)")
      .single();

    if (error) throw error;
    return data;
  },

  /** System-styled entries (stage moves, registration) attributed to the actor
   *  who triggered them, when known. Fire-and-forget: a failed note must never
   *  roll back the mutation that produced it. */
  async addSystemNote(opportunityId, content, metadata = null, authorId = null) {
    const { error } = await supabase.from("sales_opportunity_logs").insert({
      opportunity_id: opportunityId,
      author_id: authorId,
      type: "SYSTEM",
      content,
      metadata,
    });
    if (error) console.error("Failed to write opportunity system note:", error);
  },
};
