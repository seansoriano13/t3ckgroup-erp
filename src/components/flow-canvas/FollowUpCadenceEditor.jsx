import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import PeoplePicker from "@/components/ui/PeoplePicker";

import { useFlowData } from "./FlowDataContext";
import { useAuth } from "../../context/AuthContext";

/**
 * A Stage's Follow-up Cadence (issue #204 Part 3): on/off, every N days,
 * who gets reminded, and "Proof required". Recipients default to the Deal
 * Owner and use the same PeoplePicker as the Decider field on Optional
 * Actions.
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
  const [recipients, setRecipients] = useState(
    cadence?.recipients?.length ? cadence.recipients : [{ type: "role", role: "deal_owner" }],
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["followUpCadence", stageId] });
    // The worst case of the three: Follow-up Cadence is carried in the
    // snapshot but invalidated nothing shared, and no realtime subscription
    // watches its table either — so a cadence edit could never reach the
    // publish diff without a reload, rather than only sometimes.
    queryClient.invalidateQueries({ queryKey: ["flowVersionPreview"] });
    queryClient.invalidateQueries({ queryKey: ["flowDraftSnapshotData"] });
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
      recipients: recipients.length ? recipients : [{ type: "role", role: "deal_owner" }],
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

          <div className="space-y-1.5">
            <span className="text-xs text-muted-foreground">Recipients</span>
            <PeoplePicker
              value={recipients}
              onChange={(next) => {
                setRecipients(next);
                save({ recipients: next.length ? next : [{ type: "role", role: "deal_owner" }] });
              }}
              allowRoles
              disabled={disabled}
              placeholder="Add recipient"
            />
          </div>
        </>
      )}
    </section>
  );
}
