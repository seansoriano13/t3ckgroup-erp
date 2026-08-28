import { useQuery } from "@tanstack/react-query";
import { cn } from "../../lib/utils";
import { salesFlowService } from "../../services/salesFlowService";
import { flowStageTone, outgoingStages } from "../../constants/salesFlow";

/**
 * The stage control for a deal that runs a Sales Flow (issue #36, ADR 0006).
 *
 * WHY THIS IS NOT THE CHEVRON RIBBON
 * The ribbon in OpportunityDetailsModal draws the whole pipeline as a line and
 * colours each step completed / current / upcoming by comparing its position
 * against the deal's. That is exactly the presumption a graph removes: a flow
 * has branches, skips and loops, so there is no "index of the current Stage"
 * and no "everything after it". Rendering a graph as a line would show the
 * Operations Manager a shape the system does not implement — the "agreed on
 * behaviour nobody observed" failure this project exists to eliminate.
 *
 * So this shows what is actually true: where the deal is now, and every Stage
 * it may move to next. Those are the outgoing edges she drew, and nothing
 * else is offered, because a path that was never drawn never happens.
 */
export default function FlowStageControl({ opportunity, onMove, isMoving }) {
  const { data: canvas } = useQuery({
    queryKey: ["salesFlow", opportunity.sale_type_id],
    queryFn: () => salesFlowService.getFlow(opportunity.sale_type_id),
    enabled: Boolean(opportunity.sale_type_id),
  });

  if (!canvas) return null;

  const { flow, stages, edges } = canvas;
  const current = stages.find((s) => s.id === opportunity.flow_stage_id) || null;
  const destinations = outgoingStages(opportunity.flow_stage_id, stages, edges);

  const sortedStages = [...stages].sort((a, b) => {
    if (a.pos_x !== b.pos_x) return (a.pos_x || 0) - (b.pos_x || 0);
    return (a.pos_y || 0) - (b.pos_y || 0);
  });

  const currentIndex = current ? sortedStages.findIndex((s) => s.id === current.id) : -1;
  const lastIndex = sortedStages.length - 1;

  // Runs of consecutive Stages sharing one bracket label — a brace draws
  // above each run, the same grouping the canvas draws over the node graph.
  // An unlabeled Stage is its own one-Stage run with no brace, so mixing
  // bracketed and bare Stages never merges them under a heading neither drew.
  const runs = [];
  sortedStages.forEach((s) => {
    const last = runs[runs.length - 1];
    if (last && last.label === (s.bracket_label || null)) {
      last.stages.push(s);
    } else {
      runs.push({ label: s.bracket_label || null, stages: [s] });
    }
  });

  // A Stage's own `color` (migration 20260828090000) wins when set; otherwise
  // this falls back to the same role classification FlowCanvasNode draws on
  // the canvas (Entry/Won/Terminal/Plain), so a Stage nobody has recolored
  // still reads as *something* meaningful instead of defaulting to mauve.
  const TONE_CLASSES = {
    green: { current: "bg-green-9 text-white", completed: "bg-green-9/20 text-green-11 hover:bg-green-9/30" },
    amber: { current: "bg-amber-9 text-white", completed: "bg-amber-9/20 text-amber-11 hover:bg-amber-9/30" },
    blue: { current: "bg-blue-9 text-white", completed: "bg-blue-9/20 text-blue-11 hover:bg-blue-9/30" },
    red: { current: "bg-red-9 text-white", completed: "bg-red-9/20 text-red-11 hover:bg-red-9/30" },
    violet: { current: "bg-violet-9 text-white", completed: "bg-violet-9/20 text-violet-11 hover:bg-violet-9/30" },
    orange: { current: "bg-orange-9 text-white", completed: "bg-orange-9/20 text-orange-11 hover:bg-orange-9/30" },
    mauve: { current: "bg-mauve-9 text-white", completed: "bg-mauve-9/20 text-mauve-11 hover:bg-mauve-9/30" },
  };

  let globalIndex = -1;

  return (
    <div className="w-full space-y-3">
      <div className="relative w-full">
        <div className="overflow-x-auto pb-2">
          <div className="flex w-max min-w-full items-end gap-[2px] mb-2">
            {runs.map((run) => (
              <div key={run.stages[0].id} className="flex flex-col">
                {run.label && (
                  <div className="mx-1 mb-1.5 flex flex-col items-center gap-1">
                    <span
                      className="max-w-full truncate rounded-full bg-violet-9 px-2 py-0.5 text-[9px] font-black tracking-[0.12em] text-white uppercase shadow-sm"
                      title={run.label}
                    >
                      {run.label}
                    </span>
                    <div className="h-0 w-full border-t-2 border-violet-8" />
                  </div>
                )}

                <ul className="flex h-11 gap-[2px]">
                  {run.stages.map((s) => {
                    const index = ++globalIndex;
                    const isCompleted = index < currentIndex;
                    const isCurrent = index === currentIndex;
                    const isUpcoming = index > currentIndex;

                    const tone = flowStageTone(s, flow, stages);
                    const classes = TONE_CLASSES[tone] || TONE_CLASSES.mauve;

                    const isDestination = destinations.some((d) => d.id === s.id);

                    return (
                      <li
                        key={s.id}
                        onClick={() => {
                          if (!isMoving && isDestination) {
                            onMove(s.id);
                          }
                        }}
                        className={cn(
                          "relative flex flex-none items-center justify-center px-5 text-[11px] font-bold tracking-wider uppercase transition-all duration-200",
                          isDestination ? "cursor-pointer hover:brightness-110" : "cursor-default",
                          isCompleted && classes.completed,
                          isCurrent && cn(classes.current, "shadow-inner"),
                          isUpcoming && "bg-muted text-muted-foreground",
                          isMoving && "pointer-events-none opacity-50",
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
                          {isCurrent && (
                            <div className="size-1.5 shrink-0 animate-pulse rounded-full bg-white" />
                          )}
                          {s.name}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Sale Type name and the Won/terminal indicator moved up to sit next
          to the "Pipeline Stage" label in OpportunityDetailsModal, beside the
          rest of the deal's identity rather than buried under the ribbon. */}
      {current?.is_terminal && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
            Deals stop here
          </span>
        </div>
      )}
    </div>
  );
}
