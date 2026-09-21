import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, ListChecks, ArrowUp, ArrowDown, Archive, ArchiveRestore, X, Pencil } from "lucide-react";
import toast from "react-hot-toast";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

import ChoiceOptionsEditor from "./ChoiceOptionsEditor";
import StageFieldPreview from "./StageFieldPreview";
import { cleanChoiceOptions, choiceOptionsError } from "./choiceOptions";
import { useFlowData } from "./FlowDataContext";
import { useAuth } from "../../context/AuthContext";
import { SOR_STAGE_FIELDS, SOR_STAGE_FIELD_KEYS, CUSTOM_FIELD_TYPE_VALUES } from "../../constants/stageFields";

const emptyDraft = () => ({
  label: "",
  help: "",
  isRequired: true,
  source: "sor",
  sorField: SOR_STAGE_FIELD_KEYS[0],
  fieldType: "text",
  options: ["", ""],
});

function draftFromField(field) {
  return {
    label: field.label,
    help: field.help || "",
    isRequired: field.is_required,
    source: field.source,
    sorField: field.sor_field || SOR_STAGE_FIELD_KEYS[0],
    fieldType: field.field_type || "text",
    options: field.options?.length ? field.options : ["", ""],
  };
}

function payloadFrom(draft) {
  return {
    label: draft.label,
    help: draft.help?.trim() || null,
    source: draft.source,
    sorField: draft.source === "sor" ? draft.sorField : null,
    fieldType: draft.source === "custom" ? draft.fieldType : null,
    options:
      draft.source === "custom" && draft.fieldType === "choice"
        ? cleanChoiceOptions(draft.options)
        : [],
    isRequired: draft.isRequired,
  };
}

/**
 * A Stage's Fields tab (issue #203): the small form the SOR renders under
 * that Stage's checklist. Mirrors `StageConditionManager`'s add/edit/archive/
 * reorder shape exactly — same "no direct table access, only
 * `stageFieldService`" rule, same invalidation-on-every-write habit so a
 * field added here shows on the SOR in the same beat.
 */
