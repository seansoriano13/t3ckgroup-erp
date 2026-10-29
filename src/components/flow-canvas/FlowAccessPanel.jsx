import { useQueryClient, useMutation } from "@tanstack/react-query";
import { X } from "lucide-react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldBox } from "@/components/ui/FieldBox";
import PeoplePicker from "@/components/ui/PeoplePicker";
import { SELECTOR_TYPES, DEAL_TEAM_ROLES } from "@/utils/resolvePeople";

import { useFlowData } from "./FlowDataContext";
import { useAuth } from "../../context/AuthContext";

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

const Hint = ({ children }) => (
  <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>
);

function StageRow({ stage, access, lensState, disabled, onSave }) {
  const shutOut = new Set(access?.shutOutRoles || []);
  const excluded = (access?.excludedGroupIds || []).map((id) => ({ type: SELECTOR_TYPES.GROUP, id }));
  const save = (patch) =>
    onSave(stage.id, {
      shutOutRoles: [...shutOut],
      excludedGroupIds: excluded.map((s) => s.id),
      ...patch,
    });

  return (
    <li className="grid gap-x-4 gap-y-2 py-3 lg:grid-cols-[9rem_minmax(0,1fr)_14rem] lg:items-center">
      <div className="flex items-center gap-2">
        <span className="truncate text-[13px] font-bold text-foreground">{stage.name}</span>
        {lensState && lensState !== "visible" && (
          <span className="shrink-0 rounded-md bg-mauve-3 px-1.5 py-0.5 text-[10.5px] font-semibold text-mauve-11">
            {LENS_LABEL[lensState]}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {Object.entries(DEAL_TEAM_ROLES).map(([role, meta]) => (
          <FieldBox inline key={role} className="flex items-center gap-1.5 text-xs">
            <Checkbox
              checked={!shutOut.has(role)}
              disabled={disabled}
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
        disabled={disabled}
        onChange={(next) =>
          save({
            excludedGroupIds: next.filter((s) => s.type === SELECTOR_TYPES.GROUP).map((s) => s.id),
          })
        }
        placeholder="Shut out a Group"
      />
    </li>
  );
}

/**
 * The Flow Canvas's Access view (issue #292): it takes over the canvas area
 * for the selected Sale Type, so Always sees / Always edits / History viewers
 * and each Stage's restrictions are edited beside the flow they belong to.
 * `lens` is the canvas's own View as verdict per Stage.
 */
export default function FlowAccessPanel({
  flow,
  saleTypeName,
  stages,
  flowAccess,
  stageAccess,
  lens,
  viewing,
  disabled = false,
  onClose,
}) {
  const { user } = useAuth();
  const { flowAccess: flowAccessService } = useFlowData();
  const queryClient = useQueryClient();

  const invalidate = () => {
    for (const key of ["flowAccess", "stageAccess", "stageAccessByStage", "flowVersionPreview", "flowDraftSnapshotData"]) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  };

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

  const alwaysSees = flowAccess?.alwaysSees || NO_ROWS;
  const alwaysEdits = flowAccess?.alwaysEdits || NO_ROWS;
  // null means "Deal Team plus Always sees" — the default until narrowed.
  const journeyViewers = flowAccess?.journeyViewers ?? null;

  const saveFlow = (patch) =>
    flowMutation.mutate({ alwaysSees, alwaysEdits, journeyViewers, ...patch });

  return (
    <div className="absolute inset-0 z-10 overflow-y-auto bg-mauve-3 px-4 pb-10 pt-20">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-black text-foreground">Access · {saleTypeName}</h2>
            <Hint>
              Who sees and edits every SOR of this Sale Type, and which Stages are restricted.
              {disabled && " The draft is published, so reopen it to edit."}
            </Hint>
          </div>
          <Button type="button" variant="outline" size="lg" onClick={onClose}>
            <X /> Back to canvas
          </Button>
        </div>

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <section className="flex flex-col gap-4 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-mauve-6">
            <div className="space-y-1.5">
              <Label>Always sees</Label>
              <Hint>These people see every SOR of this Sale Type, regardless of Stage.</Hint>
              <PeoplePicker
                value={alwaysSees}
                onChange={(next) => saveFlow({ alwaysSees: next })}
                allowRoles
                allowEveryone
                allowDepartments
                disabled={disabled}
                placeholder="Add people"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Always edits</Label>
              <Hint>
                These people can edit every SOR of this Sale Type, the way the Deal Team can. They
                also need to be able to see the SOR.
              </Hint>
              <PeoplePicker
                value={alwaysEdits}
                onChange={(next) => saveFlow({ alwaysEdits: next })}
                allowRoles
                allowEveryone
                allowDepartments
                disabled={disabled}
                placeholder="Add people"
              />
            </div>
            <div className="space-y-1.5">
              <Label>History viewers</Label>
              <Hint>Who may open the History. Leave empty for the default: Deal Team plus Always sees.</Hint>
              <PeoplePicker
                value={journeyViewers ?? NO_ROWS}
                onChange={(next) => saveFlow({ journeyViewers: next.length ? next : null })}
                allowRoles
                allowEveryone
                allowDepartments
                disabled={disabled}
                placeholder="Add people"
              />
              {journeyViewers == null && (
                <p className="text-[10.5px] text-muted-foreground">Currently: Deal Team plus Always sees.</p>
              )}
            </div>
          </section>

          <section className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-mauve-6">
            <Label>Restricted Stages</Label>
            <Hint>
              Untick a role to shut it out of a Stage, or shut out a whole Group.
              {viewing && " The tags show what the View as pick sees."}
            </Hint>
            {stages.length === 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">This Sale Type has no Stages yet.</p>
            ) : (
              <ul className="mt-1 divide-y divide-border">
                {stages.map((stage) => (
                  <StageRow
                    key={stage.id}
                    stage={stage}
                    access={stageAccess?.[stage.id]}
                    lensState={viewing ? lens?.[stage.id] : null}
                    disabled={disabled}
                    onSave={(stageId, payload) => stageMutation.mutate({ stageId, payload })}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
