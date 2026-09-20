import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, ListTodo, ArrowUp, ArrowDown, Archive, ChevronDown, Pencil, X } from "lucide-react";
import toast from "react-hot-toast";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import Dropdown from "@/components/ui/Dropdown";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import PeoplePicker from "@/components/ui/PeoplePicker";

import AccessWindowConfig from "./AccessWindowConfig";
import { useFlowData } from "./FlowDataContext";
import { employeeService } from "../../services/employeeService";
import { CONDITION_KINDS, NEW_CONDITION_KINDS, CONDITION_STATUS } from "../../constants/stageGate";
import { SELECTOR_TYPES } from "../../utils/resolvePeople";
import { ATTACHMENT_ACCEPT_GROUPS } from "../../utils/attachments";
import { CONDITION_KIND_META, conditionDetail } from "./flowStageKinds";
import { useAuth } from "../../context/AuthContext";
import StageChecklistRow from "../sor/StageChecklistRow";

const emptyConfigFor = (kind) => {
  switch (kind) {
    case CONDITION_KINDS.ATTACHMENT:
      return { accepts: [] };
    case CONDITION_KINDS.ASSIGNMENT:
      return { who: [], access: { until: "stage_left" } };
    case CONDITION_KINDS.DEADLINE:
      return { days: "" };
    default:
      return {};
  }
};

/** Strips the config down to what the chosen kind actually reads, and blanks to null. */
function configFor(kind, config) {
  switch (kind) {
    case CONDITION_KINDS.ATTACHMENT:
      return { accepts: Array.isArray(config.accepts) ? config.accepts : [] };
    case CONDITION_KINDS.ASSIGNMENT:
      // Issue #203: `who` is a list of PeoplePicker selectors (issue #201's
      // shape). Legacy `department` is left alone by this form — it's still
      // read by the evaluator for a condition that hasn't been touched here.
      // Issue #294: `access` is rebuilt fresh from the form's own state
      // every save, which is also what clears a stale `accessFallbackWarning`
      // the moment someone re-confirms the window here.
      return {
        who: Array.isArray(config.who) ? config.who : [],
        access: config.access?.until ? config.access : { until: "stage_left" },
      };
    case CONDITION_KINDS.DEADLINE:
      return { days: Number(config.days) || 0 };
    default:
      return {};
  }
}

/**
 * A Stage's gate: what a deal owes before it may leave.
 *
 * Wired to stageConditionService only — the same "no direct table access from
 * the UI" rule the rest of the flow follows. Every write also invalidates the
 * canvas's batched read, because a condition added here is a satellite that
 * has to appear out on the canvas in the same beat.
 */
