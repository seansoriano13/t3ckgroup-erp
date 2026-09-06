import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, ListTodo, ArrowUp, ArrowDown, Archive, ChevronDown, X } from "lucide-react";
import toast from "react-hot-toast";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import Dropdown from "@/components/ui/Dropdown";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

import { useFlowData } from "./FlowDataContext";
import { CONDITION_KINDS } from "../../constants/stageGate";
import { CONDITION_KIND_META, conditionDetail } from "./flowStageKinds";
import { useAuth } from "../../context/AuthContext";

const emptyConfigFor = (kind) => {
  switch (kind) {
    case CONDITION_KINDS.ATTACHMENT:
      return { documentType: "" };
    case CONDITION_KINDS.FIELD:
      return { column: "" };
    case CONDITION_KINDS.ASSIGNMENT:
      return { department: "" };
    case CONDITION_KINDS.DEADLINE:
      return { days: "" };
    case CONDITION_KINDS.PROJECT_EVALUATION:
      return { referenceLink: "" };
    default:
      return {};
  }
};

/** Strips the config down to what the chosen kind actually reads, and blanks to null. */
function configFor(kind, config) {
  switch (kind) {
    case CONDITION_KINDS.ATTACHMENT:
      return config.documentType?.trim() ? { documentType: config.documentType.trim() } : {};
    case CONDITION_KINDS.FIELD:
      return { column: config.column?.trim() || "" };
    case CONDITION_KINDS.ASSIGNMENT:
      return { department: config.department?.trim() || "" };
    case CONDITION_KINDS.DEADLINE:
      return { days: Number(config.days) || 0 };
    case CONDITION_KINDS.PROJECT_EVALUATION:
      return config.referenceLink?.trim() ? { referenceLink: config.referenceLink.trim() } : {};
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
  const [kind, setKind] = useState(CONDITION_KINDS.FIELD);
  const [label, setLabel] = useState("");
  const [isRequired, setIsRequired] = useState(true);
  const [config, setConfig] = useState(emptyConfigFor(CONDITION_KINDS.FIELD));
  const [pendingArchive, setPendingArchive] = useState(null);

  const { data: conditions, isLoading } = useQuery({
    queryKey: ["stageConditions", stageId],
    queryFn: () => stageConditionService.getForStage(stageId),
    enabled: Boolean(stageId),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["stageConditions", stageId] });
    queryClient.invalidateQueries({ queryKey: ["stageConditionsByStage"] });
  };

  const resetForm = () => {
    setLabel("");
    setIsRequired(true);
    setKind(CONDITION_KINDS.FIELD);
    setConfig(emptyConfigFor(CONDITION_KINDS.FIELD));
    setIsAdding(false);
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
    setKind(nextKind);
    setConfig(emptyConfigFor(nextKind));
  };

  const handleAdd = (e) => {
    e.preventDefault();
    if (!label.trim() || !stageId) return;

    addMutation.mutate({
      stageId,
      kind,
      label,
      isRequired,
      config: configFor(kind, config),
    });
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

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-3 px-5 pt-5">
        <p className="text-xs leading-relaxed text-muted-foreground">
          What a deal owes before it may leave this Stage.
        </p>
        {!isAdding && stageId && !disabled && (
          <Button size="sm" variant="outline" onClick={() => setIsAdding(true)} className="shrink-0">
            <Plus /> Add
          </Button>
        )}
      </div>

      <div className="space-y-2 p-5">
        {isAdding && !disabled && (
          <form
            onSubmit={handleAdd}
            className="mb-4 space-y-3 rounded-2xl bg-mauve-a2 p-4 outline outline-1 -outline-offset-1 outline-mauve-6"
          >
            <div className="flex items-center justify-between">
              <h4 className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">
                New condition
              </h4>
              <Button type="button" variant="ghost" size="icon-xs" onClick={resetForm} aria-label="Cancel">
                <X />
              </Button>
            </div>

            <Input
              label="Label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Notice of Award attached"
              required
            />

            <div className="rounded-xl border border-border bg-muted/30 p-3">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Kind
              </span>
              <Dropdown
                usePortal
                placement="bottom-start"
                popoverClassName="popover-enter z-[10001] w-[19rem] rounded-2xl bg-popover p-1.5 shadow-2xl ring-1 ring-mauve-6"
                trigger={
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 text-left text-sm font-medium text-foreground outline-none"
                  >
                    <activeKind.icon size={15} className="shrink-0 text-muted-foreground" />
                    <span className="flex-1">{activeKind.label}</span>
                    <ChevronDown size={15} className="shrink-0 text-muted-foreground" />
                  </button>
                }
              >
                {({ close }) => (
                  <div className="flex flex-col">
                    {Object.entries(CONDITION_KIND_META).map(([value, meta]) => (
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
                    ))}
                  </div>
                )}
              </Dropdown>
            </div>

            {kind === CONDITION_KINDS.ATTACHMENT && (
              <Input
                label="Document type"
                value={config.documentType || ""}
                onChange={(e) => setConfig({ documentType: e.target.value })}
                placeholder="Any document, if left blank"
              />
            )}

            {kind === CONDITION_KINDS.FIELD && (
              <Input
                label="Column"
                value={config.column || ""}
                onChange={(e) => setConfig({ column: e.target.value })}
                placeholder="po_date"
                required
              />
            )}



            {kind === CONDITION_KINDS.ASSIGNMENT && (
              <Input
                label="Department"
                value={config.department || ""}
                onChange={(e) => setConfig({ department: e.target.value })}
                placeholder="e.g. Purchasing"
                required
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

            {kind === CONDITION_KINDS.PROJECT_EVALUATION && (
              <Input
                label="Reference link (optional)"
                value={config.referenceLink || ""}
                onChange={(e) => setConfig({ referenceLink: e.target.value })}
                placeholder="Link to the source sheet or template this Stage expects"
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

            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" size="lg" onClick={resetForm}>
                Cancel
              </Button>
              <Button type="submit" size="lg" disabled={addMutation.isPending}>
                {addMutation.isPending ? "Saving…" : "Save condition"}
              </Button>
            </div>
          </form>
        )}

        {isLoading ? (
          <p className="animate-pulse py-6 text-center text-sm text-muted-foreground">
            Loading conditions…
          </p>
        ) : conditions?.length === 0 && !isAdding ? (
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
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setPendingArchive(condition)}
                    disabled={archiveMutation.isPending}
                    aria-label={`Archive ${condition.label}`}
                    className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <Archive />
                  </Button>
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
