import { useState, useMemo, useEffect, useRef } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Maximize2,
  Minimize2,
  X,
  ChevronDown,
  Check,
  Calendar,
  LayoutTemplate,
  BookmarkPlus,
} from "lucide-react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import Spinner from "@/components/ui/Spinner";
import Dropdown from "@/components/ui/Dropdown";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { groupRoleService } from "../../../services/groupRoleService";
import { groupTaskTemplateService } from "../../../services/groupTaskTemplateService";
import { confirmActionToast } from "../../../components/ui/CustomToast";
import { useEmployeeAvatarMap } from "../../../hooks/useEmployeeAvatarMap";
import GroupRoleManagerModal from "./GroupRoleManagerModal";
import GroupTaskMemberRail from "./GroupTaskMemberRail";
import GroupTaskMemberPanel from "./GroupTaskMemberPanel";
import SaveGroupTaskTemplateModal from "./SaveGroupTaskTemplateModal";
import TemplateVariableChips from "@/components/ui/TemplateVariableChips";
import HighlightedTemplateField from "@/components/ui/HighlightedTemplateField";
import { cn } from "@/lib/utils";
import { formatDateToYMD } from "@/utils/dateUtils";
import PeoplePicker from "@/components/ui/PeoplePicker";
import { Switch } from "@/components/ui/switch";
import {
  hasChecklistContent,
  cleanChecklistForSave,
} from "@/utils/checklist";
import {
  applyTemplateToMembers,
  applyTemplateDefaults,
  hasDraftContent,
  computeDueDateOffsetDays,
} from "../utils/templateApply";
import { Input } from "@/components/ui/input";

import { Textarea } from "@/components/ui/textarea";
const makeMember = () => ({
  id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  employeeId: null,
  taskDescription: "",
  checklist: null,
  showChecklist: false,
  role: "",
  customRole: "",
  isRemoving: false,
});

/**
 * Members arriving from a saved stage action carry no `id`: handleSubmit
 * persists only the assignment fields. Identity is what the rail selects by,
 * what the detail panel resolves through and what handleMemberChange writes
 * back to, so anything without one gets a fresh one here. Skipping this makes
 * every row answer to `undefined` — the whole rail highlights at once, the
 * panel stays stuck on the first member, and an edit to one rewrites them all.
 */
const withMemberIds = (raw) =>
  (raw || []).map((m) => {
    if (m.id) return m;
    const base = makeMember();
    return { ...base, ...m, id: base.id };
  });

