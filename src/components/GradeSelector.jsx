/**
 * GradeSelector — Extracted from ManagerEvaluation.
 * Renders the 1-5 grade buttons for head task evaluation.
 *
 * Used in two modes:
 *   1. Interactive (canEvaluate=true) — head selects a grade before approving
 *   2. Read-only (finalized=true)     — shows the final grade after approval
 */
export default function GradeSelector({
  grade,
  onSelect,
  canEvaluate = false,
  finalized = false,
  compact = false,
}) {
  const activeColorMap = {
    1: "bg-destructive text-white shadow-sm",
    2: "bg-orange-500 text-white shadow-sm",
    3: "bg-amber-500 text-white shadow-sm",
    4: "bg-lime-500 text-white shadow-sm",
    5: "bg-green-10 text-white shadow-sm",
  };

  return (
    <div
      className={`flex items-center bg-muted/40 p-1.5 rounded-full w-full ${compact ? "gap-0.5" : "gap-1"}`}
    >
      {[1, 2, 3, 4, 5].map((num) => {
        const isSelected = Number(grade) === num;

        if (finalized) {
          return (
            <div
              key={num}
              className={`flex items-center justify-center font-bold transition-all rounded-full ${
                compact ? "w-6 h-7 text-[10px]" : "flex-1 py-2 text-sm"
              } ${
                isSelected
                  ? `${activeColorMap[num]}`
                  : "text-muted-foreground/40 opacity-50"
              }`}
            >
              {num}
            </div>
          );
        }

        return (
          <button
            key={num}
            type="button"
            disabled={!canEvaluate}
            onClick={() => onSelect?.(Number(grade) === num ? null : num)}
            className={`flex items-center justify-center font-bold transition-all rounded-full ${
              compact ? "w-6 h-7 text-[10px]" : "flex-1 py-2 text-sm"
            } ${!canEvaluate ? "opacity-50 cursor-not-allowed" : ""} ${
              isSelected
                ? `${activeColorMap[num]} scale-[1.02] z-10 shadow-md`
                : `text-muted-foreground hover:bg-background hover:text-foreground hover:shadow-sm`
            }`}
          >
            {num}
          </button>
        );
      })}
    </div>
  );
}
