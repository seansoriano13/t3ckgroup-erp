import { useState, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { X, Star } from "lucide-react";
import GradeSelector from "../../../components/GradeSelector";
import { confirmDeleteToast } from "../../../components/ui/CustomToast";
import { parseChecklist } from "../utils/checklist";
import ChecklistTaskRenderer from "../../../components/ChecklistTaskRenderer";

export default function RateEmployeesModal({
  isOpen,
  onClose,
  task,
  onSubmit,
  isSubmitting,
}) {
  const [ratings, setRatings] = useState([]);

  useEffect(() => {
    if (isOpen && task) {
      // Initialize ratings state
      setRatings(
        task.members.map((m) => ({
          memberId: m.id,
          employeeName: m.employee?.name || "Unknown",
          taskDescription: m.task_description,
          checklist: m.checklist,
          grade: m.grade || 0,
          gradeRemarks: m.grade_remarks || "",
          status: m.status,
        })),
      );
    }
  }, [isOpen, task]);

  const handleRatingChange = (memberId, field, value) => {
    setRatings((prev) =>
      prev.map((r) => (r.memberId === memberId ? { ...r, [field]: value } : r)),
    );
  };

  const allMembersDone =
    ratings.length > 0 && ratings.every((r) => r.status !== "PENDING");

  const handleSubmit = () => {
    if (!allMembersDone) return;

    // Validate all have grades
    const unrated = ratings.filter((r) => r.grade === 0);
    if (unrated.length > 0) {
      confirmDeleteToast(
        "Missing Grades",
        `Warning: ${unrated.length} members have no grade (0). Submit anyway?`,
        () => {
          onSubmit(
            ratings.map((r) => ({
              memberId: r.memberId,
              grade: r.grade,
              gradeRemarks: r.gradeRemarks,
            })),
          );
        },
      );
      return;
    }

    // Pass only the needed data
    onSubmit(
      ratings.map((r) => ({
        memberId: r.memberId,
        grade: r.grade,
        gradeRemarks: r.gradeRemarks,
      })),
    );
  };

  if (!task) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="p-0 gap-0 z-[80] shadow-[0_10px_40px_-10px_rgba(79,70,229,0.15)] flex flex-col transition-all duration-300 w-[960px] sm:max-w-none max-w-[95vw] rounded-2xl max-h-[90vh] overflow-hidden"
      >
        {/* HEADER */}
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-mauve-3/40 shrink-0 relative overflow-hidden bg-card">
          <div className="space-y-1 mt-1">
            <div className="flex items-center gap-2 mb-2.5">
              <span className="text-[10px] font-bold bg-warning/10 text-amber-10 px-2.5 py-0.5 rounded-full uppercase tracking-widest shadow-sm border border-amber-500/20">
                Evaluation Mode
              </span>
            </div>
            <h2 className="text-2xl font-black text-foreground tracking-tight leading-tight">
              Rate Group Members
            </h2>
            <div className="flex items-center gap-4 text-xs font-semibold text-muted-foreground mt-2">
              <span className="truncate max-w-[400px]">For: {task.title}</span>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* CONTENT */}
        <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-6 bg-card/50">
          <p className="text-[13px] text-muted-foreground font-medium leading-relaxed max-w-2xl">
            Evaluate the performance of each member based on their specific
            responsibilities. Please ensure all grades are provided before
            submitting.
          </p>

          <div className="space-y-4">
            {ratings.map((rating, index) => (
              <div
                key={rating.memberId}
                className={`p-5 border border-border rounded-2xl shadow-sm hover:shadow-md transition-all duration-300 bg-card animate-content-in stagger-${(index % 5) + 1}`}
              >
                <div className="flex flex-col lg:flex-row gap-6">
                  {/* Info */}
                  <div className="flex-1 space-y-3">
                    <div className="flex items-center gap-2">
                      <h3 className="font-extrabold text-sm text-foreground tracking-tight">
                        {rating.employeeName}
                      </h3>
                      <span
                        className={`text-[9px] font-bold px-2 py-0.5 rounded shadow-sm uppercase tracking-wider ${
                          rating.status === "DONE"
                            ? "bg-green-9/10 text-green-10 border border-green-500/20"
                            : "bg-warning/10 text-amber-10 border border-amber-500/20"
                        }`}
                      >
                        {rating.status}
                      </span>
                    </div>

                    <div className="bg-muted/20 p-3 rounded-xl border border-border/50">
                      <span className="font-bold uppercase tracking-widest text-[9px] text-muted-foreground block mb-1">
                        Assigned Task
                      </span>
                      {/* Description and checklist are separate fields now, so
                          an assignment can have either, both, or (for older
                          rows) a checklist still sitting in task_description.
                          parseChecklist covers all three. */}
                      {(() => {
                        const items = parseChecklist(
                          rating.checklist ?? rating.taskDescription,
                        );
                        const hasText = rating.taskDescription?.trim() &&
                          !rating.taskDescription.trim().startsWith("[") &&
                          !rating.taskDescription.trim().startsWith("{");

                        if (!hasText && items.length === 0) {
                          return (
                            <p className="text-[13px] text-muted-foreground italic">
                              No assignment details recorded.
                            </p>
                          );
                        }

                        return (
                          <>
                            {hasText && (
                              <p className="text-[13px] text-foreground leading-relaxed line-clamp-3 whitespace-pre-wrap">
                                {rating.taskDescription}
                              </p>
                            )}
                            {items.length > 0 && (
                              <div className={hasText ? "mt-2" : ""}>
                                <ChecklistTaskRenderer
                                  description={items}
                                  isOwner={false}
                                  disabled={true}
                                />
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>

                    {rating.status !== "DONE" && (
                      <p className="text-[10px] font-bold text-amber-9 uppercase tracking-widest flex items-center gap-1.5 bg-warning/10 w-fit px-2 py-1 rounded-md border border-amber-500/20">
                        Warning: Task not marked DONE by employee
                      </p>
                    )}
                  </div>

                  {/* Rating Controls */}
                  <div className="flex flex-col gap-4 lg:w-[280px] shrink-0 bg-muted/10 p-4 rounded-xl border border-border/50">
                    <div>
                      <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">
                        Performance Grade
                      </label>
                      <GradeSelector
                        grade={rating.grade}
                        onSelect={(g) =>
                          handleRatingChange(rating.memberId, "grade", g)
                        }
                        canEvaluate={true}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">
                        Remarks (Optional)
                      </label>
                      <textarea
                        value={rating.gradeRemarks}
                        onChange={(e) =>
                          handleRatingChange(
                            rating.memberId,
                            "gradeRemarks",
                            e.target.value,
                          )
                        }
                        placeholder="Add feedback for this member..."
                        className="w-full bg-card border border-border rounded-xl px-4 py-3 text-[13px] text-foreground outline-none focus:border-primary/50 transition-colors h-20 resize-none shadow-sm"
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* FOOTER */}
        <div className="px-6 py-4 border-t border-border bg-muted/30 flex items-center justify-between shrink-0">
          <div className="hidden sm:flex items-center gap-3 text-[10px] text-muted-foreground font-medium">
            <div className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-muted/80 border border-border rounded text-muted-foreground font-sans text-[9px]">
                Esc
              </kbd>
              <span>to close</span>
            </div>
            {!allMembersDone && (
              <span className="text-destructive font-bold bg-destructive/10 px-2 py-0.5 rounded border border-red-500/20">
                Cannot submit: Not all members are DONE
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 ml-auto">
            <button
              onClick={onClose}
              className="text-[13px] font-bold text-muted-foreground/80 hover:text-foreground h-9 rounded-xl px-4 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSubmitting || !allMembersDone}
              className="h-9 px-6 rounded-xl shadow-lg shadow-primary/20 bg-primary hover:bg-primary/90 text-primary-foreground flex items-center gap-2 font-bold transition-colors disabled:opacity-50"
            >
              <Star size={14} fill="currentColor" />
              {isSubmitting ? "Submitting..." : "Submit Ratings & Complete"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
