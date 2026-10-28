import { useMemo, useState } from "react";
import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import toast from "react-hot-toast";

import ProtectedRoute from "@/components/ProtectedRoute.jsx";
import PageShell from "@/components/ui/PageShell";
import PeoplePicker from "@/components/ui/PeoplePicker";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldBox } from "@/components/ui/FieldBox";
import { Button } from "@/components/ui/button";
import { SELECTOR_TYPES, DEAL_TEAM_ROLES } from "@/utils/resolvePeople";
import { canvasAccessLens } from "@/utils/canvasAccessLens";
import { salesFlowService } from "@/services/salesFlowService";
import { flowAccessService } from "@/services/flowAccessService";
import { employeeService } from "@/services/employeeService";
import { employeeGroupService } from "@/services/employeeGroupService";
import { useAuth } from "@/context/AuthContext";

const NO_ROWS = [];
const LENS_LABEL = {
  hidden: "Hidden",
  "calls-in": "Called in",
  "deal-team": "Full access",
  "can-edit": "Can edit",
  "view-only": "View only",
  visible: "",
};

const Label = ({ children }) => (
  <p className="text-label font-black uppercase tracking-[0.16em] text-muted-foreground">{children}</p>
);

/** Refresh every cache the canvas reads the same settings from, so an edit here shows there. */
function useInvalidateAccess() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of [
      "flowAccess",
      "stageAccess",
      "stageAccessByStage",
      "flowVersionPreview",
      "flowDraftSnapshotData",
    ]) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  };
}

