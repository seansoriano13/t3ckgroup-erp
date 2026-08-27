import { supabase } from "../lib/supabase";
import {
  COMPLETENESS,
  canSetSourcing,
  isCompleteness,
  isSourcing,
} from "../constants/projectEvaluation";

/**
 * Project Evaluation persistence (issue #38). Ticket: issue #43.
 *
 * Owns Inclusions — the client's specification, one row per item asked for.
 * The arithmetic over them is constants/projectEvaluation.js and nothing here
 * duplicates it: this file's whole job is reading and writing rows, and
 * everything expressible as a function of those rows belongs a tier down where
 * it can be tested without a database.
 *
 * Why Inclusions are not sales_opportunity_items is recorded in migration 0055,
 * and it is load-bearing: replaceItems deletes and re-inserts every line item
 * with fresh UUIDs on each SOR save, so a Canvass or a stamped cost hanging off
 * one would be destroyed silently by an unrelated edit.
 */

/** Every column a caller of this service reads. */
const INCLUSION_SELECT = `
  *,
  author:employees!sor_inclusions_created_by_fkey(id, name, avatar_path)
`;

/**
 * Normalises and checks what a caller wants written.
 *
 * Validation lives in front of the write rather than only in the CHECK
 * constraint so the failure is immediate and legible — a constraint violation
 * surfaces as a Postgres error string that no salesperson should ever be shown.
 * The constraint stays the actual guarantee; this is the message.
 */
function cleanInclusionInput(input = {}, { partial = false } = {}) {
  const row = {};

  if (input.description !== undefined || !partial) {
    const description = String(input.description ?? "").trim();
    if (!description) throw new Error("An inclusion needs a description.");
    row.description = description;
  }

  if (input.quantity !== undefined || !partial) {
    const quantity = Number(input.quantity ?? 1);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error("Quantity has to be a positive number.");
    }
    row.quantity = quantity;
  }

  // Empty text is stored as null, not "". A blank unit is the absence of a
  // unit, and two spellings of absence make every later comparison wrong.
  if (input.unit !== undefined) row.unit = String(input.unit ?? "").trim() || null;
  if (input.note !== undefined) row.note = String(input.note ?? "").trim() || null;

  if (input.completeness !== undefined) {
    if (!isCompleteness(input.completeness)) {
      throw new Error(`"${input.completeness}" is not a completeness state.`);
    }
    row.completeness = input.completeness;
  }

  if (input.sourcing !== undefined) {
    const sourcing = input.sourcing || null;
    if (sourcing !== null && !isSourcing(sourcing)) {
      throw new Error(`"${input.sourcing}" is not a sourcing state.`);
    }
    row.sourcing = sourcing;
  }

  return row;
}

