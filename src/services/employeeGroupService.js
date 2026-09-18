import { supabase } from "../lib/supabase";
import { systemAuditLogService } from "./systemAuditLogService";
import { normaliseTeam, resolveGroupMemberIds } from "../utils/resolvePeople";

/**
 * Issue #201 — Employee Groups, managed once in Settings and pointed at by
 * every Sales Flow setting that asks "who".
 *
 * Every write is Super-Admin-only. RLS enforces that at the database
 * (20260915010000_employee_groups.sql); this service refuses first so the
 * person sees why instead of a policy error. Groups decide who sees SOR data
 * (ADR 0021), so every change is audit-logged.
 */

const ENTITY = "EMPLOYEE_GROUP";

async function requireSuperAdmin(actorId) {
  if (!actorId) throw new Error("Only a Super Admin can change Employee Groups.");
  const { data, error } = await supabase
    .from("employees")
    .select("is_super_admin")
    .eq("id", actorId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.is_super_admin) {
    throw new Error("Only a Super Admin can change Employee Groups.");
  }
}

function audit(groupId, content, metadata, actorId) {
  systemAuditLogService.addSystemEvent(ENTITY, groupId, content, { ...metadata, employeeId: actorId }, actorId);
}

async function readEmployees() {
  const { data, error } = await supabase
    .from("employees")
    .select("id, name, sub_department, department, avatar_path, is_deleted");
  if (error) throw error;
  return data || [];
}

async function readMembership(groupIds) {
  if (groupIds.length === 0) return { members: [], teams: [] };
  const [members, teams] = await Promise.all([
    supabase.from("employee_group_members").select("group_id, employee_id").in("group_id", groupIds),
    supabase.from("employee_group_teams").select("group_id, team").in("group_id", groupIds),
  ]);
  if (members.error) throw members.error;
  if (teams.error) throw teams.error;
  return { members: members.data || [], teams: teams.data || [] };
}

/** A group row plus what it is made of and who that means today. */
function shape(group, membership, employees) {
  const employeeIds = membership.members.filter((m) => m.group_id === group.id).map((m) => m.employee_id);
  const teams = membership.teams
    .filter((t) => t.group_id === group.id)
    .map((t) => t.team)
    .sort();
  const memberIds = resolveGroupMemberIds({ employeeIds, teams }, employees);
  const byId = new Map(employees.map((e) => [e.id, e]));
  return {
    ...group,
    employeeIds,
    teams,
    memberIds,
    members: memberIds.map((id) => byId.get(id)).filter(Boolean),
  };
}

async function requireGroup(id) {
  const { data, error } = await supabase.from("employee_groups").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("That Employee Group no longer exists.");
  return data;
}

/** Refuses a name another active group already holds, case-insensitively. */
async function requireFreeName(name, exceptId = null) {
  const { data, error } = await supabase.from("employee_groups").select("id, name").is("archived_at", null);
  if (error) throw error;
  const wanted = name.trim().toLowerCase();
  const clash = (data || []).find((g) => g.id !== exceptId && g.name.trim().toLowerCase() === wanted);
  if (clash) throw new Error(`An active Employee Group is already called "${clash.name}".`);
}

function cleanName(name) {
  const trimmed = (name || "").trim();
  if (!trimmed) throw new Error("An Employee Group needs a name.");
  return trimmed;
}

const touch = (id) =>
  supabase.from("employee_groups").update({ updated_at: new Date().toISOString() }).eq("id", id);

/**
 * The Sale Types whose Sales Flow, live or published, mentions this group
 * anywhere. A text search over the JSON columns is acceptable because deletion
 * is rare (issue #201).
 */
