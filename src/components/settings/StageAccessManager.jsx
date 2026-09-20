import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ArrowUpRight, ShieldOff, UserPlus, Users2 } from "lucide-react";

import PeoplePicker from "@/components/ui/PeoplePicker";
import { SELECTOR_TYPES, DEAL_TEAM_ROLES } from "@/utils/resolvePeople";
import { initialsOf, stageAudience } from "@/utils/stageAudience";
import { employeeService } from "@/services/employeeService";
import { employeeGroupService } from "@/services/employeeGroupService";

import { useFlowData } from "./FlowDataContext";
import { actionTitle } from "./flowStageKinds";
import { useAuth } from "../../context/AuthContext";

import { Checkbox } from "@/components/ui/checkbox";
/**
 * A Stage's Access tab (issue #292, part of #208/ADR 0021) — and, since the
 * roster landed, the one screen that answers "who can see this Stage?".
 *
 * It leads with the answer rather than the controls. The call-in roster is
 * derived, never stored: it is whoever this Stage's own actions and Assignment
 * conditions name, resolved to people and paired with how far each window
 * reaches. That is why it cannot be edited here — a name is wrong only because
 * the action that produced it is wrong, so the roster says which action to go
 * fix.
 */
export default function StageAccessManager({ stageId, flowId, disabled = false }) {
  const { user } = useAuth();
  const { flowAccess: flowAccessService } = useFlowData();
  const queryClient = useQueryClient();

  const { data: access, isLoading } = useQuery({
    queryKey: ["stageAccess", stageId],
    queryFn: () => flowAccessService.getForStage(stageId),
    enabled: Boolean(stageId),
  });

  return isLoading ? null : (
    <StageAccessForm
      key={stageId}
      access={access}
      stageId={stageId}
      flowId={flowId}
      disabled={disabled}
      flowAccessService={flowAccessService}
      actorId={user?.id}
      queryClient={queryClient}
    />
  );
}

const SectionHeading = ({ icon: Icon, children, count }) => (
  <h3 className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">
    {Icon && <Icon size={11} />}
    {children}
    {count != null && <span className="tabular-nums text-mauve-11">· {count}</span>}
  </h3>
);

/**
 * One called-in person: who they are, and one line per call that named them.
 * Two calls means two windows — the database opens a row per call-in, so
 * collapsing them into one line here would be a lie about the access granted.
 */
const CalledInRow = ({ person }) => (
  <li className="flex gap-2.5 py-2">
    <span className="mt-px flex size-7 shrink-0 items-center justify-center rounded-full bg-violet-a4 text-[10px] font-black text-violet-11">
      {initialsOf(person.name)}
    </span>
    <div className="min-w-0 flex-1">
      <p className="truncate text-xs font-bold text-foreground">{person.name}</p>
      {person.calls.map((call, index) => (
        <p key={index} className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
          <span className="font-semibold text-mauve-11">{call.label}</span> — sees{" "}
          {call.window.reachLabel}
          {call.window.fellBack && (
            <span className="text-amber-11">
              {" "}
              (its chosen end Stage is gone, so it falls back to this Stage only)
            </span>
          )}
        </p>
      ))}
    </div>
  </li>
);

