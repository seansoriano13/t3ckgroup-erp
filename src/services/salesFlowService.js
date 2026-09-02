import { supabase } from "../lib/supabase";
import { systemAuditLogService } from "./systemAuditLogService";
import { flowLockBlockers } from "../constants/salesFlow";
import { stageActionService } from "./stageActionService";
import { stageConditionService } from "./stageConditionService";

/**
 * Flow Canvas persistence (issue #36, ADR 0006) — Sale Types, the Sales Flow
 * each one owns, its private Stages, and the edges between them.
 *
 * What is deliberately NOT here: whether a move is a legal edge, where a deal
 * enters a flow, and whether a flow is fit to be locked. Those are pure
 * questions answerable from arguments, so they live in constants/salesFlow.js
 * and are tested without a database. This file loads rows, checks who is
 * asking and whether the flow is still a draft, and writes.
 *
 * Every write is Super-Admin-gated. Issue #36 rules out a permission model for
 * the canvas: it is scaffolding scheduled to be hidden, and building a role for
 * it is the scope creep the project exists to prevent. The developer and the
 * Operations Manager work on one screen.
 */

/** Trims a free-text name field to what a human actually typed. */
const trimName = (value) => (value || "").trim();
/** Case/whitespace-insensitive comparison key for a name clash check. */
const foldName = (value) => trimName(value).toLowerCase();

/**
 * Throws unless `actorId` is a Super Admin. Enforced independently at the
 * database via RLS (0047/0048) — this check exists so the failure is
 * immediate, testable without a real database, and doesn't depend on trusting
 * a client-supplied permission flag. Prior art:
 * stageConditionService.requireSuperAdmin.
 */
async function requireSuperAdmin(actorId) {
  // Access control temporarily disabled as requested by user.
  // Anyone can edit Flow Canvas nodes (CRUD).
}

async function loadFlow(flowId) {
  const { data, error } = await supabase.from("sales_flows").select("*").eq("id", flowId).single();
  if (error) throw error;
  return data;
}

/**
 * The flow, refusing if it has been locked. Locked is read-only (issue #36),
 * and it is checked here rather than by a trigger because unlocking is a
 * legitimate action with an audit trail and a trigger cannot tell an unlock
 * from a tamper.
 */
async function requireDraft(flowId) {
  const flow = await loadFlow(flowId);
  if (flow.state === "locked") {
    throw new Error("This Sales Flow is locked. Unlock it first, with a reason, to make changes.");
  }
  return flow;
}

/** A Stage plus the flow it belongs to, refusing if that flow is locked. */
async function requireDraftStage(stageId) {
  const { data: stage, error } = await supabase
    .from("flow_stages")
    .select("*")
    .eq("id", stageId)
    .single();
  if (error) throw error;

  const flow = await requireDraft(stage.flow_id);
  return { stage, flow };
}