export default function CreateGroupTaskModal({
  isOpen,
  onClose,
  user,
  employees,
  onSubmit,
  isSubmitting,
  mode = "normal",
  initialData = null,
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isRoleManagerOpen, setIsRoleManagerOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState(null);
  const [dueOffsetDays, setDueOffsetDays] = useState("");
  const [startDate, setStartDate] = useState(null);
  const [leadTime, setLeadTime] = useState("");
  const [members, setMembers] = useState(() => [makeMember()]);
  const [selectedMemberId, setSelectedMemberId] = useState(null);
  const [appliedTemplateId, setAppliedTemplateId] = useState(null);
  const [isSaveTemplateModalOpen, setIsSaveTemplateModalOpen] = useState(false);
  const [confirmMode, setConfirmMode] = useState(undefined);
  const [decider, setDecider] = useState([]);
  const [evaluator, setEvaluator] = useState([]);

  const titleRef = useRef(null);
  const descriptionRef = useRef(null);
  const avatarMap = useEmployeeAvatarMap();
  const queryClient = useQueryClient();

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (isOpen) {
      if (initialData) {
        setTitle(initialData.title || "");
        setDescription(initialData.description || "");
        setDueOffsetDays(initialData.dueOffsetDays || "");
        setStartDate(null);
        setLeadTime("");
        const hydrated = withMemberIds(initialData.members);
        const nextMembers = hydrated.length > 0 ? hydrated : [makeMember()];
        setMembers(nextMembers);
        setSelectedMemberId(nextMembers[0]?.id ?? null);
        setAppliedTemplateId(null);
        setIsSaveTemplateModalOpen(false);
        setConfirmMode(initialData.confirmMode);
        setDecider(initialData.decider || []);
        setEvaluator(initialData.evaluator || []);
      } else {
        const first = makeMember();
        // Resetting on open is the point: the modal keeps its fields mounted
        // between openings, so without this the next open shows the last
        // session's input. isOpen is the external event being followed.
        setTitle("");
        setDescription("");
        setDueDate(null);
        setDueOffsetDays("");
        setStartDate(null);
        setLeadTime("");
        setMembers([first]);
        setSelectedMemberId(first.id);
        setAppliedTemplateId(null);
        setIsSaveTemplateModalOpen(false);
        setConfirmMode(undefined);
        setDecider([]);
        setEvaluator([]);
      }
      setTimeout(() => titleRef.current?.focus(), 150);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [isOpen, initialData]);

  const employeeOptions = useMemo(() => {
    return employees
      .filter((e) => !e.is_super_admin)
      .map((e) => ({ value: e.id, label: e.name, department: e.department }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [employees]);

  const { data: roles = [], isLoading: isRolesLoading } = useQuery({
    queryKey: ["groupRoles"],
    queryFn: groupRoleService.getRoles,
    enabled: isOpen,
  });

  const { data: templates = [] } = useQuery({
    queryKey: ["groupTaskTemplates"],
    queryFn: () => groupTaskTemplateService.getTemplates(),
    enabled: isOpen,
  });

  const saveTemplateMutation = useMutation({
    mutationFn: (name) =>
      groupTaskTemplateService.createTemplate({
        name,
        title: title.trim() || null,
        description: description.trim() || null,
        dueDateOffsetDays: computeDueDateOffsetDays(dueDate),
        createdBy: user.id,
        members,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groupTaskTemplates"] });
      toast.success("Template saved.");
      setIsSaveTemplateModalOpen(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const selectedMember = members.find((m) => m.id === selectedMemberId) || null;

  const handleApplyTemplate = (template) => {
    const apply = () => {
      const { members: newMembers, skippedCount } = applyTemplateToMembers(
        template,
        employees,
      );
      const nextMembers = newMembers.length > 0 ? newMembers : [makeMember()];
      setMembers(nextMembers);
      setSelectedMemberId(nextMembers[0]?.id ?? null);
      setAppliedTemplateId(template.id);

      const defaults = applyTemplateDefaults(template, { title, description, dueDate });
      setTitle(defaults.title || "");
      setDescription(defaults.description || "");
      setDueDate(defaults.dueDate || null);

      if (skippedCount > 0) {
        toast(
          `${skippedCount} slot${skippedCount === 1 ? "" : "s"} skipped — bound employee is no longer active.`,
          { icon: "⚠️" },
        );
      }
    };

    if (hasDraftContent(members, { title, description, dueDate })) {
      confirmActionToast(
        "Replace current draft?",
        `Applying "${template.name}" replaces the task details and members currently in this form.`,
        "Replace",
        null,
        apply,
      );
    } else {
      apply();
    }
  };

  const handleAddMember = () => {
    const next = makeMember();
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
        // Keep something selected, otherwise the panel empties out and the
        // modal looks broken after a delete.
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

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Title is required.");
      return;
    }

    if (mode !== "automation" && (!startDate || !dueDate)) {
      toast.error("Start Date and Due Date are required.");
      return;
    }

    // An assignment counts as filled in if it has description text OR at least
    // one non-empty checklist item — the two are alternatives now, not a
    // toggle between mutually exclusive fields.
    const validMembers = members.filter(
      (m) =>
        m.employeeId &&
        (m.taskDescription.trim() || hasChecklistContent(m.checklist)),
    );

    if (validMembers.length === 0) {
      toast.error("Add at least one member with a task description or checklist.");
      return;
    }

    const skipped = members.length - validMembers.length;
    if (skipped > 0) {
      toast(
        `${skipped} incomplete member ${skipped === 1 ? "card was" : "cards were"} skipped.`,
        { icon: "⚠️" },
      );
    }

    onSubmit({
      title,
      description,
      dueDate: mode === "automation" ? null : dueDate,
      dueDateOffsetDays: mode === "automation" ? dueOffsetDays : undefined,
      startDate: mode === "automation" || !startDate ? null : formatDateToYMD(startDate),
      leadTime: mode === "automation" ? null : leadTime,
      confirmMode: mode === "automation" ? confirmMode : undefined,
      decider: mode === "automation" && confirmMode === "confirm" ? decider : undefined,
      evaluator: mode === "automation" ? evaluator : undefined,
      evaluatorId: mode === "automation" ? undefined : evaluator[0]?.id ?? null,
      createdBy: user.id,
      templateId: appliedTemplateId ?? null,
      members: validMembers.map((m) => {
        return {
          employeeId: m.employeeId,
          taskDescription: m.taskDescription.trim(),
          checklist: cleanChecklistForSave(m.checklist),
          role: m.role,
          customRole: m.customRole,
        };
      }),
    });
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          showCloseButton={false}
          className={`p-0 gap-0 z-[70] shadow-[0_10px_40px_-10px_rgba(79,70,229,0.15)] flex flex-col transition-all duration-300 overflow-hidden ${
            isExpanded
              ? // Same override set the detail modal already uses — the bare
                // utilities lose to DialogContent's own centering classes.
                "!w-screen !h-screen !max-w-none !max-h-none !rounded-none !top-0 !left-0 !right-0 !bottom-0 !translate-x-0 !translate-y-0 !border-0 m-0"
              : "w-[1120px] max-w-[95vw] sm:max-w-none max-h-[90vh] rounded-2xl"
          }`}
        >
          {/* HEADER */}
          <div className="flex items-center justify-between px-5 pt-4 pb-2 border-b border-mauve-3/40 shrink-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="w-[18px] h-[18px] rounded flex items-center justify-center bg-primary text-primary-foreground font-bold text-[9px] shrink-0">
                {user?.department?.charAt(0)?.toUpperCase() || "G"}
              </div>
              <ChevronDown size={11} className="text-mauve-6 rotate-[-90deg]" />
              <span className="font-medium text-muted-foreground/80">
                New Group Task
              </span>
            </div>

            <Dropdown
              usePortal
              placement="bottom-start"
              trigger={({ isOpen: isTemplateDropdownOpen }) => (
                <Button
                  type="button"
                  variant="outline"
                  className={`h-auto gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold ${
                    isTemplateDropdownOpen
                      ? "bg-muted border-primary/30 text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  }`}
                >
                  <LayoutTemplate size={12} />
                  <span>Use Template</span>
                </Button>
              )}
            >
              {({ close }) => (
                <div className="min-w-[220px] max-h-64 overflow-y-auto flex flex-col gap-0.5">
                  {templates.length === 0 ? (
                    <p className="px-3 py-4 text-[11px] text-muted-foreground text-center">
                      No templates yet — save one from the footer below.
                    </p>
                  ) : (
                    templates.map((t) => (
                      <Button
                        key={t.id}
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          handleApplyTemplate(t);
                          close();
                        }}
                        className="h-auto justify-between gap-2 rounded-lg px-3 py-2 text-left text-[12px] font-semibold text-foreground hover:bg-sidebar-accent"
                      >
                        <span className="truncate">{t.name}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {(t.members || []).length} slot
                          {(t.members || []).length === 1 ? "" : "s"}
                        </span>
                      </Button>
                    ))
                  )}
                </div>
              )}
            </Dropdown>

            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setIsExpanded(!isExpanded)}
                className="rounded-md text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                title={isExpanded ? "Exit full screen" : "Full screen"}
                aria-label={isExpanded ? "Exit full screen" : "Full screen"}
              >
                {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </Button>
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
          </div>

          <form
            id="create-group-task-form"
            onSubmit={handleSubmit}
            className="flex-1 flex flex-col min-h-0"
          >
            {/* TASK-LEVEL FIELDS */}
            <div className="shrink-0 px-6 pt-5 pb-4 border-b border-border/60">
              {mode === "automation" ? (
                <HighlightedTemplateField
                  ref={titleRef}
                  as="input"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Group Task Title"
                  className="text-xl font-semibold placeholder:text-mauve-6 pb-1"
                  wrapperClassName="mb-2"
                  autoComplete="off"
                />
              ) : (
                <Input
                  ref={titleRef}
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Group Task Title"
                  containerClassName="w-full mb-2" className="border-0 bg-transparent rounded-none px-0 py-0 shadow-none focus-visible:ring-0 h-auto text-xl font-semibold text-foreground bg-transparent outline-none placeholder:text-mauve-6 border-b border-transparent focus-visible:border-primary pb-1"
                  autoComplete="off"
                />
              )}

              {mode === "automation" && (
                <TemplateVariableChips
                  value={title}
                  onInsert={(token) => titleRef.current?.insertToken(token)}
                  className="mb-2"
                />
              )}

              <div className="flex items-start gap-6 flex-wrap">
                <div className="flex-1 min-w-[260px]">
                  {mode === "automation" ? (
                    <HighlightedTemplateField
                      ref={descriptionRef}
                      as="textarea"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Provide an overview of the group task objective…"
                      className={cn("text-[13px] placeholder:text-mauve-6", isExpanded ? "h-20" : "h-14")}
                    />
                  ) : (
                    <Textarea variant="bare"
                      ref={descriptionRef}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Provide an overview of the group task objective…"
                      className={`resize-y text-[13px] md:text-[13px] ${
                        isExpanded ? "h-20" : "h-14"
                      }`}
                    />
                  )}
                  {mode === "automation" && (
                    <TemplateVariableChips
                      value={description}
                      onInsert={(token) => descriptionRef.current?.insertToken(token)}
                    />
                  )}
                </div>

                <div className="flex flex-col shrink-0">
                  <span className="text-label font-bold text-muted-foreground uppercase tracking-widest mb-1.5">
                    Target Due Date
                  </span>
                  <div className="relative">
                    {mode === "automation" ? (
                      <>
                        <Input
                          type="number"
                          min="0"
                          value={dueOffsetDays || ""}
                          onChange={(e) => setDueOffsetDays(e.target.value)}
                          placeholder="Offset Days (e.g. 3)"
                          containerClassName="w-60" className="h-auto bg-muted border border-border rounded-lg pl-8 pr-3 py-2 text-xs text-foreground outline-none focus:border-primary/50 transition-colors"
                        />
                        <Calendar
                          size={13}
                          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                        />
                      </>
                    ) : (
                      <>
                        <DatePicker
                          selected={dueDate}
                          onChange={(date) => setDueDate(date)}
                          showTimeSelect
                          timeIntervals={15}
                          dateFormat="MMMM d, yyyy h:mm aa"
                          placeholderText="Required due date & time"
                          className="bg-muted border border-border rounded-lg pl-8 pr-3 py-2 text-xs text-foreground outline-none focus:border-primary/50 transition-colors w-60"
                        />
                        <Calendar
                          size={13}
                          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                        />
                      </>
                    )}
                  </div>
                </div>

                {/* A task a Stage Action creates starts with both blank —
                    they are per-task facts, not something a flow can know. */}
                {mode !== "automation" && (
                  <>
                    <div className="flex flex-col shrink-0">
                      <span className="text-label font-bold text-muted-foreground uppercase tracking-widest mb-1.5">
                        Start Date
                      </span>
                      <div className="relative">
                        <DatePicker
                          selected={startDate}
                          onChange={(date) => setStartDate(date)}
                          dateFormat="MMMM d, yyyy"
                          placeholderText="Required start date"
                          className="bg-muted border border-border rounded-lg pl-8 pr-3 py-2 text-xs text-foreground outline-none focus:border-primary/50 transition-colors w-48"
                        />
                        <Calendar
                          size={13}
                          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col shrink-0">
                      <span className="text-label font-bold text-muted-foreground uppercase tracking-widest mb-1.5">
                        Lead Time
                      </span>
                      <Input
                        type="text"
                        value={leadTime}
                        onChange={(e) => setLeadTime(e.target.value)}
                        placeholder="e.g. 120 calendar days"
                        className="h-auto w-48 bg-muted px-3 py-2 text-xs md:text-xs"
                      />
                    </div>
                  </>
                )}
              </div>

              <div className="mt-3 space-y-1">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                  {mode === "automation"
                    ? "Evaluator: who rates this task (defaults to the Deal Owner)"
                    : "Evaluator: who rates this task (defaults to you)"}
                </span>
                {mode === "automation" ? (
                  <PeoplePicker value={evaluator} onChange={setEvaluator} allowRoles placeholder="Add Evaluator" />
                ) : (
                  <PeoplePicker
                    value={evaluator}
                    onChange={(next) => setEvaluator(next.slice(-1))}
                    types={["employee"]}
                    placeholder="Add Evaluator"
                  />
                )}
              </div>
              {mode === "automation" && (
                <div className="mt-3 flex items-center justify-between rounded-lg border border-dashed border-mauve-7 px-3 py-2">
                  <span className="text-xs font-semibold text-muted-foreground">
                    Require confirmation before running
                  </span>
                  <Switch
                    checked={confirmMode === "confirm"}
                    onCheckedChange={(next) => setConfirmMode(next ? "confirm" : undefined)}
                  />
                </div>
              )}
              {mode === "automation" && confirmMode === "confirm" && (
                <div className="mt-2 space-y-1">
                  <span className="text-label font-bold text-muted-foreground uppercase tracking-widest">
                    Decider (defaults to the Deal Owner)
                  </span>
                  <PeoplePicker value={decider} onChange={setDecider} allowRoles allowDepartments placeholder="Add Decider" />
                </div>
              )}
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
                  avatarMap={avatarMap}
                  resolveEmployee={(m) =>
                    employees.find((e) => e.id === m.employeeId)
                  }
                  mode="create"
                />
              </div>

              <div className="flex-1 flex flex-col min-h-0 min-w-0">
                <GroupTaskMemberPanel
                  member={selectedMember}
                  employeeOptions={employeeOptions}
                  roles={roles}
                  isRolesLoading={isRolesLoading}
                  onManageRoles={() => setIsRoleManagerOpen(true)}
                  maxDueDate={dueDate}
                  onChange={(field, value) =>
                    handleMemberChange(selectedMemberId, field, value)
                  }
                />
              </div>
            </div>
          </form>

          {/* FOOTER */}
          <div className="px-5 py-4 border-t border-border bg-muted/30 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsSaveTemplateModalOpen(true)}
                className="h-auto gap-1.5 rounded-lg bg-card px-3 py-1.5 text-xs font-semibold shadow-sm hover:border-primary/40 hover:bg-muted"
              >
                <BookmarkPlus size={13} className="text-primary" />
                <span>Save as Template</span>
              </Button>

              <div className="hidden sm:flex items-center gap-1 text-[10px] text-muted-foreground font-medium border-l border-border/80 pl-3">
                <kbd className="px-1.5 py-0.5 bg-muted/80 border border-border rounded text-muted-foreground font-sans text-[9px]">
                  Esc
                </kbd>
                <span>to cancel</span>
              </div>
            </div>

            <div className="flex items-center gap-2.5 ml-auto">
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
                form="create-group-task-form"
                disabled={isSubmitting}
                className="h-9 px-6 rounded-xl shadow-lg shadow-primary/20"
              >
                {isSubmitting ? (
                  <>
                    <Spinner size="sm" className="mr-2" />
                    <span>Creating…</span>
                  </>
                ) : (
                  <>
                    <Check size={16} strokeWidth={3} className="mr-1.5" />
                    <span>Create Group Task</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <GroupRoleManagerModal
        isOpen={isRoleManagerOpen}
        onClose={() => setIsRoleManagerOpen(false)}
      />
      <SaveGroupTaskTemplateModal
        isOpen={isSaveTemplateModalOpen}
        onClose={() => setIsSaveTemplateModalOpen(false)}
        taskDraft={{ title, description, dueDate, members }}
        onSave={(name) => saveTemplateMutation.mutate(name)}
        isSaving={saveTemplateMutation.isPending}
      />
    </>
  );
}
