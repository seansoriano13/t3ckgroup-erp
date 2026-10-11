import { useState, useEffect, useMemo, useRef } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { X, ChevronDown, Check, LayoutTemplate } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import Spinner from "@/components/ui/Spinner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { groupRoleService } from "../../../../services/groupRoleService";
import { groupTaskTemplateService } from "../../../../services/groupTaskTemplateService";
import GroupRoleManagerModal from "../../_components/GroupRoleManagerModal";
import GroupTaskMemberRail from "../../_components/GroupTaskMemberRail";
import GroupTaskMemberPanel from "../../_components/GroupTaskMemberPanel";
import { makeMemberDraft } from "../../utils/templateApply";
import { cleanChecklistForSave } from "@/utils/checklist";
import { Input } from "@/components/ui/input";

import { Textarea } from "@/components/ui/textarea";
/**
 * TemplateEditorModal — create/edit a Group Task Template.
 *
 * Deliberately its own modal rather than a "mode" flag on CreateGroupTaskModal:
 * almost every task-level field differs in type and requiredness here (title
 * optional not required, a day-offset integer instead of an absolute due
 * date, a `name` field the group task form never has), and blank-employee
 * slots must be KEPT here where CreateGroupTaskModal's submit silently drops
 * them. Reuses GroupTaskMemberRail/GroupTaskMemberPanel as-is — both are
 * already generic on the member-draft shape and tolerate a null employeeId.
 */