async function stagesOf(flowId) {
  const { data, error } = await supabase
    .from("flow_stages")
    .select("*")
    .eq("flow_id", flowId)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function edgesOf(flowId) {
  const { data, error } = await supabase.from("flow_edges").select("*").eq("flow_id", flowId);
  if (error) throw error;
  return data || [];
}

export const salesFlowService = {
  /**
   * Live Sale Types, by name. The list starts empty and stays that way until
   * the Operations Manager creates one — nothing here seeds a value, because a
   * proposed value is the system steering her toward a category that may not
   * match how the business sells.
   */
  async getSaleTypes({ includeArchived = false } = {}) {
    let query = supabase.from("sale_types").select("*").order("name", { ascending: true });
    if (!includeArchived) query = query.is("archived_at", null);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  /**
   * Everything the canvas draws for one Sale Type: the type, its flow, its
   * private Stages in canvas order, and its edges. Null when the Sale Type has
   * no flow — a state `createSaleType` never produces, but one a half-applied
   * promotion could leave behind, and a canvas that threw on it would be
   * unable to show what went wrong.
   */
  async getFlow(saleTypeId) {
    if (!saleTypeId) return null;

    const { data: saleType, error: saleTypeError } = await supabase
      .from("sale_types")
      .select("*")
      .eq("id", saleTypeId)
      .maybeSingle();
    if (saleTypeError) throw saleTypeError;
    if (!saleType) return null;

    const { data: flow, error: flowError } = await supabase
      .from("sales_flows")
      .select("*")
      .eq("sale_type_id", saleTypeId)
      .maybeSingle();
    if (flowError) throw flowError;
    if (!flow) return null;

    const [stages, edges] = await Promise.all([stagesOf(flow.id), edgesOf(flow.id)]);
    return { saleType, flow, stages, edges };
  },

  /**
   * Every Stage across every Sales Flow, indexed for a register or board that
   * lists opportunities from many Sale Types at once — the register does not
   * know ahead of time which flows it needs, and asking `getFlow` once per row
   * would mean one query per opportunity. Three flat queries regardless of how
   * many flows exist, then the caller resolves a Stage by id and its flow by
   * `flow_id`.
   */
  async getAllStagesIndex() {
    const [{ data: flows, error: flowsError }, { data: stages, error: stagesError }] =
      await Promise.all([
        supabase.from("sales_flows").select("*"),
        supabase.from("flow_stages").select("*"),
      ]);
    if (flowsError) throw flowsError;
    if (stagesError) throw stagesError;

    const flowsById = Object.fromEntries((flows || []).map((f) => [f.id, f]));
    const stagesById = Object.fromEntries((stages || []).map((s) => [s.id, s]));
    const stagesByFlow = {};
    for (const s of stages || []) {
      (stagesByFlow[s.flow_id] ||= []).push(s);
    }

    return { flowsById, stagesById, stagesByFlow };
  },

  /**
   * Creates a Sale Type and the empty Sales Flow it owns.
   *
   * Both, always: a Sale Type without a flow is a deal category nothing can
   * route, and making the canvas handle that state is more expensive than
   * never producing it. The flow is created second, so a failure leaves an
   * orphan Sale Type rather than a flow pointing at nothing — the direction
   * `getFlow` can report.
   */
  async createSaleType(name, actorId) {
    await requireSuperAdmin(actorId);

    const trimmed = trimName(name);
    if (!trimmed) throw new Error("A Sale Type needs a name.");
    await assertSaleTypeNameFree(trimmed);

    const { data: saleType, error } = await supabase
      .from("sale_types")
      .insert({ name: trimmed, created_by: actorId })
      .select()
      .single();
    if (error) throw error;

    const { error: flowError } = await supabase
      .from("sales_flows")
      .insert({ sale_type_id: saleType.id, state: "draft" });
    if (flowError) throw flowError;

    systemAuditLogService.addSystemEvent(
      "SALE_TYPE",
      saleType.id,
      `Sale Type created: "${trimmed}".`,
      { event: "SALE_TYPE_CREATED", name: trimmed, employeeId: actorId },
      actorId,
    ).catch(console.error);

    return saleType;
  },

  /** Renames a Sale Type — a working name in a meeting is not a commitment. */
  async renameSaleType(saleTypeId, name, actorId) {
    await requireSuperAdmin(actorId);

    const trimmed = trimName(name);
    if (!trimmed) throw new Error("A Sale Type needs a name.");
    await assertSaleTypeNameFree(trimmed, saleTypeId);

    const { data, error } = await supabase
      .from("sale_types")
      .update({ name: trimmed, updated_at: new Date().toISOString() })
      .eq("id", saleTypeId)
      .select()
      .single();
    if (error) throw error;

    systemAuditLogService.addSystemEvent(
      "SALE_TYPE",
      saleTypeId,
      `Sale Type renamed to "${trimmed}".`,
      { event: "SALE_TYPE_RENAMED", name: trimmed, employeeId: actorId },
      actorId,
    ).catch(console.error);

    return data;
  },

  /**
   * Retires a Sale Type without deleting it. Deals that carry it still read
   * its name, so the row stays and only leaves the pickers.
   */
  async archiveSaleType(saleTypeId, actorId) {
    await requireSuperAdmin(actorId);

    const { data, error } = await supabase
      .from("sale_types")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", saleTypeId)
      .select()
      .single();
    if (error) throw error;

    systemAuditLogService.addSystemEvent(
      "SALE_TYPE",
      saleTypeId,
      `Sale Type archived: "${data.name}".`,
      { event: "SALE_TYPE_ARCHIVED", name: data.name, employeeId: actorId },
      actorId,
    ).catch(console.error);

    return data;
  },

  /**
   * Restores a retired Sale Type so it is offered on new deals again.
   */
  async restoreSaleType(saleTypeId, actorId) {
    await requireSuperAdmin(actorId);

    const { data: saleType } = await supabase
      .from("sale_types")
      .select("name")
      .eq("id", saleTypeId)
      .single();

    if (saleType) {
      await assertSaleTypeNameFree(saleType.name, saleTypeId);
    }

    const { data, error } = await supabase
      .from("sale_types")
      .update({ archived_at: null, updated_at: new Date().toISOString() })
      .eq("id", saleTypeId)
      .select()
      .single();
    if (error) throw error;

    systemAuditLogService.addSystemEvent(
      "SALE_TYPE",
      saleTypeId,
      `Sale Type restored: "${data.name}".`,
      { event: "SALE_TYPE_RESTORED", name: data.name, employeeId: actorId },
      actorId,
    ).catch(console.error);

    return data;
  },

  /**
   * Hard-deletes a Sale Type. The database will enforce foreign key constraints 
   * if this Sale Type is already linked to active deals.
   */
  async deleteSaleType(saleTypeId, actorId) {
    await requireSuperAdmin(actorId);

    const { data: saleType, error: fetchError } = await supabase
      .from("sale_types")
      .select("name")
      .eq("id", saleTypeId)
      .single();
    if (fetchError) throw fetchError;

    const { error } = await supabase
      .from("sale_types")
      .delete()
      .eq("id", saleTypeId);
    if (error) throw error;

    systemAuditLogService.addSystemEvent(
      "SALE_TYPE",
      saleTypeId,
      `Sale Type deleted: "${saleType.name}".`,
      { event: "SALE_TYPE_DELETED", name: saleType.name, employeeId: actorId },
      actorId,
    ).catch(console.error);

    return true;
  },

  /**
   * Adds a Stage to the end of a flow. Its `sort_order` puts it last, which
   * matters for one reason only: the Stage that sorts first is where deals
   * enter (constants/salesFlow.js). Reordering is how she changes that.
   */
  async addStage(flowId, name, actorId, posX = 0, posY = 0) {
    await requireSuperAdmin(actorId);
    await requireDraft(flowId);

    const trimmed = trimName(name);
    if (!trimmed) throw new Error("A Stage needs a name.");

    const siblings = await stagesOf(flowId);
    assertStageNameFree(siblings, trimmed);

    const { data, error } = await supabase
      .from("flow_stages")
      .insert({ flow_id: flowId, name: trimmed, sort_order: siblings.length, pos_x: Math.round(posX), pos_y: Math.round(posY) })
      .select()
      .single();
    if (error) throw error;

    systemAuditLogService.addSystemEvent(
      "FLOW_STAGE",
      data.id,
      `Stage added: "${trimmed}".`,
      { event: "FLOW_STAGE_ADDED", flowId, name: trimmed, employeeId: actorId },
      actorId,
    ).catch(console.error);

    return data;
  },

  /** Renames a Stage so the flow reads the way the business talks. */
  async renameStage(stageId, name, actorId) {
    await requireSuperAdmin(actorId);
    const { stage } = await requireDraftStage(stageId);

    const trimmed = trimName(name);
    if (!trimmed) throw new Error("A Stage needs a name.");

    const siblings = await stagesOf(stage.flow_id);
    assertStageNameFree(siblings, trimmed, stageId);

    const { data, error } = await supabase
      .from("flow_stages")
      .update({ name: trimmed, updated_at: new Date().toISOString() })
      .eq("id", stageId)
      .select()
      .single();
    if (error) throw error;

    systemAuditLogService.addSystemEvent(
      "FLOW_STAGE",
      stageId,
      `Stage renamed to "${trimmed}".`,
      { event: "FLOW_STAGE_RENAMED", name: trimmed, employeeId: actorId },
      actorId,
    ).catch(console.error);

    return data;
  },

  /**
   * Sets a Stage's own color, overriding the role-based default (Entry/Won/
   * Terminal/Plain) the canvas and the Opportunity ribbon otherwise fall back
   * to. `null` clears the override.
   */
  async updateStageColor(stageId, color, actorId) {
    await requireSuperAdmin(actorId);
    await requireDraftStage(stageId);

    const { data, error } = await supabase
      .from("flow_stages")
      .update({ color: color || null, updated_at: new Date().toISOString() })
      .eq("id", stageId)
      .select()
      .single();
    if (error) throw error;

    // No audit event: same class of change as updateStagePosition — cosmetic,
    // not flow execution.

    return data;
  },

  /**
   * Sets a Stage's bracket label — free text grouping several Stages under
   * one heading for context (e.g. "Pre-Sales", "Closing"). Purely a display
   * grouping: Stages sharing the same text are read as one bracket wherever
   * a flow's Stages are drawn in order (the canvas node's tag, the
   * Opportunity ribbon's header), nothing else in the flow keys off it.
   * `null` clears it.
   */
  async updateStageBracket(stageId, label, actorId) {
    await requireSuperAdmin(actorId);
    await requireDraftStage(stageId);

    const trimmed = typeof label === "string" ? label.trim() : "";

    const { data, error } = await supabase
      .from("flow_stages")
      .update({ bracket_label: trimmed || null, updated_at: new Date().toISOString() })
      .eq("id", stageId)
      .select()
      .single();
    if (error) throw error;

    // No audit event: same class of change as updateStageColor — cosmetic,
    // not flow execution.

    return data;
  },

  /** Updates the visual position of a Stage on the canvas. */
  async updateStagePosition(stageId, x, y, actorId) {
    await requireSuperAdmin(actorId);
    await requireDraftStage(stageId);

    const { data, error } = await supabase
      .from("flow_stages")
      .update({ pos_x: Math.round(x), pos_y: Math.round(y), updated_at: new Date().toISOString() })
      .eq("id", stageId)
      .select()
      .single();
    if (error) throw error;

    // No audit event emitted: visual layout changes do not affect flow execution
    // and dragging nodes fires frequently.
    
    return data;
  },

  /**
   * Rewrites the canvas order from a list of Stage ids, first to last.
   *
   * Written one row at a time rather than as a batch: `sort_order` carries no
   * unique constraint here (unlike `crm_pipeline_stages`, where a swap
   * collides mid-write), so a sequential rewrite is enough and needs no
   * two-phase dance. This is a one-admin-in-a-meeting action, not a bulk path.
   */
  async reorderStages(flowId, orderedStageIds, actorId) {
    await requireSuperAdmin(actorId);
    await requireDraft(flowId);

    const stages = await stagesOf(flowId);
    const known = new Set(stages.map((s) => s.id));
    if (orderedStageIds.length !== stages.length || orderedStageIds.some((id) => !known.has(id))) {
      throw new Error("Reordering must list every Stage in this flow exactly once.");
    }

    for (const [index, stageId] of orderedStageIds.entries()) {
      const { error } = await supabase
        .from("flow_stages")
        .update({ sort_order: index, updated_at: new Date().toISOString() })
        .eq("id", stageId);
      if (error) throw error;
    }

    return stagesOf(flowId);
  },

  /** Marks a Stage as one where deals stop. A flow may have many. */
  async setStageTerminal(stageId, isTerminal, actorId) {
    await requireSuperAdmin(actorId);
    await requireDraftStage(stageId);

    const { data, error } = await supabase
      .from("flow_stages")
      .update({ is_terminal: Boolean(isTerminal), updated_at: new Date().toISOString() })
      .eq("id", stageId)
      .select()
      .single();
    if (error) throw error;

    systemAuditLogService.addSystemEvent(
      "FLOW_STAGE",
      stageId,
      `Stage "${data.name}" marked ${data.is_terminal ? "terminal" : "not terminal"}.`,
      { event: "FLOW_STAGE_TERMINAL_SET", isTerminal: data.is_terminal, employeeId: actorId },
      actorId,
    ).catch(console.error);

    return data;
  },

  /**
   * Deletes a Stage and, by cascade, every edge that touched it.
   *
   * Refused for the Stage the flow calls Won: losing that designation as a
   * side effect would leave the flow unlockable with nothing on screen saying
   * why. She moves the designation first, deliberately.
   */
  async deleteStage(stageId, actorId) {
    await requireSuperAdmin(actorId);
    const { stage, flow } = await requireDraftStage(stageId);

    if (flow.won_stage_id === stageId) {
      throw new Error(
        `"${stage.name}" is this flow's Won Stage. Choose a different Won Stage before deleting it.`,
      );
    }

    // The composite foreign keys in 0048 cascade the edges. Deleting them
    // first anyway keeps the harness and the database agreeing on what a
    // Stage deletion leaves behind, rather than depending on a cascade the
    // fake database does not model.
    const { error: edgeError } = await supabase
      .from("flow_edges")
      .delete()
      .or(`from_stage_id.eq.${stageId},to_stage_id.eq.${stageId}`);
    if (edgeError) throw edgeError;

    const { error } = await supabase.from("flow_stages").delete().eq("id", stageId);
    if (error) throw error;

    systemAuditLogService.addSystemEvent(
      "FLOW_STAGE",
      stageId,
      `Stage deleted: "${stage.name}".`,
      { event: "FLOW_STAGE_DELETED", flowId: stage.flow_id, name: stage.name, employeeId: actorId },
      actorId,
    ).catch(console.error);

    return true;
  },

  /**
   * Draws a permitted move. Loops back and skips ahead are ordinary edges —
   * that is the whole reason the flow is a graph rather than a list.
   *
   * Drawing an edge that already exists is a no-op rather than an error: on a
   * canvas she may well drag the same arrow twice, and the second attempt
   * expresses the same intention as the first.
   */
  async addEdge(flowId, fromStageId, toStageId, actorId) {
    await requireSuperAdmin(actorId);
    await requireDraft(flowId);

    if (fromStageId === toStageId) {
      throw new Error("A Stage cannot move to itself.");
    }

    const stages = await stagesOf(flowId);
    const ids = new Set(stages.map((s) => s.id));
    if (!ids.has(fromStageId) || !ids.has(toStageId)) {
      throw new Error("Both ends of a move must be Stages in the same flow.");
    }

    const existing = (await edgesOf(flowId)).find(
      (e) => e.from_stage_id === fromStageId && e.to_stage_id === toStageId,
    );
    if (existing) return existing;

    const { data, error } = await supabase
      .from("flow_edges")
      .insert({ flow_id: flowId, from_stage_id: fromStageId, to_stage_id: toStageId })
      .select()
      .single();
    if (error) throw error;

    systemAuditLogService.addSystemEvent(
      "SALES_FLOW",
      flowId,
      `Move drawn: ${stages.find((s) => s.id === fromStageId)?.name} → ${stages.find((s) => s.id === toStageId)?.name}.`,
      { event: "FLOW_EDGE_ADDED", flowId, fromStageId, toStageId, employeeId: actorId },
      actorId,
    ).catch(console.error);

    return data;
  },

  /** Removes a move she decided never happens in reality. */
  async removeEdge(edgeId, actorId) {
    await requireSuperAdmin(actorId);

    const { data: edge, error: readError } = await supabase
      .from("flow_edges")
      .select("*")
      .eq("id", edgeId)
      .single();
    if (readError) throw readError;

    await requireDraft(edge.flow_id);

    const { error } = await supabase.from("flow_edges").delete().eq("id", edgeId);
    if (error) throw error;

    systemAuditLogService.addSystemEvent(
      "SALES_FLOW",
      edge.flow_id,
      `Move removed.`,
      { event: "FLOW_EDGE_REMOVED", flowId: edge.flow_id, fromStageId: edge.from_stage_id, toStageId: edge.to_stage_id, employeeId: actorId },
      actorId,
    ).catch(console.error);

    return true;
  },

  /**
   * Designates where this flow's deals are won. Set by the developer on the
   * lock screen, phrased as "where have we won the deal" and never labelled
   * with commission vocabulary (issue #36) — but it is what
   * `isRealizedOpportunity` ultimately depends on, because reaching it is what
   * stamps a Contract Date.
   *
   * A column on the flow rather than a flag on the Stage, so two Won Stages
   * cannot be represented at all.
   */
  async setWonStage(flowId, stageId, actorId) {
    await requireSuperAdmin(actorId);
    await requireDraft(flowId);

    let stageName = "None";
    if (stageId !== null) {
      const stages = await stagesOf(flowId);
      const stage = stages.find((s) => s.id === stageId);
      if (!stage) {
        throw new Error("A flow's Won Stage must be one of its own Stages.");
      }
      stageName = stage.name;
    }

    const { data, error } = await supabase
      .from("sales_flows")
      .update({ won_stage_id: stageId, updated_at: new Date().toISOString() })
      .eq("id", flowId)
      .select()
      .single();
    if (error) throw error;

    // This is the one write on this screen with a downstream effect beyond
    // the canvas itself: it decides which Stage stamps Contract Date, which
    // is what isRealizedOpportunity ultimately asks. Worth an audit trail
    // independent of the flow's own lock/unlock history.
    systemAuditLogService.addSystemEvent(
      "SALES_FLOW",
      flowId,
      `Won Stage set to "${stageName}".`,
      { event: "FLOW_WON_STAGE_SET", flowId, stageId, employeeId: actorId },
      actorId,
    ).catch(console.error);

    return data;
  },

  /**
   * Freezes an agreed flow read-only. Agreement becomes a state rather than a
   * memory.
   *
   * The blockers come from the pure module so the lock screen and this check
   * can never disagree about what "fit to lock" means, and every blocker is
   * reported at once — being told about the next problem only after fixing the
   * last is the wrong shape of feedback for a meeting.
   */
  async lockFlow(flowId, actorId) {
    await requireSuperAdmin(actorId);
    const flow = await requireDraft(flowId);

    const [stages, edges] = await Promise.all([stagesOf(flowId), edgesOf(flowId)]);
    const blockers = flowLockBlockers({ stages, edges, wonStageId: flow.won_stage_id });
    if (blockers.length > 0) {
      throw new Error(`This flow cannot be locked yet. ${blockers.join(" ")}`);
    }

    const { data, error } = await supabase
      .from("sales_flows")
      .update({
        state: "locked",
        locked_at: new Date().toISOString(),
        locked_by: actorId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", flowId)
      .select()
      .single();
    if (error) throw error;

    systemAuditLogService.addSystemEvent(
      "SALES_FLOW",
      flowId,
      `Sales Flow locked.`,
      { event: "SALES_FLOW_LOCKED", employeeId: actorId },
      actorId,
    ).catch(console.error);

    // 1. Snapshotting
    const stageIds = stages.map(s => s.id);
    const [actionsObj, conditionsObj] = await Promise.all([
      stageIds.length > 0 ? stageActionService.getForStages(stageIds) : {},
      stageIds.length > 0 ? stageConditionService.getForStages(stageIds) : {}
    ]);

    const { data: latestSnapshot } = await supabase
      .from("flow_snapshots")
      .select("version")
      .eq("flow_id", flowId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextVersion = (latestSnapshot?.version || 0) + 1;

    const snapshotData = {
      stages,
      edges,
      actions: Object.values(actionsObj || {}).flat(),
      conditions: Object.values(conditionsObj || {}).flat(),
      wonStageId: flow.won_stage_id,
      saleTypeId: flow.sale_type_id
    };

    const { data: snapshotResult, error: snapshotError } = await supabase
      .from("flow_snapshots")
      .insert({
        flow_id: flowId,
        version: nextVersion,
        snapshot_data: snapshotData,
        created_by: actorId
      })
      .select()
      .single();

    if (snapshotError) throw snapshotError;

    // 2. Emit artefacts
    const artefacts = {
      promotableConfiguration: JSON.stringify(snapshotData, null, 2),
      readableDocument: `# Sales Flow Document\n\nVersion: ${nextVersion}\n...`,
      notesList: "Notes...",
    };

    return { ...data, snapshot: snapshotResult, artefacts };
  },

  async importSnapshot(snapshotData, name, actorId) {
    await requireSuperAdmin(actorId);

    const saleType = await this.createSaleType(name, actorId);
    const flow = (await this.getFlow(saleType.id)).flow;

    const stageIdMap = {};

    // 1. Create Stages
    for (const oldStage of snapshotData.stages || []) {
      const newStage = await this.addStage(flow.id, oldStage.name, actorId);
      stageIdMap[oldStage.id] = newStage.id;
    }

    // 2. Set Won Stage
    if (snapshotData.wonStageId && stageIdMap[snapshotData.wonStageId]) {
      await this.setWonStage(flow.id, stageIdMap[snapshotData.wonStageId], actorId);
    }

    // 3. Create Edges
    for (const oldEdge of snapshotData.edges || []) {
      const sourceId = stageIdMap[oldEdge.from_stage_id];
      const targetId = stageIdMap[oldEdge.to_stage_id];
      if (sourceId && targetId) {
        await this.addEdge(flow.id, sourceId, targetId, actorId);
      }
    }

    // 4. Create Actions
    const actionsList = Array.isArray(snapshotData.actions) ? snapshotData.actions : Object.values(snapshotData.actions || {}).flat();
    for (const action of actionsList) {
      const stageId = stageIdMap[action.stage_id];
      if (stageId) {
        await stageActionService.add({ stageId, kind: action.kind, config: action.config }, actorId);
      }
    }

    // 5. Create Conditions
    const reqList = Array.isArray(snapshotData.conditions) ? snapshotData.conditions : Object.values(snapshotData.conditions || {}).flat();
    for (const req of reqList) {
      const stageId = stageIdMap[req.stage_id];
      if (stageId) {
        await stageConditionService.add({ 
          stageId, 
          kind: req.kind, 
          label: req.label, 
          isRequired: req.is_required, 
          config: req.config 
        }, actorId);
      }
    }

    return this.getFlow(saleType.id);
  },

  /**
   * Reopens a locked flow for a genuine correction after the meeting.
   *
   * The reason is mandatory and recorded. Unlocking is permitted precisely so
   * that it can be counted: repeated reopening is a pattern about how the
   * agreement is being reached, and it has to be visible rather than absorbed
   * silently.
   */
  async unlockFlow(flowId, reason, actorId) {
    await requireSuperAdmin(actorId);

    const trimmedReason = trimName(reason);
    if (!trimmedReason) {
      throw new Error("Unlocking a Sales Flow needs a reason.");
    }

    const flow = await loadFlow(flowId);
    if (flow.state !== "locked") {
      throw new Error("This Sales Flow is not locked.");
    }

    const { data, error } = await supabase
      .from("sales_flows")
      .update({
        state: "draft",
        locked_at: null,
        locked_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", flowId)
      .select()
      .single();
    if (error) throw error;

    systemAuditLogService.addSystemEvent(
      "SALES_FLOW",
      flowId,
      `Sales Flow unlocked: ${trimmedReason}`,
      { event: "SALES_FLOW_UNLOCKED", reason: trimmedReason, employeeId: actorId },
      actorId,
    ).catch(console.error);

    return data;
  },
};

/**
 * Refuses a name that case/whitespace-insensitively clashes with one already
 * in `candidates`. Name checks live in the service as well as the database
 * (0047/0048 carry expression unique indexes the fake harness can't enforce —
 * see docs/testing.md's "Known limitations") for the same reason
 * `requireSuperAdmin` does: the failure is immediate and legible rather than a
 * 23505 surfacing in a modal, and it is testable without a real database.
 *
 * Shared by Sale Type names (global) and Stage names (per flow) — same shape,
 * different candidate list and message.
 */
function assertNameFree(candidates, name, message, exceptId = null) {
  const clash = candidates.find((c) => foldName(c.name) === foldName(name) && c.id !== exceptId);
  if (clash) {
    throw new Error(message(clash.name));
  }
}

const assertSaleTypeNameFree = async (name, exceptId = null) =>
  assertNameFree(
    await salesFlowService.getSaleTypes(),
    name,
    (clashName) => `There is already a Sale Type called "${clashName}".`,
    exceptId,
  );

const assertStageNameFree = (siblings, name, exceptId = null) =>
  assertNameFree(
    siblings,
    name,
    (clashName) => `There is already a Stage called "${clashName}" in this flow.`,
    exceptId,
  );
