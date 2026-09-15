import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import { useFlowData } from "./FlowDataContext";
import { useAuth } from "../../context/AuthContext";

/**
 * A Stage's Follow-up Cadence (issue #204 Part 3), kept deliberately simple:
 * on/off, every N days, and "Proof required". Recipients default to the
 * Deal Owner — a fuller people-picker (matching the Decider picker built for
 * Part 2's Optional Actions) is left for follow-up work; this keeps the
 * cadence usable without building a second selector UI.
 */
export default function FollowUpCadenceEditor({ stageId, disabled = false }) {
  const { user } = useAuth();
  const { followUp: followUpService } = useFlowData();
  const queryClient = useQueryClient();

  const { data: cadence, isLoading } = useQuery({
    queryKey: ["followUpCadence", stageId],
    queryFn: () => followUpService.getForStage(stageId),
    enabled: Boolean(stageId),
  });

  return isLoading ? null : (
    <FollowUpCadenceForm
      key={stageId}
      cadence={cadence}
      stageId={stageId}
      disabled={disabled}
      followUpService={followUpService}
      actorId={user?.id}
      queryClient={queryClient}
    />
  );
}

function FollowUpCadenceForm({ cadence, stageId, disabled, followUpService, actorId, queryClient }) {
  const [enabled, setEnabled] = useState(Boolean(cadence?.enabled));
  const [everyDays, setEveryDays] = useState(String(cadence?.everyDays ?? 7));
  const [proofRequired, setProofRequired] = useState(cadence?.proofRequired !== false);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["followUpCadence", stageId] });
  };

  const saveMutation = useMutation({
    mutationFn: (payload) => followUpService.save(stageId, payload, actorId),
    onSuccess: () => {
      invalidate();
      toast.success("Follow-up Cadence saved.");
    },
    onError: (err) => toast.error(err.message),
  });

  const save = (patch) => {
    const next = {
      enabled,
      everyDays: Number(everyDays) || null,
      recipients: cadence?.recipients?.length ? cadence.recipients : [{ type: "role", role: "deal_owner" }],
      proofRequired,
      ...patch,
    };
    saveMutation.mutate(next);
  };

  return (
    <section className="space-y-3 rounded-md border border-border p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Follow-up Cadence</span>
        <Switch
          checked={enabled}
          disabled={disabled}
          onCheckedChange={(next) => {
            setEnabled(next);
            save({ enabled: next });
          }}
        />
      </div>

      {enabled && (
        <>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Every</span>
            <Input
              type="number"
              min={1}
              className="h-8 w-20 text-sm"
              value={everyDays}
              disabled={disabled}
              onChange={(e) => setEveryDays(e.target.value)}
              onBlur={() => save({ everyDays: Number(everyDays) || null })}
            />
            <span className="text-xs text-muted-foreground">day(s)</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Proof required</span>
            <Switch
              checked={proofRequired}
              disabled={disabled}
              onCheckedChange={(next) => {
                setProofRequired(next);
                save({ proofRequired: next });
              }}
            />
          </div>
        </>
      )}
    </section>
  );
}