async function saleTypesUsingGroup(groupId) {
  const needle = String(groupId);
  const mentions = (value) => JSON.stringify(value ?? null).includes(needle);

  const [conditions, actions, snapshots, flows] = await Promise.all([
    supabase.from("stage_conditions").select("stage_id, config"),
    supabase.from("flow_stage_actions").select("stage_id, config"),
    supabase.from("flow_snapshots").select("flow_id, snapshot_data"),
    supabase.from("sales_flows").select("*"),
  ]);
  for (const result of [conditions, actions, snapshots, flows]) {
    if (result.error) throw result.error;
  }

  const stageIds = new Set(
    [...conditions.data, ...actions.data].filter((row) => mentions(row.config)).map((row) => row.stage_id),
  );
  const flowIds = new Set(snapshots.data.filter((s) => mentions(s.snapshot_data)).map((s) => s.flow_id));
  // Flow-level "who" settings (Always sees, Journey access…) live on the
  // flow row itself in later specs; the whole row is searched so they are
  // covered the day they land.
  for (const flow of flows.data) {
    if (mentions({ ...flow, id: null, sale_type_id: null })) flowIds.add(flow.id);
  }

  if (stageIds.size > 0) {
    const { data: stages, error } = await supabase
      .from("flow_stages")
      .select("id, flow_id")
      .in("id", [...stageIds]);
    if (error) throw error;
    for (const stage of stages || []) flowIds.add(stage.flow_id);
  }
  if (flowIds.size === 0) return [];

  const saleTypeIds = [
    ...new Set(flows.data.filter((f) => flowIds.has(f.id)).map((f) => f.sale_type_id).filter(Boolean)),
  ];
  if (saleTypeIds.length === 0) return [];
  const { data: saleTypes, error } = await supabase.from("sale_types").select("id, name").in("id", saleTypeIds);
  if (error) throw error;
  return (saleTypes || []).map((t) => t.name).sort();
}

