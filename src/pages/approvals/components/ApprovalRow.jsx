import { useState, useMemo, useEffect, useRef } from "react";
import {
  ChevronDown,
  ChevronUp,
  Maximize2,
  CheckCircle2,
  MessageSquareCheck,
} from "lucide-react";
import toast from "react-hot-toast";
import { formatDate } from "../../../utils/formatDate.js";
import { formatTaskPreview } from "../../../utils/taskFormatters";
import ImageAttachment from "../../../components/ImageAttachment.jsx";
import ChecklistTaskRenderer from "../../../components/ChecklistTaskRenderer.jsx";
import { TASK_STATUS } from "../../../constants/status.js";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import Avatar from "../../../components/Avatar";
import { useEmployeeAvatarMap } from "../../../hooks/useEmployeeAvatarMap";
import GradeSelector from "../../../components/GradeSelector.jsx";
import HighlightText from "../../../components/HighlightText";
import Dot from "../../../components/ui/Dot";

export function ApprovalRow({
  task,
  isHr,
  onProcess,
  isSubmitting,
  currentUserId,
  defaultExpanded,
  onViewDetails,
  appSettings,
  isSelected,
  onToggleSelection,
  isVerifiedTab,
  searchTerm,
  isReplied,
}) {
  const [expanded, setExpanded] = useState(!!defaultExpanded);
  const [grade, setGrade] = useState(task.grade ? Number(task.grade) : null);
  const [remarks, setRemarks] = useState(isVerifiedTab ? task.remarks || "" : "");
  const [hrRemarks, setHrRemarks] = useState(isVerifiedTab ? task.hrRemarks || "" : "");
  const [isEditing, setIsEditing] = useState(false);
  const isReadOnly = isVerifiedTab && !isEditing;
  const rowRef = useRef(null);
  const avatarMap = useEmployeeAvatarMap();

  // Adjust grade and expanded states directly during render if props change
  // (Prevents cascading re-renders and avoids calling setState inside useEffect)
  const [prevTaskGrade, setPrevTaskGrade] = useState(task.grade);
  if (task.grade !== prevTaskGrade) {
    setPrevTaskGrade(task.grade);
    setGrade(task.grade ? Number(task.grade) : null);
  }

  const [prevDefaultExpanded, setPrevDefaultExpanded] = useState(defaultExpanded);
  if (defaultExpanded !== prevDefaultExpanded) {
    setPrevDefaultExpanded(defaultExpanded);
    if (defaultExpanded) {
      setExpanded(true);
    }
  }

  useEffect(() => {
    if (expanded && rowRef.current) {
      // Small timeout ensures the container is fully rendered before focusing
      setTimeout(() => rowRef.current.focus({ preventScroll: true }), 50);
    }
  }, [expanded]);

  const handleKeyDown = (e) => {
    if (!expanded || isSubmitting || isReadOnly) return;

    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") {
      if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey) {
        e.preventDefault();
        if (isHr) {
          if (!isSubmitting) handleHrVerify();
        } else {
          if (grade !== null && !isSubmitting) handleHeadApprove();
          else toast.error("Select a grade (1-5) before pressing Enter to approve");
        }
      }
      return;
    }

    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (!isHr) {
      const keyMap = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 };
      if (keyMap[e.key]) {
        e.preventDefault();
        const num = keyMap[e.key];
        setGrade(num);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (grade !== null) {
          handleHeadApprove();
        } else {
          toast.error("Select a grade (1-5) before pressing Enter to approve");
        }
      } else if (e.key.toLowerCase() === "x") {
        e.preventDefault();
        if (!remarks) {
          toast.error("Evaluation remarks required to reject task");
          return;
        }
        handleHeadReject();
      }
    } else {
      if (e.key.toLowerCase() === "v" || e.key === "Enter") {
        e.preventDefault();
        handleHrVerify();
      } else if (e.key.toLowerCase() === "x") {
        e.preventDefault();
        if (!hrRemarks) {
          toast.error("HR verification notes required to reject task");
          return;
        }
        handleHrReject();
      }
    }
  };

  const isDelayed = useMemo(() => {
    if (!task?.createdAt) return false;
    const hrs = (new Date() - new Date(task.createdAt)) / (1000 * 60 * 60);
    return hrs >= 48;
  }, [task.createdAt]);

  const handleHeadApprove = async () => {
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
      toast.success(isEditing ? "Task updated!" : "Task approved!", { id: toastId });
      setIsEditing(false);
    } catch {
      toast.error(isEditing ? "Failed to update task" : "Failed to approve task", { id: toastId });
    }
  };

  const handleHeadReject = async () => {
    const toastId = toast.loading("Rejecting task...");
    try {
      await onProcess({
        id: task.id,
        status: "NOT APPROVED",
        grade: 0,
        remarks: remarks,
        evaluatedBy: currentUserId,
        editedBy: currentUserId,
        hrVerified: false,
        hrRemarks: "",
      });
      toast.success("Task rejected!", { id: toastId });
    } catch {
      toast.error("Failed to reject task", { id: toastId });
    }
  };

  const handleHrVerify = async () => {
    const toastId = toast.loading(isEditing ? "Updating task..." : "Verifying task...");
    try {
      await onProcess({
        id: task.id,
        status: TASK_STATUS.COMPLETE,
        hrVerified: true,
        hrVerifiedAt: task.hrVerifiedAt || new Date().toISOString(),
        hrRemarks: hrRemarks,
        editedBy: currentUserId,
      });
      toast.success(isEditing ? "Task updated!" : "Task verified!", { id: toastId });
      setIsEditing(false);
    } catch {
      toast.error(isEditing ? "Failed to update task" : "Failed to verify task", { id: toastId });
    }
  };

  const handleHrReject = async () => {
    const toastId = toast.loading("Rejecting task...");
    try {
      await onProcess({
        id: task.id,
        status: "NOT APPROVED",
        hrVerified: false,
        hrVerifiedAt: null,
        hrRemarks: hrRemarks,
        editedBy: currentUserId,
      });
      toast.success("Task rejected!", { id: toastId });
    } catch {
      toast.error("Failed to reject task", { id: toastId });
    }
  };

  return (
    <div
      ref={rowRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className={`outline-none border transition-all duration-300 rounded-xl focus-visible:ring-2 focus-visible:ring-mauve-6 focus-visible:border-mauve-6 ${
        isSelected
          ? "border-mauve-8 shadow bg-mauve-4"
          : expanded
            ? "bg-card border-border"
            : isReplied
              ? "border-blue-a5 bg-blue-a2 shadow-sm hover:border-blue-a7"
              : "border-border bg-card shadow-sm hover:border-mauve-8"
      }`}
    >
      {/* COMPACT ROW */}
      <div
        className="p-3 md:p-4 flex items-start sm:items-center justify-between cursor-pointer gap-4 group hover:bg-muted/30 transition-colors rounded-xl"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start sm:items-center gap-3 md:gap-4 flex-1 min-w-0">
          <div className="shrink-0 mt-1 sm:mt-0">
            <Avatar
              name={task.loggedByName}
              src={avatarMap.get(task.loggedById) || task.loggedByAvatar}
              size="lg"
              isSelected={isSelected}
              showCheckOnSelect={true}
              className={!isSelected ? " shadow-inner" : "shadow-inner"}
              onClick={
                appSettings?.enable_bulk_approval && onToggleSelection
                  ? (e) => {
                      e.stopPropagation();
                      onToggleSelection(task.id);
                    }
                  : undefined
              }
              title={
                appSettings?.enable_bulk_approval && onToggleSelection
                  ? isSelected
                    ? "Deselect task"
                    : "Select for bulk approval"
                  : undefined
              }
            />
          </div>

          <div className="flex flex-col min-w-0 flex-1 justify-center gap-0.5">
            <div className="flex flex-wrap items-center gap-1.5 md:gap-2 text-[10px] md:text-[11px] text-muted-foreground">
              <span className="font-semibold text-foreground">
                <HighlightText text={task.loggedByName} search={searchTerm} />
              </span>
              <span className="opacity-50">•</span>
              <span className="bg-muted/50 px-1.5 py-0.5 rounded font-medium text-muted-foreground border border-border/50">
                <HighlightText text={task.categoryId} search={searchTerm} />
              </span>
              <span className="opacity-50">•</span>
              <span className="font-medium">{formatDate(task.createdAt)}</span>
              {task.editedAt && (
                <>
                  <span className="opacity-50">•</span>
                  <span
                    className="italic opacity-80"
                    title={`Last modified ${formatDate(task.editedAt)}${task.editedByName ? ` by ${task.editedByName}` : ""}`}
                  >
                    Edited: {formatDate(task.editedAt)}
                  </span>
                </>
              )}
            </div>

            <h4 className="text-xs md:text-sm font-semibold text-foreground line-clamp-1 group-hover:text-primary transition-colors leading-tight">
              <HighlightText
                text={formatTaskPreview(task.taskDescription, task.checklist)}
                search={searchTerm}
              />
            </h4>
          </div>
        </div>

          <div className="flex items-center gap-2 md:gap-3 shrink-0">
          <div className="flex flex-col sm:flex-row items-end sm:items-center gap-1.5 sm:gap-2">
            {Number(task.grade) > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-green-a3 text-green-11 border border-green-a4 text-[9px] md:text-[10px] font-semibold tracking-wide uppercase">
                Grade: {task.grade}
              </span>
            )}

            {appSettings?.enable_visual_shaming && isDelayed && (
              <span className="px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-600 border border-amber-500/20 text-[9px] md:text-[10px] font-semibold tracking-wide uppercase">
                Delayed
              </span>
            )}

            {isReplied && (
              <span
                className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-a3 text-blue-11 text-[9px] md:text-[10px] font-semibold tracking-wide uppercase border border-blue-a4"
                title="You've already replied to this task"
              >
                <MessageSquareCheck size={12} />
                Replied
              </span>
            )}

            {task.priority === "HIGH" && (
              <>
                <span className="hidden sm:block px-2 py-0.5 rounded-md bg-red-a3 text-red-11 border border-red-a4 text-[9px] md:text-[10px] font-semibold tracking-wide uppercase">
                  Priority
                </span>
                <Dot
                  size="w-2 h-2"
                  color="bg-red-9"
                  className="sm:hidden shadow-[0_0_8px_rgba(229,72,77,0.5)]"
                />
              </>
            )}
          </div>

          <div className="flex items-center gap-0.5 sm:gap-1 sm:ml-2 sm:pl-2 sm:border-l border-border/50">
            <button
              className="text-muted-foreground/60 hover:text-primary hover:bg-muted p-1.5 rounded-lg transition-all hidden sm:block"
              onClick={(e) => {
                e.stopPropagation();
                onViewDetails(task);
              }}
              title="Open Full Details"
            >
              <Maximize2 size={16} />
            </button>

            <button className="text-muted-foreground/60 group-hover:text-foreground group-hover:bg-muted/50 p-1.5 rounded-lg transition-all">
              {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
          </div>
        </div>
      </div>

      {/* EXPANDED ACTION AREA */}
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${
          expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0 pointer-events-none"
        }`}
        aria-hidden={!expanded}
      >
        <div className="overflow-hidden">
          <div className="p-4 border-t border-border bg-muted/50 rounded-b-xl">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left Col: Full Description */}
            <div className="flex flex-col">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2 block">
                Task Description
              </label>
              {task.taskDescription &&
              task.taskDescription.trim().startsWith("[") ? (
                <div className="mt-1">
                  <ChecklistTaskRenderer
                    description={task.taskDescription}
                    isOwner={false}
                    disabled={true}
                    searchTerm={searchTerm}
                  />
                </div>
              ) : (
                <div className="bg-muted/30 p-3 md:p-4 rounded-xl border border-transparent text-xs md:text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                  <HighlightText
                    text={formatTaskPreview(task.taskDescription, task.checklist)}
                    search={searchTerm}
                  />
                </div>
              )}

              {task.attachments && task.attachments.length > 0 && (
                <div className="mt-4 pt-4 border-t border-border/50">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2 block">
                    Screenshots / Attachments
                  </label>
                  <ImageAttachment
                    taskId={task.id}
                    userId={currentUserId}
                    attachments={task.attachments}
                    readOnly={true}
                    onChange={() => {}}
                  />
                </div>
              )}
            </div>

            {/* Right Col: Dynamic UI based on Role */}
            <div className="bg-card border border-border/60 p-5 rounded-2xl shadow-sm flex flex-col gap-6">
              {isHr ? (
                /* --- HR UI --- */
                <>
                  <div className="flex flex-col gap-2">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">
                      Manager's Evaluation
                    </p>
                    <div className="mt-1">
                      <GradeSelector grade={task.grade} finalized={true} />
                    </div>
                  </div>

                  {task.remarks && (
                    <div className="bg-muted/30 border border-border/50 p-3 rounded-xl">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">
                        Manager Remarks
                      </p>
                      <p className="text-xs text-foreground">{task.remarks}</p>
                    </div>
                  )}

                  <div className="relative border border-border/50 rounded-xl bg-muted/20 focus-within:bg-background focus-within:border-mauve-6 focus-within:ring-1 focus-within:ring-mauve-6 transition-all">
                    <label className="absolute left-3 top-2 text-[9px] font-bold text-muted-foreground uppercase tracking-wider pointer-events-none">
                      HR Verification Notes
                    </label>
                    <textarea
                      value={hrRemarks}
                      onChange={(e) => setHrRemarks(e.target.value)}
                      placeholder={
                        isReadOnly ? "No notes provided" : "Audit notes..."
                      }
                      className="w-full bg-transparent border-none outline-none focus:ring-0 resize-none pt-7 pb-3 px-3 text-sm placeholder:text-muted-foreground/50 min-h-[80px] rounded-xl"
                      disabled={isReadOnly}
                    />
                  </div>

                  {isVerifiedTab && !isEditing && (
                    <div className="flex justify-end pt-2">
                      <Button
                        variant="outline"
                        onClick={() => setIsEditing(true)}
                        className="px-6 py-4 rounded-full font-semibold transition-all text-xs"
                      >
                        Edit Evaluation
                      </Button>
                    </div>
                  )}

                  {!isReadOnly && (
                    <div className="flex flex-col sm:flex-row justify-end gap-3 pt-2">
                      {isEditing ? (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setIsEditing(false);
                            setHrRemarks(task.hrRemarks || "");
                          }}
                          disabled={isSubmitting}
                          className="px-6 py-5 order-2 sm:order-1 rounded-full font-semibold transition-all"
                        >
                          Cancel
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          onClick={handleHrReject}
                          disabled={!hrRemarks || isSubmitting}
                          className="px-6 py-5 order-2 sm:order-1 text-white hover:bg-red-11 bg-red-9 rounded-full font-semibold transition-all"
                        >
                          Return
                        </Button>
                      )}
                      <Button
                        variant="primary"
                        onClick={handleHrVerify}
                        disabled={isSubmitting}
                        className="px-6 py-5 order-1 sm:order-2 bg-green-10 hover:bg-green-11 text-white font-bold rounded-full shadow-md hover:shadow-lg transition-all"
                      >
                        {isEditing ? "Save Changes" : "Verify & Sign"}
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                /* --- HEAD UI --- */
                <>
                  <div>
                    <label className="text-[10px] font-bold  uppercase tracking-wider mb-2 block">
                      Assign Grade (1-5)
                    </label>
                    <div className="mt-1">
                      <GradeSelector
                        grade={grade}
                        onSelect={setGrade}
                        canEvaluate={!isReadOnly}
                        finalized={isReadOnly}
                      />
                    </div>
                  </div>

                  <div className="relative border border-border/50 rounded-xl bg-muted/20 focus-within:bg-background focus-within:border-mauve-6 focus-within:ring-1 focus-within:ring-mauve-6 transition-all">
                    <label className="absolute left-3 top-2 text-[9px] font-bold text-muted-foreground uppercase tracking-wider pointer-events-none">
                      Evaluation Remarks
                    </label>
                    <textarea
                      className="w-full bg-transparent border-none outline-none focus:ring-0 resize-none pt-7 pb-3 px-3 text-sm placeholder:text-muted-foreground/50 min-h-[80px] rounded-xl"
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                      placeholder={
                        isReadOnly && !remarks
                          ? "No feedback provided"
                          : "Add feedback..."
                      }
                      disabled={isReadOnly}
                    />
                  </div>

                  {isVerifiedTab && !isEditing && (
                    <div className="flex justify-end pt-2">
                      <Button
                        variant="outline"
                        onClick={() => setIsEditing(true)}
                        className="px-6 py-4 rounded-full font-semibold transition-all text-xs"
                      >
                        Edit Evaluation
                      </Button>
                    </div>
                  )}

                  {!isReadOnly && (
                    <div className="flex flex-col sm:flex-row justify-end gap-3 pt-2">
                      {isEditing ? (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setIsEditing(false);
                            setGrade(task.grade || null);
                            setRemarks(task.remarks || "");
                          }}
                          disabled={isSubmitting}
                          className="px-6 py-5 order-2 sm:order-1 rounded-full font-semibold transition-all"
                        >
                          Cancel
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          onClick={handleHeadReject}
                          disabled={!remarks || isSubmitting}
                          className="px-6 py-5 order-2 sm:order-1 text-white hover:bg-red-11 bg-red-9 rounded-full font-semibold transition-all"
                        >
                          Return
                        </Button>
                      )}
                      <Button
                        onClick={handleHeadApprove}
                        disabled={grade === null || isSubmitting}
                        className="px-6 py-5 order-1 sm:order-2 bg-green-10 hover:bg-green-11 text-white font-bold rounded-full shadow-md hover:shadow-lg transition-all"
                      >
                        {isEditing ? "Save Changes" : "Approve Task"}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* KEYBOARD SHORTCUTS HINT */}
          {!isReadOnly && (
            <div className="mt-6 pt-3 border-t border-border/50 flex justify-center opacity-70">
              <p className="text-[10px] text-muted-foreground font-bold tracking-widest uppercase flex flex-wrap items-center justify-center gap-2 text-center">
                Shortcuts:
                {!isHr ? (
                  <>
                    <span className="bg-mauve-4 text-foreground px-1.5 py-0.5 rounded border border-border">
                      1-5
                    </span>{" "}
                    Grade
                    <span className="bg-mauve-4 text-foreground px-1.5 py-0.5 rounded border border-border ml-2">
                      Enter
                    </span>{" "}
                    Approve
                    <span className="bg-mauve-4 text-foreground px-1.5 py-0.5 rounded border border-border ml-2">
                      Ctrl+Enter
                    </span>{" "}
                    New Line
                    <span className="bg-mauve-4 text-foreground px-1.5 py-0.5 rounded border border-border ml-2">
                      X
                    </span>{" "}
                    Return
                  </>
                ) : (
                  <>
                    <span className="bg-mauve-4 text-foreground px-1.5 py-0.5 rounded border border-border">
                      V / Enter
                    </span>{" "}
                    Verify
                    <span className="bg-mauve-4 text-foreground px-1.5 py-0.5 rounded border border-border ml-2">
                      Ctrl+Enter
                    </span>{" "}
                    New Line
                    <span className="bg-mauve-4 text-foreground px-1.5 py-0.5 rounded border border-border ml-2">
                      X
                    </span>{" "}
                    Return
                  </>
                )}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  </div>
  );
}
