import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Wand2, ArrowUp, ArrowDown, Archive, ChevronRight } from "lucide-react";
import toast from "react-hot-toast";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import Dropdown from "@/components/ui/Dropdown";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import TemplateTokenText from "@/components/ui/TemplateTokenText";

import { useFlowData } from "./FlowDataContext";
import { employeeService } from "../../services/employeeService";
import { ACTION_KIND_META, actionSummary, actionTitle } from "./flowStageKinds";
import { DEFAULT_ACCESS } from "../../utils/stageAudience";
import StageActionDetail from "./StageActionDetail";
import { useAuth } from "../../context/AuthContext";

import CreateGroupTaskModal from "../../pages/group-tasks/_components/CreateGroupTaskModal";
import LogTaskModal from "../LogTaskModal";

/**
 * A Stage's run: what fires on its own when a deal arrives.
 *
 * The counterpart to StageConditionManager — conditions block the way out,
 * actions happen on the way in — and it invalidates the canvas's batched read
 * for the same reason: an action added here is a satellite out on the canvas.
 */
export default function StageActionManager({ stageId, disabled = false }) {
  const { user } = useAuth();
  const { stageAction: stageActionService } = useFlowData();
  const queryClient = useQueryClient();
  const [addingKind, setAddingKind] = useState(null);
  const [editingAction, setEditingAction] = useState(null);
  const [pendingArchive, setPendingArchive] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const { data: employees } = useQuery({
    queryKey: ["employees"],
    queryFn: () => employeeService.getAllEmployees(),
  });

  const { data: actions, isLoading } = useQuery({
    queryKey: ["stageActions", stageId],
    queryFn: () => stageActionService.getForStage(stageId),
    enabled: Boolean(stageId),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["stageActions", stageId] });
    queryClient.invalidateQueries({ queryKey: ["stageActionsByStage"] });
    // Same reason as StageConditionManager: an action is in the snapshot, and
    // nothing threads a canvas refresh into this manager, so the publish diff
    // has to be invalidated from here or it goes stale until a reload.
    queryClient.invalidateQueries({ queryKey: ["flowVersionPreview"] });
    queryClient.invalidateQueries({ queryKey: ["flowDraftSnapshotData"] });
  };

  const addMutation = useMutation({
    mutationFn: (payload) => stageActionService.add(payload, user?.id),
    onSuccess: () => {
      invalidate();
      toast.success("Action added.");
      setAddingKind(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, config }) => stageActionService.update(id, config, user?.id),
    onSuccess: () => {
      invalidate();
      toast.success("Action updated.");
      setEditingAction(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const reorderMutation = useMutation({
    mutationFn: (updates) => stageActionService.reorder(updates, user?.id),
    onSuccess: invalidate,
    onError: (err) => {
      toast.error(err.message);
      invalidate();
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (id) => stageActionService.archive(id, user?.id),
    onSuccess: () => {
      invalidate();
      toast.success("Action archived.");
    },
    onError: (err) => toast.error(err.message),
  });

  const moveAction = (index, direction) => {
    if (!actions) return;
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= actions.length) return;

    const updated = [...actions];
    const [moved] = updated.splice(index, 1);
    updated.splice(newIndex, 0, moved);

    const updates = updated.map((r, i) => ({ id: r.id, sortOrder: i }));
    queryClient.setQueryData(["stageActions", stageId], updated);
    reorderMutation.mutate(updates);
  };

  // Issue #294's access window no longer gates the modal. It defaults to the
  // rule that matches what a call-in means to everyone who described it —
  // "this Stage only" — and is changed afterwards, in the action's own
  // expanded detail, where the assignees it applies to are on screen. The
  // step it replaces sat in front of the task modal and had to be dismissed
  // before the automation could even be read.
  const handleAdd = (kind, config) =>
    addMutation.mutate({ stageId, kind, config: { ...config, access: DEFAULT_ACCESS } });

  // Editing the task keeps whatever window the action already had: the modal
  // never asks about it, so it must never silently reset it.
  const handleUpdate = (config) =>
    updateMutation.mutate({
      id: editingAction.id,
      config: { ...config, access: editingAction.config?.access || DEFAULT_ACCESS },
    });

  const handleAccessChange = (action, access) =>
    updateMutation.mutate({ id: action.id, config: { ...action.config, access } });

  if (isLoading) {
    return <div className="m-5 h-20 animate-pulse rounded-2xl bg-mauve-a2" />;
  }

  return (
    <div className="flex flex-col">
      <p className="px-5 pt-5 text-xs leading-relaxed text-muted-foreground">
        What happens on its own the moment a deal arrives here. Actions run in the order below.
      </p>

      <div className="space-y-2 p-5">
        {actions?.map((action, i) => {
          const meta = ACTION_KIND_META[action.kind];
          const Icon = meta?.icon ?? Wand2;

          const title = actionTitle(action);
          const isExpanded = expandedId === action.id;

          return (
            <div
              key={action.id}
              className="group rounded-xl bg-card outline outline-1 -outline-offset-1 outline-mauve-6 transition-colors hover:outline-mauve-8"
            >
              <div className="flex items-center gap-3 px-3 py-2.5">
                {!disabled && (
                  <div className="flex shrink-0 flex-col">
                    <button
                      onClick={() => moveAction(i, -1)}
                      disabled={i === 0 || reorderMutation.isPending}
                      aria-label={`Move ${title} earlier`}
                      className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-mauve-a3 hover:text-foreground disabled:opacity-20 disabled:hover:bg-transparent"
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      onClick={() => moveAction(i, 1)}
                      disabled={i === actions.length - 1 || reorderMutation.isPending}
                      aria-label={`Move ${title} later`}
                      className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-mauve-a3 hover:text-foreground disabled:opacity-20 disabled:hover:bg-transparent"
                    >
                      <ArrowDown size={13} />
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : action.id)}
                  aria-expanded={isExpanded}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-violet-a3 text-violet-11">
                    <Icon size={15} strokeWidth={2.5} />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-foreground">
                      <TemplateTokenText text={title} />
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {actionSummary(action)}
                    </span>
                  </span>

                  <ChevronRight
                    size={15}
                    className={cn(
                      "shrink-0 text-muted-foreground transition-transform duration-200",
                      isExpanded && "rotate-90",
                    )}
                  />
                </button>

                {!disabled && (
                  <div className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setEditingAction(action)}
                      aria-label={`Edit ${title}`}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Wand2 size={16} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setPendingArchive(action)}
                      disabled={archiveMutation.isPending}
                      aria-label={`Archive ${title}`}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Archive size={16} />
                    </Button>
                  </div>
                )}
              </div>

              {isExpanded && (
                <StageActionDetail
                  action={action}
                  employees={employees || []}
                  stageId={stageId}
                  disabled={disabled}
                  onAccessChange={(access) => handleAccessChange(action, access)}
                />
              )}
            </div>
          );
        })}

        {actions?.length === 0 && (
          <div className="rounded-2xl border border-dashed border-mauve-7 px-5 py-8 text-center">
            <Wand2 size={22} className="mx-auto mb-2 text-muted-foreground/60" />
            <p className="text-sm font-semibold text-foreground">Nothing runs here</p>
            <p className="mx-auto mt-1 text-xs leading-relaxed text-muted-foreground">
              A deal arriving at this Stage sets nothing else in motion.
            </p>
          </div>
        )}

        {!disabled && (
          <Dropdown
            usePortal
            placement="bottom-start"
            popoverClassName="popover-enter z-[10001] w-[19rem] rounded-2xl bg-popover p-1.5 shadow-2xl ring-1 ring-mauve-6"
            trigger={({ isOpen }) => (
              <button
                type="button"
                className={cn(
                  "flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-mauve-7 p-3",
                  "text-sm font-semibold transition-colors",
                  isOpen
                    ? "border-primary bg-primary/5 text-primary"
                    : "text-muted-foreground hover:border-primary hover:bg-primary/5 hover:text-primary",
                )}
              >
                <Plus size={16} /> Add Action
              </button>
            )}
          >
            {({ close }) => (
              <div className="flex flex-col">
                {Object.entries(ACTION_KIND_META).map(([value, meta]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setAddingKind(value);
                      close();
                    }}
                    className="flex items-start gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-mauve-a2"
                  >
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-violet-a3 text-violet-11">
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
        )}
      </div>

      {addingKind === "create_group_task" && (
        <CreateGroupTaskModal
          isOpen={true}
          onClose={() => setAddingKind(null)}
          employees={employees || []}
          user={user}
          mode="automation"
          onSubmit={(config) => handleAdd("create_group_task", config)}
          isSubmitting={addMutation.isPending}
        />
      )}

      {addingKind === "create_individual_task" && (
        <LogTaskModal
          isOpen={true}
          onClose={() => setAddingKind(null)}
          mode="automation"
          onSubmitOverride={(config) => handleAdd("create_individual_task", config)}
        />
      )}

      {editingAction?.kind === "create_group_task" && (
        <CreateGroupTaskModal
          isOpen={true}
          onClose={() => setEditingAction(null)}
          employees={employees || []}
          user={user}
          mode="automation"
          initialData={editingAction.config}
          onSubmit={handleUpdate}
          isSubmitting={updateMutation.isPending}
        />
      )}

      {editingAction?.kind === "create_individual_task" && (
        <LogTaskModal
          isOpen={true}
          onClose={() => setEditingAction(null)}
          mode="automation"
          initialData={editingAction.config}
          onSubmitOverride={handleUpdate}
        />
      )}

      <ConfirmDialog
        open={Boolean(pendingArchive)}
        onOpenChange={(open) => !open && setPendingArchive(null)}
        title={`Archive “${pendingArchive ? actionTitle(pendingArchive) : "this action"}”?`}
        description="It stops firing for deals arriving from now on. Tasks it already created are untouched."
        confirmLabel="Archive"
        tone="destructive"
        onConfirm={() => archiveMutation.mutate(pendingArchive.id)}
      />
    </div>
  );
}