export const employeeGroupService = {
  /** Every group with its members resolved. Archived groups only when asked — pickers never ask. */
  async list({ includeArchived = false } = {}) {
    let query = supabase.from("employee_groups").select("*").order("name", { ascending: true });
    if (!includeArchived) query = query.is("archived_at", null);
    const { data: groups, error } = await query;
    if (error) throw error;
    if (!groups || groups.length === 0) return [];

    const [membership, employees] = await Promise.all([
      readMembership(groups.map((g) => g.id)),
      readEmployees(),
    ]);
    return groups.map((g) => shape(g, membership, employees));
  },

  /** One group, archived or not, with the people it resolves to today. */
  async get(id) {
    const group = await requireGroup(id);
    const [membership, employees] = await Promise.all([readMembership([id]), readEmployees()]);
    return shape(group, membership, employees);
  },

  async create({ name, description = null, employeeIds = [], teams = [] }, actorId) {
    await requireSuperAdmin(actorId);
    const cleanedName = cleanName(name);
    await requireFreeName(cleanedName);

    const { data, error } = await supabase
      .from("employee_groups")
      .insert({ name: cleanedName, description: (description || "").trim() || null, created_by: actorId })
      .select()
      .single();
    if (error) throw error;

    audit(data.id, `Employee Group created: "${cleanedName}".`, { event: "EMPLOYEE_GROUP_CREATED", name: cleanedName }, actorId);

    if (employeeIds.length > 0) await this.setMembers(data.id, employeeIds, actorId);
    if (teams.length > 0) await this.setTeams(data.id, teams, actorId);
    return this.get(data.id);
  },

  /** Renames (and optionally re-describes) a group. Settings point at the id, so nothing using it breaks. */
  async rename(id, { name, description }, actorId) {
    await requireSuperAdmin(actorId);
    const group = await requireGroup(id);
    const cleanedName = cleanName(name);
    if (!group.archived_at) await requireFreeName(cleanedName, id);

    const patch = { name: cleanedName, updated_at: new Date().toISOString() };
    if (description !== undefined) patch.description = (description || "").trim() || null;
    const { error } = await supabase.from("employee_groups").update(patch).eq("id", id);
    if (error) throw error;

    audit(
      id,
      group.name === cleanedName
        ? `Employee Group details updated: "${cleanedName}".`
        : `Employee Group renamed: "${group.name}" → "${cleanedName}".`,
      { event: "EMPLOYEE_GROUP_RENAMED", from: group.name, to: cleanedName },
      actorId,
    );
    return this.get(id);
  },

  /** Replaces the hand-picked members with exactly this list. */
  async setMembers(id, employeeIds, actorId) {
    await requireSuperAdmin(actorId);
    await requireGroup(id);
    const wanted = [...new Set((employeeIds || []).filter(Boolean).map(String))];

    const { data: current, error } = await supabase
      .from("employee_group_members")
      .select("id, employee_id")
      .eq("group_id", id);
    if (error) throw error;

    const have = new Set(current.map((m) => String(m.employee_id)));
    const removed = current.filter((m) => !wanted.includes(String(m.employee_id)));
    const added = wanted.filter((employeeId) => !have.has(employeeId));

    if (removed.length > 0) {
      const { error: deleteError } = await supabase
        .from("employee_group_members")
        .delete()
        .in("id", removed.map((m) => m.id));
      if (deleteError) throw deleteError;
    }
    if (added.length > 0) {
      const { error: insertError } = await supabase
        .from("employee_group_members")
        .insert(added.map((employeeId) => ({ group_id: id, employee_id: employeeId, added_by: actorId })));
      if (insertError) throw insertError;
    }

    if (removed.length > 0 || added.length > 0) {
      await touch(id);
      audit(
        id,
        `Employee Group members changed: ${added.length} added, ${removed.length} removed.`,
        { event: "EMPLOYEE_GROUP_MEMBERS_CHANGED", added, removed: removed.map((m) => m.employee_id) },
        actorId,
      );
    }
    return this.get(id);
  },

  /** Replaces the whole Teams with exactly this list, matched the way the database matches them. */
  async setTeams(id, teams, actorId) {
    await requireSuperAdmin(actorId);
    await requireGroup(id);
    const wanted = [...new Set((teams || []).map(normaliseTeam).filter(Boolean))];

    const { data: current, error } = await supabase
      .from("employee_group_teams")
      .select("id, team")
      .eq("group_id", id);
    if (error) throw error;

    const have = new Set(current.map((t) => normaliseTeam(t.team)));
    const removed = current.filter((t) => !wanted.includes(normaliseTeam(t.team)));
    const added = wanted.filter((team) => !have.has(team));

    if (removed.length > 0) {
      const { error: deleteError } = await supabase
        .from("employee_group_teams")
        .delete()
        .in("id", removed.map((t) => t.id));
      if (deleteError) throw deleteError;
    }
    if (added.length > 0) {
      const { error: insertError } = await supabase
        .from("employee_group_teams")
        .insert(added.map((team) => ({ group_id: id, team })));
      if (insertError) throw insertError;
    }

    if (removed.length > 0 || added.length > 0) {
      await touch(id);
      audit(
        id,
        `Employee Group Teams changed: ${wanted.length ? wanted.join(", ") : "none"}.`,
        { event: "EMPLOYEE_GROUP_TEAMS_CHANGED", added, removed: removed.map((t) => t.team) },
        actorId,
      );
    }
    return this.get(id);
  },

  /** Hides a group from pickers. Settings already using it keep resolving it. */
  async archive(id, actorId) {
    await requireSuperAdmin(actorId);
    const group = await requireGroup(id);
    if (group.archived_at) return this.get(id);

    const now = new Date().toISOString();
    const { error } = await supabase.from("employee_groups").update({ archived_at: now, updated_at: now }).eq("id", id);
    if (error) throw error;
    audit(id, `Employee Group archived: "${group.name}".`, { event: "EMPLOYEE_GROUP_ARCHIVED", name: group.name }, actorId);
    return this.get(id);
  },

  async restore(id, actorId) {
    await requireSuperAdmin(actorId);
    const group = await requireGroup(id);
    if (!group.archived_at) return this.get(id);
    await requireFreeName(group.name, id);

    const { error } = await supabase
      .from("employee_groups")
      .update({ archived_at: null, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
    audit(id, `Employee Group restored: "${group.name}".`, { event: "EMPLOYEE_GROUP_RESTORED", name: group.name }, actorId);
    return this.get(id);
  },

  /** The Sale Types that still use a group, live or in a published version. */
  saleTypesUsingGroup,

  /** Deletes a group outright — refused, naming the Sale Types, while anything still uses it. */
  async remove(id, actorId) {
    await requireSuperAdmin(actorId);
    const group = await requireGroup(id);

    const usedBy = await saleTypesUsingGroup(id);
    if (usedBy.length > 0) {
      throw new Error(
        `"${group.name}" is still used by the Sales Flow for ${usedBy.join(", ")}. Remove it there, or archive the group instead.`,
      );
    }

    // The foreign keys cascade; deleting the children first keeps the order
    // explicit rather than leaning on it.
    for (const table of ["employee_group_members", "employee_group_teams"]) {
      const { error: childError } = await supabase.from(table).delete().eq("group_id", id);
      if (childError) throw childError;
    }
    const { error } = await supabase.from("employee_groups").delete().eq("id", id);
    if (error) throw error;
    audit(id, `Employee Group deleted: "${group.name}".`, { event: "EMPLOYEE_GROUP_DELETED", name: group.name }, actorId);
  },
};
