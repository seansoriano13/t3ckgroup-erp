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

  return (
    <div className="w-full space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
          {saleType.name}
        </span>
        <span
          className={cn(
            "rounded-lg px-3 py-1.5 text-[11px] font-bold tracking-wider uppercase",
            "bg-primary/10 text-foreground border border-primary",
          )}
        >
          {current?.name || "Not placed"}
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

      {destinations.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {current?.is_terminal
            ? "This deal has reached the end of its flow."
            : "No moves are drawn from this Stage yet."}
        </p>
      ) : (
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
            Move to
          </p>
          <div className="flex flex-wrap gap-1.5">
            {destinations.map((stage) => (
              <button
                key={stage.id}
                disabled={isMoving}
                onClick={() => onMove(stage.id)}
                className="rounded-xl border border-border px-3 py-2 text-[13px] font-bold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                {stage.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
