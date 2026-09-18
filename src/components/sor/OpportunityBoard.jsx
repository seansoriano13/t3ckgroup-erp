import { useEffect, useMemo, useState } from "react";
import { Clock, ChevronDown, LayoutGrid, Rows3 } from "lucide-react";
import Avatar from "../Avatar";
import Dropdown from "../ui/Dropdown";
import MoveConfirmDialog from "./MoveConfirmDialog";
import { PROJECT_TYPE_SHORT, formatPHP } from "../../constants/sor";
import { flowBoardColumns, legacyBoardColumns } from "../../constants/board";
import { outgoingStages, isLostFlowStage } from "../../constants/salesFlow";
import { usePipelineStages } from "../../hooks/usePipelineStages";
import { getStatusTheme } from "../../constants/status";
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

const LEGACY_KEY = "LEGACY";

/**
 * CRM Board (issue #206) — one Sale Type's Stages at a time, in the same
 * bracket order the Flow Canvas draws, plus a "Legacy pipeline" option for
 * SORs with no Sale Type. Mixing every flow's Stages into one row was the
 * old board's problem: two flows' Stages are unrelated (ADR 0006), so
 * columns from different flows next to each other implied an order that
 * doesn't exist.
 *
 * Drag-and-drop moves a Sales Flow SOR through the same funnel the details
 * modal's stage control uses (`opportunityService.updateStatus` →
 * `moveAlongFlow`), via `MoveConfirmDialog` — so a drag can never skip a rule
 * the modal enforces. The legacy pipeline board stays read-only: those SORs
 * are winding down, and a legacy move can cross several Stages' worth of
 * conditions the way a flow move never does.
 */
