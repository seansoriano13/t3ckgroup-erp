import { useEffect, useRef, useState } from "react";
import { CircleAlert, Edit3 } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import GradeSelector from "../../../components/GradeSelector.jsx";
import ImageAttachment from "../../../components/ImageAttachment.jsx";
import ChecklistTaskRenderer from "../../../components/ChecklistTaskRenderer.jsx";
import HighlightText from "../../../components/HighlightText";
import { TASK_STATUS } from "../../../constants/status.js";
import { formatDate } from "../../../utils/formatDate.js";
import { relativeAge } from "../../../utils/approvalItems.js";
import { checklistProgressLabel, isChecklistDescription, resolveApprovalShortcut } from "../../../utils/approvalQueue.js";
import { ApprovalChain, DetailRow, DetailSection, NotePresets, PersonChip } from "@/components/ui/DetailParts";
import { SlideOverBody, SlideOverFooter } from "@/components/ui/SlideOver";
import { APPROVE_CLASS, NOTE_PRESETS, whyYouSeeThis } from "./approvalUi";

/**
 * Reviewing one task inside the sheet: the head grades it (queue "tasks"), or
 * HR signs off the head's grade (queue "hr"). An already-decided task is read
 * only until the reviewer asks to edit it.
 *
 * The payloads are the pipeline's: approve writes COMPLETE + grade +
 * evaluatedBy, return writes NOT APPROVED with the reason; HR verify sets
 * hrVerified, HR return sends it back NOT APPROVED. The service enforces the
 * pipeline; the guards here only stop a decision that is missing its grade or
 * its reason. Shortcuts: 1–5 grade, Enter approve / verify, X return.
 */
