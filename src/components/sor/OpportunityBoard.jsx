import { useMemo } from "react";
import { Clock } from "lucide-react";
import Avatar from "../Avatar";
import { PROJECT_TYPE_SHORT, formatPHP } from "../../constants/sor";
import { usePipelineStages } from "../../hooks/usePipelineStages";
import { getStatusTheme } from "../../constants/status";
import { flowStageTone } from "../../constants/salesFlow";
import HighlightText from "../HighlightText";

const THEME_DOT = {
  green: "bg-green-9",
  amber: "bg-amber-9",
  blue: "bg-blue-9",
  red: "bg-red-9",
  violet: "bg-violet-9",
  orange: "bg-orange-9",
  mauve: "bg-mauve-9",
};

/**
 * Pipeline board — one column per stage (Annex C.3), matching the same
 * color mapping StatusBadge uses everywhere else. Cards are read-only;
 * stage changes still happen through the details modal's guarded control
 * (Closed Lost requires a reason there — dragging a card wouldn't be able
 * to enforce that, so drag-and-drop is deliberately not offered here).
 */
export default function OpportunityBoard({
  opportunities,
  search,
  deadlineStatuses = {},
  flowStagesIndex,
  onCardClick,
}) {
  // A flow deal's `status` never changes (opportunityService's moveAlongFlow
  // deliberately leaves it alone — the trigger that requires a Sales
  // Reference to "leave Lead" fires on any change to it). So a flow deal is
  // never grouped by `status`; it gets its own column per Stage below.
  const pipelineOpportunities = useMemo(
    () => opportunities.filter((o) => !o.sale_type_id),
    [opportunities],
  );
  const flowOpportunities = useMemo(
    () => opportunities.filter((o) => o.sale_type_id),
    [opportunities],
  );

  // Deactivating a stage removes it from pickers, never from opportunities
  // already sitting in it — so a column an opportunity here occupies stays
  // on the board even after a super admin retires it.
  const occupiedStageCodes = useMemo(
    () => pipelineOpportunities.map((o) => o.status),
    [pipelineOpportunities],
  );
  const { stages } = usePipelineStages({ occupiedCodes: occupiedStageCodes });

  const pipelineColumns = useMemo(() => {
    return stages.map((stage) => {
      const items = pipelineOpportunities.filter((o) => o.status === stage.code);
      const total = items.reduce(
        (sum, o) => sum + Number(o.expected_value || 0),
        0,
      );
      return { key: stage.code, label: stage.label, theme: stage.theme, items, total };
    });
  }, [pipelineOpportunities, stages]);

  // One column per Stage a loaded flow deal is actually sitting in — never
  // per flow. A Sales Flow is a graph (see FlowStageControl's "WHY THIS IS
  // NOT THE CHEVRON RIBBON"), so there is no shared ordered axis across every
  // flow the way there is for the global pipeline; each column still only
  // ever groups deals within one flow's one Stage, so nothing here claims an
  // ordering the graph doesn't have. Columns are ordered left to right by
  // canvas position, the same axis FlowStageControl's ribbon uses.
  const flowColumns = useMemo(() => {
    if (!flowStagesIndex) return [];
    const byStage = new Map();
    for (const o of flowOpportunities) {
      const stage = flowStagesIndex.stagesById[o.flow_stage_id];
      if (!stage) continue;
      if (!byStage.has(stage.id)) byStage.set(stage.id, []);
      byStage.get(stage.id).push(o);
    }
    return [...byStage.entries()]
      .map(([stageId, items]) => {
        const stage = flowStagesIndex.stagesById[stageId];
        const flow = flowStagesIndex.flowsById[stage.flow_id];
        const stagesOfFlow = flowStagesIndex.stagesByFlow[stage.flow_id] || [];
        const total = items.reduce((sum, o) => sum + Number(o.expected_value || 0), 0);
        return {
          key: stage.id,
          label: stage.name,
          theme: flowStageTone(stage, flow, stagesOfFlow),
          items,
          total,
          posX: stage.pos_x || 0,
          posY: stage.pos_y || 0,
        };
      })
      .sort((a, b) => a.posX - b.posX || a.posY - b.posY);
  }, [flowOpportunities, flowStagesIndex]);

  // Flow deals with no matching Stage loaded yet (index still fetching, or
  // a deal whose Stage was deleted) fall out of every column silently
  // otherwise — this at least keeps the count on the board honest.
  const unresolvedFlowCount =
    flowOpportunities.length - flowColumns.reduce((sum, c) => sum + c.items.length, 0);

  const columns = [...pipelineColumns, ...flowColumns];

  return (
    <div className="flex gap-3 overflow-x-auto pb-4 items-start">
      {columns.map((column) => (
        <BoardColumn
          key={column.key}
          column={column}
          search={search}
          deadlineStatuses={deadlineStatuses}
          onCardClick={onCardClick}
        />
      ))}
      {unresolvedFlowCount > 0 && (
        <div className="min-w-[264px] w-[264px] shrink-0 rounded-2xl border border-dashed border-mauve-6 p-3.5 text-[11px] text-muted-foreground">
          {unresolvedFlowCount} deal{unresolvedFlowCount === 1 ? "" : "s"} on a Sales Flow Stage that
          could not be resolved (still loading, or the Stage was deleted).
        </div>
      )}
    </div>
  );
}