function StageAccessForm({
  access,
  stageId,
  flowId,
  disabled,
  flowAccessService,
  actorId,
  queryClient,
}) {
  const { stageCondition, stageAction, salesFlow } = useFlowData();
  const [shutOutRoles, setShutOutRoles] = useState(new Set(access?.shutOutRoles || []));
  const [excludedGroups, setExcludedGroups] = useState(
    (access?.excludedGroupIds || []).map((id) => ({ type: SELECTOR_TYPES.GROUP, id })),
  );

  // Every read here shares its key with a query the canvas or a sibling tab
  // already runs, so opening this tab costs nothing the panel had not fetched.
  const { data: conditions = [] } = useQuery({
    queryKey: ["stageConditions", stageId],
    queryFn: () => stageCondition.getForStage(stageId),
    enabled: Boolean(stageId),
  });
  const { data: actions = [] } = useQuery({
    queryKey: ["stageActions", stageId],
    queryFn: () => stageAction.getForStage(stageId),
    enabled: Boolean(stageId),
  });
  const { data: rawEmployees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => employeeService.getAllEmployees(),
  });
  const { data: groups = [] } = useQuery({
    queryKey: ["employeeGroups", "all"],
    queryFn: () => employeeGroupService.list({ includeArchived: true }),
  });
  const { data: graph } = useQuery({
    queryKey: ["flowGraphForStage", stageId],
    queryFn: () => salesFlow.getFlowGraphForStage(stageId),
    enabled: Boolean(stageId),
  });
  const { data: flowAccess } = useQuery({
    queryKey: ["flowAccess", flowId],
    queryFn: () => flowAccessService.getForFlow(flowId),
    enabled: Boolean(flowId),
  });

  // resolvePeople reads `sub_department`; the service hands back `subDepartment`.
  const employees = useMemo(
    () => rawEmployees.map((e) => ({ ...e, sub_department: e.subDepartment })),
    [rawEmployees],
  );
  const groupMembersById = useMemo(
    () => Object.fromEntries(groups.map((g) => [g.id, { employeeIds: g.memberIds || [] }])),
    [groups],
  );
  const groupsById = useMemo(
    () => Object.fromEntries(groups.map((g) => [g.id, g])),
    [groups],
  );
  const stageNameById = useMemo(
    () => Object.fromEntries((graph?.stages || []).map((s) => [s.id, s.name])),
    [graph],
  );

  // Draft state, not the saved rows: the roster has to answer for what is on
  // screen right now, or unticking a role would leave the summary stale.
  const audience = useMemo(
    () =>
      stageAudience({
        stageAccess: {
          shutOutRoles: [...shutOutRoles],
          excludedGroupIds: excludedGroups.map((s) => s.id),
        },
        flowAccess,
        conditions,
        actions,
        employees,
        groupMembersById,
        groupsById,
        stageNameById,
        actionLabel: actionTitle,
      }),
    [
      shutOutRoles,
      excludedGroups,
      flowAccess,
      conditions,
      actions,
      employees,
      groupMembersById,
      groupsById,
      stageNameById,
    ],
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["stageAccess", stageId] });
    queryClient.invalidateQueries({ queryKey: ["stageAccessByStage"] });
    // Same worst-case reasoning as FollowUpCadenceEditor's invalidate: Access
    // is carried in the snapshot but shares no realtime subscription with the
    // publish preview, so an edit could never reach the diff without this.
    queryClient.invalidateQueries({ queryKey: ["flowVersionPreview"] });
    queryClient.invalidateQueries({ queryKey: ["flowDraftSnapshotData"] });
  };

  const saveMutation = useMutation({
    mutationFn: (payload) => flowAccessService.saveForStage(stageId, payload, actorId),
    onSuccess: () => {
      invalidate();
      toast.success("Stage Access saved.");
    },
    onError: (err) => toast.error(err.message),
  });

  const save = (patch) => {
    saveMutation.mutate({
      shutOutRoles: [...shutOutRoles],
      excludedGroupIds: excludedGroups.map((s) => s.id),
      ...patch,
    });
  };

  const toggleRole = (role) => {
    const next = new Set(shutOutRoles);
    if (next.has(role)) next.delete(role);
    else next.add(role);
    setShutOutRoles(next);
    save({ shutOutRoles: [...next] });
  };

  const { counts } = audience;

  return (
    <div className="space-y-6 p-5">
      {/* The answer, before any control that changes it. */}
      <section className="space-y-1">
        <SectionHeading>Who can see this Stage</SectionHeading>
        <p className="text-sm font-bold leading-snug text-foreground">
          {counts.seeingRoles} of {audience.dealTeam.length} Deal Team roles
          {counts.calledIn > 0 ? `, plus ${counts.calledIn} called in here` : ", and nobody else"}
          {audience.alwaysSees.length > 0 && `, plus ${audience.alwaysSees.length} who always see`}.
        </p>
        {counts.shutOutRoles + counts.shutOutPeople > 0 && (
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-11">
            <ShieldOff size={11} />
            Restricted Stage — {counts.shutOutRoles} role
            {counts.shutOutRoles === 1 ? "" : "s"} and {counts.shutOutPeople} more{" "}
            {counts.shutOutPeople === 1 ? "person is" : "people are"} shut out.
          </p>
        )}
      </section>

      <section className="space-y-1">
        <SectionHeading icon={UserPlus} count={counts.calledIn || null}>
          Called in here
        </SectionHeading>
        {audience.calledIn.length > 0 ? (
          <ul className="divide-y divide-mauve-a4">
            {audience.calledIn.map((person) => (
              <CalledInRow key={person.employeeId} person={person} />
            ))}
          </ul>
        ) : (
          <div className="rounded-xl border border-dashed border-mauve-7 px-4 py-5 text-center">
            <p className="text-xs font-bold text-foreground">Nobody is called in here</p>
            <p className="mx-auto mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Only the Deal Team sees this Stage. A Group Task, an Individual Task, or an
              Assignment condition on this Stage is what brings anyone else in.
            </p>
          </div>
        )}
      </section>

      <section className="space-y-2.5">
        <SectionHeading icon={ShieldOff}>Deal Team roles</SectionHeading>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Untick a role to shut it out of this Stage. Ticked roles keep seeing it.
        </p>
        <div className="space-y-1.5">
          {Object.entries(DEAL_TEAM_ROLES).map(([role, meta]) => (
            <label
              key={role}
              className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
            >
              <Checkbox
                checked={!shutOutRoles.has(role)}
                disabled={disabled}
                onCheckedChange={() => toggleRole(role)}
              />
              <span className={shutOutRoles.has(role) ? "text-muted-foreground line-through" : ""}>
                {meta.label}
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-2.5">
        <SectionHeading icon={Users2}>Excluded Employee Groups</SectionHeading>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Everyone in a picked group is shut out of this Stage.
        </p>
        <PeoplePicker
          value={excludedGroups}
          onChange={(next) => {
            setExcludedGroups(next);
            save({ excludedGroupIds: next.map((s) => s.id) });
          }}
          types={[SELECTOR_TYPES.GROUP]}
          disabled={disabled}
          placeholder="Add group"
        />
        {audience.shutOutGroups.length > 0 && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {audience.shutOutGroups
              .map((group) => `${group.name} (${group.memberCount})`)
              .join(", ")}{" "}
            cannot see this Stage.
          </p>
        )}
      </section>

      {/* Inherited, not editable here — otherwise the same list would appear
          to be per-Stage on every Stage that shows it. */}
      <section className="space-y-1.5 border-t border-mauve-5 pt-5">
        <SectionHeading icon={ArrowUpRight}>Always sees, from the Sales Flow</SectionHeading>
        {audience.alwaysSees.length > 0 ? (
          <p className="text-xs leading-relaxed text-foreground">
            {audience.alwaysSees.map((entry) => entry.label).join(", ")} see every SOR of this Sale
            Type, including this Stage.
          </p>
        ) : (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Nobody. Set it in Access settings on the canvas toolbar, where it applies to every
            Stage at once.
          </p>
        )}
      </section>
    </div>
  );
}