export function TaskReview({ item, currentUserId, onProcess, isSubmitting, onDecided, searchTerm = "" }) {
  const task = item.source;
  const isHr = item.queue === "hr";
  const [grade, setGrade] = useState(task.grade ? Number(task.grade) : null);
  const [remarks, setRemarks] = useState(task.remarks || "");
  const [hrRemarks, setHrRemarks] = useState(task.hrRemarks || "");
  const [isEditing, setIsEditing] = useState(false);
  const noteRef = useRef(null);

  const isReadOnly = item.done && !isEditing;
  const isChecklist = isChecklistDescription(task.taskDescription);
  const checklistLabel = checklistProgressLabel(task.taskDescription);

  const run = async (payload, { loading, success, failure }) => {
    const id = toast.loading(loading);
    try {
      await onProcess(payload);
      toast.success(success, { id, duration: 4000 });
      // An edit stays on the task it corrected; a fresh decision moves on.
      if (isEditing) setIsEditing(false);
      else onDecided?.();
    } catch (err) {
      toast.error(err?.message || failure, { id, duration: 4000 });
    }
  };

  const headApprove = () => {
    if (isSubmitting || isReadOnly) return;
    if (!grade) {
      toast.error("Pick a grade (1–5) before approving.");
      return;
    }
    run(
      {
        id: task.id,
        status: TASK_STATUS.COMPLETE,
        grade,
        remarks,
        endAt: task.endAt || new Date().toISOString(),
        evaluatedBy: currentUserId,
        editedBy: currentUserId,
        hrVerified: task.hrVerified || false,
        hrRemarks: task.hrRemarks || "",
      },
      isEditing
        ? { loading: "Updating task…", success: "Task updated.", failure: "Could not update the task." }
        : { loading: "Approving task…", success: "Task approved.", failure: "Could not approve the task." },
    );
  };

  const headReturn = () => {
    if (isSubmitting || isReadOnly) return;
    if (!remarks.trim()) {
      toast.error("Add remarks so they know what to fix.");
      noteRef.current?.focus();
      return;
    }
    run(
      { id: task.id, status: TASK_STATUS.NOT_APPROVED, grade: 0, remarks, evaluatedBy: currentUserId, editedBy: currentUserId, hrVerified: false, hrRemarks: "" },
      { loading: "Returning task…", success: "Task returned to the employee.", failure: "Could not return the task." },
    );
  };

  const hrVerify = () => {
    if (isSubmitting || isReadOnly) return;
    run(
      { id: task.id, status: TASK_STATUS.COMPLETE, hrVerified: true, hrVerifiedAt: task.hrVerifiedAt || new Date().toISOString(), hrRemarks, editedBy: currentUserId },
      isEditing
        ? { loading: "Updating verification…", success: "Verification updated.", failure: "Could not update the verification." }
        : { loading: "Verifying task…", success: "Task verified and signed.", failure: "Could not verify the task." },
    );
  };

  const hrReturn = () => {
    if (isSubmitting || isReadOnly) return;
    if (!hrRemarks.trim()) {
      toast.error("Add audit notes so the head knows what to fix.");
      noteRef.current?.focus();
      return;
    }
    run(
      { id: task.id, status: TASK_STATUS.NOT_APPROVED, hrVerified: false, hrVerifiedAt: null, hrRemarks, editedBy: currentUserId },
      { loading: "Returning task…", success: "Task returned to the head.", failure: "Could not return the task." },
    );
  };

  const approve = isHr ? hrVerify : headApprove;
  const reject = isHr ? hrReturn : headReturn;

  useEffect(() => {
    const onKey = (e) => {
      const action = resolveApprovalShortcut(e, { isHr, isReadOnly });
      if (!action) return;
      e.preventDefault();
      if (action.startsWith("grade:")) setGrade(Number(action.slice(6)));
      else if (action === "submit") approve();
      else if (action === "reject") reject();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const cancelEdit = () => {
    setIsEditing(false);
    setGrade(task.grade ? Number(task.grade) : null);
    setRemarks(task.remarks || "");
    setHrRemarks(task.hrRemarks || "");
  };

  const note = isHr ? hrRemarks : remarks;
  const setNote = isHr ? setHrRemarks : setRemarks;

  return (
    <>
      <SlideOverBody>
        <PersonChip person={item.person} size="lg" />

        <DetailSection title="Details">
          <dl className="divide-y divide-border/70">
            <DetailRow label="Category">{task.categoryId}</DetailRow>
            <DetailRow label="Priority">
              {item.isHighPriority ? (
                <span className="inline-flex items-center gap-1 text-red-11">
                  <CircleAlert size={12} /> High
                </span>
              ) : (
                "Normal"
              )}
            </DetailRow>
            <DetailRow label="Logged">{formatDate(task.createdAt)}</DetailRow>
            {task.paymentVoucher && <DetailRow label="Voucher">{task.paymentVoucher}</DetailRow>}
            {!item.done && (
              <DetailRow label="Waiting">
                <span className={item.isStale ? "font-semibold text-amber-11" : ""}>{relativeAge(item.clockAt).replace(" ago", "")}</span>
              </DetailRow>
            )}
            {isHr && (
              <>
                <DetailRow label="Head grade">
                  <div className="space-y-1">
                    <div className="w-44" aria-hidden="true">
                      <GradeSelector grade={task.grade} finalized compact />
                    </div>
                    <span className="sr-only">Grade {task.grade} of 5</span>
                    <p className="text-xs text-muted-foreground">by {task.evaluatedByName || "the head"}</p>
                  </div>
                </DetailRow>
                <DetailRow label="Head remarks">{task.remarks || <span className="italic text-muted-foreground">No remarks.</span>}</DetailRow>
              </>
            )}
          </dl>
        </DetailSection>

        <DetailSection title="Work logged" aside={checklistLabel && <span className="font-mono normal-case tracking-normal">· {checklistLabel}</span>}>
          {task.projectTitle && (
            <p className="mb-1.5 text-[13px] font-bold text-foreground">
              <HighlightText text={task.projectTitle} search={searchTerm} />
            </p>
          )}
          {isChecklist ? (
            <ChecklistTaskRenderer description={task.taskDescription} isOwner={false} disabled searchTerm={searchTerm} />
          ) : (
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
              <HighlightText text={task.taskDescription || "No description provided."} search={searchTerm} />
            </p>
          )}
        </DetailSection>

        {task.attachments?.length > 0 && (
          <DetailSection title={`Attachments · ${task.attachments.length}`}>
            <ImageAttachment taskId={task.id} userId={currentUserId} attachments={task.attachments} readOnly onChange={() => {}} />
          </DetailSection>
        )}

        <DetailSection title="Approval chain">
          <ApprovalChain chain={item.chain} />
        </DetailSection>

        <p className="rounded-xl bg-muted/60 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">Why you’re seeing this. </span>
          {whyYouSeeThis(item)}
        </p>
      </SlideOverBody>

      <SlideOverFooter>
        {isReadOnly ? (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 text-[13px]">
              <p className="font-semibold text-foreground">{isHr ? "Verified" : `Approved · grade ${task.grade}/5`}</p>
              <p className="truncate text-xs text-muted-foreground">{(isHr ? task.hrRemarks : task.remarks) || "No remarks."}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
              <Edit3 size={13} /> {isHr ? "Edit verification" : "Edit evaluation"}
            </Button>
          </div>
        ) : (
          <>
            {!isHr && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Grade</span>
                  <span className="text-[10px] text-muted-foreground">Keys 1–5</span>
                </div>
                <GradeSelector grade={grade} onSelect={setGrade} canEvaluate />
              </div>
            )}
            <Textarea
              ref={noteRef}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              aria-label={isHr ? "HR audit notes" : "Evaluation remarks"}
              placeholder={isHr ? "Add HR audit notes (required to return)" : "Add evaluation remarks (required to return)"}
              className="min-h-0 resize-none bg-card text-[13px] md:text-[13px]"
            />
            <NotePresets presets={NOTE_PRESETS[isHr ? "hr" : "tasks"]} onPick={(q) => setNote((n) => (n ? `${n} ${q}` : q))} />
            <div className="flex gap-2">
              {isEditing ? (
                <Button variant="outline" className="flex-1" onClick={cancelEdit} disabled={isSubmitting}>
                  Cancel
                </Button>
              ) : (
                <Button variant="destructive" className="flex-1" onClick={reject} disabled={isSubmitting} title="Shortcut: X">
                  Return
                </Button>
              )}
              <Button className={`flex-1 ${APPROVE_CLASS}`} onClick={approve} disabled={isSubmitting || (!isHr && !grade)} title="Shortcut: Enter">
                {isEditing ? "Save changes" : isHr ? "Verify & sign" : "Approve"}
              </Button>
            </div>
          </>
        )}
      </SlideOverFooter>
    </>
  );
}