export default function StageFieldManager({ stageId, disabled = false }) {
  const { user } = useAuth();
  const { stageField: stageFieldService } = useFlowData();
  const queryClient = useQueryClient();
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(emptyDraft());
  const [editingField, setEditingField] = useState(null);
  const [pendingArchive, setPendingArchive] = useState(null);
  const [showArchived, setShowArchived] = useState(false);

  const { data: fields, isLoading } = useQuery({
    queryKey: ["stageFields", stageId],
    queryFn: () => stageFieldService.getForStage(stageId),
    enabled: Boolean(stageId),
  });

  // Fetched separately, and only when asked for, so the ordinary list stays
  // one small query — archived rows are the exception, not part of the view.
  const { data: archivedFields = [] } = useQuery({
    queryKey: ["stageFields", stageId, "archived"],
    queryFn: async () => {
      const all = await stageFieldService.getForStage(stageId, { includeArchived: true });
      return all.filter((f) => f.archived_at);
    },
    enabled: Boolean(stageId) && showArchived,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["stageFields", stageId] });
    queryClient.invalidateQueries({ queryKey: ["stageFieldsByStage"] });
    // A field is part of the flow's snapshot shape, so adding, editing,
    // archiving or restoring one changes what the next publish would create.
    queryClient.invalidateQueries({ queryKey: ["flowVersionPreview"] });
    queryClient.invalidateQueries({ queryKey: ["flowDraftSnapshotData"] });
  };

  const resetForm = () => {
    setDraft(emptyDraft());
    setIsAdding(false);
    setEditingId(null);
    setEditingField(null);
  };

  const addMutation = useMutation({
    mutationFn: (payload) => stageFieldService.add({ stageId, ...payload }, user?.id),
    onSuccess: () => {
      invalidate();
      toast.success("Field added.");
      resetForm();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload, field }) =>
      stageFieldService.update(
        id,
        {
          label: payload.label,
          help: payload.help,
          isRequired: payload.isRequired,
          // `update` refuses `options` on anything but a custom choice field
          // — only send it when that's what's being edited.
          ...(field.source === "custom" && field.field_type === "choice" ? { options: payload.options } : {}),
        },
        user?.id,
      ),
    onSuccess: () => {
      invalidate();
      toast.success("Field updated.");
      resetForm();
    },
    onError: (err) => toast.error(err.message),
  });

  const archiveMutation = useMutation({
    mutationFn: (id) => stageFieldService.archive(id, user?.id),
    onSuccess: () => {
      invalidate();
      toast.success("Field archived.");
    },
    onError: (err) => toast.error(err.message),
  });

  const restoreMutation = useMutation({
    mutationFn: (id) => stageFieldService.restore(id, user?.id),
    onSuccess: () => {
      invalidate();
      toast.success("Field restored.");
    },
    onError: (err) => toast.error(err.message),
  });

  const reorderMutation = useMutation({
    mutationFn: (updates) => stageFieldService.reorder(updates, user?.id),
    onSuccess: invalidate,
    onError: (err) => {
      toast.error(err.message);
      invalidate();
    },
  });

  const moveField = (index, direction) => {
    if (!fields) return;
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= fields.length) return;
    const a = fields[index];
    const b = fields[newIndex];
    reorderMutation.mutate([
      { id: a.id, sortOrder: b.sort_order },
      { id: b.id, sortOrder: a.sort_order },
    ]);
  };

  const startEdit = (field) => {
    if (editingId === field.id) {
      resetForm();
      return;
    }
    setEditingId(field.id);
    setEditingField(field);
    setDraft(draftFromField(field));
    setIsAdding(false);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!draft.label.trim() || !stageId) return;
    if (draft.source === "custom" && draft.fieldType === "choice") {
      const error = choiceOptionsError(draft.options);
      if (error) return toast.error(error);
    }
    const payload = payloadFrom(draft);
    if (editingId) {
      updateMutation.mutate({ id: editingId, payload, field: editingField });
    } else {
      addMutation.mutate(payload);
    }
  };

  const isFormOpen = isAdding || Boolean(editingId);
  const isSaving = addMutation.isPending || updateMutation.isPending;

  const renderForm = () => (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-2xl bg-mauve-a2 p-4 outline outline-1 -outline-offset-1 outline-mauve-6"
    >
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">
          {editingId ? "Edit field" : "New field"}
        </h4>
        <Button type="button" variant="ghost" size="icon-xs" onClick={resetForm} aria-label="Cancel">
          <X />
        </Button>
      </div>

      <Input
        label="Label"
        value={draft.label}
        onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
        placeholder="e.g. Award amount"
        required
      />

      <Input
        label="Help text"
        value={draft.help}
        onChange={(e) => setDraft((d) => ({ ...d, help: e.target.value }))}
        placeholder="What should the salesperson enter?"
      />

      <div className="rounded-xl border border-border bg-muted/30 p-3">
        <span className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Source
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={Boolean(editingId)}
            onClick={() => setDraft((d) => ({ ...d, source: "sor" }))}
            className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
              draft.source === "sor" ? "bg-mauve-12 text-mauve-1" : "bg-mauve-a3 text-muted-foreground hover:bg-mauve-a4"
            }`}
          >
            SOR field
          </button>
          <button
            type="button"
            disabled={Boolean(editingId)}
            onClick={() => setDraft((d) => ({ ...d, source: "custom" }))}
            className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
              draft.source === "custom" ? "bg-mauve-12 text-mauve-1" : "bg-mauve-a3 text-muted-foreground hover:bg-mauve-a4"
            }`}
          >
            Custom
          </button>
        </div>

        {draft.source === "sor" ? (
          <select
            aria-label="SOR field"
            disabled={Boolean(editingId)}
            value={draft.sorField}
            onChange={(e) => setDraft((d) => ({ ...d, sorField: e.target.value }))}
            className="mt-2 flex h-8 w-full rounded-md border border-input bg-transparent px-2.5 py-1 text-xs shadow-sm disabled:opacity-50"
          >
            {SOR_STAGE_FIELD_KEYS.map((key) => (
              <option key={key} value={key}>
                {SOR_STAGE_FIELDS[key].label}
              </option>
            ))}
          </select>
        ) : (
          <>
            <select
              aria-label="Field type"
              disabled={Boolean(editingId)}
              value={draft.fieldType}
              onChange={(e) => setDraft((d) => ({ ...d, fieldType: e.target.value }))}
              className="mt-2 flex h-8 w-full rounded-md border border-input bg-transparent px-2.5 py-1 text-xs shadow-sm disabled:opacity-50"
            >
              {CUSTOM_FIELD_TYPE_VALUES.map((type) => (
                <option key={type} value={type}>
                  {type[0].toUpperCase() + type.slice(1)}
                </option>
              ))}
            </select>
            {draft.fieldType === "choice" && (
              <ChoiceOptionsEditor
                options={draft.options}
                onChange={(options) => setDraft((d) => ({ ...d, options }))}
              />
            )}
          </>
        )}
      </div>

      <label className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 p-3">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-foreground">Required to leave</span>
          <span className="block text-xs leading-snug text-muted-foreground">
            An empty required field blocks the move with "Fill in: {draft.label || "…"}&quot;.
          </span>
        </span>
        <Switch
          checked={draft.isRequired}
          onCheckedChange={(v) => setDraft((d) => ({ ...d, isRequired: v }))}
        />
      </label>

      <StageFieldPreview draft={draft} />

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="lg" onClick={resetForm}>
          Cancel
        </Button>
        <Button type="submit" size="lg" disabled={isSaving}>
          {isSaving ? "Saving…" : editingId ? "Save changes" : "Save field"}
        </Button>
      </div>
    </form>
  );

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-3 px-5 pt-5">
        <p className="text-xs leading-relaxed text-muted-foreground">
          What this Stage asks for, as a small form on the SOR — never a checklist row.
        </p>
        {!isFormOpen && stageId && !disabled && (
          <Button size="sm" variant="outline" onClick={() => setIsAdding(true)} className="shrink-0">
            <Plus /> Add
          </Button>
        )}
      </div>

      <div className="space-y-2 p-5">
        {isAdding && !disabled && (
          <div className="mb-4">
            {renderForm()}
          </div>
        )}

        {isLoading ? (
          <p className="animate-pulse py-6 text-center text-sm text-muted-foreground">Loading fields…</p>
        ) : fields?.length === 0 && !isFormOpen ? (
          <div className="rounded-2xl border border-dashed border-mauve-7 px-5 py-8 text-center">
            <ListChecks size={22} className="mx-auto mb-2 text-muted-foreground/60" />
            <p className="text-sm font-semibold text-foreground">This Stage asks for nothing</p>
            <p className="mx-auto mt-1 text-xs leading-relaxed text-muted-foreground">
              Add a field to collect it on the SOR — never as a checklist row.
            </p>
          </div>
        ) : (
          fields?.map((field, index) => {
            const isEditing = editingId === field.id;

            return (
              <div key={field.id} className="space-y-2">
                <div
                  className={cn(
                    "group flex items-center gap-3 rounded-xl bg-card px-3 py-2.5 outline outline-1 -outline-offset-1 outline-mauve-6 transition-colors hover:outline-mauve-8",
                    isEditing && "outline-mauve-8 bg-mauve-a2",
                  )}
                >
                  {!disabled && (
                    <div className="flex shrink-0 flex-col">
                      <button
                        onClick={() => moveField(index, "up")}
                        disabled={index === 0 || reorderMutation.isPending}
                        aria-label={`Move ${field.label} earlier`}
                        className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-mauve-a3 hover:text-foreground disabled:opacity-20"
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        onClick={() => moveField(index, "down")}
                        disabled={index === fields.length - 1 || reorderMutation.isPending}
                        aria-label={`Move ${field.label} later`}
                        className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-mauve-a3 hover:text-foreground disabled:opacity-20"
                      >
                        <ArrowDown size={13} />
                      </button>
                    </div>
                  )}

                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-a3 text-amber-11">
                    <ListChecks size={15} strokeWidth={2.5} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-sm font-bold text-foreground">{field.label}</p>
                      {!field.is_required && (
                        <span className="shrink-0 rounded bg-mauve-a3 px-1.5 py-px text-[9px] font-black uppercase tracking-[0.1em] text-mauve-11">
                          Optional
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {field.source === "sor" ? SOR_STAGE_FIELDS[field.sor_field]?.label ?? field.sor_field : `Custom · ${field.field_type}`}
                    </p>
                  </div>

                  {!disabled && (
                    <div
                      className={cn(
                        "flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100",
                        isEditing && "opacity-100",
                      )}
                    >
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => startEdit(field)}
                        aria-label={`Edit ${field.label}`}
                        className={cn(
                          "text-muted-foreground hover:text-foreground",
                          isEditing && "bg-mauve-a3 text-foreground",
                        )}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setPendingArchive(field)}
                        disabled={archiveMutation.isPending}
                        aria-label={`Archive ${field.label}`}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Archive />
                      </Button>
                    </div>
                  )}
                </div>

                {isEditing && !disabled && (
                  <div className="pt-0.5">
                    {renderForm()}
                  </div>
                )}
              </div>
            );
          })
        )}

        {stageId && !disabled && (
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              className="text-[11px] font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {showArchived ? "Hide archived fields" : "Show archived fields"}
            </button>

            {showArchived && (
              <div className="mt-2 space-y-2">
                {archivedFields.length === 0 ? (
                  <p className="px-1 py-2 text-xs text-muted-foreground">
                    Nothing archived on this Stage.
                  </p>
                ) : (
                  archivedFields.map((field) => (
                    <div
                      key={field.id}
                      className="flex items-center gap-3 rounded-xl bg-muted/40 px-3 py-2.5 outline outline-1 -outline-offset-1 outline-dashed outline-mauve-6"
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-mauve-a3 text-muted-foreground">
                        <Archive size={15} strokeWidth={2.5} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-muted-foreground line-through">
                          {field.label}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          Archived {new Date(field.archived_at).toLocaleDateString()}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => restoreMutation.mutate(field.id)}
                        disabled={restoreMutation.isPending}
                        aria-label={`Restore ${field.label}`}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <ArchiveRestore />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(pendingArchive)}
        onOpenChange={(open) => !open && setPendingArchive(null)}
        title={`Archive “${pendingArchive?.label}”?`}
        description="It stops appearing on the SOR, and every value already saved against it keeps that record. You can bring it back with “Show archived fields”."
        confirmLabel="Archive"
        tone="destructive"
        onConfirm={() => archiveMutation.mutate(pendingArchive.id)}
      />
    </div>
  );
}
