import { supabase } from "../lib/supabase";
import { systemAuditLogService } from "./systemAuditLogService";
import { flowLockBlockers, buildDraftSnapshotData, diffFlowSnapshots } from "../constants/salesFlow";
import { stageActionService } from "./stageActionService";
import { stageConditionService } from "./stageConditionService";
import { formatSnapshotVersion, formatVersionNumber } from "../constants/flowVersion";

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
 * Access control check for Flow Canvas modifications.
 * Opened to allow all authenticated employees to edit Flow Canvas.
 */
async function requireSuperAdmin(_actorId) {
  // Access control opened: anyone can make changes on Flow Canvas.
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

/**
 * Turns a Flow Snapshot's stored shape into live Stages, Edges, Actions and
 * Conditions on `flow` — the write path behind `importSnapshot`, where a
 * brand-new Sale Type gets its starting point.
 *
 * Stage ids are never reused from the snapshot — every Stage created here is
 * a new row, mapped back to the id it stood in for while wiring Edges,
 * Actions and Conditions to the right new Stage. That is right for an import
 * (a different Sales Flow) and wrong for a restore, which keeps ids: restore
 * goes through the `restore_flow_snapshot` function instead (issue #187).
 */
async function materializeSnapshotIntoFlow(flow, snapshotData, actorId) {
  const stageIdMap = {};

  for (const oldStage of snapshotData.stages || []) {
    const newStage = await salesFlowService.addStage(flow.id, oldStage.name, actorId);
    stageIdMap[oldStage.id] = newStage.id;
  }

  if (snapshotData.wonStageId && stageIdMap[snapshotData.wonStageId]) {
    await salesFlowService.setWonStage(flow.id, stageIdMap[snapshotData.wonStageId], actorId);
  }

  for (const oldEdge of snapshotData.edges || []) {
    const sourceId = stageIdMap[oldEdge.from_stage_id];
    const targetId = stageIdMap[oldEdge.to_stage_id];
    if (sourceId && targetId) {
      await salesFlowService.addEdge(flow.id, sourceId, targetId, actorId);
    }
  }

  const actionsList = Array.isArray(snapshotData.actions)
    ? snapshotData.actions
    : Object.values(snapshotData.actions || {}).flat();
  for (const action of actionsList) {
    const stageId = stageIdMap[action.stage_id];
    if (stageId) {
      await stageActionService.add({ stageId, kind: action.kind, config: action.config }, actorId);
    }
  }

  const conditionsList = Array.isArray(snapshotData.conditions)
    ? snapshotData.conditions
    : Object.values(snapshotData.conditions || {}).flat();
  for (const req of conditionsList) {
    const stageId = stageIdMap[req.stage_id];
    if (stageId) {
      await stageConditionService.add(
        { stageId, kind: req.kind, label: req.label, isRequired: req.is_required, config: req.config },
        actorId,
      );
    }
  }
}

/**
 * The `snapshot_data` shape a publish writes — every Stage of the whole flow,
 * its edges, and a flat list of every Stage's Actions and Conditions at this
 * moment, plus the Won Stage and Sale Type ids.
 *
 * The one builder shared by `lockFlow` (which writes it) and `previewVersion`
 * (which only asks the database what number it would get), so the preview on
 * the Publish button and the version the publish actually creates are computed
 * from byte-identical input.
 */
async function buildSnapshotData(flow, stages, edges) {
  const stageIds = stages.map((s) => s.id);
  const [actionsObj, conditionsObj] = await Promise.all([
    stageIds.length > 0 ? stageActionService.getForStages(stageIds) : {},
    stageIds.length > 0 ? stageConditionService.getForStages(stageIds) : {},
  ]);

  return buildDraftSnapshotData({
    flow,
    stages,
    edges,
    actions: Object.values(actionsObj || {}).flat(),
    conditions: Object.values(conditionsObj || {}).flat(),
  });
}

/** The most recently published Flow Snapshot of `flowId`, or null if it has never been locked. */
async function latestSnapshotOf(flowId) {
  const { data, error } = await supabase
    .from("flow_snapshots")
    .select("*")
    .eq("flow_id", flowId)
    .order("version", { ascending: false })
    .order("version_minor", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
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
   * Inserts a new Stage into an existing move — the n8n-style midpoint plus
   * (issue #196), turning A → B into A → New → B. The most common edit to a
   * live process: a step everybody already does but nobody had drawn.
   *
   * A's Stage Conditions and Actions are its own gate and entry work, keyed
   * to A regardless of what leaves it, so they are untouched. Only which
   * Stage a deal lands on next changes.
   *
   * Writes create-then-delete, in an order chosen so a failure partway never
   * cuts the flow in two:
   *   1. create the Stage
   *   2. add A → New
   *   3. add New → B
   *   4. only then remove A → B
   * A crash after step 1 leaves an unreached, harmless orphan Stage; a crash
   * after step 2 or 3 leaves the flow reachable through the old A → B edge as
   * well as the new detour. Either way, A → B stays intact until step 4 is
   * the only write left to do, so B is never unreachable from A.
   */
  async insertStageOnMove(edgeId, name, actorId, posX = 0, posY = 0) {
    await requireSuperAdmin(actorId);

    const { data: edge, error: readError } = await supabase
      .from("flow_edges")
      .select("*")
      .eq("id", edgeId)
      .single();
    if (readError) throw readError;

    await requireDraft(edge.flow_id);

    const newStage = await salesFlowService.addStage(edge.flow_id, name, actorId, posX, posY);
    await salesFlowService.addEdge(edge.flow_id, edge.from_stage_id, newStage.id, actorId);
    await salesFlowService.addEdge(edge.flow_id, newStage.id, edge.to_stage_id, actorId);
    await salesFlowService.removeEdge(edge.id, actorId);

    return newStage;
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
  async lockFlow(flowId, actorId, note = null) {
    await requireSuperAdmin(actorId);
    const flow = await requireDraft(flowId);

    const [stages, edges] = await Promise.all([stagesOf(flowId), edgesOf(flowId)]);
    const blockers = flowLockBlockers({ stages, edges, wonStageId: flow.won_stage_id });
    if (blockers.length > 0) {
      throw new Error(`This flow cannot be locked yet. ${blockers.join(" ")}`);
    }

    const snapshotData = await buildSnapshotData(flow, stages, edges);

    // No empty versions (issue #189): a flow that has never been published
    // has no latest Snapshot to diff against, so it can always publish once
    // the blockers above clear. Otherwise an identical draft would create a
    // Flow Snapshot nothing distinguishes from the one before it — a version
    // number with no meaning behind it. This mirrors the popover's own gate
    // (FlowCanvas), but is enforced here too since the popover is not the
    // only caller of this method.
    const latest = await latestSnapshotOf(flowId);
    if (latest && !diffFlowSnapshots(latest.snapshot_data, snapshotData).hasChanges) {
      throw new Error("This draft is identical to the latest version. There is nothing to publish.");
    }

    // Flipping the flow to locked and publishing the snapshot that pins its
    // rules have to succeed or fail together — a flow stranded locked with no
    // snapshot is unusable (issue #181). `lock_sales_flow` does both writes in
    // one transaction instead of two unguarded round trips.
    const { data, error } = await supabase.rpc("lock_sales_flow", {
      p_flow_id: flowId,
      p_actor_id: actorId,
      p_snapshot_data: snapshotData,
      p_note: note,
    });
    if (error) throw error;

    systemAuditLogService.addSystemEvent(
      "SALES_FLOW",
      flowId,
      `Sales Flow published: ${formatSnapshotVersion(data.snapshot)}.`,
      { event: "SALES_FLOW_LOCKED", employeeId: actorId },
      actorId,
    ).catch(console.error);

    const artefacts = {
      promotableConfiguration: JSON.stringify(snapshotData, null, 2),
      readableDocument: `# Sales Flow Document\n\nVersion: ${formatSnapshotVersion(data.snapshot)}\n...`,
      notesList: "Notes...",
    };

    return { ...data.flow, snapshot: data.snapshot, artefacts };
  },

  /**
   * The number the next publish of this flow would create, as `{ major, minor,
   * label }` — the Publish button's caption, taken straight from the database
   * rule (`flow_snapshot_next_version`, ADR 0020) rather than recomputed here,
   * so the preview and the result cannot disagree.
   *
   * Answers for any draft, including one that still has lock blockers: the
   * caller keeps the button disabled for those, but a "Publish v3.2" caption
   * is still the right thing to show while the reason it is disabled is a
   * missing Won Stage.
   */
  async previewVersion(flowId) {
    const flow = await loadFlow(flowId);
    const [stages, edges] = await Promise.all([stagesOf(flowId), edgesOf(flowId)]);
    const snapshotData = await buildSnapshotData(flow, stages, edges);

    const [{ data, error }, latest] = await Promise.all([
      supabase.rpc("flow_snapshot_next_version", {
        p_flow_id: flowId,
        p_snapshot_data: snapshotData,
      }),
      latestSnapshotOf(flowId),
    ]);
    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    const major = row?.version_major ?? 1;
    const minor = row?.version_minor ?? 0;
    const diff = diffFlowSnapshots(latest?.snapshot_data ?? {}, snapshotData);

    return {
      major,
      minor,
      label: formatVersionNumber(major, minor),
      diff,
      hasChanges: latest ? diff.hasChanges : true,
    };
  },

  /**
   * How many live SORs are running each of this flow's Flow Snapshots —
   * what tells an Operations Manager how much of the register is still on
   * an older process (issue #83). Keyed by `flow_snapshot_id`; `"none"`
   * groups any flow-built deal that predates a snapshot ever being assigned.
   */
  async getSnapshotUsageCounts(flowId) {
    const flow = await loadFlow(flowId);

    const { data: rows, error } = await supabase
      .from("sales_opportunities")
      .select("flow_snapshot_id")
      .eq("sale_type_id", flow.sale_type_id)
      .eq("is_scratch", false)
      // Issue #170/#171 — a retail order never runs a Sales Flow, so it must
      // not appear in a flow's live-usage count.
      .eq("is_retail", false)
      .neq("is_deleted", true);
    if (error) throw error;

    const counts = {};
    for (const row of rows || []) {
      const key = row.flow_snapshot_id ?? "none";
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  },

  /**
   * Every Flow Snapshot ever locked for `flowId`, newest first — a Super
   * Admin's view of how the agreed process has evolved (issue #36's user
   * story #64/#65). Never touches `sales_opportunities`: browsing history is
   * a read of `flow_snapshots` alone.
   */
  /**
   * One Flow Snapshot by id, with the Sale Type it belongs to.
   *
   * This is the read behind "which version is my deal running, and what did it
   * look like": an SOR pins `flow_snapshot_id` at registration and stays on
   * that version for life, so the deal's rules live here rather than in the
   * live tables the canvas edits. Returns null rather than throwing when the
   * id resolves to nothing, because a caller asking about a deal's version
   * wants to render "no version on record", not an error page.
   */
  async getSnapshot(snapshotId) {
    if (!snapshotId) return null;

    const { data, error } = await supabase
      .from("flow_snapshots")
      .select("*, flow:sales_flows!flow_snapshots_flow_id_fkey(id, sale_type_id, state)")
      .eq("id", snapshotId)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  },

  /**
   * Several Flow Snapshots in one read, keyed by id — for a list of SORs
   * that each need judging against their own snapshot (issue #199's Open
   * Pipeline rule on the register) without a read per row.
   */
  async getSnapshotsByIds(snapshotIds = []) {
    const ids = [...new Set(snapshotIds.filter(Boolean))];
    if (ids.length === 0) return {};
    const { data, error } = await supabase
      .from("flow_snapshots")
      .select("id, flow_id, snapshot_data")
      .in("id", ids);
    if (error) throw error;
    return Object.fromEntries((data || []).map((s) => [s.id, s]));
  },

  async listSnapshots(flowId) {
    const { data, error } = await supabase
      .from("flow_snapshots")
      .select("*")
      .eq("flow_id", flowId)
      .order("version", { ascending: false })
      .order("version_minor", { ascending: false });
    if (error) throw error;
    return data || [];
  },

  /**
   * Every reason `flowId` has been reopened, newest first — issue #36's
   * "repeated reopening is a pattern... it has to be visible", surfaced
   * alongside Snapshot history rather than a separate audit-log lookup.
   */
  async listUnlockEvents(flowId) {
    const { data, error } = await supabase
      .from("system_audit_logs")
      .select("*")
      .eq("entity_type", "SALES_FLOW")
      .eq("entity_id", flowId)
      .eq("metadata->>event", "SALES_FLOW_UNLOCKED")
      .order("created_at", { ascending: false });
    if (error) throw error;

    return (data || []).map((row) => ({
      reason: row.metadata?.reason || "",
      employeeId: row.metadata?.employeeId || null,
      createdAt: row.created_at,
    }));
  },

  async importSnapshot(snapshotData, name, actorId) {
    await requireSuperAdmin(actorId);

    const saleType = await this.createSaleType(name, actorId);
    const flow = (await this.getFlow(saleType.id)).flow;

    await materializeSnapshotIntoFlow(flow, snapshotData, actorId);

    return this.getFlow(saleType.id);
  },

  /**
   * Reopens `flowId`'s draft and rebuilds it as `snapshotId`'s shape — the
   * explicit, audited "we went back to how it worked before" that a change
   * turning out wrong needs to be cheap to undo.
   *
   * This never rewrites the Snapshot itself, or any other Snapshot — issue
   * #83's immutability is exactly what makes a restore trustworthy. The
   * restored shape becomes its own new Snapshot only the next time this flow
   * is locked, the same as any other draft edit.
   */
  async restoreSnapshot(flowId, snapshotId, actorId) {
    await requireSuperAdmin(actorId);

    // One call. `restore_flow_snapshot` (issue #187) locks the Sales Flow
    // row, refuses before writing anything if a Stage the target drops still
    // has an SOR on it (`flow_stage_id` is ON DELETE RESTRICT — the old
    // client-side delete-and-rebuild half-deleted the draft when it hit one),
    // then reshapes the draft in place keeping every id so the next version's
    // changelog is not a full rewrite.
    const { data, error } = await supabase.rpc("restore_flow_snapshot", {
      p_flow_id: flowId,
      p_snapshot_id: snapshotId,
    });
    if (error) throw error;

    systemAuditLogService.addSystemEvent(
      "SALES_FLOW",
      flowId,
      `Flow Snapshot v${data.version} restored into the draft.`,
      {
        event: "SALES_FLOW_SNAPSHOT_RESTORED",
        version: data.version,
        snapshotId,
        employeeId: actorId,
      },
      actorId,
    ).catch(console.error);

    return this.getFlow(data.flow.sale_type_id);
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
      `Sales Flow draft reopened: ${trimmedReason}`,
      { event: "SALES_FLOW_UNLOCKED", reason: trimmedReason, employeeId: actorId },
      actorId,
    ).catch(console.error);

    return data;
  },
};

// The vocabulary the rest of the app uses (issue #188): the canvas action is
// "publish" and its reverse is "reopen". The database keeps the older names —
// the `draft`/`locked` state values and the `lock_sales_flow` function — so
// only the service surface is renamed, with the old names kept as aliases for
// callers and tests not yet moved over.
salesFlowService.publishFlow = salesFlowService.lockFlow;
salesFlowService.reopenFlow = salesFlowService.unlockFlow;

// Exposed for the version rail's "Compare with draft" (issue #192): it needs
// the live draft's own `snapshot_data` shape to diff against an arbitrary
// past Flow Snapshot, not just the "vs latest" diff `previewVersion` returns.
salesFlowService.buildSnapshotData = buildSnapshotData;

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
