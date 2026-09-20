import React from "react"
import { MessageCircle } from "lucide-react"
import { Textarea } from "@/components/ui/textarea"
import GradeSelector from "./GradeSelector"

export default function TaskEvaluationSection({
  isEditing,
  canReEvalGrade,
  editGrade,
  setEditGrade,
  isComplete,
  isNotApproved,
  isFinalized,
  canEvaluate,
  task,
  activeTask,
  approvalGrade,
  setApprovalGrade,
  approvalRemarks,
  setApprovalRemarks,
  timelineMessageRef,
}) {
  return (
    <>
      {/* --- GRADE EDIT (Re-evaluation during edit mode) --- */}
      {canReEvalGrade && (
        <div className="flex flex-col gap-1.5 pt-2">
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider pl-1 flex items-center gap-1.5">
            Performance Grade
            <span className="font-normal normal-case tracking-normal text-muted-foreground/70">
              (editing)
            </span>
          </label>
          <GradeSelector
            grade={editGrade}
            onSelect={setEditGrade}
            canEvaluate={true}
            finalized={false}
          />
        </div>
      )}

      {/* --- GRADE SELECTOR (for evaluation) --- */}
      {!isEditing && (
        <div
          className={`p-4 rounded-xl border ${
            isComplete
              ? "bg-muted/50/50 border-border"
              : isNotApproved
                ? "bg-destructive/10 border-destructive/20"
                : "border-mauve-8"
          }`}
        >
          <div className="grid gap-1 mb-3">
            <div className="text-xs font-bold uppercase tracking-wider">
              {isFinalized
                ? "Performance Grade"
                : canEvaluate
                  ? "Performance Grade (Required for Approval)"
                  : "Evaluation Status (Not Yet Evaluated)"}
            </div>

            {isFinalized && task.evaluatedByName && (
              <div className="text-[11px] text-muted-foreground flex items-center justify-between">
                <div className="flex items-center gap-1">
                  Evaluated by:{" "}
                  <span className="font-bold text-muted-foreground">
                    {task.evaluatedByName}
                  </span>
                </div>
                {task.evaluatedById === task.loggedById && (
                  <span className="px-2 py-0.5 rounded-full bg-purple-900/20 text-plum-9 text-[10px] font-black uppercase tracking-widest border border-purple-500/30">
                    Self-Verified
                  </span>
                )}
              </div>
            )}
          </div>

          <GradeSelector
            grade={isFinalized ? activeTask?.grade : approvalGrade}
            onSelect={setApprovalGrade}
            canEvaluate={canEvaluate && !isFinalized}
            finalized={isFinalized}
          />

          {/* --- APPROVAL REMARKS (only shown to evaluators before finalization) --- */}
          {canEvaluate && !isFinalized && (
            <div className="flex flex-col gap-1.5 mt-4">
              <label className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                <MessageCircle size={11} />
                Remarks
                <span className="font-normal normal-case tracking-normal text-muted-foreground/60">
                  (required to reject)
                </span>
              </label>
              <Textarea
                value={approvalRemarks}
                onChange={(e) => {
                  setApprovalRemarks(e.target.value)
                  if (timelineMessageRef?.current !== undefined) {
                    timelineMessageRef.current = e.target.value
                  }
                }}
                placeholder="Leave feedback for the employee..."
                className="w-full bg-card border border-border text-foreground rounded-xl p-3 outline-none transition-all h-20 resize-none text-[13px] shadow-sm"
              />
            </div>
          )}
        </div>
      )}
    </>
  )
}
