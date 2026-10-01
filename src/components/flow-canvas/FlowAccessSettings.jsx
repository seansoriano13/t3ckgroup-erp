import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import Dropdown from "@/components/ui/Dropdown";
import { Tooltip } from "@/components/ui/Tooltip";
import PeoplePicker from "@/components/ui/PeoplePicker";
import { SELECTOR_TYPES } from "@/utils/resolvePeople";

import { useFlowData } from "./FlowDataContext";
import { useAuth } from "../../context/AuthContext";

/**
 * The Flow Canvas toolbar's Access settings (issue #292, part of #208/
 * ADR 0021): who always sees every SOR of this Sale Type, and who may open
 * the Journey. Configuration only — nothing here enforces access yet.
 */
export default function FlowAccessSettings({ flowId, disabled = false }) {
  const { user } = useAuth();
  const { flowAccess: flowAccessService } = useFlowData();
  const queryClient = useQueryClient();
  // Only fetched once the popover is open — a toolbar button nobody has
  // clicked yet has no business issuing a query on every canvas render.
  const [isOpen, setIsOpen] = useState(false);

  const { data: access } = useQuery({
    queryKey: ["flowAccess", flowId],
    queryFn: () => flowAccessService.getForFlow(flowId),
    enabled: Boolean(flowId) && isOpen,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["flowAccess", flowId] });
    queryClient.invalidateQueries({ queryKey: ["flowVersionPreview"] });
    queryClient.invalidateQueries({ queryKey: ["flowDraftSnapshotData"] });
  };

  const saveMutation = useMutation({
    mutationFn: (payload) => flowAccessService.saveForFlow(flowId, payload, user?.id),
    onSuccess: () => {
      invalidate();
      toast.success("Access settings saved.");
    },
    onError: (err) => toast.error(err.message),
  });

  const alwaysSees = access?.alwaysSees || [];
  const alwaysEdits = access?.alwaysEdits || [];
  // null means "Deal Team plus Always sees" — the default until narrowed.
  const journeyViewers = access?.journeyViewers;
  const journeyIsDefault = journeyViewers == null;

  const save = (patch) =>
    saveMutation.mutate({
      alwaysSees,
      alwaysEdits,
      journeyViewers,
      ...patch,
    });

  return (
    <Dropdown
      usePortal
      placement="bottom-start"
      onToggle={() => setIsOpen((prev) => !prev)}
      onClose={() => setIsOpen(false)}
      popoverClassName="popover-enter z-[10001] w-96 rounded-2xl bg-popover p-3 shadow-2xl ring-1 ring-mauve-6"
      trigger={
        <Tooltip content="Access settings">
          <Button variant="ghost" size="icon-sm" aria-label="Access settings" disabled={disabled}>
            <ShieldCheck size={14} />
          </Button>
        </Tooltip>
      }
    >
      {() => (
        <div className="flex flex-col gap-4">
          <section className="space-y-1.5">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground">
              Always sees
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              These people see every SOR of this Sale Type, regardless of Stage.
            </p>
            <PeoplePicker
              value={alwaysSees}
              onChange={(next) => save({ alwaysSees: next })}
              allowRoles
              allowEveryone
              allowDepartments
              disabled={disabled}
              placeholder="Add people"
            />
          </section>

          <section className="space-y-1.5">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground">
              Always edits
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              These people can edit every SOR of this Sale Type, the way the Deal Team can. They also
              need to be able to see the SOR.
            </p>
            <PeoplePicker
              value={alwaysEdits}
              onChange={(next) => save({ alwaysEdits: next })}
              allowRoles
              allowEveryone
              allowDepartments
              disabled={disabled}
              placeholder="Add people"
            />
          </section>

          <section className="space-y-1.5">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground">
              History viewers
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Who may open the History. Leave empty for the default: Deal Team plus Always sees.
            </p>
            <PeoplePicker
              value={journeyIsDefault ? [] : journeyViewers}
              onChange={(next) => save({ journeyViewers: next.length ? next : null })}
              allowRoles
              allowEveryone
              allowDepartments
              disabled={disabled}
              placeholder="Add people"
            />
            {journeyIsDefault && (
              <p className="text-[10.5px] text-muted-foreground">
                Currently: Deal Team plus Always sees.
              </p>
            )}
          </section>
        </div>
      )}
    </Dropdown>
  );
}
