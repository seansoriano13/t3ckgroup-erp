import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { CheckCircle2, ListChecks } from "lucide-react";
import { cn } from "../../lib/utils";
import { CONDITION_STATUS } from "../../constants/stageGate";
import { opportunityService } from "../../services/opportunityService";
import { employeeGroupService } from "../../services/employeeGroupService";
import { confirmActionToast } from "../ui/CustomToast";
import { storageService } from "../../services/storageService";
import { attachmentAcceptType, acceptsLabel } from "../../utils/attachments";
import StageChecklistRow from "./StageChecklistRow";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";

/**
 * Stage Gate Engine, ticket 6 (.scratch/stage-gate-engine/issues/06-deal-
 * owner-visibility.md) — what the deal's current Stage owes, before a Deal
 * Owner tries to move it: every live condition, whether it's satisfied,
 * and who/when for the kinds that carry that. This is also the "specific,
 * named reason" a blocked move gets refused with (ticket 2's
 * `assertStageGateSatisfied` throws the same labels this list already
 * shows) — so there's one surface for both, not a checklist plus a
 * separate error format to keep in sync.
 *
 * A `tickbox` item has no other way to get satisfied (ticket 5) — it's the
 * one kind this list also acts on, not just reports.
 *
 * Issue #299 narrowed this to the conditions alone. The Stage Fields form,
 * the Optional Action cards and the follow-up panel used to hang off the
 * bottom of this component; the Now tab now orders all four itself
 * (conditions, fields, actions, tasks, follow-up), and a component that
 * decided its own neighbours' order could not be put in that order.
 */