function BoardColumn({ column, search, deadlineStatuses, onCardClick }) {
  // A configured stage carries its own theme; getStatusTheme is the fallback
  // for a code the palette map still knows about.
  const theme = column.theme || getStatusTheme(column.key);
  const dotClass = THEME_DOT[theme] || THEME_DOT.mauve;

  return (
    <div className="min-w-[264px] w-[264px] shrink-0 bg-mauve-2 rounded-2xl border border-mauve-4 flex flex-col max-h-[calc(100vh-280px)]">
      <div className="px-3.5 py-3 border-b border-mauve-4 shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`} />
          <h3 className="font-bold text-[13px] text-foreground truncate flex-1">
            {column.label}
          </h3>
          <span className="text-[10px] font-black text-muted-foreground bg-mauve-3 px-1.5 py-0.5 rounded-full shrink-0">
            {column.items.length}
          </span>
        </div>
        {column.items.length > 0 && (
          <p className="text-[11px] font-bold text-muted-foreground pl-4">
            {formatPHP(column.total)}
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar">
        {column.items.length === 0 ? (
          <p className="text-[11px] text-muted-foreground/50 italic text-center py-8">
            No opportunities
          </p>
        ) : (
          column.items.map((o) => (
            <BoardCard
              key={o.id}
              opportunity={o}
              search={search}
              deadline={deadlineStatuses[o.id]}
              onClick={() => onCardClick(o)}
            />
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Stage Gate Engine, ticket 7 (D42) — the board card countdown for a Stage
 * carrying a `deadline` condition. Shown at every distance, not just once
 * urgent: D42 says the card shows the countdown, not just a warning, and
 * story 16 is "I want to see a countdown", not "I want to be warned."
 * Colour is the only thing that changes with urgency.
 */
function DeadlineBadge({ deadline }) {
  if (!deadline) return null;
  const { daysRemaining, isBreached, isApproaching, condition } = deadline;

  const tone = isBreached
    ? "bg-red-500/10 text-red-600 dark:text-red-400"
    : isApproaching
      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
      : "bg-muted text-muted-foreground";
  const text = isBreached ? `${Math.abs(daysRemaining)}d overdue` : `${daysRemaining}d left`;

  return (
    <span
      title={condition.label}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${tone}`}
    >
      <Clock size={10} />
      {text}
    </span>
  );
}

function BoardCard({ opportunity, search, deadline, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left bg-card border border-border rounded-xl p-3 hover:border-gray-6 hover:shadow-md transition-all"
    >
      <div className="flex items-center justify-between mb-1.5 gap-2">
        {/* The Odoo Sales Reference, not the retired opportunity_no — that
            shared the same S0#### format while identifying a different record
            entirely. Leads have no reference yet, so the slot stays empty. */}
        <span className="font-mono text-[10px] font-bold text-primary truncate">
          <HighlightText text={opportunity.sales_reference || ""} search={search} />
        </span>
        <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wide shrink-0">
          {PROJECT_TYPE_SHORT[opportunity.project_type] || opportunity.project_type}
        </span>
      </div>
      <p className="text-sm font-bold text-foreground truncate mb-0.5">
        <HighlightText text={opportunity.client_name} search={search} />
      </p>
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <p className="text-xs text-muted-foreground truncate">
          <HighlightText text={opportunity.project_title} search={search} />
        </p>
        <DeadlineBadge deadline={deadline} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-black text-foreground truncate">
          {formatPHP(opportunity.expected_value)}
        </span>
        {opportunity.deal_owner && (
          <Avatar
            name={opportunity.deal_owner.name}
            src={opportunity.deal_owner.avatar_path}
            size="xs"
            title={opportunity.deal_owner.name}
            className="shrink-0"
          />
        )}
      </div>
    </button>
  );
}