export default function TemplateEditorModal({
  isOpen,
  onClose,
  templateId,
  user,
  employees,
  onSaved,
}) {
  const isEditing = !!templateId;

  const [isRoleManagerOpen, setIsRoleManagerOpen] = useState(false);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDateOffsetDays, setDueDateOffsetDays] = useState("");
  const [members, setMembers] = useState(() => [makeMemberDraft()]);
  const [selectedMemberId, setSelectedMemberId] = useState(null);

  const nameRef = useRef(null);
  const queryClient = useQueryClient();

  const { data: roles = [], isLoading: isRolesLoading } = useQuery({
    queryKey: ["groupRoles"],
    queryFn: groupRoleService.getRoles,
    enabled: isOpen,
  });

  const { data: templateData, isLoading: isTemplateLoading } = useQuery({
    queryKey: ["groupTaskTemplate", templateId],
    queryFn: () => groupTaskTemplateService.getTemplateById(templateId),
    enabled: isOpen && isEditing,
  });

  // Reset to a blank draft whenever a "New Template" open happens.
  useEffect(() => {
    if (isOpen && !isEditing) {
      const first = makeMemberDraft();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setName("");
      setTitle("");
      setDescription("");
      setDueDateOffsetDays("");
      setMembers([first]);
      setSelectedMemberId(first.id);
      setTimeout(() => nameRef.current?.focus(), 150);
    }
  }, [isOpen, isEditing]);

  // Hydrate from the fetched template whenever an "Edit" open resolves. Kept
  // separate from the reset effect above since this one depends on async data.
  useEffect(() => {
    if (isOpen && isEditing && templateData) {
      const hydrated = (templateData.members || []).map((m) => {
        const checklist = cleanChecklistForSave(m.checklist, { resetChecked: true });
        return {
          ...makeMemberDraft(),
          employeeId: m.employee_id || null,
          taskDescription: m.task_description || "",
          checklist,
          showChecklist: !!checklist,
          role: m.role || "",
          customRole: m.custom_role || "",
        };
      });
      const nextMembers = hydrated.length > 0 ? hydrated : [makeMemberDraft()];
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setName(templateData.name || "");
      setTitle(templateData.title || "");
      setDescription(templateData.description || "");
      setDueDateOffsetDays(
        templateData.due_date_offset_days != null
          ? String(templateData.due_date_offset_days)
          : "",
      );
      setMembers(nextMembers);
      setSelectedMemberId(nextMembers[0]?.id ?? null);
    }
  }, [isOpen, isEditing, templateData]);

  const employeeOptions = useMemo(() => {
    return employees
      .filter((e) => !e.is_super_admin)
      .map((e) => ({ value: e.id, label: e.name, department: e.department }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [employees]);

  const selectedMember = members.find((m) => m.id === selectedMemberId) || null;

  const handleAddMember = () => {
    const next = makeMemberDraft();
    setMembers((prev) => [...prev, next]);
    setSelectedMemberId(next.id);
  };

  const handleRemoveMember = (id) => {
    setMembers((prev) =>
      prev.map((m) => (m.id === id ? { ...m, isRemoving: true } : m)),
    );
    setTimeout(() => {
      setMembers((prev) => {
        const remaining = prev.filter((m) => m.id !== id);
        if (id === selectedMemberId) {
          setSelectedMemberId(remaining[0]?.id ?? null);
        }
        return remaining;
      });
    }, 250);
  };

  const handleMemberChange = (id, field, value) => {
    setMembers((prev) =>
      prev.map((m) => (m.id === id ? { ...m, [field]: value } : m)),
    );
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const trimmedName = name.trim();
      if (!trimmedName) {
        throw new Error("Name your template before saving it.");
      }

      const payload = {
        name: trimmedName,
        title: title.trim() || null,
        description: description.trim() || null,
        dueDateOffsetDays:
          dueDateOffsetDays.trim() === "" ? null : Number(dueDateOffsetDays),
        createdBy: user.id,
        members,
      };

      return isEditing
        ? groupTaskTemplateService.updateTemplate(templateId, payload)
        : groupTaskTemplateService.createTemplate(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groupTaskTemplates"] });
      if (isEditing) {
        queryClient.invalidateQueries({ queryKey: ["groupTaskTemplate", templateId] });
      }
      toast.success(isEditing ? "Template updated." : "Template created.");
      onSaved?.();
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    saveMutation.mutate();
  };

  const isLoadingExisting = isEditing && isTemplateLoading;

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          showCloseButton={false}
          className="p-0 gap-0 z-[70] shadow-[0_10px_40px_-10px_rgba(79,70,229,0.15)] flex flex-col w-[1120px] max-w-[95vw] sm:max-w-none max-h-[90vh] rounded-2xl overflow-hidden"
        >
          {/* HEADER */}
          <div className="flex items-center justify-between px-5 pt-4 pb-2 border-b border-mauve-3/40 shrink-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="w-[18px] h-[18px] rounded flex items-center justify-center bg-primary text-primary-foreground shrink-0">
                <LayoutTemplate size={11} />
              </div>
              <ChevronDown size={11} className="text-mauve-6 rotate-[-90deg]" />
              <span className="font-medium text-muted-foreground/80">
                {isEditing ? "Edit Template" : "New Template"}
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              className="rounded-md text-muted-foreground hover:bg-muted/80 hover:text-foreground"
              aria-label="Close"
            >
              <X size={15} />
            </Button>
          </div>

          {isLoadingExisting ? (
            <div className="flex-1 flex items-center justify-center py-20">
              <Spinner size="md" />
            </div>
          ) : (
            <form
              id="template-editor-form"
              onSubmit={handleSubmit}
              className="flex-1 flex flex-col min-h-0"
            >
              {/* TEMPLATE-LEVEL FIELDS */}
              <div className="shrink-0 px-6 pt-5 pb-4 border-b border-border/60">
                <Input
                  ref={nameRef}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Template Name (e.g. Monthly Safety Audit)"
                  containerClassName="w-full mb-2" className="border-0 bg-transparent rounded-none px-0 py-0 shadow-none focus-visible:ring-0 h-auto text-xl font-semibold text-foreground bg-transparent outline-none placeholder:text-mauve-6 border-b border-transparent focus-visible:border-primary pb-1"
                  autoComplete="off"
                />

                <div className="flex items-start gap-6 flex-wrap">
                  <div className="flex-1 min-w-[260px] flex flex-col gap-3">
                    <Input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Default group task title (optional — leave blank to type it fresh each time)"
                      containerClassName="w-full" className="h-auto bg-card border border-border rounded-lg px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/50 transition-colors"
                    />
                    <Textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Default description (optional)…"
                      className="h-16 min-h-0 resize-y rounded-lg px-3 py-2 text-[13px] md:text-[13px]"
                    />
                  </div>

                  <div className="flex flex-col shrink-0">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">
                      Due In (Days)
                    </span>
                    <Input
                      type="number"
                      value={dueDateOffsetDays}
                      onChange={(e) => setDueDateOffsetDays(e.target.value)}
                      placeholder="Optional — e.g. 3"
                      containerClassName="w-40" className="h-auto bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground outline-none focus:border-primary/50 transition-colors"
                    />
                  </div>
                </div>
              </div>

              {/* MASTER / DETAIL */}
              <div className="flex-1 flex min-h-0">
                <div className="w-[260px] shrink-0 min-h-0">
                  <GroupTaskMemberRail
                    members={members}
                    selectedId={selectedMemberId}
                    onSelect={setSelectedMemberId}
                    onAdd={handleAddMember}
                    onRemove={handleRemoveMember}
                    currentUserId={user?.id}
                    resolveEmployee={(m) =>
                      employees.find((e) => e.id === m.employeeId)
                    }
                    mode="template"
                  />
                </div>

                <div className="flex-1 flex flex-col min-h-0 min-w-0">
                  <GroupTaskMemberPanel
                    member={selectedMember}
                    employeeOptions={employeeOptions}
                    roles={roles}
                    isRolesLoading={isRolesLoading}
                    onManageRoles={() => setIsRoleManagerOpen(true)}
                    onChange={(field, value) =>
                      handleMemberChange(selectedMemberId, field, value)
                    }
                  />
                </div>
              </div>
            </form>
          )}

          {/* FOOTER */}
          <div className="px-5 py-4 border-t border-border bg-muted/30 flex items-center justify-end gap-2.5 shrink-0">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="text-[13px] font-bold text-muted-foreground/80 hover:text-foreground h-9 rounded-xl px-4"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="template-editor-form"
              disabled={saveMutation.isPending || isLoadingExisting}
              className="h-9 px-6 rounded-xl shadow-lg shadow-primary/20"
            >
              {saveMutation.isPending ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  <span>Saving…</span>
                </>
              ) : (
                <>
                  <Check size={16} strokeWidth={3} className="mr-1.5" />
                  <span>{isEditing ? "Save Template" : "Create Template"}</span>
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <GroupRoleManagerModal
        isOpen={isRoleManagerOpen}
        onClose={() => setIsRoleManagerOpen(false)}
      />
    </>
  );
}