export default function StageChecklist({ opportunity, employees = [], actorId, onChanged, onSaveField }) {
  const [fieldValues, setFieldValues] = useState({});
  const [savingField, setSavingField] = useState(null);
  const [assignmentId, setAssignmentId] = useState({});
  const [uploadingAttachment, setUploadingAttachment] = useState({});
  const [pickingFor, setPickingFor] = useState(null);
  const queryClient = useQueryClient();
  const opportunityId = opportunity?.id;
  // A flow SOR's `status` never changes (it stays LEAD), so the key follows
  // its flow Stage — otherwise a move keeps showing the old Stage's list.
  const stageCode = opportunity?.flow_stage_id || opportunity?.status;

  const { data: checklist = [] } = useQuery({
    queryKey: ["stageChecklist", opportunityId, stageCode],
    // Read fresh, not from the prop: right after a Save or a move the prop can
    // still be the copy from before it.
    queryFn: () => opportunityService.getStageChecklist(opportunityId),
    enabled: !!opportunityId,
  });

  const { data: currentVisitId = null } = useQuery({
    queryKey: ["stageVisitId", opportunityId, stageCode],
    queryFn: () => opportunityService.getCurrentStageVisitId(opportunityId),
    enabled: !!opportunityId,
  });

  // Existing SOR files, for the "pick existing file" attachment option
  // (issue #203, story 13) — flattened from every note's attachments.
  const { data: notes = [] } = useQuery({
    queryKey: ["opportunityNotes", opportunityId],
    queryFn: () => opportunityService.getNotes(opportunityId),
    enabled: !!opportunityId,
  });
  const existingFiles = notes.flatMap((n) => n.metadata?.attachments || []);

  // Issue #203, story 17: fetched once here (rather than per row) so an
  // Assignment condition's `who` group selectors can narrow the dropdown
  // without every row re-fetching Employee Groups.
  const { data: groups = [] } = useQuery({
    queryKey: ["employeeGroups"],
    queryFn: () => employeeGroupService.list(),
    enabled: !!opportunityId,
  });

  const satisfyMutation = useMutation({
    mutationFn: (conditionId) =>
      opportunityService.satisfyCondition(opportunityId, conditionId, actorId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stageChecklist", opportunityId, stageCode] });
      queryClient.invalidateQueries({ queryKey: ["opportunityNotes", opportunityId] });
      onChanged?.();
    },
    onError: (err) => toast.error(err.message),
  });

  const addMemberMutation = useMutation({
    mutationFn: ({ employeeId, conditionId }) =>
      opportunityService.addMember(opportunityId, employeeId, actorId, { conditionId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stageChecklist", opportunityId, stageCode] });
      queryClient.invalidateQueries({ queryKey: ["opportunityNotes", opportunityId] });
      onChanged?.();
    },
    onError: (err) => toast.error(err.message),
  });

  const stampAndAttach = async (condition, uploaded) => {
    if (condition.config?.documentType) {
      uploaded.documentType = condition.config.documentType;
    }
    // Issue #203, stories 12/13/15: only a file given through this
    // condition's own row counts — stamp which condition and which Stage
    // Visit it was given on, so a later loop back or an unrelated chat
    // attachment (or a pick from another condition's file) can never
    // satisfy it.
    uploaded.conditionId = condition.id;
    // Read the visit fresh, not from the cached query: that cache is keyed by
    // Stage, so after a Revert then Resume back to the same Stage it can still
    // hold an earlier visit's id and stamp the file there (same race as #413).
    const visitId = (await opportunityService.getCurrentStageVisitId(opportunityId)) ?? currentVisitId;
    if (visitId) uploaded.stageVisitId = visitId;
    await opportunityService.addNote(
      opportunityId,
      actorId,
      `Attached document: ${condition.label}`,
      [uploaded],
    );
  };

  const uploadMutation = useMutation({
    mutationFn: async ({ condition, file }) => {
      setUploadingAttachment((p) => ({ ...p, [condition.id]: true }));
      try {
        const uploaded = await storageService.uploadFileToCloudinary(file);
        uploaded.type = attachmentAcceptType(file) || uploaded.type;
        await stampAndAttach(condition, uploaded);
      } finally {
        setUploadingAttachment((p) => ({ ...p, [condition.id]: false }));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stageChecklist", opportunityId, stageCode] });
      queryClient.invalidateQueries({ queryKey: ["opportunityNotes", opportunityId] });
      onChanged?.();
      toast.success("Attachment uploaded");
    },
    onError: (err) => toast.error(err.message),
  });

  const pickExistingMutation = useMutation({
    mutationFn: async ({ condition, file }) => {
      // Same refusal the upload path enforces client-side: a file whose type
      // isn't in `accepts` can't satisfy this condition just by being picked.
      const accepts = Array.isArray(condition.config?.accepts) ? condition.config.accepts : [];
      const type = file.type || attachmentAcceptType(file);
      if (accepts.length > 0 && !accepts.includes(type)) {
        throw new Error(`This condition only accepts: ${acceptsLabel(accepts)}.`);
      }
      await stampAndAttach(condition, { ...file });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stageChecklist", opportunityId, stageCode] });
      queryClient.invalidateQueries({ queryKey: ["opportunityNotes", opportunityId] });
      onChanged?.();
      toast.success("File attached");
      setPickingFor(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const handleTick = (condition) => {
    confirmActionToast(
      `Certify "${condition.label}"?`,
      "This records your name against it — the condition has no other evidence, so ticking it is the certification.",
      "Certify",
      "warning",
      () => satisfyMutation.mutate(condition.id),
    );
  };

  const handleUpload = (condition, file) => {
    const accepts = Array.isArray(condition.config?.accepts) ? condition.config.accepts : [];
    if (accepts.length > 0 && !accepts.includes(attachmentAcceptType(file))) {
      toast.error(`This condition only accepts: ${acceptsLabel(accepts)}.`);
      return;
    }
    uploadMutation.mutate({ condition, file });
  };

  // A fully-satisfied checklist used to look identical to a half-done one —
  // just more green circles — so "is this Stage finished?" could only be
  // answered by reading every row. Not-applicable rows are excluded from
  // both halves: they never applied to this SOR, so counting them would
  // make a complete Stage read as incomplete forever.
  const applicable = checklist.filter(({ status }) => status !== CONDITION_STATUS.NOT_APPLICABLE);
  const satisfiedCount = applicable.filter(
    ({ status }) => status === CONDITION_STATUS.SATISFIED,
  ).length;
  const allSatisfied = applicable.length > 0 && satisfiedCount === applicable.length;

  const showChecklist = checklist.length > 0;

  return (
    <div className="space-y-4">
      {!showChecklist && (
        <p className="rounded-xl border border-border/70 bg-card/50 px-4 py-3 text-sm text-muted-foreground">
          Nothing blocks this stage.
        </p>
      )}

      {showChecklist && (
        <div
          className={cn(
            "rounded-xl border p-4",
            allSatisfied ? "border-green-9/40 bg-green-a2" : "border-border/70 bg-card/50",
          )}
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-label font-bold tracking-widest text-muted-foreground uppercase">
              What {opportunity?.status ? "this Stage" : "the Stage"} owes
            </p>
            {applicable.length > 0 && (
              <span
                className={cn(
                  "shrink-0 rounded-md px-2 py-0.5 text-label font-black uppercase tracking-wider tabular-nums",
                  allSatisfied
                    ? "bg-green-9/15 text-green-11"
                    : "bg-amber-9/15 text-amber-11",
                )}
              >
                {satisfiedCount} of {applicable.length}
              </span>
            )}
          </div>

          {allSatisfied && (
            <p className="mb-3 flex items-center gap-1.5 text-xs font-bold text-green-11">
              <CheckCircle2 size={14} className="shrink-0" />
              Stage requirements met — this Stage no longer blocks the move.
            </p>
          )}
          <div className="space-y-2.5">
            {checklist.map(({ condition, status, satisfiedBy, satisfiedAt, detail }) => (
              <StageChecklistRow
                key={condition.id}
                condition={condition}
                status={status}
                satisfiedBy={satisfiedBy}
                satisfiedAt={satisfiedAt}
                detail={detail}
                employees={employees}
                groups={groups}
                opportunity={opportunity}
                onTick={handleTick}
                tickDisabled={satisfyMutation.isPending}
                fieldValue={fieldValues[condition.id]}
                savingField={savingField === condition.id}
                onFieldChange={(val) => setFieldValues((p) => ({ ...p, [condition.id]: val }))}
                onSaveField={
                  onSaveField && opportunityService.isChecklistWritableField(condition.config?.column)
                    ? async () => {
                        if (!condition.config?.column) return;
                        setSavingField(condition.id);
                        try {
                          await onSaveField(condition.config.column, fieldValues[condition.id]);
                          setFieldValues((p) => ({ ...p, [condition.id]: "" }));
                        } catch (err) {
                          toast.error(err.message);
                        } finally {
                          setSavingField(null);
                        }
                      }
                    : undefined
                }
                uploading={uploadingAttachment[condition.id]}
                onUpload={(file) => handleUpload(condition, file)}
                onPickExisting={existingFiles.length > 0 ? () => setPickingFor(condition) : undefined}
                assignmentValue={assignmentId[condition.id]}
                onAssignmentChange={(val) => setAssignmentId((p) => ({ ...p, [condition.id]: val }))}
                onAssign={() =>
                  assignmentId[condition.id] &&
                  addMemberMutation.mutate({ employeeId: assignmentId[condition.id], conditionId: condition.id })
                }
                assignPending={addMemberMutation.isPending}
              />
            ))}
          </div>
        </div>
      )}

      <Dialog open={!!pickingFor} onOpenChange={(open) => !open && setPickingFor(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              <ListChecks size={14} className="mr-1 inline" /> Pick an existing SOR file
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-72 space-y-0.5 overflow-y-auto">
            {existingFiles.length === 0 && (
              <p className="px-1 py-4 text-center text-xs text-muted-foreground">
                No files on this SOR yet.
              </p>
            )}
            {existingFiles.map((file, idx) => (
              <Button
                key={`${file.url}-${idx}`}
                type="button"
                variant="ghost"
                disabled={pickExistingMutation.isPending}
                onClick={() => pickingFor && pickExistingMutation.mutate({ condition: pickingFor, file })}
                className="h-auto w-full justify-start truncate rounded-lg px-2.5 py-1.5 text-left text-sm"
              >
                {file.name || "Attachment"}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
