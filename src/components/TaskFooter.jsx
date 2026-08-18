import {
  Edit3,
  RotateCcw,
  Trash2,
  ShieldCheck,
  CheckCircle,
  XCircle,
  Clock,
  Undo2,
  RefreshCw,
} from "lucide-react";
import { TASK_STATUS } from "../constants/status.js";
import { Button } from "@/components/ui/button";
import Spinner from "@/components/ui/Spinner";

const TaskFooter = ({ actions, permissions, state }) => {
  const {
    onCancel,
    onClose,
    onSave,
    onToggleEdit,
    onMarkComplete,
    onHeadReject,
    onHrVerify,
    onDelete,
    onUndoVerify,
    onSubmitApproval,
    onSelfVerify,
    onRecallTask,
    onResubmit,
  } = actions;
  const { canEdit, canEvaluate, isHr, isManagement, isOwner } = permissions;
  const { isEditing, isSubmitting, task, formIsValid, isHrRejected } = state;

  return (
    <div className="px-4 py-3 sm:px-5 border-t border-border bg-card flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4 shrink-0 rounded-b-xl">
      {/* ========================================= */}
      {/* LEFT: CANCEL / CLOSE & DELETE ZONE          */}
      {/* ========================================= */}
      <div className="flex flex-wrap items-center justify-between sm:justify-start gap-2">
        <Button
          variant="ghost"
          onClick={isEditing ? onCancel : onClose}
          className="h-9 rounded-xl px-4 text-[13px] font-bold text-mauve-11 hover:bg-mauve-3 hover:text-mauve-12"
        >
          {isEditing ? "Cancel" : "Close"}
        </Button>

        {!isEditing &&
          (isManagement ||
            (isOwner && task.status === TASK_STATUS.INCOMPLETE)) && (
            <Button
              variant="ghost"
              onClick={onDelete}
              disabled={isSubmitting}
              className="h-9 rounded-xl px-4 text-[13px] font-bold text-mauve-11 hover:bg-red-3 hover:text-red-11 gap-1.5"
              title="Delete Task"
            >
              <Trash2 size={15} />
              <span className="hidden sm:inline">Delete</span>
            </Button>
          )}
      </div>

      {/* ========================================= */}
      {/* RIGHT: PRIMARY ACTIONS ZONE                 */}
      {/* ========================================= */}
      <div className="flex flex-wrap items-center justify-end gap-2.5">
        {/* --- EDITING STATE --- */}
        {isEditing ? (
          <Button
            variant="ghost"
            onClick={onSave}
            disabled={!formIsValid || isSubmitting}
            className="h-9 rounded-xl px-5 text-[13px] font-bold border border-blue-6 bg-blue-3 text-blue-11 hover:bg-blue-4 hover:text-blue-11 shadow-sm gap-1.5"
          >
            {isSubmitting ? <Spinner size="sm" /> : <CheckCircle size={15} />}
            {isSubmitting ? "Saving..." : "Save"}
          </Button>
        ) : (
          <>
            {/* --- AUTHOR ACTION (Edit / Resubmit) --- */}
            {canEdit && (
              <Button
                variant="ghost"
                onClick={isOwner && isHrRejected ? onResubmit : onToggleEdit}
                disabled={isSubmitting && isOwner && isHrRejected}
                className={`h-9 rounded-xl px-4 text-[13px] font-bold shadow-sm gap-1.5 ${
                  isOwner && isHrRejected
                    ? "border border-violet-6 bg-violet-3 text-violet-11 hover:bg-violet-4 hover:text-violet-11"
                    : "border border-mauve-6 bg-mauve-3 text-mauve-11 hover:bg-mauve-4 hover:text-mauve-12"
                }`}
                title={
                  isOwner && isHrRejected
                    ? state.hasUncheckedItems
                      ? "Check all items first"
                      : "Reset this task back to the Needs Approval queue"
                    : undefined
                }
              >
                {isOwner && isHrRejected ? (
                  <>
                    {isSubmitting ? <Spinner size="sm" /> : <RefreshCw size={15} />}
                    Resubmit for Review
                  </>
                ) : (
                  <>
                    <Edit3 size={15} /> Edit
                  </>
                )}
              </Button>
            )}

            {/* --- SUBMIT FOR REVIEW (Marketing always / Procurement / All when setting enabled) --- */}
            {(state.isMarketing || state.universalTaskSubmission || state.isProcurement) &&
              isOwner &&
              (task.status === TASK_STATUS.INCOMPLETE ||
                task.status === TASK_STATUS.NOT_APPROVED) && (
                <Button
                  variant="default"
                  onClick={onSubmitApproval}
                  disabled={
                    isSubmitting ||
                    state.task.status === TASK_STATUS.AWAITING_APPROVAL ||
                    state.hasUncheckedItems ||
                    state.hasUndeliveredProcurement
                  }
                  title={
                    state.hasUndeliveredProcurement
                      ? "All procurement products must be delivered or resolved before submitting for review"
                      : state.hasUncheckedItems
                        ? "Check all items first"
                        : ""
                  }
                  className="h-9 rounded-xl px-5 text-[13px] font-bold shadow-sm gap-1.5 bg-blue-9 text-white hover:bg-blue-10 border-none"
                >
                  {isSubmitting ? (
                    <Spinner size="sm" />
                  ) : (
                    <CheckCircle size={15} />
                  )}
                  {isSubmitting ? "Submitting for Review..." : "Submit for Review"}
                </Button>
              )}

            {(state.isMarketing || state.universalTaskSubmission || state.isProcurement) &&
              isOwner &&
              task.status === TASK_STATUS.AWAITING_APPROVAL && (
                <div className="flex flex-wrap items-center gap-2.5">
                  {state.isDelayed && state.enableSelfVerification && (
                    <Button
                      variant="ghost"
                      onClick={onSelfVerify}
                      className="h-9 rounded-xl px-5 text-[13px] font-bold border border-violet-6 bg-violet-3 text-violet-11 hover:bg-violet-4 hover:text-violet-11 shadow-sm gap-1.5"
                      title="Bypass unresponsive head approval"
                    >
                      <ShieldCheck size={15} /> Self-Verify
                    </Button>
                  )}

                  <Button
                    variant="ghost"
                    onClick={onRecallTask}
                    disabled={isSubmitting}
                    className="h-9 rounded-xl px-4 text-[13px] font-bold border border-orange-6 bg-orange-3 text-orange-11 hover:bg-orange-4 hover:text-orange-11 shadow-sm gap-1.5"
                    title="Recall this task to make edits"
                  >
                    <Undo2 size={15} /> Recall
                  </Button>

                  <div className="text-[10px] uppercase tracking-widest font-bold text-blue-10 flex items-center gap-1.5 px-2">
                    <Clock size={16} />
                    {state.isDelayed && state.enableVisualShaming ? (
                      <span className="text-destructive animate-pulse">
                        DELAYED
                      </span>
                    ) : (
                      "Pending Review"
                    )}
                  </div>
                </div>
              )}

            {/* --- HEAD ACTIONS (EVALUATION) --- */}
            {canEvaluate &&
              (task.status === TASK_STATUS.INCOMPLETE ||
                task.status === TASK_STATUS.AWAITING_APPROVAL) && (
                <div className="flex items-center gap-3 sm:pl-3 sm:ml-1 sm:border-l border-border">
                  <Button
                    variant="ghost"
                    onClick={onHeadReject}
                    disabled={isSubmitting}
                    className="h-9 rounded-xl px-4 text-[13px] font-bold border border-red-6 bg-red-3 text-red-11 hover:bg-red-4 hover:text-red-11 shadow-sm gap-1.5"
                  >
                    <XCircle size={15} /> Not Approve
                  </Button>

                  <Button
                    variant="default"
                    onClick={onMarkComplete}
                    disabled={isSubmitting || !state.canApprove}
                    className="h-9 rounded-xl px-5 text-[13px] font-bold shadow-sm gap-1.5 bg-green-9 text-white hover:bg-green-10 border-none"
                  >
                    {isSubmitting ? (
                      <Spinner size="sm" />
                    ) : (
                      <CheckCircle size={15} />
                    )}
                    Approve
                  </Button>
                </div>
              )}

            {/* --- HR ACTIONS (VERIFICATION) --- */}
            {isHr &&
              task.status === TASK_STATUS.COMPLETE &&
              !task.hrVerified && (
                <Button
                  variant="default"
                  onClick={onHrVerify}
                  disabled={isSubmitting}
                  className="h-9 rounded-xl px-5 text-[13px] font-bold shadow-sm gap-1.5 bg-blue-9 text-white hover:bg-blue-10 border-none"
                >
                  {isSubmitting ? (
                    <Spinner size="sm" />
                  ) : (
                    <ShieldCheck size={15} />
                  )}
                  Verify & Sign
                </Button>
              )}

            {isHr && task.hrVerified && (
              <Button
                variant="ghost"
                onClick={onUndoVerify}
                disabled={isSubmitting}
                className="h-9 rounded-xl px-4 text-[13px] font-bold border border-amber-6 bg-amber-3 text-amber-11 hover:bg-amber-4 hover:text-amber-11 shadow-sm gap-1.5"
              >
                {isSubmitting ? <Spinner size="sm" /> : <RotateCcw size={15} />}
                Undo
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default TaskFooter;
