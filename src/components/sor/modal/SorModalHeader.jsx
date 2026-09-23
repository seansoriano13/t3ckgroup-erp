import { useEffect, useRef } from "react";
import {
  ChevronLeft,
  ChevronRight as ChevronRightIcon,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Pencil,
  Target,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Spinner from "../../ui/Spinner";
import Dropdown from "../../ui/Dropdown";
import StatusBadge from "../../StatusBadge";
import { confirmDeleteToast } from "../../ui/CustomToast";
import { getStatusTheme } from "../../../constants/status";
import FlowStageControl from "../FlowStageControl";
import FlowVersionBadge from "../FlowVersionBadge";
import { Button } from "../../ui/button";

const TONE_CLASSES = {
  green: { current: "bg-green-9 text-white hover:bg-green-9 hover:text-white", completed: "bg-green-9/20 text-green-11 hover:bg-green-9/30" },
  amber: { current: "bg-amber-9 text-white hover:bg-amber-9 hover:text-white", completed: "bg-amber-9/20 text-amber-11 hover:bg-amber-9/30" },
  blue: { current: "bg-blue-9 text-white hover:bg-blue-9 hover:text-white", completed: "bg-blue-9/20 text-blue-11 hover:bg-blue-9/30" },
  red: { current: "bg-red-9 text-white hover:bg-red-9 hover:text-white", completed: "bg-red-9/20 text-red-11 hover:bg-red-9/30" },
  violet: { current: "bg-violet-9 text-white hover:bg-violet-9 hover:text-white", completed: "bg-violet-9/20 text-violet-11 hover:bg-violet-9/30" },
  orange: { current: "bg-orange-9 text-white hover:bg-orange-9 hover:text-white", completed: "bg-orange-9/20 text-orange-11 hover:bg-orange-9/30" },
  mauve: { current: "bg-mauve-9 text-white hover:bg-mauve-9 hover:text-white", completed: "bg-mauve-9/20 text-mauve-11 hover:bg-mauve-9/30" },
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
  accessLevel = "full",
  moveDisabled = false,
  moveDisabledReason,
}) {
  const canEdit = accessLevel === "full";
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
        <ol data-stage-ribbon aria-label="Pipeline stage" className="flex h-11 min-w-full w-max gap-[2px] mb-2">
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
                className="flex flex-none"
              >
              <Button
                type="button"
                variant="ghost"
                aria-current={isCurrent ? "step" : undefined}
                aria-disabled={moveDisabled || stageMutation.isPending || isCurrent || undefined}
                aria-label={isCurrent ? `${s.label || s.code} (current stage)` : moveDisabled ? `${s.label || s.code}, you can't move this deal` : `Move to ${s.label || s.code}`}
                onClick={() => {
                  if (!moveDisabled && !stageMutation.isPending && s.code !== opportunity.status) {
                    handleStageChange(s.code);
                  }
                }}
                title={moveDisabled ? moveDisabledReason : undefined}
                className={cn(
                  "relative h-full focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-current flex-none rounded-none px-5 text-[11px] font-bold tracking-wider uppercase",
                  moveDisabled ? "cursor-default" : "cursor-pointer",
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
              </Button>
              </li>
            );
          })}
        </ol>
      </div>
      {moveDisabled && moveDisabledReason && (
        <p className="-mt-1 mb-1 text-[11px] font-medium text-muted-foreground">
          {moveDisabledReason}
        </p>
      )}
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
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={onPrev}
                disabled={!hasPrev}
                title="Previous"
                aria-label="Previous opportunity"
                className="text-muted-foreground"
              >
                <ChevronLeft size={15} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={onNext}
                disabled={!hasNext}
                title="Next"
                aria-label="Next opportunity"
                className="text-muted-foreground"
              >
                <ChevronRightIcon size={15} />
              </Button>
              <div className="mx-1 h-4 w-px bg-border/60" />
            </>
          )}
          {isEditing ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleEditToggle}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => updateMutation.mutate(editForm)}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </>
          ) : (
            <>
              {canEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={handleEditToggle}
                  title="Edit"
                  aria-label="Edit opportunity"
                  className="text-muted-foreground"
                >
                  <Pencil size={14} />
                </Button>
              )}
              {/* Rarely-used actions live behind one menu so the header keeps a single row of intent. */}
              <Dropdown
                usePortal
                placement="bottom-end"
                popoverClassName="popover-enter z-[10001] w-44 rounded-xl bg-popover p-1.5 shadow-2xl ring-1 ring-mauve-6"
                trigger={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    title="More actions"
                    aria-label="More actions"
                    className="text-muted-foreground"
                  >
                    <MoreHorizontal size={15} />
                  </Button>
                }
              >
                {({ close }) => (
                  <div className="flex flex-col gap-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        close();
                        setIsExpanded((v) => !v);
                      }}
                      className="h-auto justify-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-foreground hover:bg-mauve-a3 hover:text-foreground"
                    >
                      {isExpanded ? <Minimize2 size={14} className="text-muted-foreground" /> : <Maximize2 size={14} className="text-muted-foreground" />}
                      {isExpanded ? "Collapse" : "Expand to full screen"}
                    </Button>
                    {canEdit && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          close();
                          confirmDeleteToast(
                            `Delete ${opportunity.opportunity_no}?`,
                            "The record is archived, not erased.",
                            () => deleteMutation.mutate(),
                          );
                        }}
                        className="h-auto justify-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-foreground hover:bg-red-9/10 hover:text-red-11"
                      >
                        <Trash2 size={14} className="text-red-11" />
                        Delete opportunity
                      </Button>
                    )}
                  </div>
                )}
              </Dropdown>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={onClose}
                title="Close"
                aria-label="Close"
                className="text-muted-foreground"
              >
                <X size={15} />
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="w-full">
        <div className="flex flex-wrap items-center justify-between gap-2">
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
              {blockedCount > 0 ? `Blocked: ${blockedCount}` : "Clear to move"}
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
            disabled={moveDisabled}
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