export default function StageConditionManager({ stageId, disabled = false }) {
  const { user } = useAuth();
  const { stageCondition: stageConditionService } = useFlowData();
  const queryClient = useQueryClient();
  const [isAdding, setIsAdding] = useState(false);
  // Issue #203, story 4: the same form edits a saved condition — `editingId`
  // holds which one, null while adding. Kind is fixed once a condition
  // exists (story 5), so the kind picker below is disabled whenever this is set.
  const [editingId, setEditingId] = useState(null);
  const [kind, setKind] = useState(CONDITION_KINDS.ATTACHMENT);
  const [label, setLabel] = useState("");
  const [isRequired, setIsRequired] = useState(true);
  const [config, setConfig] = useState(emptyConfigFor(CONDITION_KINDS.ATTACHMENT));
  const [pendingArchive, setPendingArchive] = useState(null);

  const { data: conditions, isLoading } = useQuery({
    queryKey: ["stageConditions", stageId],
    queryFn: () => stageConditionService.getForStage(stageId),
    enabled: Boolean(stageId),
  });

  // For the Assignment who-picker and the live preview's "who satisfied it" name.
  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => employeeService.getAllEmployees(),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["stageConditions", stageId] });
    queryClient.invalidateQueries({ queryKey: ["stageConditionsByStage"] });
    // A condition is part of the flow's snapshot, so editing one changes what
    // the next publish would create. This manager is rendered bare by
    // StageSettingsPanel with no refresh callback threaded in, so it has to
    // invalidate the canvas-level keys itself — otherwise the node badge
    // repaints while the publish diff stays stale until a reload.
    queryClient.invalidateQueries({ queryKey: ["flowVersionPreview"] });
    queryClient.invalidateQueries({ queryKey: ["flowDraftSnapshotData"] });
  };

  const resetForm = () => {
    setLabel("");
    setIsRequired(true);
    setKind(CONDITION_KINDS.ATTACHMENT);
    setConfig(emptyConfigFor(CONDITION_KINDS.ATTACHMENT));
    setIsAdding(false);
    setEditingId(null);
  };

  const addMutation = useMutation({
    mutationFn: (payload) => stageConditionService.add(payload, user?.id),
    onSuccess: () => {
      invalidate();
      toast.success("Condition added.");
      resetForm();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => stageConditionService.update(id, payload, user?.id),
    onSuccess: () => {
      invalidate();
      toast.success("Condition updated.");
      resetForm();
    },
    onError: (err) => toast.error(err.message),
  });

  const reorderMutation = useMutation({
    mutationFn: (updates) => stageConditionService.reorder(updates, user?.id),
    onSuccess: invalidate,
    onError: (err) => {
      toast.error(err.message);
      invalidate();
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (id) => stageConditionService.archive(id, user?.id),
    onSuccess: () => {
      invalidate();
      toast.success("Condition archived.");
    },
    onError: (err) => toast.error(err.message),
  });

  const handleKindChange = (nextKind) => {
    // Kind is fixed once saved — the picker below is disabled while editing,
    // but guard here too since it's the single source of truth for the form.
    if (editingId) return;
    setKind(nextKind);
    setConfig(emptyConfigFor(nextKind));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!label.trim() || !stageId) return;

    if (editingId) {
      updateMutation.mutate({
        id: editingId,
        payload: { label, isRequired, config: configFor(kind, config) },
      });
    } else {
      addMutation.mutate({
        stageId,
        kind,
        label,
        isRequired,
        config: configFor(kind, config),
      });
    }
  };

  const startEdit = (condition) => {
    setEditingId(condition.id);
    setKind(condition.kind);
    setLabel(condition.label);
    setIsRequired(condition.is_required);
    setConfig({ ...emptyConfigFor(condition.kind), ...(condition.config || {}) });
    setIsAdding(false);
  };

  const moveCondition = (index, direction) => {
    if (!conditions) return;
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= conditions.length) return;

    const a = conditions[index];
    const b = conditions[newIndex];
    reorderMutation.mutate([
      { id: a.id, sortOrder: b.sort_order },
      { id: b.id, sortOrder: a.sort_order },
    ]);
  };

  const activeKind = CONDITION_KIND_META[kind];
  const isFormOpen = isAdding || Boolean(editingId);
  const isSaving = addMutation.isPending || updateMutation.isPending;

  // Issue #203, story 3: the live preview renders the same row component the
  // SOR's checklist uses, fed a sample condition built from the form's
  // current draft values — so the preview and the eventual checklist row can
  // never quietly look different.
  const previewCondition = {
    id: "preview",
    kind,
    label: label.trim() || activeKind?.label || "Untitled condition",
    is_required: isRequired,
    config: configFor(kind, config),
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-3 px-5 pt-5">
        <p className="text-xs leading-relaxed text-muted-foreground">
          What a deal owes before it may leave this Stage.
        </p>
        {!isFormOpen && stageId && !disabled && (
          <Button size="sm" variant="outline" onClick={() => setIsAdding(true)} className="shrink-0">
            <Plus /> Add
          </Button>
        )}
      </div>

      <div className="space-y-2 p-5">
        {isFormOpen && !disabled && (
          <form
            onSubmit={handleSubmit}
            className="mb-4 space-y-3 rounded-2xl bg-mauve-a2 p-4 outline outline-1 -outline-offset-1 outline-mauve-6"
          >
            <div className="flex items-center justify-between">
              <h4 className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">
                {editingId ? "Edit condition" : "New condition"}
              </h4>
              <Button type="button" variant="ghost" size="icon-xs" onClick={resetForm} aria-label="Cancel">
                <X />
              </Button>
            </div>

            {/* Story 1: Kind comes first. */}
            <div className="rounded-xl border border-border bg-muted/30 p-3">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Kind
              </span>
              <Dropdown
                usePortal
                disabled={Boolean(editingId)}
                placement="bottom-start"
                popoverClassName="popover-enter z-[10001] w-[19rem] rounded-2xl bg-popover p-1.5 shadow-2xl ring-1 ring-mauve-6"
                trigger={
                  <button
                    type="button"
                    disabled={Boolean(editingId)}
                    className="flex w-full items-center gap-2 text-left text-sm font-medium text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    <activeKind.icon size={15} className="shrink-0 text-muted-foreground" />
                    <span className="flex-1">{activeKind.label}</span>
                    {!editingId && <ChevronDown size={15} className="shrink-0 text-muted-foreground" />}
                  </button>
                }
              >
                {({ close }) => (
                  <div className="flex flex-col">
                    {NEW_CONDITION_KINDS.map((value) => {
                      const meta = CONDITION_KIND_META[value]
                      return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => {
                          handleKindChange(value);
                          close();
                        }}
                        className={cn(
                          "flex items-start gap-3 rounded-xl px-2.5 py-2 text-left transition-colors",
                          value === kind ? "bg-mauve-a3" : "hover:bg-mauve-a2",
                        )}
                      >
                        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-amber-a3 text-amber-11">
                          <meta.icon size={14} strokeWidth={2.5} />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-foreground">
                            {meta.label}
                          </span>
                          <span className="block text-xs leading-snug text-muted-foreground">
                            {meta.hint}
                          </span>
                        </span>
                      </button>
                    )})}
                  </div>
                )}
              </Dropdown>
              {editingId && (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Kind is fixed once saved. Archive this condition and add a new one to change it.
                </p>
              )}
            </div>

            <Input
              label="Label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Notice of Award attached"
              required
            />

            {kind === CONDITION_KINDS.ATTACHMENT && (
              <div className="rounded-xl border border-border bg-muted/30 p-3">
                <span className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Accepts — Any, if none chosen
                </span>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(ATTACHMENT_ACCEPT_GROUPS).map(([key, group]) => {
                    const accepts = config.accepts || [];
                    const active = accepts.includes(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() =>
                          setConfig({
                            accepts: active ? accepts.filter((a) => a !== key) : [...accepts, key],
                          })
                        }
                        className={cn(
                          "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                          active
                            ? "bg-mauve-12 text-mauve-1"
                            : "bg-mauve-a3 text-muted-foreground hover:bg-mauve-a4",
                        )}
                      >
                        {group.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}


            {kind === CONDITION_KINDS.ASSIGNMENT && (
              <div className="rounded-xl border border-border bg-muted/30 p-3">
                <span className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Who — a specific employee, an Employee Group, or a Team
                </span>
                <PeoplePicker
                  value={config.who || []}
                  onChange={(who) => setConfig((c) => ({ ...c, who }))}
                  types={[SELECTOR_TYPES.EMPLOYEE, SELECTOR_TYPES.GROUP, SELECTOR_TYPES.TEAM]}
                  placeholder="Add who satisfies this"
                />
              </div>
            )}

            {kind === CONDITION_KINDS.ASSIGNMENT && (
              <AccessWindowConfig
                stageId={stageId}
                value={config.access}
                onChange={(access) => setConfig((c) => ({ ...c, access }))}
              />
            )}

            {kind === CONDITION_KINDS.DEADLINE && (
              <Input
                label="Days from Stage entry"
                type="number"
                min="1"
                value={config.days || ""}
                onChange={(e) => setConfig({ days: e.target.value })}
                placeholder="10"
                required
              />
            )}

            <label className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 p-3">
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">
                  Blocks the way out
                </span>
                <span className="block text-xs leading-snug text-muted-foreground">
                  {isRequired
                    ? "A deal cannot leave this Stage until it is satisfied."
                    : "Tracked and shown, but never in the way."}
                </span>
              </span>
              <Switch checked={isRequired} onCheckedChange={setIsRequired} />
            </label>

            {/* Story 3: a live preview of the exact row the SOR's checklist
                will show, fed a sample opportunity matching the draft. */}
            <div className="rounded-xl border border-dashed border-mauve-7 p-3">
              <span className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Preview — how this looks on the SOR
              </span>
              <StageChecklistRow
                condition={previewCondition}
                status={CONDITION_STATUS.UNSATISFIED}
                employees={employees}
                isPreview
              />
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" size="lg" onClick={resetForm}>
                Cancel
              </Button>
              <Button type="submit" size="lg" disabled={isSaving}>
                {isSaving ? "Saving…" : editingId ? "Save changes" : "Save condition"}
              </Button>
            </div>
          </form>
        )}

        {isLoading ? (
          <p className="animate-pulse py-6 text-center text-sm text-muted-foreground">
            Loading conditions…
          </p>
        ) : conditions?.length === 0 && !isFormOpen ? (
          <div className="rounded-2xl border border-dashed border-mauve-7 px-5 py-8 text-center">
            <ListTodo size={22} className="mx-auto mb-2 text-muted-foreground/60" />
            <p className="text-sm font-semibold text-foreground">Nothing gates this Stage</p>
            <p className="mx-auto mt-1 text-xs leading-relaxed text-muted-foreground">
              A deal may leave the moment a move is drawn from here.
            </p>
          </div>
        ) : (
          conditions?.map((condition, index) => {
            const meta = CONDITION_KIND_META[condition.kind];
            const detail = conditionDetail(condition);
            const Icon = meta?.icon ?? ListTodo;

            return (
              <div
                key={condition.id}
                className="group flex items-center gap-3 rounded-xl bg-card px-3 py-2.5 outline outline-1 -outline-offset-1 outline-mauve-6 transition-colors hover:outline-mauve-8"
              >
                {!disabled && (
                  <div className="flex shrink-0 flex-col">
                    <button
                      onClick={() => moveCondition(index, "up")}
                      disabled={index === 0 || reorderMutation.isPending}
                      aria-label={`Move ${condition.label} earlier`}
                      className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-mauve-a3 hover:text-foreground disabled:opacity-20 disabled:hover:bg-transparent"
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      onClick={() => moveCondition(index, "down")}
                      disabled={index === conditions.length - 1 || reorderMutation.isPending}
                      aria-label={`Move ${condition.label} later`}
                      className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-mauve-a3 hover:text-foreground disabled:opacity-20 disabled:hover:bg-transparent"
                    >
                      <ArrowDown size={13} />
                    </button>
                  </div>
                )}

                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-a3 text-amber-11">
                  <Icon size={15} strokeWidth={2.5} />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-bold text-foreground">
                      {condition.label}
                    </p>
                    {!condition.is_required && (
                      <span className="shrink-0 rounded bg-mauve-a3 px-1.5 py-px text-[9px] font-black uppercase tracking-[0.1em] text-mauve-11">
                        Optional
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {meta?.label ?? condition.kind}
                    {detail && <span className="text-mauve-10"> · {detail}</span>}
                  </p>
                </div>

                {!disabled && (
                  <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => startEdit(condition)}
                      aria-label={`Edit ${condition.label}`}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setPendingArchive(condition)}
                      disabled={archiveMutation.isPending}
                      aria-label={`Archive ${condition.label}`}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Archive />
                    </Button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <ConfirmDialog
        open={Boolean(pendingArchive)}
        onOpenChange={(open) => !open && setPendingArchive(null)}
        title={`Archive “${pendingArchive?.label}”?`}
        description="Archiving is the only way to remove a condition. It stops blocking future moves, and every deal that already satisfied it keeps that record."
        confirmLabel="Archive"
        tone="destructive"
        onConfirm={() => archiveMutation.mutate(pendingArchive.id)}
      />
    </div>
  );
}
