import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { CheckCircle2, Circle, Paperclip, ListChecks, UserCheck, Square, CheckSquare, UserPlus } from "lucide-react";
import Avatar from "../Avatar";
import { opportunityService } from "../../services/opportunityService";
import { CONDITION_KINDS, CONDITION_STATUS } from "../../constants/stageGate";
import { formatDate } from "../../utils/formatDate";
import { confirmActionToast } from "../ui/CustomToast";
import Dropdown from "../ui/Dropdown";
import { FilterOptionList, FilterTrigger } from "../ui/FilterDropdown";
import { storageService } from "../../services/storageService";

/** PO Date and Expected Award Date are dates; every other writable field is text. */
const DATE_FIELDS = new Set(["po_date", "expected_award_date"]);

const KIND_LABELS = {
  [CONDITION_KINDS.ATTACHMENT]: "Attachment",
  [CONDITION_KINDS.FIELD]: "Field on record",
  [CONDITION_KINDS.TICKBOX]: "Self-certified",
  [CONDITION_KINDS.ASSIGNMENT]: "Assignment",
};

const KIND_ICONS = {
  [CONDITION_KINDS.ATTACHMENT]: Paperclip,
  [CONDITION_KINDS.FIELD]: ListChecks,
  [CONDITION_KINDS.TICKBOX]: CheckSquare,
  [CONDITION_KINDS.ASSIGNMENT]: UserCheck,
};

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
 */
