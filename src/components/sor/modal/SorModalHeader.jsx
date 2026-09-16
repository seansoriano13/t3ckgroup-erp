import { useEffect, useRef } from "react";
import {
  ChevronLeft,
  ChevronRight as ChevronRightIcon,
  Maximize2,
  Minimize2,
  Pencil,
  Target,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Spinner from "../../ui/Spinner";
import StatusBadge from "../../StatusBadge";
import { confirmDeleteToast } from "../../ui/CustomToast";
import { getStatusTheme } from "../../../constants/status";
import FlowStageControl from "../FlowStageControl";
import FlowVersionBadge from "../FlowVersionBadge";

const TONE_CLASSES = {
  green: { current: "bg-green-9 text-white", completed: "bg-green-9/20 text-green-11 hover:bg-green-9/30" },
  amber: { current: "bg-amber-9 text-white", completed: "bg-amber-9/20 text-amber-11 hover:bg-amber-9/30" },
  blue: { current: "bg-blue-9 text-white", completed: "bg-blue-9/20 text-blue-11 hover:bg-blue-9/30" },
  red: { current: "bg-red-9 text-white", completed: "bg-red-9/20 text-red-11 hover:bg-red-9/30" },
  violet: { current: "bg-violet-9 text-white", completed: "bg-violet-9/20 text-violet-11 hover:bg-violet-9/30" },
  orange: { current: "bg-orange-9 text-white", completed: "bg-orange-9/20 text-orange-11 hover:bg-orange-9/30" },
  mauve: { current: "bg-mauve-9 text-white", completed: "bg-mauve-9/20 text-mauve-11 hover:bg-mauve-9/30" },
};

/**
 * Two rows: identity/actions (Sales Reference or Company, stage badge,
 * title, version badge, edit/delete/expand/close, prev/next) and the stage
 * ribbon (move destinations, Blocked: N — the ribbon's own click is the Move
 * control, same interaction as before this ticket).
 */
export default function SorModalHeader({
  opportunity,
  isEditing,
  editForm,
  setEditForm,
  handleEditToggle,
  updateMutation,
  deleteMutation,
  isExpanded,
  setIsExpanded,
  onClose,
  isFlowDeal,
  flowCanvas,
  currentFlowStage,
  currentFlowStageTone,
  pipelineStages,
  stageMutation,
  handleStageChange,
  checklist,
  isOpen,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
}) {
  const scrollRef = useRef(null);
  const activeChevronRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    // Two rAFs, not a timeout: the first fires once the browser has committed
    // DialogContent's post-open layout, the second once that layout has
    // painted. A fixed delay guessed wrong often enough that the active stage
    // silently stayed scrolled off-screen on deals past the first couple stages.
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        activeChevronRef.current?.scrollIntoView({
          behavior: "smooth",
          inline: "center",
          block: "nearest",
        });
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [opportunity?.status, isOpen]);

  const currentIndex = pipelineStages.findIndex((s) => s.code === opportunity.status);
  const lastIndex = pipelineStages.length - 1;
  const blockedCount = checklist.filter(
    ({ condition, status }) => condition?.is_required && status === "unsatisfied",
  ).length;

  const legacyRibbon = (
    <div className="relative w-full">
      <div ref={scrollRef} className="overflow-x-auto pb-2">
        <ul className="flex h-11 min-w-full w-max gap-[2px] mb-2">
          {pipelineStages.map((s, index) => {
            const isCompleted = index < currentIndex;
            const isCurrent = index === currentIndex;
            const isUpcoming = index > currentIndex;
            const tone = s.theme || getStatusTheme(s.code);
            const classes = TONE_CLASSES[tone] || TONE_CLASSES.mauve;

            return (
              <li
                key={s.code}
                ref={isCurrent ? activeChevronRef : undefined}
                onClick={() => {
                  if (!stageMutation.isPending && s.code !== opportunity.status) {
                    handleStageChange(s.code);
                  }
                }}
                className={cn(
                  "relative flex flex-none cursor-pointer items-center justify-center px-5 text-[11px] font-bold tracking-wider uppercase transition-all duration-200",
                  isCompleted && classes.completed,
                  isCurrent && cn(classes.current, "shadow-inner"),
                  isUpcoming && "bg-muted text-muted-foreground hover:bg-muted/80",
                  stageMutation.isPending && "pointer-events-none opacity-50",
                )}
                style={{
                  clipPath:
                    index === 0
                      ? "polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%)"
                      : index === lastIndex
                        ? "polygon(0 0, 100% 0, 100% 100%, 0 100%, 14px 50%)"
                        : "polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%, 14px 50%)",
                }}
              >
                <span
                  className={cn(
                    "flex items-center gap-1.5 whitespace-nowrap",
                    index > 0 && index < lastIndex && "pl-2",
                    index === lastIndex && "pl-3",
                  )}
                >
                  {isCurrent && <div className="size-1.5 shrink-0 animate-pulse rounded-full bg-white" />}
                  {s.label}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      {stageMutation.isPending && (
        <div className="absolute inset-0 flex items-center justify-center rounded-md bg-background/50 backdrop-blur-[1px]">
          <Spinner size="sm" />
        </div>
      )}
    </div>
  );

  return (
    <div className="flex shrink-0 flex-col gap-3 border-b border-border/60 px-6 pt-5 pb-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-1.5 flex items-center gap-2">
            <div className="flex size-[18px] shrink-0 items-center justify-center rounded bg-primary/10 text-primary">
              <Target size={11} strokeWidth={2.5} />
            </div>
            {opportunity.sales_reference ? (
              <span className="font-mono text-xs font-bold text-primary">
                {opportunity.sales_reference}
              </span>
            ) : (
              <span className="truncate text-xs font-bold text-muted-foreground">
                {opportunity.client_name}
              </span>
            )}
            {isFlowDeal ? (
              currentFlowStage && <StatusBadge label={currentFlowStage.name} theme={currentFlowStageTone} />
            ) : (
              <StatusBadge status={opportunity.status} />
            )}
          </div>
          {isEditing ? (
            <div className="space-y-2 mt-2 max-w-xl">
              <input
                value={editForm.project_title}
                onChange={(e) => setEditForm((f) => ({ ...f, project_title: e.target.value }))}
                className="w-full text-lg font-black text-foreground bg-transparent border-b border-border/50 focus:border-primary focus:outline-none placeholder:text-muted-foreground/30"
                placeholder="Project Title"
                autoFocus
              />
              <input
                value={editForm.client_name}
                onChange={(e) => setEditForm((f) => ({ ...f, client_name: e.target.value }))}
                className="w-full text-xs font-medium text-muted-foreground bg-transparent border-b border-border/50 focus:border-primary focus:outline-none placeholder:text-muted-foreground/30"
                placeholder="Company"
              />
            </div>
          ) : (
            <>
              <h2 className="truncate text-lg font-black text-foreground">{opportunity.project_title}</h2>
              <p className="truncate text-xs font-medium text-muted-foreground">{opportunity.client_name}</p>
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {(hasPrev || hasNext) && (
            <>
              <button
                onClick={onPrev}
                disabled={!hasPrev}
                title="Previous"
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground disabled:opacity-30"
              >
                <ChevronLeft size={15} />
              </button>
              <button
                onClick={onNext}
                disabled={!hasNext}
                title="Next"
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground disabled:opacity-30"
              >
                <ChevronRightIcon size={15} />
              </button>
              <div className="mx-1 h-4 w-px bg-border/60" />
            </>
          )}
          {isEditing ? (
            <>
              <button
                onClick={handleEditToggle}
                className="rounded-md px-3 py-1.5 text-xs font-bold text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={() => updateMutation.mutate(editForm)}
                disabled={updateMutation.isPending}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground transition-all hover:bg-primary-hover disabled:opacity-50"
              >
                {updateMutation.isPending ? "Saving..." : "Save"}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleEditToggle}
                title="Edit"
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
              >
                <Pencil size={14} />
              </button>
              <button
                onClick={() =>
                  confirmDeleteToast(
                    `Delete ${opportunity.opportunity_no}?`,
                    "The record is archived, not erased.",
                    () => deleteMutation.mutate(),
                  )
                }
                title="Delete"
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/80 hover:text-red-500"
              >
                <Trash2 size={14} />
              </button>
              <button
                onClick={() => setIsExpanded((v) => !v)}
                title={isExpanded ? "Collapse" : "Expand"}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
              >
                {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
              <button
                onClick={onClose}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
              >
                <X size={15} />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="w-full">
        <div className="flex-between align-center">
          <p className="flex flex-wrap items-center gap-2 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
            Pipeline Stage
            {isFlowDeal && flowCanvas && (
              <>
                <span className="text-muted-foreground/40">—</span>
                <span className="text-foreground">{flowCanvas.saleType.name}</span>
                {flowCanvas.flow.won_stage_id === currentFlowStage?.id ? (
                  <span className="rounded-full bg-green-9/15 px-1.5 py-0.5 text-green-11">Won</span>
                ) : (
                  currentFlowStage?.is_terminal && (
                    <span className="rounded-full bg-mauve-9/15 px-1.5 py-0.5 text-mauve-11">Closed</span>
                  )
                )}
              </>
            )}
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5",
                blockedCount > 0 ? "bg-red-9/15 text-red-11" : "bg-green-9/15 text-green-11",
              )}
            >
              Blocked: {blockedCount}
            </span>
          </p>
          {isFlowDeal && (
            <div className="flex justify-end">
              <FlowVersionBadge
                opportunity={opportunity}
                onOpenVersion={(snapshotId) => {
                  const stage = opportunity.flow_stage_id;
                  const query = stage ? `?stage=${encodeURIComponent(stage)}` : "";
                  window.open(`/flow-versions/${snapshotId}${query}`, "_blank", "noopener");
                }}
              />
            </div>
          )}
        </div>
        {isFlowDeal ? (
          <FlowStageControl
            opportunity={opportunity}
            isMoving={stageMutation.isPending}
            blockedBy={checklist
              .filter(({ condition, status }) => condition?.is_required && status === "unsatisfied")
              .map(({ condition }) => condition.label)}
            onMove={(flowStageId) =>
              stageMutation.mutate({ next: flowStageId, reason: null, salesReference: null })
            }
          />
        ) : (
          legacyRibbon
        )}
      </div>
    </div>
  );
}
