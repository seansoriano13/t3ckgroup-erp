import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Eye, EyeOff, GripVertical, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import toast from "react-hot-toast";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Spinner from "@/components/ui/Spinner";
import { useFlowData } from "./FlowDataContext";
import { useAuth } from "../../context/AuthContext";
import { FORM_FIELD_TYPES, isCoreFormField, resolveFormFields } from "../../constants/sorFormBuilder";
import RegistrationField, { SAMPLE_FIELD_CTX } from "../sor/RegistrationField";
import ChoiceOptionsEditor from "./ChoiceOptionsEditor";
import { cleanChoiceOptions, choiceOptionsError } from "./choiceOptions";
import { Select } from "@/components/ui/select";

/**
 * The SOR registration form, shown exactly as a salesperson will see it, and
 * editable in place.
 *
 * It draws the real fields through `RegistrationField` — the same component
 * the live form uses — inside the same modal chrome as the registration form
 * itself, so "this is what they will see" is true by construction rather than
 * by two files agreeing. Drag a field to reorder it, click its label to rename
 * it, toggle whether it is asked for at all.
 *
 * The Product List and Ownership are drawn but not editable: they are fixed
 * parts of the form, and showing them greyed is more honest than pretending
 * the form ends above them.
 */
export default function SorFormBuilder({ flow }) {
  const [open, setOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [draft, setDraft] = useState({ label: "", help: "", fieldType: "text", options: ["", ""], isRequired: false });
  const [renaming, setRenaming] = useState(null);
  const [pendingRestore, setPendingRestore] = useState(false);
  const [pendingRemove, setPendingRemove] = useState(null);

  const { user } = useAuth();
  const { formField: formFieldService } = useFlowData();
  const queryClient = useQueryClient();
  const flowId = flow?.id;

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["flowFormFields", flowId],
    queryFn: () => formFieldService.getForFlow(flowId),
    enabled: open && Boolean(flowId),
  });

  const fields = resolveFormFields(rows);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["flowFormFields", flowId] });
    queryClient.invalidateQueries({ queryKey: ["flowVersionPreview"] });
    queryClient.invalidateQueries({ queryKey: ["flowDraftSnapshotData"] });
  };

  const run = (promise, message) =>
    promise
      .then(() => {
        invalidate();
        if (message) toast.success(message);
      })
      .catch((err) => toast.error(err.message));

  // Reordering a default that has never been customized creates its row first
  // — "unchanged" is stored as the absence of a row, so there is nothing to
  // update until something changes.
  const persistOrder = (field, sortOrder) =>
    field.source === "default"
      ? formFieldService.customizeDefault({ flowId, defaultKey: field.key, sortOrder }, user?.id)
      : formFieldService.reorder([{ id: field.id, sortOrder }], user?.id);

  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const from = fields.findIndex((f) => f.key === active.id);
    const to = fields.findIndex((f) => f.key === over.id);
    if (from < 0 || to < 0) return;

    const next = arrayMove(fields, from, to);
    run(Promise.all(next.map((field, index) => persistOrder(field, index))));
  };

  const setHidden = (field, isHidden) =>
    run(
      field.source === "default"
        ? formFieldService.customizeDefault({ flowId, defaultKey: field.key, isHidden }, user?.id)
        : formFieldService.updateCustom(field.id, { isHidden }, user?.id),
    );

  const setRequired = (field, isRequired) =>
    run(
      field.source === "default"
        ? formFieldService.customizeDefault({ flowId, defaultKey: field.key, isRequired }, user?.id)
        : formFieldService.updateCustom(field.id, { isRequired }, user?.id),
    );

  const commitRename = (field, label) => {
    setRenaming(null);
    if (!label.trim() || label.trim() === field.label) return;
    run(
      field.source === "default"
        ? formFieldService.customizeDefault({ flowId, defaultKey: field.key, label }, user?.id)
        : formFieldService.updateCustom(field.id, { label }, user?.id),
    );
  };

  const addMutation = useMutation({
    mutationFn: () =>
      formFieldService.addCustom(
        {
          flowId,
          label: draft.label,
          help: draft.help?.trim() || null,
          fieldType: draft.fieldType,
          options:
            draft.fieldType === "choice"
              ? cleanChoiceOptions(draft.options)
              : [],
          isRequired: draft.isRequired,
        },
        user?.id,
      ),
    onSuccess: () => {
      invalidate();
      toast.success("Field added.");
      setIsAdding(false);
      setDraft({ label: "", help: "", fieldType: "text", options: ["", ""], isRequired: false });
    },
    onError: (err) => toast.error(err.message),
  });

  if (!flow) return null;

  return (
    <>
      <Button variant="ghost" size="lg" onClick={() => setOpen(true)} aria-label="Registration form">
        <Pencil /> Registration form
      </Button>

      {/* The registration form's own modal chrome, deliberately: same width,
          same header/body/footer, same scroll behaviour. It also portals out
          of the canvas toolbar, which is what the previous drawer failed to do
          — sized against the toolbar pill, it came out short and see-through. */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-popover text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none p-0 gap-0 z-70 shadow-[0_10px_40px_-10px_rgba(79,70,229,0.15)] flex flex-col w-full max-w-[95vw] sm:max-w-[680px] rounded-2xl max-h-[90vh] overflow-hidden"
        >
          <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border/60 shrink-0">
            <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
              <div className="w-[18px] h-[18px] rounded flex items-center justify-center bg-primary text-[9px] font-bold text-primary-foreground shrink-0">
                OPP
              </div>
              <ChevronDown size={11} className="text-muted-foreground/50 -rotate-90" />
              <span className="font-medium text-muted-foreground/80">Registration form</span>
              <span className="text-muted-foreground/30">•</span>
              <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground/60">
                {flow.name || "This Sale Type"}
              </span>
            </div>
            <Button
              onClick={() => setOpen(false)}
              variant="ghost" size="icon-xs"
            >
              <X size={15} />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 min-h-0 space-y-4">
            <p className="text-[11px] text-muted-foreground leading-relaxed bg-muted/40 border border-border rounded-xl px-3 py-2.5">
              This is the form a salesperson fills in when registering an SOR against this Sale
              Type. Drag a field to reorder it, click its name to rename it, and use the toggles to
              choose what is asked for.
            </p>

            {isAdding && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!draft.label.trim()) return;
                  const error = draft.fieldType === "choice" && choiceOptionsError(draft.options);
                  if (error) return toast.error(error);
                  addMutation.mutate();
                }}
                className="space-y-3 rounded-2xl bg-mauve-a2 p-4 outline outline-1 -outline-offset-1 outline-mauve-6"
              >
                <div className="flex items-center justify-between">
                  <h4 className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">
                    New field
                  </h4>
                  <Button type="button" variant="ghost" size="icon-xs" onClick={() => setIsAdding(false)} aria-label="Cancel">
                    <X />
                  </Button>
                </div>

                <Input
                  label="Label"
                  value={draft.label}
                  onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                  placeholder="e.g. Bid Bond Reference"
                  required
                />
                <Input
                  label="Help text"
                  value={draft.help}
                  onChange={(e) => setDraft((d) => ({ ...d, help: e.target.value }))}
                  placeholder="What should the salesperson enter?"
                />
                <Select
  options={[...FORM_FIELD_TYPES.map((type) => ({ value: type, label: type[0].toUpperCase() + type.slice(1) }))]}
  value={draft.fieldType}
  onChange={(next) => setDraft((d) => ({ ...d, fieldType: next }))}
  aria-label="Field type"
  className="w-full"
