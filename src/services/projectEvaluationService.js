import { supabase } from "../lib/supabase";
import { commissionService } from "./commissionService";
import {
  COMPLETENESS,
  COST_SOURCE,
  applyWinner,
  calculateProjectMargin,
  canSetSourcing,
  isCompleteness,
  isSourcing,
  priceDelta,
  resolveCost,
  rollUpBaseCost,
  sumActualCost,
  visiblePurchaseOrders,
  winningOffer,
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

/** Every column a caller reads for a Canvass, including its Offers. */
const CANVASS_SELECT = `
  *,
  signer:employees!sor_canvasses_signed_off_by_fkey(id, name, avatar_path),
  offers:sor_canvass_offers(*)
`;

/** Every column a caller reads for a Project Evaluation. */
const EVALUATION_SELECT = `
  *,
  signer:employees!sor_project_evaluations_signed_off_by_fkey(id, name, avatar_path)
`;

/** Normalises and checks what a caller wants written for a Project Evaluation. */
function cleanEvaluationInput(input = {}) {
  const row = {};

  const setAmount = (key, column, label) => {
    if (input[key] === undefined) return;
    const value = input[key] === null || input[key] === "" ? null : Number(input[key]);
    if (value !== null && !Number.isFinite(value)) {
      throw new Error(`${label} has to be a number.`);
    }
    row[column] = value;
  };

  setAmount("candidateSalesPrice", "candidate_sales_price", "Candidate sales price");
  setAmount("estimatedOpex", "estimated_opex", "Estimated operating expense");

  if (input.isGovernmentClient !== undefined) {
    row.is_government_client = Boolean(input.isGovernmentClient);
  }

  return row;
}

/**
 * Resolves the exactly-one-subject columns for a Canvass from a caller's
 * `{ procurementRequestId }` or `{ inclusionId }`. Throws rather than letting
 * a caller silently write a Canvass that satisfies neither, or both, of the
 * two — the database CHECK (0059) backs this up, but that surfaces as an
 * opaque Postgres error string no purchaser should ever see.
 */
function subjectColumns({ procurementRequestId, inclusionId } = {}) {
  const provided = [procurementRequestId, inclusionId].filter(Boolean);
  if (provided.length !== 1) {
    throw new Error("A Canvass belongs to exactly one Procurement Request or Inclusion.");
  }
  return {
    procurement_request_id: procurementRequestId || null,
    inclusion_id: inclusionId || null,
  };
}

/** Normalises and checks what a caller wants written for an Offer. */
function cleanOfferInput(input = {}, { partial = false } = {}) {
  const row = {};

  const setText = (key, column) => {
    if (input[key] === undefined) return;
    row[column] = String(input[key] ?? "").trim() || null;
  };

  setText("brand", "brand");
  setText("description", "description");
  setText("sourceLink", "source_link");
  setText("remarks", "remarks");
  setText("leadTime", "lead_time");
  setText("qualityNote", "quality_note");

  if (input.brochure !== undefined) row.brochure = input.brochure || [];

  if (input.unitPrice !== undefined) {
    const unitPrice = input.unitPrice === null || input.unitPrice === "" ? null : Number(input.unitPrice);
    if (unitPrice !== null && !Number.isFinite(unitPrice)) {
      throw new Error("Unit price has to be a number.");
    }
    row.unit_price = unitPrice;
  }

  if (!partial && !row.brand && !row.description) {
    throw new Error("An offer needs at least a brand or a description.");
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

  // ── Canvass (issue #46, Inclusion side #47) ──────────────────────────────

  /**
   * The Canvass for a subject, with its Offers, or null when nobody has
   * started canvassing it yet. Offers are ordered the way they were entered,
   * matching Inclusions.
   */
  async getCanvass(subject) {
    const columns = subjectColumns(subject);
    const filterKey = columns.procurement_request_id ? "procurement_request_id" : "inclusion_id";
    const filterValue = columns.procurement_request_id || columns.inclusion_id;

    const { data, error } = await supabase
      .from("sor_canvasses")
      .select(CANVASS_SELECT)
      .eq(filterKey, filterValue)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return {
      ...data,
      offers: (data.offers || []).sort(
        (a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at),
      ),
    };
  },

  /** The Canvass for a subject, creating an empty one on first touch. */
  async getOrCreateCanvass(subject, actorId) {
    const existing = await this.getCanvass(subject);
    if (existing) return existing;

    const { data, error } = await supabase
      .from("sor_canvasses")
      .insert({ ...subjectColumns(subject), created_by: actorId || null })
      .select(CANVASS_SELECT)
      .single();

    if (error) throw error;
    return { ...data, offers: [] };
  },

  /** Adds one Offer to a Canvass, appended after its current rows. */
  async addOffer(canvassId, input, actorId) {
    if (!canvassId) throw new Error("A Canvass id is required.");

    const row = cleanOfferInput(input);
    const { data: siblings, error: siblingsError } = await supabase
      .from("sor_canvass_offers")
      .select("id")
      .eq("canvass_id", canvassId);
    if (siblingsError) throw siblingsError;

    const { data, error } = await supabase
      .from("sor_canvass_offers")
      .insert({
        canvass_id: canvassId,
        brochure: [],
        ...row,
        sort_order: (siblings || []).length,
        created_by: actorId || null,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  /** Edits one Offer. Only the fields named in `patch` are touched. */
  async updateOffer(offerId, patch = {}) {
    if (!offerId) throw new Error("An offer id is required.");

    const row = cleanOfferInput(patch, { partial: true });
    if (Object.keys(row).length === 0) return null;

    const { data, error } = await supabase
      .from("sor_canvass_offers")
      .update(row)
      .eq("id", offerId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  /** Removes an Offer outright — a comparison being built up is a draft. */
  async removeOffer(offerId) {
    if (!offerId) throw new Error("An offer id is required.");

    const { error } = await supabase.from("sor_canvass_offers").delete().eq("id", offerId);
    if (error) throw error;
  },

  /**
   * Marks one Offer the winner of a Canvass.
   *
   * Written as two sequential, awaited updates — clear whoever held it, then
   * set the new one — rather than one bulk write, so
   * sor_canvass_offers_one_winner_per_canvass (0059) is never hit transiently.
   * applyWinner is what decides the shape; this is only the two writes it
   * implies.
   *
   * Issue #47: when the Canvass belongs to an Inclusion, its winning price is
   * also stamped onto that Inclusion's cost basis — the same write a purchaser
   * would otherwise have to make twice, once here and once by hand.
   */
  async markWinner(canvassId, winnerId) {
    if (!canvassId) throw new Error("A Canvass id is required.");

    const [{ data: offers, error: listError }, { data: canvassRow, error: canvassError }] =
      await Promise.all([
        supabase.from("sor_canvass_offers").select("id, is_winner").eq("canvass_id", canvassId),
        supabase.from("sor_canvasses").select("inclusion_id").eq("id", canvassId).single(),
      ]);
    if (listError) throw listError;
    if (canvassError) throw canvassError;

    // Throws if winnerId isn't one of this Canvass's offers — the same check
    // a bad write would otherwise skip straight past.
    applyWinner(offers || [], winnerId);

    const previousWinner = (offers || []).find((o) => o.is_winner && o.id !== winnerId);
    if (previousWinner) {
      const { error } = await supabase
        .from("sor_canvass_offers")
        .update({ is_winner: false })
        .eq("id", previousWinner.id);
      if (error) throw error;
    }

    const { data, error } = await supabase
      .from("sor_canvass_offers")
      .update({ is_winner: true })
      .eq("id", winnerId)
      .select()
      .single();
    if (error) throw error;

    if (canvassRow.inclusion_id) {
      await this.stampInclusionCost(canvassRow.inclusion_id, {
        amount: data.unit_price,
        source: COST_SOURCE.CANVASS_OFFER,
      });
    }

    return data;
  },

  /**
   * Records sign-off on a Canvass. The under-three-offers warning is a UI
   * confirmation (constants/projectEvaluation.js's canvassNeedsMoreOffers) —
   * this call itself never blocks, matching the policy that research must be
   * saveable half-finished.
   */
  async signOffCanvass(canvassId, actorId) {
    if (!canvassId) throw new Error("A Canvass id is required.");
    if (!actorId) throw new Error("An actor is required to sign off a Canvass.");

    const { data, error } = await supabase
      .from("sor_canvasses")
      .update({ signed_off_by: actorId, signed_off_at: new Date().toISOString() })
      .eq("id", canvassId)
      .select(CANVASS_SELECT)
      .single();

    if (error) throw error;
    return data;
  },

  /** Appends one attachment descriptor to a Canvass's evidence sheet. */
  async addCanvassAttachment(canvassId, descriptor) {
    if (!canvassId) throw new Error("A Canvass id is required.");

    const { data: canvass, error: readError } = await supabase
      .from("sor_canvasses")
      .select("attachments")
      .eq("id", canvassId)
      .single();
    if (readError) throw readError;

    const { data, error } = await supabase
      .from("sor_canvasses")
      .update({ attachments: [...(canvass.attachments || []), descriptor] })
      .eq("id", canvassId)
      .select(CANVASS_SELECT)
      .single();

    if (error) throw error;
    return data;
  },

  /** Removes one attachment from a Canvass's evidence sheet, matched by URL. */
  async removeCanvassAttachment(canvassId, url) {
    if (!canvassId) throw new Error("A Canvass id is required.");

    const { data: canvass, error: readError } = await supabase
      .from("sor_canvasses")
      .select("attachments")
      .eq("id", canvassId)
      .single();
    if (readError) throw readError;

    const { data, error } = await supabase
      .from("sor_canvasses")
      .update({ attachments: (canvass.attachments || []).filter((a) => a.url !== url) })
      .eq("id", canvassId)
      .select(CANVASS_SELECT)
      .single();

    if (error) throw error;
    return data;
  },

  // ── Cost basis (issue #47) ───────────────────────────────────────────────

  /**
   * Writes an Inclusion's cost basis, stamped with the moment it was
   * established. Internal — callers go through markWinner or
   * refreshInclusionCost, which decide *what* amount and source apply; this
   * is only the write. A null amount clears all three columns together,
   * since "not costed" has to mean none of them are set, not a stale
   * timestamp sitting under an empty figure.
   */
  async stampInclusionCost(inclusionId, { amount, source }) {
    const hasCost = amount !== null && amount !== undefined;

    const { data, error } = await supabase
      .from("sor_inclusions")
      .update({
        cost_amount: hasCost ? amount : null,
        cost_source: hasCost ? source : null,
        cost_established_at: hasCost ? new Date().toISOString() : null,
      })
      .eq("id", inclusionId)
      .select(INCLUSION_SELECT)
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Re-resolves and re-stamps an Inclusion's cost basis on demand — the only
   * way any input other than a fresh Canvass win moves the figure, matching
   * the policy that cost is a snapshot a purchaser controls, not a live read.
   *
   * `manualAmount` is the fallback tier: pass a number to record a hand-typed
   * figure, or omit it to re-check only the higher tiers (a winning offer, if
   * the Canvass changed since) against whatever manual figure is already on
   * file.
   *
   * Odoo's catalog price (the middle tier) is not wired here — an Inclusion
   * carries no Odoo product reference to key such a lookup on, and issue #38
   * already scoped live Odoo reads out of this feature. resolveCost() already
   * supports the tier, so wiring it later is additive, not a rewrite.
   */
  async refreshInclusionCost(inclusionId, { manualAmount } = {}) {
    if (!inclusionId) throw new Error("An inclusion id is required.");

    const [canvass, { data: current, error: readError }] = await Promise.all([
      this.getCanvass({ inclusionId }),
      supabase
        .from("sor_inclusions")
        .select("cost_amount, cost_source")
        .eq("id", inclusionId)
        .single(),
    ]);
    if (readError) throw readError;

    const winner = canvass ? winningOffer(canvass.offers) : null;
    const fallbackManual =
      manualAmount !== undefined
        ? manualAmount
        : current.cost_source === COST_SOURCE.MANUAL
          ? current.cost_amount
          : null;

    const { amount, source } = resolveCost({
      winningOfferPrice: winner?.unit_price ?? null,
      odooCatalogPrice: null,
      manualAmount: fallbackManual,
    });

    return this.stampInclusionCost(inclusionId, { amount, source });
  },

  // ── Project Evaluation (issue #48) ───────────────────────────────────────

  /** The SOR's Project Evaluation, or null when nobody has started one yet. */
  async getEvaluation(opportunityId) {
    if (!opportunityId) return null;

    const { data, error } = await supabase
      .from("sor_project_evaluations")
      .select(EVALUATION_SELECT)
      .eq("opportunity_id", opportunityId)
      .maybeSingle();

    if (error) throw error;
    return data;
  },

  /** The SOR's Project Evaluation, creating an empty one on first touch. */
  async getOrCreateEvaluation(opportunityId, actorId) {
    if (!opportunityId) throw new Error("An SOR is required.");

    const existing = await this.getEvaluation(opportunityId);
    if (existing) return existing;

    const { data, error } = await supabase
      .from("sor_project_evaluations")
      .insert({ opportunity_id: opportunityId, created_by: actorId || null })
      .select(EVALUATION_SELECT)
      .single();

    if (error) throw error;
    return data;
  },

  /** Edits a Project Evaluation. Only the fields named in `patch` are touched. */
  async updateEvaluation(evaluationId, patch = {}) {
    if (!evaluationId) throw new Error("A Project Evaluation id is required.");

    const row = cleanEvaluationInput(patch);
    if (Object.keys(row).length === 0) return null;

    const { data, error } = await supabase
      .from("sor_project_evaluations")
      .update(row)
      .eq("id", evaluationId)
      .select(EVALUATION_SELECT)
      .single();

    if (error) throw error;
    return data;
  },

  /** Records sign-off on a Project Evaluation — who decided, and when. */
  async signOffEvaluation(evaluationId, actorId) {
    if (!evaluationId) throw new Error("A Project Evaluation id is required.");
    if (!actorId) throw new Error("An actor is required to sign off a Project Evaluation.");

    const { data, error } = await supabase
      .from("sor_project_evaluations")
      .update({ signed_off_by: actorId, signed_off_at: new Date().toISOString() })
      .eq("id", evaluationId)
      .select(EVALUATION_SELECT)
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * VAT, Withholding and Retention as of today — what a Project Evaluation's
   * government-deduction math needs. Extends commissionService rather than
   * re-querying commission_rates a second way; retentionPercent is null when
   * nobody has ever configured one, matching getEffectiveRetentionPercent.
   */
  async getDeductionRates() {
    const [rates, retentionPercent] = await Promise.all([
      commissionService.getEffectiveRates(),
      commissionService.getEffectiveRetentionPercent(),
    ]);
    return { ...rates, retentionPercent };
  },

  // ── Actual cost (issue #49) ───────────────────────────────────────────────

  /** Every local override recorded for an SOR's purchase-order rollup. */
  async listPurchaseOrderLinks(opportunityId) {
    if (!opportunityId) return [];

    const { data, error } = await supabase
      .from("sor_purchase_order_links")
      .select("*")
      .eq("opportunity_id", opportunityId);

    if (error) throw error;
    return data || [];
  },

  /**
   * Calls the Odoo PO rollup edge function. Never throws — an unreachable
   * Odoo is a status on the result the caller displays, the same soft-fail
   * contract odoo-po-verify and odoo-sor-lookup already use, not an error
   * anyone has to catch.
   */
  async fetchOdooPurchaseOrders(salesReference, additionalPoNumbers = []) {
    if (!salesReference) return { status: "ok", orders: [] };

    try {
      const { data, error } = await supabase.functions.invoke("odoo-po-rollup", {
        body: { saleOrderRef: salesReference, additionalPoNumbers },
      });
      if (error || !data?.success) return { status: "unreachable", orders: [] };
      return { status: "ok", orders: data.orders || [] };
    } catch {
      return { status: "unreachable", orders: [] };
    }
  },

  /**
   * The SOR's actual cost: live Odoo purchase orders matched by Source
   * Document, plus any manually attached (looked up by number in the same
   * call so their totals are real Odoo figures), minus whatever has been
   * detached. `status` is "unreachable" when Odoo could not be asked at all —
   * distinct from "ok" with an empty set, which means Odoo answered and there
   * is genuinely nothing yet.
   */
  async getActualCostRollup(opportunityId, salesReference) {
    const links = await this.listPurchaseOrderLinks(opportunityId);
    const manualNumbers = links
      .filter((link) => link.origin === "MANUAL" && !link.is_detached)
      .map((link) => link.po_number);

    const { status, orders } = await this.fetchOdooPurchaseOrders(salesReference, manualNumbers);
    const visible = visiblePurchaseOrders(orders, links);

    return { status, orders: visible, total: sumActualCost(visible), links };
  },

  /** Attaches a purchase order the rollup did not find, by its Odoo number. */
  async attachPurchaseOrder(opportunityId, poNumber, actorId) {
    if (!opportunityId || !poNumber) {
      throw new Error("An SOR and a PO number are required.");
    }

    const { data, error } = await supabase
      .from("sor_purchase_order_links")
      .upsert(
        {
          opportunity_id: opportunityId,
          po_number: poNumber.trim().toUpperCase(),
          origin: "MANUAL",
          is_detached: false,
          created_by: actorId || null,
        },
        { onConflict: "opportunity_id,po_number" },
      )
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Detaches a purchase order the rollup picked up wrongly.
   *
   * A manually attached PO is un-attached by deleting its override — nothing
   * is left to record once neither Odoo's search nor a human claims the
   * number. A PO Odoo's own search found is detached by recording that
   * override, so it stays excluded across the next refresh (0062).
   */
  async detachPurchaseOrder(opportunityId, poNumber) {
    if (!opportunityId || !poNumber) {
      throw new Error("An SOR and a PO number are required.");
    }
    const number = poNumber.trim().toUpperCase();

    const { data: existing, error: readError } = await supabase
      .from("sor_purchase_order_links")
      .select("id, origin")
      .eq("opportunity_id", opportunityId)
      .eq("po_number", number)
      .maybeSingle();
    if (readError) throw readError;

    if (existing?.origin === "MANUAL") {
      const { error } = await supabase
        .from("sor_purchase_order_links")
        .delete()
        .eq("id", existing.id);
      if (error) throw error;
      return null;
    }

    const { data, error } = await supabase
      .from("sor_purchase_order_links")
      .upsert(
        { opportunity_id: opportunityId, po_number: number, origin: "ODOO_ORIGIN", is_detached: true },
        { onConflict: "opportunity_id,po_number" },
      )
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Everything one screen needs to show the go/no-go: the evaluation record
   * itself, the base cost rolled up from Inclusions, whether the evaluation
   * is bound to a live Odoo order (and if so, how its price and its actual
   * spend compare), and the resulting margin.
   *
   * Deduction rates are only fetched when the evaluation is flagged as a
   * government client — a private-sector evaluation needs no rate at all,
   * and skipping the query is one fewer round trip on the common case. The
   * actual-cost rollup is likewise skipped entirely when unbound: with no
   * Sales Reference there is no Odoo sale order for a purchase order to name.
   */
  async getEvaluationSummary(opportunityId) {
    if (!opportunityId) throw new Error("An SOR is required.");

    const [evaluation, inclusions, { data: opportunity, error: oppError }] = await Promise.all([
      this.getEvaluation(opportunityId),
      this.listInclusions(opportunityId),
      supabase
        .from("sales_opportunities")
        .select("id, sales_reference, expected_value")
        .eq("id", opportunityId)
        .single(),
    ]);
    if (oppError) throw oppError;

    const baseCost = rollUpBaseCost(inclusions);
    const isBound = Boolean(opportunity.sales_reference);
    const odooOrderPrice = isBound && opportunity.expected_value != null
      ? Number(opportunity.expected_value)
      : null;

    const rates = evaluation?.is_government_client
      ? await this.getDeductionRates()
      : { vatPercent: 0, withholdingPercent: 0, retentionPercent: null };

    const margin = calculateProjectMargin({
      candidateSalesPrice: evaluation?.candidate_sales_price ?? null,
      baseCost: baseCost.amount,
      estimatedOpex: evaluation?.estimated_opex ?? null,
      isGovernmentClient: evaluation?.is_government_client ?? false,
      ...rates,
    });

    const actualCost = isBound
      ? await this.getActualCostRollup(opportunityId, opportunity.sales_reference)
      : { status: "ok", orders: [], total: { amount: null, orderCount: 0 }, links: [] };

    return {
      evaluation,
      baseCost,
      isBound,
      odooOrderPrice,
      delta: priceDelta(evaluation?.candidate_sales_price ?? null, odooOrderPrice),
      margin,
      actualCost: {
        ...actualCost,
        // The estimate is never overwritten by this — it is only ever the
        // difference read alongside it (issue #49's own decision).
        variance: priceDelta(baseCost.amount, actualCost.total.amount),
      },
    };
  },
};
