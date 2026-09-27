/**
 * PROTOTYPE — throwaway. The vertical stage rail (Flow rail,
 * Rail + summary, Rail + board): every
 * Stage top-to-bottom, when this SOR was in each (from the Journey), and a
 * Move button on exactly the stages it can move to.
 */
import { useMemo } from "react";
import { ArrowRight, CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import Spinner from "../../../ui/Spinner";
import FlowVersionBadge from "../../FlowVersionBadge";
import { useSorModalData } from "../useSorModalData";
import { opportunityService } from "../../../../services/opportunityService";
import { bracketRuns } from "../../../flow-canvas/flowCanvasLayout";
import { LABEL, formatShort, stageMoves } from "./shared";

const DOT = {
  green: "bg-green-9",
  amber: "bg-amber-9",
  blue: "bg-blue-9",
  red: "bg-red-9",
  violet: "bg-violet-9",
  orange: "bg-orange-9",
  mauve: "bg-mauve-9",
};

function StageRow({ label, state, tone, visits = [], onMove, canMove, blockedBy = [], isLast }) {
  const latest = visits[0];
  const isCurrent = state === "current";
  const isDestination = state === "destination";
  const isPast = state === "visited" || state === "done";

  return (
    <li className="relative pl-6">
      {!isLast && <span className="absolute top-4 bottom-[-4px] left-[7px] w-px bg-border" aria-hidden />}
      <span
        className={cn(
          "absolute top-[9px] left-[3px] size-[9px] rounded-full ring-4 ring-popover",
          isCurrent ? DOT[tone] || "bg-foreground" : isPast ? "bg-mauve-9" : isDestination ? "border-2 border-foreground bg-popover" : "border border-mauve-7 bg-popover",
        )}
        aria-hidden
      />
      <div className={cn("rounded-lg px-2.5 py-1.5", isCurrent && "bg-muted", isDestination && "hover:bg-muted/60")}>
        <div className="flex items-start justify-between gap-2">
          <span
            className={cn(
              "min-w-0 pt-0.5 text-[13px] leading-snug break-words",
              isCurrent ? "font-black text-foreground" : isDestination ? "font-bold text-foreground" : isPast ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {label}
          </span>
          {isDestination && (
            <Button type="button" size="xs" variant="outline" disabled={!canMove} onClick={onMove} className="shrink-0 gap-1">
              Move
              <ArrowRight size={11} />
            </Button>
          )}
        </div>
        {isCurrent && (
          <p className="text-[11px] text-muted-foreground">{latest ? `Since ${formatShort(latest.enteredAt)}` : "Current stage"}</p>
        )}
        {!isCurrent && latest && (
          <p className="text-[11px] tabular-nums text-muted-foreground">
            {formatShort(latest.enteredAt)} → {latest.leftAt ? formatShort(latest.leftAt) : "now"}
            {visits.length > 1 && <span className="ml-1 font-semibold">· {visits.length}×</span>}
          </p>
        )}
        {isCurrent && blockedBy.length > 0 && (
          <ul className="mt-1.5 space-y-0.5">
            {blockedBy.map((b) => (
              <li key={b} className="flex items-start gap-1 text-[11px] font-semibold text-amber-11">
                <CircleAlert size={11} className="mt-[3px] shrink-0" />
                {b}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

export default function FlowRail({ p }) {
  const m = stageMoves(p);
  const { data: visits = [] } = useSorModalData({
    tab: "journey",
    opportunityId: p.id,
    queryFn: () => opportunityService.getJourney(p.id),
    hasOpened: p.hasOpened,
  });
  const visitsByStage = useMemo(() => {
    const map = {};
    [...visits].sort((a, b) => (b.sequence ?? 0) - (a.sequence ?? 0)).forEach((v) => {
      (map[v.stage.id] ||= []).push(v);
    });
    return map;
  }, [visits]);

  let content;
  if (m.isFlow) {
    const canvas = p.flowCanvas;
    if (!canvas) {
      content = <Spinner size="sm" />;
    } else {
      const destIds = new Set(m.destinations.map((d) => d.key));
      const runs = bracketRuns(canvas.stages);
      const flat = runs.flatMap((r) => r.stages);
      content = runs.map((run) => (
        <div key={run.stages[0].id} className="mb-1">
          {run.label && <p className="mt-2 mb-1 pl-6 text-[9px] font-black tracking-[0.14em] text-violet-11 uppercase">{run.label}</p>}
          <ol>
            {run.stages.map((s) => {
              const state =
                s.id === p.opportunity.flow_stage_id ? "current" : destIds.has(s.id) ? "destination" : visitsByStage[s.id] ? "visited" : "other";
              return (
                <StageRow
                  key={s.id}
                  label={s.name}
                  state={state}
                  tone={p.currentFlowStageTone}
                  visits={visitsByStage[s.id]}
                  canMove={m.canMove && !m.isBlocked(s.id)}
                  onMove={() => m.move(s.id)}
                  blockedBy={m.isBlocked(s.id) ? m.blockedBy : []}
                  isLast={s.id === flat[flat.length - 1].id}
                />
              );
            })}
          </ol>
        </div>
      ));
    }
  } else {
    content = (
      <ol>
        {m.legacy.map((s, i) => (
          <StageRow
            key={s.key}
            label={s.label}
            state={s.state === "current" ? "current" : s.state === "done" ? "done" : "destination"}
            canMove={m.canMove}
            onMove={() => m.move(s.key)}
            blockedBy={m.blockedBy}
            isLast={i === m.legacy.length - 1}
          />
        ))}
      </ol>
    );
  }

  return (
    <aside className="flex w-[260px] shrink-0 flex-col border-r border-border/60">
      <div className="shrink-0 border-b border-border/60 px-4 py-3">
        <p className={LABEL}>{m.isFlow && p.flowCanvas ? p.flowCanvas.saleType.name : "Pipeline"}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {p.moveDisabled ? p.moveDisabledReason : m.isTerminal ? "Deals stop here." : m.blockedBy.length ? "Clear the items in amber to move on." : "Pick where this SOR goes next."}
        </p>
      </div>
      <div className={cn("relative min-h-0 flex-1 overflow-y-auto px-2 py-3", m.isMoving && "pointer-events-none opacity-60")}>{content}</div>
      {p.isFlowDeal && (
        <div className="shrink-0 border-t border-border/60 px-4 py-2.5">
          <FlowVersionBadge opportunity={p.opportunity} onOpenVersion={p.openFlowVersion} />
        </div>
      )}
    </aside>
  );
}