export default function StageChecklist({ opportunity, employees = [], actorId, onChanged, onSaveField }) {
  const [fieldValues, setFieldValues] = useState({});
  const [savingField, setSavingField] = useState(null);
  const [assignmentId, setAssignmentId] = useState({});
  const [uploadingAttachment, setUploadingAttachment] = useState({});
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
    mutationFn: ({ conditionId, employeeId }) =>
      opportunityService.addMember(opportunityId, employeeId, actorId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stageChecklist", opportunityId, stageCode] });
      queryClient.invalidateQueries({ queryKey: ["opportunityNotes", opportunityId] });
      // We don't necessarily want to immediately nullify assignmentId since it closes on its own
      onChanged?.();
    },
    onError: (err) => toast.error(err.message),
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ condition, file }) => {
      setUploadingAttachment(p => ({ ...p, [condition.id]: true }));
      try {
        const uploaded = await storageService.uploadFileToCloudinary(file);
        if (condition.config?.documentType) {
          uploaded.documentType = condition.config.documentType;
        }
        await opportunityService.addNote(
          opportunityId,
          actorId,
          `Attached document: ${condition.label}`,
          [uploaded]
        );
      } finally {
        setUploadingAttachment(p => ({ ...p, [condition.id]: false }));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stageChecklist", opportunityId, stageCode] });
      queryClient.invalidateQueries({ queryKey: ["opportunityNotes", opportunityId] });
      onChanged?.();
      toast.success("Attachment uploaded");
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const nameFor = (employeeId) => employees.find((e) => e.id === employeeId)?.name || null;

  const handleTick = (condition) => {
    confirmActionToast(
      `Certify "${condition.label}"?`,
      "This records your name against it — the condition has no other evidence, so ticking it is the certification.",
      "Certify",
      "warning",
      () => satisfyMutation.mutate(condition.id),
    );
  };

  if (checklist.length === 0) return null;

  return (
    <div className="mt-4 rounded-xl border border-border/70 bg-card/50 p-4">
      <p className="mb-3 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
        What {opportunity?.status ? "this Stage" : "the Stage"} owes
      </p>
      <div className="space-y-2.5">
        {checklist.map(({ condition, status, satisfiedBy, satisfiedAt }) => {
          const Icon = KIND_ICONS[condition.kind] || Circle;
          const isSatisfied = status === CONDITION_STATUS.SATISFIED;
          const isTickable =
            !isSatisfied && condition.kind === CONDITION_KINDS.TICKBOX;
          const who = nameFor(satisfiedBy);

          return (
            <div
              key={condition.id}
              className="flex items-start gap-2.5 rounded-lg border border-border/50 bg-background px-3 py-2.5"
            >
              <button
                type="button"
                disabled={!isTickable || satisfyMutation.isPending}
                onClick={() => isTickable && handleTick(condition)}
                aria-label={isTickable ? `Certify ${condition.label}` : undefined}
                className={
                  isSatisfied
                    ? "mt-0.5 shrink-0 text-green-9"
                    : isTickable
                      ? "mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                      : "mt-0.5 shrink-0 text-muted-foreground/40"
                }
              >
                {isSatisfied ? (
                  <CheckCircle2 size={17} />
                ) : isTickable ? (
                  <Square size={17} />
                ) : (
                  <Circle size={17} />
                )}
              </button>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={
                      isSatisfied
                        ? "text-sm font-semibold text-foreground line-through decoration-muted-foreground/40"
                        : "text-sm font-semibold text-foreground"
                    }
                  >
                    {condition.label}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
                    <Icon size={10} />
                    {KIND_LABELS[condition.kind] || condition.kind}
                  </span>
                  {!condition.is_required && (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
                      Optional
                    </span>
                  )}
                </div>

                {isSatisfied ? (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {who || satisfiedAt ? (
                      <>
                        Satisfied{who ? ` by ${who}` : ""}
                        {satisfiedAt ? ` on ${formatDate(satisfiedAt)}` : ""}
                      </>
                    ) : (
                      "Satisfied."
                    )}
                  </p>
                ) : (
                  <div className="mt-0.5 space-y-2">
                    <p
                      className={
                        condition.is_required
                          ? "text-[11px] font-semibold text-amber-600 dark:text-amber-400"
                          : "text-[11px] text-muted-foreground"
                      }
                    >
                      {isTickable ? "Not yet certified — tap to certify." : "Not yet satisfied."}
                    </p>
                    
                    {!isSatisfied &&
                      condition.kind === CONDITION_KINDS.FIELD &&
                      onSaveField &&
                      opportunityService.isChecklistWritableField(condition.config?.column) && (
                      <div className="flex items-center gap-2 max-w-[240px]">
                        <input
                          type={DATE_FIELDS.has(condition.config?.column) ? "date" : "text"}
                          aria-label={condition.label}
                          value={fieldValues[condition.id] || ""}
                          onChange={(e) => setFieldValues(p => ({ ...p, [condition.id]: e.target.value }))}
                          placeholder={`Enter ${condition.config?.column || 'value'}`}
                          className="flex h-7 w-full rounded-md border border-input bg-transparent px-2.5 py-1 text-xs shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <button
                          type="button"
                          disabled={savingField === condition.id || !(fieldValues[condition.id] || "").trim()}
                          onClick={async () => {
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
                          }}
                          className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 h-7 px-3"
                        >
                          {savingField === condition.id ? "..." : "Save"}
                        </button>
                      </div>
                    )}
                    
                    {!isSatisfied && condition.kind === CONDITION_KINDS.ATTACHMENT && (
                      <div className="mt-1.5 flex items-center gap-2">
                        <label
                          className={`flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border/80 bg-background px-3 text-[12px] font-semibold text-foreground shadow-xs transition-colors hover:bg-muted ${
                            uploadMutation.isPending || uploadingAttachment[condition.id] ? "pointer-events-none opacity-50" : ""
                          }`}
                        >
                          <Paperclip size={13} />
                          {uploadingAttachment[condition.id] ? "Uploading..." : "Attach File"}
                          <input
                            type="file"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              uploadMutation.mutate({ condition, file });
                            }}
                          />
                        </label>
                      </div>
                    )}
                    
                    {!isSatisfied && condition.kind === CONDITION_KINDS.ASSIGNMENT && (
                      <div className="flex items-center gap-2 mt-1.5 max-w-sm">
                        <Dropdown
                          usePortal
                          className="flex-1 min-w-0"
                          trigger={({ isOpen }) => (
                            <FilterTrigger
                              label={
                                assignmentId[condition.id]
                                  ? employees.find((e) => e.id === assignmentId[condition.id])?.name || "Select..."
                                  : `Assign ${condition.config?.department || "Member"}...`
                              }
                              isActive={!!assignmentId[condition.id]}
                              isOpen={isOpen}
                              icon={UserPlus}
                              className="!h-8"
                            />
                          )}
                        >
                          {({ close }) => (
                            <FilterOptionList
                              showSearch
                              options={employees.map((e) => ({
                                value: e.id,
                                label: e.name,
                              }))}
                              value={assignmentId[condition.id]}
                              onChange={(val) => {
                                setAssignmentId(p => ({ ...p, [condition.id]: val }));
                                close();
                              }}
                              close={close}
                            />
                          )}
                        </Dropdown>
                        <button
                          type="button"
                          disabled={!assignmentId[condition.id] || addMemberMutation.isPending}
                          onClick={() => addMemberMutation.mutate({ conditionId: condition.id, employeeId: assignmentId[condition.id] })}
                          className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border/80 bg-background px-3 text-[12px] font-semibold text-foreground shadow-xs transition-colors hover:bg-muted disabled:opacity-50"
                        >
                          Assign
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {isSatisfied && who && (
                <Avatar name={who} size="xs" className="mt-0.5 shrink-0" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
