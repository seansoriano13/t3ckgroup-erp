import { useEffect, useRef } from "react";
import {
  ChevronLeft,
  ChevronRight as ChevronRightIcon,
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
import StageRibbonScroller from "../StageRibbonScroller";
import { Button } from "../../ui/button";
import { Input } from "@/components/ui/input";
import { sorCodeOf } from "../../../utils/sorCode";

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
  onClose,
  isFlowDeal,
  flowCanvas,
  currentFlowStage,
  currentFlowStageTone,
  pipelineStages,
  stageMutation,
  handleStageChange,
  checklist,
  missingRequiredStageFields = [],
  isOpen,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  canEdit = false,
  moveDisabled = false,
  moveDisabledReason,
  returnStageIds = [],
}) {
  const activeChevronRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    // Two rAFs, not a timeout: the first fires once the browser has committed
    // DialogContent's post-open layout, the second once that layout has
    // painted. A fixed delay guessed wrong often enough that the active stage
    // silently stayed scrolled off-screen on deals past the first couple stages.
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        // Scroll the ribbon strip only. scrollIntoView also scrolls every
        // ancestor, and DialogContent's overflow-hidden still allows that, so
        // the whole modal body slid left on later stages.
        const chevron = activeChevronRef.current;
        const scroller = chevron?.closest(".scrollbar-hide");
        if (!chevron || !scroller) return;
        const c = chevron.getBoundingClientRect();
        const s = scroller.getBoundingClientRect();
        scroller.scrollTo({
          left: scroller.scrollLeft + (c.left - s.left) - (s.width - c.width) / 2,
          behavior: "smooth",
        });
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [opportunity?.status, isOpen]);

  const currentIndex = pipelineStages.findIndex((s) => s.code === opportunity.status);
  const lastIndex = pipelineStages.length - 1;
  // Issue #407 — a required, empty Stage Field blocks the move exactly like
  // an unsatisfied required Condition (`assertStageGateSatisfied` refuses
  // either), so both count toward "Blocked: N" and both name themselves in
  // the ribbon's blockedBy list. Before this, the badge only ever looked at
  // `checklist` and could read "Clear to move" while a Stage Field still
  // blocked the server-side move.
  const blockedCount =
    checklist.filter(({ condition, status }) => condition?.is_required && status === "unsatisfied").length +
    missingRequiredStageFields.length;

  const legacyRibbon = (
    <div className="relative w-full">
      <StageRibbonScroller>
        <ol data-stage-ribbon aria-label="Pipeline stage" className="flex h-12 min-w-full w-max gap-[2px]">
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
                  "relative h-full focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-current flex-none rounded-none px-6 text-xs font-bold tracking-wider uppercase",
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
      </StageRibbonScroller>
      {moveDisabled && moveDisabledReason && (
        <p className="mt-2 text-[11px] font-medium text-muted-foreground">
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
    <div className="flex shrink-0 flex-col gap-5 border-b border-border/60 px-5 pt-5 pb-5 sm:gap-6 sm:px-8 sm:pt-7 sm:pb-6">
      <div className="flex items-start justify-between gap-3 sm:gap-6">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Target size={13} strokeWidth={2.5} />
            </div>
            {sorCodeOf(opportunity) && (
              <span className="font-mono text-[13px] font-bold text-primary">{sorCodeOf(opportunity)}</span>
            )}
            {opportunity.sales_reference ? (
              <span className="font-mono text-[13px] font-bold text-muted-foreground">
                {opportunity.sales_reference}
              </span>
            ) : (
              <span className="truncate text-[13px] font-bold text-muted-foreground">
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
              <Input
                value={editForm.project_title}
                onChange={(e) => setEditForm((f) => ({ ...f, project_title: e.target.value }))}
                containerClassName="w-full" className="text-lg font-black placeholder:text-muted-foreground/30"
                placeholder="Project Title"
                autoFocus
              />
              <Input
                value={editForm.client_name}
                onChange={(e) => setEditForm((f) => ({ ...f, client_name: e.target.value }))}
                containerClassName="w-full" className="h-auto text-xs font-medium text-muted-foreground bg-transparent border-b border-border/50 focus:border-primary focus:outline-none placeholder:text-muted-foreground/30"
                placeholder="Company"
              />
            </div>
          ) : (
            <>
              <h2 className="line-clamp-2 text-xl leading-tight font-black tracking-[-0.02em] text-balance text-foreground sm:text-[26px]">{opportunity.project_title}</h2>
              <p className="mt-1.5 truncate text-sm font-medium text-muted-foreground">{opportunity.client_name}</p>
            </>
          )}
        </div>
        <div className="-mt-1 -mr-2 flex shrink-0 items-center gap-1 sm:-mr-3">
          {(hasPrev || hasNext) && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onPrev}
                disabled={!hasPrev}
                title="Previous"
                aria-label="Previous opportunity"
                className="text-muted-foreground"
              >
                <ChevronLeft size={17} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onNext}
                disabled={!hasNext}
                title="Next"
                aria-label="Next opportunity"
                className="text-muted-foreground"
              >
                <ChevronRightIcon size={17} />
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
                  size="icon"
                  onClick={handleEditToggle}
                  title="Edit"
                  aria-label="Edit opportunity"
                  className="text-muted-foreground"
                >
                  <Pencil size={16} />
                </Button>
              )}
              {/* Rarely-used actions live behind one menu so the header keeps a single row of intent. */}
              <Dropdown
                usePortal
                placement="bottom-end"
                popoverClassName="popover-enter z-[10001] w-max min-w-52 rounded-xl bg-popover p-1.5 shadow-2xl ring-1 ring-mauve-6"
                trigger={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    title="More actions"
                    aria-label="More actions"
                    className="text-muted-foreground"
                  >
                    <MoreHorizontal size={17} />
                  </Button>
                }
              >
                {({ close }) => (
                  <div className="flex flex-col gap-0.5">
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
                size="icon"
                onClick={onClose}
                title="Close"
                aria-label="Close"
                className="text-muted-foreground"
              >
                <X size={17} />
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="w-full">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p className="flex flex-wrap items-center gap-2.5 text-[11px] font-bold tracking-widest text-muted-foreground uppercase">
            Pipeline Stage
            {isFlowDeal && flowCanvas && (
              <>
                <span className="text-muted-foreground/40">—</span>
                <span className="text-foreground">{flowCanvas.saleType.name}</span>
                {flowCanvas.flow.won_stage_id === currentFlowStage?.id ? (
                  <span className="rounded-full bg-green-9/15 px-2 py-0.5 text-green-11">Won</span>
                ) : (
                  currentFlowStage?.is_terminal && (
                    <span className="rounded-full bg-mauve-9/15 px-2 py-0.5 text-mauve-11">Closed</span>
                  )
                )}
              </>
            )}
            <span
              className={cn(
                "rounded-full px-2 py-0.5",
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
            blockedBy={[
              ...checklist
                .filter(({ condition, status }) => condition?.is_required && status === "unsatisfied")
                .map(({ condition }) => condition.label),
              ...missingRequiredStageFields.map((field) => field.label),
            ]}
            returnStageIds={returnStageIds}
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
