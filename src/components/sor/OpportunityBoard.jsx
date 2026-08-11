import { useMemo } from "react";
import Avatar from "../Avatar";
import {
  OPPORTUNITY_STAGES,
  PROJECT_TYPE_SHORT,
  formatPHP,
} from "../../constants/sor";
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

/**
 * Pipeline board — one column per stage (Annex C.3), matching the same
 * color mapping StatusBadge uses everywhere else. Cards are read-only;
 * stage changes still happen through the details modal's guarded control
 * (Closed Lost requires a reason there — dragging a card wouldn't be able
 * to enforce that, so drag-and-drop is deliberately not offered here).
 */
export default function OpportunityBoard({ opportunities, search, onCardClick }) {
  const columns = useMemo(() => {
    return OPPORTUNITY_STAGES.map((stage) => {
      const items = opportunities.filter((o) => o.status === stage.value);
      const total = items.reduce(
        (sum, o) => sum + Number(o.expected_value || 0),
        0,
      );
      return { ...stage, items, total };
    });
  }, [opportunities]);

  return (
    <div className="flex gap-3 overflow-x-auto pb-4 items-start">
      {columns.map((column) => (
        <BoardColumn
          key={column.value}
          column={column}
          search={search}
          onCardClick={onCardClick}
        />
      ))}
    </div>
  );
}

function BoardColumn({ column, search, onCardClick }) {
  const theme = getStatusTheme(column.value);
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
              onClick={() => onCardClick(o)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function BoardCard({ opportunity, search, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left bg-card border border-border rounded-xl p-3 hover:border-gray-6 hover:shadow-md transition-all"
    >
      <div className="flex items-center justify-between mb-1.5 gap-2">
        <span className="font-mono text-[10px] font-bold text-primary truncate">
          <HighlightText text={opportunity.opportunity_no} search={search} />
        </span>
        <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wide shrink-0">
          {PROJECT_TYPE_SHORT[opportunity.project_type] || opportunity.project_type}
        </span>
      </div>
      <p className="text-sm font-bold text-foreground truncate mb-0.5">
        <HighlightText text={opportunity.client_name} search={search} />
      </p>
      <p className="text-xs text-muted-foreground truncate mb-2.5">
        <HighlightText text={opportunity.project_title} search={search} />
      </p>
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
