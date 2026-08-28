import { useQuery } from "@tanstack/react-query";
import { cn } from "../../lib/utils";
import { salesFlowService } from "../../services/salesFlowService";
import { outgoingStages } from "../../constants/salesFlow";

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

  const { saleType, flow, stages, edges } = canvas;
  const current = stages.find((s) => s.id === opportunity.flow_stage_id) || null;
  const destinations = outgoingStages(opportunity.flow_stage_id, stages, edges);

  const currentIndex = current ? stages.findIndex((s) => s.id === current.id) : -1;
  const lastIndex = stages.length - 1;

  // We still use TONE_CLASSES or default for colors
  const TONE_CLASSES = {
    green: { current: "bg-green-9 text-white", completed: "bg-green-9/20 text-green-11 hover:bg-green-9/30" },
    amber: { current: "bg-amber-9 text-white", completed: "bg-amber-9/20 text-amber-11 hover:bg-amber-9/30" },
    blue: { current: "bg-blue-9 text-white", completed: "bg-blue-9/20 text-blue-11 hover:bg-blue-9/30" },
    red: { current: "bg-red-9 text-white", completed: "bg-red-9/20 text-red-11 hover:bg-red-9/30" },
    violet: { current: "bg-violet-9 text-white", completed: "bg-violet-9/20 text-violet-11 hover:bg-violet-9/30" },
    orange: { current: "bg-orange-9 text-white", completed: "bg-orange-9/20 text-orange-11 hover:bg-orange-9/30" },
    mauve: { current: "bg-mauve-9 text-white", completed: "bg-mauve-9/20 text-mauve-11 hover:bg-mauve-9/30" },
  };

  return (
    <div className="w-full space-y-3">
      <div className="relative w-full">
        <div className="overflow-x-auto pb-2">
          <ul className="flex h-11 min-w-full w-max gap-[2px] mb-2">
            {stages.map((s, index) => {
              const isCompleted = index < currentIndex;
              const isCurrent = index === currentIndex;
              const isUpcoming = index > currentIndex;

              // Use mauve or any custom theme if provided in flow stage (for now default to mauve)
              const tone = s.theme || "mauve";
              const classes = TONE_CLASSES[tone] || TONE_CLASSES.mauve;

              const isDestination = destinations.some(d => d.id === s.id);

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
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
          {saleType.name}
        </span>
        {flow.won_stage_id === current?.id && (
          <span className="text-[10px] font-bold tracking-widest text-emerald-600 uppercase">
            Won
          </span>
        )}
        {current?.is_terminal && (
          <span className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
            Deals stop here
          </span>
        )}
      </div>

    </div>
  );
}