export default function OpportunityBoard({
  opportunities,
  search,
  deadlineStatuses = {},
  flowStagesIndex,
  snapshotsById = {},
  blockedDeals = {},
  saleTypes = [],
  stages: legacyStages,
  onCardClick,
  onMoved,
  currentUserId,
}) {
  const pipelineOpportunities = useMemo(
    () => opportunities.filter((o) => !o.sale_type_id),
    [opportunities],
  );
  const flowOpportunitiesAll = useMemo(
    () => opportunities.filter((o) => o.sale_type_id),
    [opportunities],
  );

  const occupiedStageCodes = useMemo(
    () => pipelineOpportunities.map((o) => o.status),
    [pipelineOpportunities],
  );
  const { stages: fallbackStages } = usePipelineStages({ occupiedCodes: occupiedStageCodes });
  const stages = legacyStages?.length ? legacyStages : fallbackStages;

  // Sale Type switcher — remembered per person, like the sidebar's own state.
  const storageKey = currentUserId ? `erp_board_sale_type_${currentUserId}` : null;
  const [selected, setSelected] = useState(() => {
    if (!storageKey) return null;
    try {
      return localStorage.getItem(storageKey) || null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (selected) return;
    if (saleTypes.length > 0) setSelected(saleTypes[0].id);
    else setSelected(LEGACY_KEY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleTypes.length]);

  const chooseSaleType = (id) => {
    setSelected(id);
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, id);
      } catch {
        // Ignore storage errors
      }
    }
  };

  const [density, setDensity] = useState(() => {
    try {
      return localStorage.getItem("erp_board_density") || "detailed";
    } catch {
      return "detailed";
    }
  });
  const toggleDensity = () => {
    setDensity((prev) => {
      const next = prev === "compact" ? "detailed" : "compact";
      try {
        localStorage.setItem("erp_board_density", next);
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  };

  const isLegacy = selected === LEGACY_KEY || saleTypes.length === 0;

  const activeFlow = useMemo(() => {
    if (isLegacy || !flowStagesIndex) return null;
    return Object.values(flowStagesIndex.flowsById).find((f) => f.sale_type_id === selected) || null;
  }, [isLegacy, flowStagesIndex, selected]);

  const activeFlowStages = useMemo(() => {
    if (!activeFlow) return [];
    return flowStagesIndex.stagesByFlow[activeFlow.id] || [];
  }, [activeFlow, flowStagesIndex]);

  const flowOpportunities = useMemo(
    () => flowOpportunitiesAll.filter((o) => o.sale_type_id === selected),
    [flowOpportunitiesAll, selected],
  );

  const columns = useMemo(() => {
    if (isLegacy) return legacyBoardColumns({ stages, opportunities: pipelineOpportunities });
    return flowBoardColumns({
      stages: activeFlowStages,
      opportunities: flowOpportunities,
      snapshotsById,
      flow: activeFlow,
    });
  }, [isLegacy, stages, pipelineOpportunities, activeFlowStages, flowOpportunities, snapshotsById, activeFlow]);

  const columnKeys = useMemo(() => new Set(columns.map((c) => c.key)), [columns]);

  // Drag state: the SOR being dragged and the target Stage ids its own
  // snapshot's edges actually permit — resolved from the SOR's OWN Flow
  // Snapshot (issue #83), never the live flow, so editing the live flow
  // after this deal registered doesn't change what a drag offers it.
  const [dragging, setDragging] = useState(null); // { opportunity, allowedStageIds }
  const [pendingMove, setPendingMove] = useState(null); // { opportunity, targetStage }

  const handleDragStart = (opportunity) => {
    const snapshotData = snapshotsById[opportunity.flow_snapshot_id]?.snapshot_data;
    if (!snapshotData) {
      setDragging({ opportunity, allowedStageIds: new Set() });
      return;
    }
    const targets = outgoingStages(opportunity.flow_stage_id, snapshotData.stages, snapshotData.edges);
    setDragging({
      opportunity,
      allowedStageIds: new Set(targets.map((s) => s.id).filter((id) => columnKeys.has(id))),
    });
  };

  const handleDragEnd = () => setDragging(null);

  const handleDrop = (column) => {
    if (!dragging || !dragging.allowedStageIds.has(column.key)) {
      setDragging(null);
      return;
    }
    setPendingMove({ opportunity: dragging.opportunity, targetStage: column.stage });
    setDragging(null);
  };

  const isLostTarget = Boolean(
    pendingMove &&
      activeFlow &&
      isLostFlowStage(pendingMove.targetStage, activeFlow.won_stage_id),
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <Dropdown
          usePortal={true}
          trigger={({ isOpen }) => (
            <div
              className={`flex h-9 min-w-[180px] cursor-pointer items-center justify-between gap-2 rounded-xl border px-3 text-sm font-bold transition-all ${isOpen ? "border-mauve-7 bg-muted" : "border-border bg-card hover:border-border/80"
                }`}
            >
              <span className="truncate">
                {isLegacy
                  ? "Legacy pipeline"
                  : saleTypes.find((s) => s.id === selected)?.name || "Choose a Sale Type"}
              </span>
              <ChevronDown size={14} className={`shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
            </div>
          )}
        >
          {({ close }) => (
            <div className="flex min-w-[200px] flex-col gap-0.5 rounded-xl border border-border bg-card p-1.5 shadow-lg">
              {saleTypes.map((st) => (
                <button
                  key={st.id}
                  onClick={() => {
                    chooseSaleType(st.id);
                    close();
                  }}
                  className={`rounded-lg px-2.5 py-1.5 text-left text-[13px] font-semibold transition-colors ${selected === st.id ? "bg-muted text-foreground" : "text-foreground hover:bg-muted/60"
                    }`}
                >
                  {st.name}
                </button>
              ))}
              {saleTypes.length > 0 && <div className="my-1 h-px bg-border" />}
              <button
                onClick={() => {
                  chooseSaleType(LEGACY_KEY);
                  close();
                }}
                className={`rounded-lg px-2.5 py-1.5 text-left text-[13px] font-semibold transition-colors ${isLegacy ? "bg-muted text-foreground" : "text-foreground hover:bg-muted/60"
                  }`}
              >
                Legacy pipeline
              </button>
            </div>
          )}
        </Dropdown>

        <button
          onClick={toggleDensity}
          title={density === "compact" ? "Switch to detailed cards" : "Switch to compact cards"}
          className="flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground"
        >
          {density === "compact" ? <LayoutGrid size={14} /> : <Rows3 size={14} />}
          {density === "compact" ? "Compact" : "Detailed"}
        </button>
      </div>

      <div className="flex flex-1 min-h-0 gap-3 overflow-x-auto pb-2 items-start">
        {columns.map((column, idx) => {
          const showBracketHeader =
            column.bracketLabel && (idx === 0 || columns[idx - 1].bracketLabel !== column.bracketLabel);
          return (
            <BoardColumn
              key={column.key}
              column={column}
              bracketHeader={showBracketHeader ? column.bracketLabel : null}
              search={search}
              density={density}
              deadlineStatuses={deadlineStatuses}
              onCardClick={onCardClick}
              draggable={!isLegacy}
              isDragTarget={dragging?.allowedStageIds?.has(column.key)}
              isDragging={Boolean(dragging)}
              draggingId={dragging?.opportunity?.id}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDrop={() => handleDrop(column)}
            />
          );
        })}
        {columns.length === 0 && (
          <p className="py-8 text-sm text-muted-foreground">
            {isLegacy ? "No legacy SORs." : "This Sale Type has no Stages yet."}
          </p>
        )}
      </div>

      <MoveConfirmDialog
        isOpen={Boolean(pendingMove)}
        onClose={() => setPendingMove(null)}
        opportunity={pendingMove?.opportunity}
        targetStage={pendingMove?.targetStage}
        isLostTarget={isLostTarget}
        knownBlockers={pendingMove ? blockedDeals[pendingMove.opportunity.id] || [] : []}
        actorId={currentUserId}
        onMoved={onMoved}
      />
    </div>
  );
}

function BoardColumn({
  column,
  bracketHeader,
  search,
  density,
  deadlineStatuses,
  onCardClick,
  draggable,
  isDragTarget,
  isDragging,
  draggingId,
  onDragStart,
  onDragEnd,
  onDrop,
}) {
  const theme = column.theme || getStatusTheme(column.key);
  const dotClass = THEME_DOT[theme] || THEME_DOT.mauve;
  const dimmed = isDragging && !isDragTarget;

  return (
    <div className="flex min-w-[264px] w-[264px] shrink-0 flex-col">
      {bracketHeader && (
        <p className="mb-1 truncate px-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          {bracketHeader}
        </p>
      )}
      <div
        onDragOver={(e) => {
          if (isDragTarget) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          onDrop();
        }}
        className={`flex h-full min-h-0 flex-1 flex-col rounded-2xl border bg-mauve-2 transition-all ${isDragTarget
            ? "border-primary/60 ring-2 ring-primary/20"
            : "border-mauve-4"
          } ${dimmed ? "opacity-40" : ""}`}
      >
        <div className="shrink-0 border-b border-mauve-4 px-3.5 py-3">
          <div className="mb-1 flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
            <h3 className="flex-1 truncate text-[13px] font-bold text-foreground">
              {column.stage?.label || column.stage?.name}
            </h3>
            <span className="shrink-0 rounded-full bg-mauve-3 px-1.5 py-0.5 text-[10px] font-black text-muted-foreground">
              {column.count}
            </span>
          </div>
          {column.count > 0 && (
            <div className="flex items-center gap-2 pl-4 text-[11px] font-bold text-muted-foreground">
              {column.openValue > 0 && <span>Open {formatPHP(column.openValue)}</span>}
              {column.openValue > 0 && column.wonValue > 0 && <span className="text-muted-foreground/40">•</span>}
              {column.wonValue > 0 && <span>Won {formatPHP(column.wonValue)}</span>}
            </div>
          )}
        </div>

        <div className="custom-scrollbar flex-1 min-h-0 space-y-2 overflow-y-auto p-2">
          {column.items.length === 0 ? (
            <p className="py-8 text-center text-[11px] italic text-muted-foreground/50">
              No opportunities
            </p>
          ) : (
            column.items.map((o) => (
              <BoardCard
                key={o.id}
                opportunity={o}
                search={search}
                density={density}
                deadline={deadlineStatuses[o.id]}
                draggable={draggable}
                isBeingDragged={draggingId === o.id}
                onClick={() => onCardClick(o)}
                onDragStart={() => onDragStart(o)}
                onDragEnd={onDragEnd}
              />
            ))
          )}
        </div>
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

function BoardCard({
  opportunity,
  search,
  density,
  deadline,
  draggable,
  isBeingDragged,
  onClick,
  onDragStart,
  onDragEnd,
}) {
  const compact = density === "compact";
  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`w-full text-left bg-card border border-border rounded-xl transition-all hover:border-gray-6 hover:shadow-md ${compact ? "p-2" : "p-3"
        } ${draggable ? "cursor-grab active:cursor-grabbing" : ""} ${isBeingDragged ? "opacity-40" : ""}`}
    >
      <div className={`flex items-center justify-between gap-2 ${compact ? "mb-0.5" : "mb-1.5"}`}>
        <span className="font-mono text-[10px] font-bold text-primary truncate">
          <HighlightText text={opportunity.sales_reference || ""} search={search} />
        </span>
        <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wide shrink-0">
          {PROJECT_TYPE_SHORT[opportunity.project_type] || opportunity.project_type}
        </span>
      </div>
      <p className={`text-sm font-bold text-foreground truncate ${compact ? "mb-0" : "mb-0.5"}`}>
        <HighlightText text={opportunity.client_name} search={search} />
      </p>
      {!compact && (
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <p className="text-xs text-muted-foreground truncate">
            <HighlightText text={opportunity.project_title} search={search} />
          </p>
          <DeadlineBadge deadline={deadline} />
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className={`font-black text-foreground truncate ${compact ? "text-xs" : "text-sm"}`}>
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