export const projectEvaluationService = {
  // ── Inclusions ────────────────────────────────────────────────────────────

  /** An SOR's Inclusions, in the order they were entered. */
  async listInclusions(opportunityId) {
    if (!opportunityId) return [];

    const { data, error } = await supabase
      .from("sor_inclusions")
      .select(INCLUSION_SELECT)
      .eq("opportunity_id", opportunityId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data || [];
  },

  /**
   * Adds one Inclusion, appended after the SOR's current rows.
   *
   * A new row defaults to MISSING rather than COVERED. A breakdown just entered
   * from a spec sheet has not been answered yet, and defaulting the other way
   * would make every fresh breakdown read as a complete one.
   *
   * Read-then-write on sort_order, matching stageRequirementService.add: the
   * column carries no unique constraint, so two people adding at the same
   * instant tie rather than error, and the order between those two rows falls
   * back to created_at. This is somebody typing a spec sheet, not a bulk path.
   */
  async addInclusion(input, actorId) {
    const { opportunityId } = input;
    if (!opportunityId) throw new Error("An inclusion needs an SOR.");

    const row = cleanInclusionInput(input);
    const siblings = await this.listInclusions(opportunityId);

    const { data, error } = await supabase
      .from("sor_inclusions")
      .insert({
        opportunity_id: opportunityId,
        completeness: COMPLETENESS.MISSING,
        sourcing: null,
        ...row,
        sort_order: siblings.length,
        created_by: actorId || null,
      })
      .select(INCLUSION_SELECT)
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Enters several Inclusions at once, preserving the order given.
   *
   * A spec sheet arrives as a list, and adding it one row at a time would be
   * one round trip per line plus a re-read of the siblings between each. The
   * whole batch is rejected if any row is bad — half a client's specification
   * silently landing is worse than none of it.
   */
  async addInclusions(opportunityId, entries = [], actorId) {
    if (!opportunityId) throw new Error("An inclusion needs an SOR.");
    if (!entries.length) return [];

    const cleaned = entries.map((entry) => cleanInclusionInput(entry));
    const siblings = await this.listInclusions(opportunityId);

    const { data, error } = await supabase
      .from("sor_inclusions")
      .insert(
        cleaned.map((row, i) => ({
          opportunity_id: opportunityId,
          completeness: COMPLETENESS.MISSING,
          sourcing: null,
          ...row,
          sort_order: siblings.length + i,
          created_by: actorId || null,
        })),
      )
      .select(INCLUSION_SELECT);

    if (error) throw error;
    return data || [];
  },

  /** Edits one Inclusion. Only the fields named in `patch` are touched. */
  async updateInclusion(inclusionId, patch = {}) {
    if (!inclusionId) throw new Error("An inclusion id is required.");

    const row = cleanInclusionInput(patch, { partial: true });
    if (Object.keys(row).length === 0) return null;

    const { data, error } = await supabase
      .from("sor_inclusions")
      .update(row)
      .eq("id", inclusionId)
      .select(INCLUSION_SELECT)
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Records how an item would be obtained.
   *
   * Separate from updateInclusion because it is a different act by a different
   * person — sales writes the specification, purchasing assesses how it would
   * be filled — and because `canSetSourcing` is the pure module's answer to
   * whether the value is one the system recognises at all.
   */
  async setSourcing(inclusionId, sourcing) {
    if (!inclusionId) throw new Error("An inclusion id is required.");

    const next = sourcing || null;
    if (!canSetSourcing(null, next)) {
      throw new Error(`"${sourcing}" is not a sourcing state.`);
    }

    const { data, error } = await supabase
      .from("sor_inclusions")
      .update({ sourcing: next })
      .eq("id", inclusionId)
      .select(INCLUSION_SELECT)
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Removes an Inclusion outright.
   *
   * A real delete, not a soft one, matching sales_opportunity_items: a
   * breakdown being typed up is a draft, and a mis-keyed line the salesperson
   * removes two seconds later is not history worth keeping. Anything durable
   * that later hangs off an Inclusion cascades with it.
   */
  async removeInclusion(inclusionId) {
    if (!inclusionId) throw new Error("An inclusion id is required.");

    const { error } = await supabase
      .from("sor_inclusions")
      .delete()
      .eq("id", inclusionId);

    if (error) throw error;
  },

  /**
   * Reorders an SOR's Inclusions — `updates` is `[{ id, sortOrder }]`.
   *
   * A plain batch of updates rather than a transaction: sort_order carries no
   * unique constraint (0055), so a partially-applied reorder leaves the list in
   * a slightly odd order and nothing else. The alternative — a two-phase write
   * to dodge collisions that cannot happen — would cost a round trip on every
   * drag.
   */
  async reorderInclusions(updates = []) {
    const writes = updates
      .filter((u) => u?.id)
      .map(({ id, sortOrder }) =>
        supabase
          .from("sor_inclusions")
          .update({ sort_order: Number(sortOrder) || 0 })
          .eq("id", id),
      );

    const results = await Promise.all(writes);
    const failure = results.find((r) => r.error);
    if (failure) throw failure.error;
  },
};
