/**
 * REMOVE-BEFORE-PROD — SOR modal layout prototype. A stage strip that never
 * scrolls sideways ("Thread"'s status panel): every Stage is one segment sharing the
 * width, so an 18-Stage flow still fits, with the current Stage named and the
 * moves open from it as buttons. Plus the visits hook the strip and the
 * charts share.
 */
import { useMemo } from "react";
import { ArrowRight, ChevronDown, CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import Dropdown from "../../../ui/Dropdown";
import { useSorModalData } from "../useSorModalData";
import { opportunityService } from "../../../../services/opportunityService";
import { getStatusTheme } from "../../../../constants/status";
import { bracketRuns } from "../../../flow-canvas/flowCanvasLayout";
import { LABEL, stageMoves } from "./shared";

export const TONE_BG = {
  green: "bg-green-9",
  amber: "bg-amber-9",
  blue: "bg-blue-9",
  red: "bg-red-9",
  violet: "bg-violet-9",
  orange: "bg-orange-9",
  mauve: "bg-mauve-10",
};

export function useJourneyVisits(p) {
  const { data: visits = [] } = useSorModalData({
    tab: "journey",
    opportunityId: p.id,
    queryFn: () => opportunityService.getJourney(p.id),
    hasOpened: p.hasOpened,
  });
  return visits;
}

/** The deal's stages in reading order, marked current / visited / destination. */
export function stageList(p, visits) {
  const m = stageMoves(p);
  const destKeys = new Set(m.destinations.map((d) => d.key));
  if (p.isFlowDeal) {
    const stages = p.flowCanvas ? bracketRuns(p.flowCanvas.stages).flatMap((r) => r.stages) : [];
    const visited = new Set(visits.map((v) => v.stage.id));
    return stages.map((s) => ({
      key: s.id,
      label: s.name,
      bracket: s.bracket_label || null,
      state: s.id === p.opportunity.flow_stage_id ? "current" : visited.has(s.id) ? "visited" : "upcoming",
      isDestination: destKeys.has(s.id),
      tone: s.id === p.opportunity.flow_stage_id ? p.currentFlowStageTone : null,
    }));
  }
  const idx = p.pipelineStages.findIndex((s) => s.code === p.opportunity.status);
  return p.pipelineStages.map((s, i) => ({
    key: s.code,
    label: s.label,
    bracket: null,
    state: i === idx ? "current" : i < idx ? "visited" : "upcoming",
    isDestination: false,
    tone: i === idx ? s.theme || getStatusTheme(s.code) : null,
  }));
}

/** Where the deal can go from here, as buttons — the same rules the ribbon enforces. */
export function MoveButtons({ p, size = "sm", align = "start" }) {
  const m = stageMoves(p);
  if (m.isTerminal) return <span className="text-xs font-semibold text-muted-foreground">Deals stop here.</span>;
  if (p.moveDisabled) return <span className="text-xs text-muted-foreground">{p.moveDisabledReason}</span>;

  const menu = (items, label) => (
    <Dropdown
      usePortal
      placement={align === "end" ? "bottom-end" : "bottom-start"}
      popoverClassName="popover-enter z-[10001] w-max min-w-52 rounded-xl bg-popover p-1.5 shadow-2xl ring-1 ring-mauve-6"
      trigger={
        <Button type="button" variant="outline" size={size} disabled={!m.canMove} className="gap-1">
          {label}
          <ChevronDown size={13} />
        </Button>
      }
    >
      {({ close }) => (
        <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
          {items.map((d) => (
            <Button
              key={d.key}
              type="button"
              variant="ghost"
              onClick={() => {
                close();
                m.move(d.key);
              }}
              className="h-auto justify-start rounded-lg px-2.5 py-2 text-sm"
            >
              {d.label}
            </Button>
          ))}
        </div>
      )}
    </Dropdown>
  );

  const primary = m.isFlow ? m.destinations.slice(0, 2) : m.suggested ? [m.suggested] : [];
  const rest = m.isFlow ? m.destinations.slice(2) : m.destinations.filter((d) => d.key !== m.suggested?.key);

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", align === "end" && "justify-end")}>
      {m.blockedBy.length > 0 && (
        <span className="mr-1 inline-flex items-center gap-1 text-xs font-semibold text-amber-11">
          <CircleAlert size={13} className="shrink-0" />
          Clear first: {m.blockedBy.join(", ")}
        </span>
      )}
      {primary.map((d, i) => (
        <Button key={d.key} type="button" size={size} variant={i === 0 ? "default" : "outline"} disabled={!m.canMove} onClick={() => m.move(d.key)} className="gap-1.5">
          Move to {d.label}
          <ArrowRight size={13} />
        </Button>
      ))}
      {rest.length > 0 && menu(rest, primary.length ? "Other" : "Move to…")}
    </div>
  );
}

export default function StageStrip({ p, visits, showMoves = true, className }) {
  const list = useMemo(() => stageList(p, visits), [p, visits]);
  const currentIndex = list.findIndex((s) => s.state === "current");
  const current = list[currentIndex];

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <p className={LABEL}>{p.isFlowDeal && p.flowCanvas ? p.flowCanvas.saleType.name : "Pipeline"}</p>
        {currentIndex >= 0 && (
          <p className="text-[11px] tabular-nums text-muted-foreground">
            Stage {currentIndex + 1} of {list.length}
          </p>
        )}
      </div>
      <ol className="mt-2 flex h-2 gap-[3px]" aria-label="Stages">
        {list.map((s) => (
          <li
            key={s.key}
            title={`${s.label}${s.state === "current" ? " (current)" : s.isDestination ? " (can move here)" : ""}`}
            aria-current={s.state === "current" ? "step" : undefined}
            className={cn(
              "min-w-[6px] flex-1 rounded-full transition-colors",
              s.state === "current" ? TONE_BG[s.tone] || "bg-foreground" : s.state === "visited" ? "bg-mauve-8" : s.isDestination ? "bg-mauve-4 ring-1 ring-mauve-9 ring-inset" : "bg-mauve-4",
            )}
          />
        ))}
      </ol>
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-sm font-black text-foreground">
          {current?.label || "—"}
          {current?.bracket && <span className="ml-2 text-[10px] font-bold tracking-wider text-violet-11 uppercase">{current.bracket}</span>}
        </p>
        {showMoves && <MoveButtons p={p} align="end" />}
      </div>
    </div>
  );
}
