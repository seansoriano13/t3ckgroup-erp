import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ShieldOff, Users2 } from "lucide-react";

import PeoplePicker from "@/components/ui/PeoplePicker";
import { SELECTOR_TYPES, DEAL_TEAM_ROLES } from "@/utils/resolvePeople";

import { useFlowData } from "./FlowDataContext";
import { useAuth } from "../../context/AuthContext";

/**
 * A Stage's Access tab (issue #292, part of #208/ADR 0021): untick Deal Team
 * roles and pick Employee Groups to shut out of this Stage, plus a read-only
 * list of everyone called in — empty until call-in data lands in a later
 * ticket. Configuration only: nothing here enforces the access yet.
 */
export default function StageAccessManager({ stageId, disabled = false }) {
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
      disabled={disabled}
      flowAccessService={flowAccessService}
      actorId={user?.id}
      queryClient={queryClient}
    />
  );
}

function StageAccessForm({ access, stageId, disabled, flowAccessService, actorId, queryClient }) {
  const [shutOutRoles, setShutOutRoles] = useState(new Set(access?.shutOutRoles || []));
  const [excludedGroups, setExcludedGroups] = useState(
    (access?.excludedGroupIds || []).map((id) => ({ type: SELECTOR_TYPES.GROUP, id })),
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["stageAccess", stageId] });
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
    const next = {
      shutOutRoles: [...shutOutRoles],
      excludedGroupIds: excludedGroups.map((s) => s.id),
      ...patch,
    };
    saveMutation.mutate(next);
  };

  const toggleRole = (role) => {
    const next = new Set(shutOutRoles);
    if (next.has(role)) next.delete(role);
    else next.add(role);
    setShutOutRoles(next);
    save({ shutOutRoles: [...next] });
  };

  return (
    <div className="space-y-5 p-5">
      <section className="space-y-2.5">
        <h3 className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">
          <ShieldOff size={11} /> Deal Team roles
        </h3>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Untick a role to shut it out of this Stage. Ticked roles keep seeing it.
        </p>
        <div className="space-y-1.5">
          {Object.entries(DEAL_TEAM_ROLES).map(([role, meta]) => (
            <label
              key={role}
              className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
            >
              <input
                type="checkbox"
                checked={!shutOutRoles.has(role)}
                disabled={disabled}
                onChange={() => toggleRole(role)}
                className="size-4 rounded border-mauve-7"
              />
              {meta.label}
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-2.5">
        <h3 className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">
          <Users2 size={11} /> Excluded Employee Groups
        </h3>
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
      </section>

      <section className="space-y-2.5">
        <h3 className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">
          Called in at this Stage
        </h3>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Nobody has been called in yet — call-in data lands in a later ticket.
        </p>
      </section>
    </div>
  );
}
