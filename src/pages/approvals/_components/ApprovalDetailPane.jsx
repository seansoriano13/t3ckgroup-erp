import { useEffect, useRef, useState } from "react";
import { 
  CheckCircle2, 
  XCircle, 
  Maximize2, 
  Clock, 
  Calendar, 
  Tag, 
  ChevronUp, 
  ChevronDown, 
  Sparkles, 
  ShieldCheck, 
  Edit3, 
  History, 
  FileText,
  CornerDownLeft
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import GradeSelector from "../../../components/GradeSelector.jsx";
import ImageAttachment from "../../../components/ImageAttachment.jsx";
import ChecklistTaskRenderer from "../../../components/ChecklistTaskRenderer.jsx";
import HighlightText from "../../../components/HighlightText";
import Avatar from "../../../components/Avatar";
import { useEmployeeAvatarMap } from "../../../hooks/useEmployeeAvatarMap";
import { formatDate } from "../../../utils/formatDate.js";
import { TASK_STATUS } from "../../../constants/status.js";
import {
  STALE_AFTER_HOURS,
  isChecklistDescription,
  isStaleTask,
  resolveApprovalShortcut,
} from "../../../utils/approvalQueue.js";
import toast from "react-hot-toast";
import { Textarea } from "@/components/ui/textarea";
import { FieldBox } from "@/components/ui/FieldBox";

const QUICK_REMARKS_HEAD = [
  "Completed as specified.",
  "Great quality work!",
  "Approved for payroll.",
  "Please update checklist items.",
  "Follow up required on details.",
];

const QUICK_REMARKS_HR = [
  "Verified against payroll guidelines.",
  "Audited and approved.",
  "Incomplete documentation.",
  "Returned for manager review.",
];

export function ApprovalDetailPane({
  task,
  isHr = false,
  isVerifiedTab = false,
  onProcess,
  isSubmitting = false,
  currentUserId,
  onViewFullDetails,
  autoAdvance = true,
  setAutoAdvance,
  onNavigateNext,
  onNavigatePrev,
  hasNext = false,
  hasPrev = false,
  queueIndex = 1,
  totalInQueue = 1,
  searchTerm = "",
}) {
  const avatarMap = useEmployeeAvatarMap();
  // Seeded from the task and never synced back: the pane is keyed on task id by
  // its parent, so a different task arrives as a fresh mount with fresh state.
  // That keeps a half-typed remark from following the reviewer to the next row.
  const [grade, setGrade] = useState(task?.grade ? Number(task.grade) : null);
  const [remarks, setRemarks] = useState(task?.remarks || "");
  const [hrRemarks, setHrRemarks] = useState(task?.hrRemarks || "");
  const [isEditing, setIsEditing] = useState(false);
  const textareaRef = useRef(null);

  const isReadOnly = isVerifiedTab && !isEditing;
  const isDelayed = isStaleTask(task);
  const isChecklist = isChecklistDescription(task?.taskDescription);

  const handleHeadApprove = async () => {
    if (isSubmitting || isReadOnly) return;
    if (grade === null || grade === 0) {
      toast.error("Please select a grade (1-5) before approving.");
      return;
    }
    const toastId = toast.loading(isEditing ? "Updating task..." : "Approving task...");
    try {
      await onProcess({
        id: task.id,
        status: TASK_STATUS.COMPLETE,
        grade: grade,
        remarks: remarks,
        endAt: task.endAt || new Date().toISOString(),
        evaluatedBy: currentUserId,
        editedBy: currentUserId,
        hrVerified: task.hrVerified || false,
        hrRemarks: task.hrRemarks || "",
      });
      toast.success(isEditing ? "Task updated!" : "Task approved!", { id: toastId, duration: 4000 });
      setIsEditing(false);
      if (autoAdvance && onNavigateNext) {
        onNavigateNext();
      }
    } catch {
      toast.error(isEditing ? "Failed to update task" : "Failed to approve task", { id: toastId, duration: 4000 });
    }
  };

  const handleHeadReject = async () => {
    if (isSubmitting || isReadOnly) return;
    if (!remarks.trim()) {
      toast.error("Evaluation remarks required to return a task.");
      textareaRef.current?.focus();
      return;
    }
    const toastId = toast.loading("Returning task...");
    try {
      await onProcess({
        id: task.id,
        status: TASK_STATUS.NOT_APPROVED,
        grade: 0,
        remarks: remarks,
        evaluatedBy: currentUserId,
        editedBy: currentUserId,
        hrVerified: false,
        hrRemarks: "",
      });
      toast.success("Task returned to employee!", { id: toastId, duration: 4000 });
      if (autoAdvance && onNavigateNext) {
        onNavigateNext();
      }
    } catch {
      toast.error("Failed to return task", { id: toastId, duration: 4000 });
    }
  };

  const handleHrVerify = async () => {
    if (isSubmitting || isReadOnly) return;
    const toastId = toast.loading(isEditing ? "Updating verification..." : "Verifying task...");
    try {
      await onProcess({
        id: task.id,
        status: TASK_STATUS.COMPLETE,
        hrVerified: true,
        hrVerifiedAt: task.hrVerifiedAt || new Date().toISOString(),
        hrRemarks: hrRemarks,
        editedBy: currentUserId,
      });
      toast.success(isEditing ? "Verification updated!" : "Task verified & signed!", { id: toastId, duration: 4000 });
      setIsEditing(false);
      if (autoAdvance && onNavigateNext) {
        onNavigateNext();
      }
    } catch {
      toast.error("Failed to verify task", { id: toastId, duration: 4000 });
    }
  };

  const handleHrReject = async () => {
    if (isSubmitting || isReadOnly) return;
    if (!hrRemarks.trim()) {
      toast.error("HR verification notes required to return a task.");
      textareaRef.current?.focus();
      return;
    }
    const toastId = toast.loading("Returning task...");
    try {
      await onProcess({
        id: task.id,
        status: TASK_STATUS.NOT_APPROVED,
        hrVerified: false,
        hrVerifiedAt: null,
        hrRemarks: hrRemarks,
        editedBy: currentUserId,
      });
      toast.success("Task returned from HR!", { id: toastId, duration: 4000 });
      if (autoAdvance && onNavigateNext) {
        onNavigateNext();
      }
    } catch {
      toast.error("Failed to return task", { id: toastId, duration: 4000 });
    }
  };

  // TRIAGE SHORTCUTS: 1-5 grade, Enter submit, X return, Ctrl+Enter from the
  // remarks box. `resolveApprovalShortcut` owns the rules — including the two
  // that matter most: nothing fires while the task is read-only, and nothing
  // fires while focus is on the queue list, where Enter means "open this row".
  useEffect(() => {
    const handleKeyDown = (e) => {
      const action = resolveApprovalShortcut(e, { isHr, isReadOnly });
      if (!action) return;
      e.preventDefault();

      if (action.startsWith("grade:")) {
        const num = Number(action.slice("grade:".length));
        setGrade(num);
        toast.success(`Grade ${num} selected`, { id: "grade-shortcut", duration: 1000 });
        return;
      }
      if (action === "submit") {
        if (isHr) handleHrVerify();
        else handleHeadApprove();
        return;
      }
      if (action === "reject") {
        if (isHr) handleHrReject();
        else handleHeadReject();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  if (!task) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center text-muted-foreground bg-card border border-border rounded-2xl shadow-xs">
        <FileText className="w-12 h-12 stroke-[1.5] mb-3 text-muted-foreground/40" />
        <p className="font-bold text-base text-foreground">No Task Selected</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">
          Select a task from the queue on the left or use J / K to begin reviewing.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-card border border-border rounded-2xl shadow-xs overflow-hidden">
      {/* PANE TOP HEADER */}
      <div className="px-5 py-3 border-b border-border bg-muted/20 flex items-center justify-between gap-3 shrink-0">
        {/* Navigation indicator & buttons */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-muted-foreground">
            Task <span className="text-foreground font-extrabold">{queueIndex}</span> of <span className="text-foreground font-extrabold">{totalInQueue}</span>
          </span>
          <div className="flex items-center gap-1 border-l border-border pl-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
              onClick={onNavigatePrev}
              disabled={!hasPrev}
              title="Previous task (K or Up Arrow)"
            >
              <ChevronUp className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
              onClick={onNavigateNext}
              disabled={!hasNext}
              title="Next task (J or Down Arrow)"
            >
              <ChevronDown className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Action icons & Auto-Advance Toggle */}
        <div className="flex items-center gap-3">
          {setAutoAdvance && (
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground" title="Automatically advance to next task after grading">
              <span className="hidden sm:inline text-[11px]">Auto-advance</span>
              <Switch
                checked={autoAdvance}
                onCheckedChange={setAutoAdvance}
                size="sm"
              />
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-xs gap-1.5 rounded-lg text-muted-foreground hover:text-foreground font-semibold"
            onClick={() => onViewFullDetails?.(task)}
            title="Open Full Details & Activity Drawer"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Details</span>
          </Button>
        </div>
      </div>

      {/* SCROLLABLE MAIN BODY (Clean, flat hierarchy without nested card boxes) */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
        {/* SECTION 1: EMPLOYEE & TASK METADATA (Seamless flat header) */}
        <div className="flex flex-col gap-2.5 pb-5 border-b border-border/70">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3.5 min-w-0">
              <Avatar
                name={task.loggedByName}
                src={avatarMap.get(task.loggedById) || task.loggedByAvatar}
                size="lg"
                className="ring-1 ring-border shrink-0"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-base text-foreground truncate">
                    <HighlightText text={task.loggedByName} search={searchTerm} />
                  </h3>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                  <span className="font-semibold text-foreground/80 bg-muted/60 px-2 py-0.5 rounded border border-border/50">
                    <HighlightText text={task.categoryId} search={searchTerm} />
                  </span>
                  {task.subDepartment && (
                    <span className="text-muted-foreground bg-muted/40 px-2 py-0.5 rounded border border-border/40 text-[11px]">
                      {task.subDepartment}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-col items-end gap-1.5 shrink-0">
              {task.priority === "HIGH" && (
                <span className="px-2 py-0.5 rounded-md bg-red-500/10 text-red-600 border border-red-500/20 text-[10px] font-bold uppercase tracking-wider">
                  Priority
                </span>
              )}
              {isDelayed && (
                <span className="px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-600 border border-amber-500/20 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Stale Backlog (&gt;{STALE_AFTER_HOURS}h)
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground pt-1 font-medium">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-muted-foreground/60" />
              <span>Created: {formatDate(task.createdAt)}</span>
            </div>
            {task.editedAt && (
              <div className="flex items-center gap-1.5 text-muted-foreground/80 italic">
                <History className="w-3.5 h-3.5 text-muted-foreground/60" />
                <span>Edited: {formatDate(task.editedAt)}</span>
              </div>
            )}
            {task.paymentVoucher && (
              <div className="flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-muted-foreground/60" />
                <span>Voucher: {task.paymentVoucher}</span>
              </div>
            )}
          </div>
        </div>

        {/* SECTION 2: TASK DESCRIPTION / CHECKLIST (Clean readable block) */}
        <div className="space-y-2 pb-5 border-b border-border/70">
          {task.projectTitle && (
            <div className="mb-4">
              <FieldBox bare label={<>
                <Tag className="w-3.5 h-3.5" />
                Project Title
              </>}>
<h4 className="text-sm font-bold text-foreground">
                <HighlightText text={task.projectTitle} search={searchTerm} />
              </h4>
</FieldBox>
            </div>
          )}

          <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" />
            Task Description
          </span>

          {isChecklist ? (
            <div className="pt-1">
              <ChecklistTaskRenderer
                description={task.taskDescription}
                isOwner={false}
                disabled={true}
                searchTerm={searchTerm}
              />
            </div>
          ) : (
            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed pt-0.5">
              <HighlightText
                text={task.taskDescription || "No description provided."}
                search={searchTerm}
              />
            </p>
          )}
        </div>

        {/* SECTION 3: SCREENSHOTS / ATTACHMENTS (if present) */}
        {task.attachments && task.attachments.length > 0 && (
          <div className="space-y-2 pb-5 border-b border-border/70">
            <FieldBox bare label={<>
              <Sparkles className="w-3.5 h-3.5" />
              Attachments ({task.attachments.length})
            </>}>
<div className="pt-1">
              <ImageAttachment
                taskId={task.id}
                userId={currentUserId}
                attachments={task.attachments}
                readOnly={true}
                onChange={() => {}}
              />
            </div>
</FieldBox>
          </div>
        )}

        {/* SECTION 4: EVALUATION & ACTION (Seamless integrated section) */}
        <div className="space-y-4 pt-1">
          <div className="flex items-center justify-between">
            <h4 className="font-extrabold text-xs tracking-wider uppercase text-foreground flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-foreground/70" />
              {isHr ? "HR Verification & Audit" : "Manager Evaluation"}
            </h4>

            {isVerifiedTab && !isEditing && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsEditing(true)}
                className="h-7 text-xs font-semibold rounded-lg"
              >
                <Edit3 className="w-3 h-3 mr-1.5" />
                Edit Evaluation
              </Button>
            )}
          </div>

          {/* MANAGER EVALUATION CONTROLS */}
          {!isHr && (
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold text-foreground uppercase tracking-wider">
                    Assign Grade (1-5)
                  </span>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    Press keys 1 to 5
                  </span>
                </div>
                <GradeSelector
                  grade={grade}
                  onSelect={setGrade}
                  canEvaluate={!isReadOnly}
                  finalized={isReadOnly}
                />
              </div>

              <div className="space-y-2">
                <FieldBox bare label="Evaluation Remarks / Feedback">
<Textarea
                  ref={textareaRef}
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder={
                    isReadOnly && !remarks
                      ? "No feedback provided."
                      : "Add evaluation remarks (optional, or press Enter to approve)..."
                  }
                  disabled={isReadOnly}
                  rows={3}
                  className="resize-none min-h-0"
                />
</FieldBox>

                {/* Quick Feedback Presets */}
                {!isReadOnly && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {QUICK_REMARKS_HEAD.map((preset, idx) => (
                      <Button
                        key={idx}
                        type="button"
                        onClick={() => setRemarks((prev) => prev ? `${prev} ${preset}` : preset)}
                        variant="outline"
                      >
                        + {preset}
                      </Button>
                    ))}
                  </div>
                )}
              </div>

              {/* ACTION BUTTONS FOR MANAGER */}
              {!isReadOnly && (
                <div className="flex items-center justify-end gap-2.5 pt-3">
                  {isEditing ? (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setIsEditing(false);
                        setGrade(task.grade ? Number(task.grade) : null);
                        setRemarks(task.remarks || "");
                      }}
                      disabled={isSubmitting}
                      className="font-semibold text-xs rounded-xl"
                    >
                      Cancel
                    </Button>
                  ) : (
                    <Button
                      variant="destructive"
                      onClick={handleHeadReject}
                      disabled={isSubmitting}
                      className="font-bold text-xs rounded-xl shadow-xs"
                      title="Return task to employee (Shortcut: X)"
                    >
                      <XCircle className="w-3.5 h-3.5 mr-1.5" />
                      Return Task (X)
                    </Button>
                  )}

                  <Button
                    onClick={handleHeadApprove}
                    disabled={grade === null || isSubmitting}
                    className="bg-green-600 hover:bg-green-700 text-white font-bold text-xs rounded-xl shadow-xs tracking-wide"
                    title="Approve and mark complete (Shortcut: Enter)"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                    {isEditing ? "Save Changes" : "Approve Task (Enter)"}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* HR VERIFICATION CONTROLS */}
          {isHr && (
            <div className="space-y-4">
              {/* Manager's Previous Evaluation Details */}
              <div className="bg-muted/30 border border-border/60 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                    Manager Evaluation
                  </span>
                  {task.grade && (
                    <span className="px-2 py-0.5 rounded bg-green-500/10 text-green-700 dark:text-green-400 border border-green-500/20 text-xs font-bold">
                      Grade: {task.grade} / 5
                    </span>
                  )}
                </div>
                {task.remarks ? (
                  <p className="text-xs text-foreground bg-background/60 p-2 rounded-lg border border-border/40">
                    {task.remarks}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground italic">No manager remarks provided.</p>
                )}
              </div>

              {/* HR Verification Notes */}
              <div className="space-y-2">
                <FieldBox bare label="HR Verification / Audit Notes">
<Textarea
                  ref={textareaRef}
                  value={hrRemarks}
                  onChange={(e) => setHrRemarks(e.target.value)}
                  placeholder={
                    isReadOnly && !hrRemarks
                      ? "No HR notes provided."
                      : "Add HR audit notes..."
                  }
                  disabled={isReadOnly}
                  rows={3}
                  className="resize-none min-h-0"
                />
</FieldBox>

                {/* Quick HR Presets */}
                {!isReadOnly && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {QUICK_REMARKS_HR.map((preset, idx) => (
                      <Button
                        key={idx}
                        type="button"
                        onClick={() => setHrRemarks((prev) => prev ? `${prev} ${preset}` : preset)}
                        variant="outline"
                      >
                        + {preset}
                      </Button>
                    ))}
                  </div>
                )}
              </div>

              {/* ACTION BUTTONS FOR HR */}
              {!isReadOnly && (
                <div className="flex items-center justify-end gap-2.5 pt-3">
                  {isEditing ? (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setIsEditing(false);
                        setHrRemarks(task.hrRemarks || "");
                      }}
                      disabled={isSubmitting}
                      className="font-semibold text-xs rounded-xl"
                    >
                      Cancel
                    </Button>
                  ) : (
                    <Button
                      variant="destructive"
                      onClick={handleHrReject}
                      disabled={isSubmitting}
                      className="font-bold text-xs rounded-xl shadow-xs"
                      title="Return task for correction (Shortcut: X)"
                    >
                      <XCircle className="w-3.5 h-3.5 mr-1.5" />
                      Return (X)
                    </Button>
                  )}

                  <Button
                    onClick={handleHrVerify}
                    disabled={isSubmitting}
                    className="bg-green-600 hover:bg-green-700 text-white font-bold text-xs rounded-xl shadow-xs tracking-wide"
                    title="Verify & Sign Task (Shortcut: Enter)"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                    {isEditing ? "Save Changes" : "Verify & Sign (Enter)"}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* FOOTER KEYBOARD SHORTCUTS HINTS */}
      <div className="px-5 py-2 bg-muted/30 border-t border-border shrink-0 text-center">
        <div className="flex flex-wrap items-center justify-center gap-2 text-[10px] font-semibold text-muted-foreground tracking-wider uppercase">
          <span>Shortcuts:</span>
          {!isHr ? (
            <>
              <span className="bg-background px-1.5 py-0.5 rounded border border-border text-foreground font-mono">1-5</span> Grade
              <span className="bg-background px-1.5 py-0.5 rounded border border-border text-foreground font-mono ml-1">Enter</span> Approve
              <span className="bg-background px-1.5 py-0.5 rounded border border-border text-foreground font-mono ml-1">X</span> Return
            </>
          ) : (
            <>
              <span className="bg-background px-1.5 py-0.5 rounded border border-border text-foreground font-mono">Enter</span> Verify &amp; Sign
              <span className="bg-background px-1.5 py-0.5 rounded border border-border text-foreground font-mono ml-1">X</span> Return
            </>
          )}
          <span className="bg-background px-1.5 py-0.5 rounded border border-border text-foreground font-mono ml-1">J / K</span> Next / Prev
        </div>
      </div>
    </div>
  );
}