function StageRow({ stage, access, lensState, onSave }) {
  const shutOut = new Set(access?.shutOutRoles || []);
  const excluded = (access?.excludedGroupIds || []).map((id) => ({ type: SELECTOR_TYPES.GROUP, id }));
  const save = (patch) =>
    onSave(stage.id, {
      shutOutRoles: [...shutOut],
      excludedGroupIds: excluded.map((s) => s.id),
      ...patch,
    });

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-bold text-foreground">{stage.name}</span>
        {lensState && lensState !== "visible" && (
          <span className="rounded-md bg-mauve-3 px-1.5 py-0.5 text-[10.5px] font-semibold text-mauve-11">
            {LENS_LABEL[lensState]}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {Object.entries(DEAL_TEAM_ROLES).map(([role, meta]) => (
          <FieldBox inline key={role} className="flex items-center gap-1.5 text-xs">
            <Checkbox
              checked={!shutOut.has(role)}
              onCheckedChange={(checked) => {
                const next = new Set(shutOut);
                if (checked) next.delete(role);
                else next.add(role);
                save({ shutOutRoles: [...next] });
              }}
            />
            <span className={shutOut.has(role) ? "text-muted-foreground line-through" : ""}>
              {meta.label}
            </span>
          </FieldBox>
        ))}
      </div>
      <PeoplePicker
        value={excluded}
        onChange={(next) =>
          save({
            excludedGroupIds: next.filter((s) => s.type === SELECTOR_TYPES.GROUP).map((s) => s.id),
          })
        }
        placeholder="Shut out an Employee Group"
      />
    </li>
  );
}

function FlowCard({ saleType, flowData, flowAccess, stageAccess, viewAs, employees, groupMembersById }) {
  const { user } = useAuth();
  const invalidate = useInvalidateAccess();
  const flow = flowData?.flow;
  const stages = flowData?.stages || NO_ROWS;
  const alwaysSees = flowAccess?.alwaysSees || NO_ROWS;
  const alwaysEdits = flowAccess?.alwaysEdits || NO_ROWS;

  const flowMutation = useMutation({
    mutationFn: (payload) => flowAccessService.saveForFlow(flow.id, payload, user?.id),
    onSuccess: () => {
      invalidate();
      toast.success("Access settings saved.");
    },
    onError: (err) => toast.error(err.message),
  });
  const stageMutation = useMutation({
    mutationFn: ({ stageId, payload }) => flowAccessService.saveForStage(stageId, payload, user?.id),
    onSuccess: () => {
      invalidate();
      toast.success("Stage access saved.");
    },
    onError: (err) => toast.error(err.message),
  });

  // Called-in people come from each Stage's own actions and conditions, which
  // this page does not load; the canvas's View as shows those.
  const lens = useMemo(
    () =>
      canvasAccessLens({
        snapshotLikeDraft: {
          stages: stages.map((s) => ({
            id: s.id,
            shutOutRoles: stageAccess?.[s.id]?.shutOutRoles || [],
            excludedGroupIds: stageAccess?.[s.id]?.excludedGroupIds || [],
            calledIn: [],
          })),
          employees,
          groupMembersById,
          alwaysSees,
          alwaysEdits,
        },
        selector: viewAs,
      }),
    [stages, stageAccess, employees, groupMembersById, alwaysSees, alwaysEdits, viewAs],
  );

  const saveFlow = (patch) =>
    flowMutation.mutate({
      alwaysSees,
      alwaysEdits,
      journeyViewers: flowAccess?.journeyViewers ?? null,
      ...patch,
    });

  if (!flow) {
    return (
      <section className="rounded-2xl border border-border p-4">
        <h2 className="text-sm font-black">{saleType.name}</h2>
        <p className="mt-1 text-xs text-muted-foreground">This Sale Type has no flow yet.</p>
      </section>
    );
  }

  return (
    <section className="flex min-w-[22rem] flex-1 flex-col gap-4 rounded-2xl border border-border p-4">
      <h2 className="text-sm font-black">{saleType.name}</h2>
      <div className="space-y-1.5">
        <Label>Always sees</Label>
        <PeoplePicker
          value={alwaysSees}
          onChange={(next) => saveFlow({ alwaysSees: next })}
          allowRoles
          allowEveryone
          allowDepartments
          placeholder="Add people"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Always edits</Label>
        <PeoplePicker
          value={alwaysEdits}
          onChange={(next) => saveFlow({ alwaysEdits: next })}
          allowRoles
          allowEveryone
          allowDepartments
          placeholder="Add people"
        />
      </div>
      <div className="space-y-1">
        <Label>Restricted Stages</Label>
        <ul className="divide-y divide-border">
          {stages.map((stage) => (
            <StageRow
              key={stage.id}
              stage={stage}
              access={stageAccess?.[stage.id]}
              lensState={viewAs ? lens[stage.id] : null}
              onSave={(stageId, payload) => stageMutation.mutate({ stageId, payload })}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

function FlowAccessOverview() {
  const [viewAs, setViewAs] = useState(null);

  const { data: saleTypes = NO_ROWS } = useQuery({
    queryKey: ["saleTypes"],
    queryFn: () => salesFlowService.getSaleTypes(),
  });
  const flowQueries = useQueries({
    queries: saleTypes.map((st) => ({
      queryKey: ["salesFlow", st.id],
      queryFn: () => salesFlowService.getFlow(st.id),
    })),
  });
  const flowIds = flowQueries.map((q) => q.data?.flow?.id).filter(Boolean);
  const stageIds = flowQueries.flatMap((q) => (q.data?.stages || []).map((s) => s.id));

  // Same keys the canvas uses, so a save on either side refreshes both.
  const accessQueries = useQueries({
    queries: flowIds.map((id) => ({
      queryKey: ["flowAccess", id],
      queryFn: () => flowAccessService.getForFlow(id),
    })),
  });
  const accessByFlow = Object.fromEntries(flowIds.map((id, i) => [id, accessQueries[i]?.data]));
  const { data: stageAccess = {} } = useQuery({
    queryKey: ["stageAccessByStage", "all", stageIds.join(",")],
    queryFn: () => flowAccessService.getForStages(stageIds),
    enabled: stageIds.length > 0,
  });
  const { data: employees = NO_ROWS } = useQuery({
    queryKey: ["employees"],
    queryFn: () => employeeService.getAllEmployees(),
  });
  const { data: groups = NO_ROWS } = useQuery({
    queryKey: ["employeeGroups", "all"],
    queryFn: () => employeeGroupService.list({ includeArchived: true }),
  });
  const groupMembersById = useMemo(
    () => Object.fromEntries(groups.map((g) => [g.id, { employeeIds: g.memberIds || [] }])),
    [groups],
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex max-w-md items-center gap-2">
        <Eye size={14} className="shrink-0 text-muted-foreground" />
        <div className="flex-1">
          <PeoplePicker
            value={viewAs ? [viewAs] : []}
            onChange={(next) => setViewAs(next[next.length - 1] || null)}
            allowRoles
            placeholder="View as a role, group, or person"
          />
        </div>
        {viewAs && (
          <Button variant="ghost" size="sm" onClick={() => setViewAs(null)}>
            Clear
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-start gap-4">
        {saleTypes.map((st, i) => (
          <FlowCard
            key={st.id}
            saleType={st}
            flowData={flowQueries[i]?.data}
            flowAccess={accessByFlow[flowQueries[i]?.data?.flow?.id]}
            stageAccess={stageAccess}
            viewAs={viewAs}
            employees={employees}
            groupMembersById={groupMembersById}
          />
        ))}
      </div>
    </div>
  );
}

export default function FlowAccessPage() {
  return (
    <ProtectedRoute requireSuperAdmin>
      <PageShell
        title="Flow Access"
        description="Every Sales Flow's Always sees, Always edits and Restricted Stages in one place. Edits here are the same settings as the Flow Canvas."
      >
        <FlowAccessOverview />
      </PageShell>
    </ProtectedRoute>
  );
}