/>
                {draft.fieldType === "choice" && (
                  <ChoiceOptionsEditor
                    options={draft.options}
                    onChange={(options) => setDraft((d) => ({ ...d, options }))}
                  />
                )}
                <label className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 p-3">
                  <span className="text-sm font-semibold text-foreground">Required to register</span>
                  <Switch
                    checked={draft.isRequired}
                    onCheckedChange={(v) => setDraft((d) => ({ ...d, isRequired: v }))}
                  />
                </label>
                <div className="flex items-center justify-end gap-2">
                  <Button type="button" variant="ghost" size="lg" onClick={() => setIsAdding(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" size="lg" disabled={addMutation.isPending}>
                    {addMutation.isPending ? "Saving…" : "Save field"}
                  </Button>
                </div>
              </form>
            )}

            {isLoading ? (
              <div className="flex justify-center py-8">
                <Spinner size="sm" />
              </div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={fields.map((f) => f.key)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-3">
                    {fields.map((field) => (
                      <BuilderRow
                        key={field.key}
                        field={field}
                        renaming={renaming === field.key}
                        onStartRename={() => setRenaming(field.key)}
                        onCommitRename={(label) => commitRename(field, label)}
                        onToggleHidden={() => setHidden(field, !field.isHidden)}
                        onToggleRequired={(v) => setRequired(field, v)}
                        onRemove={() => setPendingRemove(field)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}

            {/* Fixed parts of the form. Drawn so the builder shows the whole
                thing, dimmed so it is clear they are not configurable. */}
            <div className="pt-2 border-t border-border/50 space-y-3 opacity-50 pointer-events-none select-none">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                Product List, Sales Division and Ownership — always on the form
              </p>
              <div className="rounded-xl border border-dashed border-border bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
                Not configurable
              </div>
            </div>
          </div>

          <div className="px-5 py-4 border-t border-border bg-muted/30 flex items-center justify-between shrink-0">
            <Button variant="ghost" size="lg" onClick={() => setPendingRestore(true)}>
              <RotateCcw /> Restore default
            </Button>
            <div className="flex items-center gap-2.5">
              <Button variant="outline" size="lg" onClick={() => setIsAdding(true)}>
                <Plus /> Add field
              </Button>
              <Button size="lg" onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingRestore}
        onOpenChange={setPendingRestore}
        title="Restore the default form?"
        description="Every change to this flow's registration form is discarded — renamed labels, hidden fields, the order, and any custom fields you added, along with the answers already saved against them. SORs already registered keep the form they were registered on."
        confirmLabel="Restore"
        tone="destructive"
        onConfirm={() => run(formFieldService.restoreDefaults(flowId, user?.id), "Registration form restored to the default.")}
      />

      <ConfirmDialog
        open={Boolean(pendingRemove)}
        onOpenChange={(v) => !v && setPendingRemove(null)}
        title={`Remove “${pendingRemove?.label}”?`}
        description="It stops appearing on the registration form. Answers already given keep their record, and you can bring the field back."
        confirmLabel="Remove"
        tone="destructive"
        onConfirm={() => run(formFieldService.archiveCustom(pendingRemove.id, user?.id), "Field removed.")}
      />
    </>
  );
}

/**
 * One draggable row: the real field, plus the handle and the controls that act
 * on it. The controls sit in a rail beside the field rather than replacing it,
 * so what you are editing stays the thing you are looking at.
 */
function BuilderRow({ field, renaming, onStartRename, onCommitRename, onToggleHidden, onToggleRequired, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.key,
  });
  const core = field.source === "default" && isCoreFormField(field.key);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group relative rounded-xl transition-shadow",
        isDragging && "z-10 shadow-lg ring-1 ring-mauve-8",
        field.isHidden && "opacity-45",
      )}
    >
      <div className="flex items-start gap-2">
        <Button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${field.label}`}
          variant="ghost" size="icon-xs" className="mt-4 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        >
          <GripVertical size={15} />
        </Button>

        <div className="min-w-0 flex-1">
          {renaming ? (
            <Input
              autoFocus
              defaultValue={field.label}
              onBlur={(e) => onCommitRename(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") onCommitRename(field.label);
              }}
              aria-label={`Rename ${field.label}`}
              containerClassName="mb-1 w-full"
            />
          ) : null}
          <RegistrationField field={field} ctx={SAMPLE_FIELD_CTX} disabled />
        </div>

        <div className="mt-3 flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <Button
            type="button"
            onClick={onStartRename}
            aria-label={`Rename ${field.label}`}
            title="Rename"
            variant="ghost" size="icon-xs"
          >
            <Pencil size={14} />
          </Button>

          {!core && (
            <>
              <Button
                type="button"
                onClick={onToggleHidden}
                aria-label={field.isHidden ? `Show ${field.label}` : `Hide ${field.label}`}
                title={field.isHidden ? "Show on the form" : "Hide from the form"}
                variant="ghost" size="icon-xs"
              >
                {field.isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
              </Button>
              <label
                className="flex items-center gap-1 rounded px-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
                title="Required to register"
              >
                Req
                <Switch checked={field.isRequired} onCheckedChange={onToggleRequired} />
              </label>
            </>
          )}

          {core && (
            <span
              title="Required to register an SOR — rename and reorder only."
              className="rounded bg-mauve-a3 px-1.5 py-px text-[9px] font-black uppercase tracking-[0.1em] text-mauve-11"
            >
              Core
            </span>
          )}

          {field.source === "custom" && (
            <Button
              type="button"
              onClick={onRemove}
              aria-label={`Remove ${field.label}`}
              title="Remove"
              variant="ghost" size="icon-xs"
            >
              <Trash2 size={14} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
