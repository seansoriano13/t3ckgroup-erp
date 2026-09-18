import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { MoreHorizontal, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { SAT_H, SAT_W } from "./flowCanvasLayout";
import {
  ACTION_KIND_META,
  CONDITION_KIND_META,
  actionTitle,
  actionSummary,
  conditionDetail,
} from "./flowStageKinds";
import TemplateTokenText from "@/components/ui/TemplateTokenText";

/**
 * The small nodes that hang off a Stage: one per condition on the gate side,
 * one per action on the run side, plus the overflow and add-slot nodes that
 * stand in for what is not drawn.
 *
 * They are children of their Stage node (`parentId`), so React Flow moves them
 * when the Stage is dragged and they never drift out of alignment with it.
 * None of them is draggable or connectable on its own — a condition is not a
 * step in the flow, it is a property of the Stage that owns it, and letting one
 * be wired to a second Stage would say something the model cannot store.
 */

const TONE = {
  gate: {
    tile: "bg-amber-a3 text-amber-11",
    line: "outline-amber-a6",
    hover: "hover:outline-amber-8",
  },
  run: {
    tile: "bg-violet-a3 text-violet-11",
    line: "outline-violet-a6",
    hover: "hover:outline-violet-8",
  },
};

const shell = (column, selected) =>
  cn(
    "flex h-full w-full items-center gap-2.5 rounded-xl bg-card px-2.5",
    "outline outline-1 -outline-offset-1 transition-[outline-color,background-color] duration-150",
    TONE[column].line,
    TONE[column].hover,
    "cursor-pointer",
    selected && "outline-2 outline-primary",
  );

function SatelliteBody({ column, icon: Icon, title, detail, badge, selected }) {
  return (
    <div className={shell(column, selected)}>
      <div
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-lg",
          TONE[column].tile,
        )}
      >
        <Icon size={14} strokeWidth={2.5} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[12px] font-bold leading-tight text-foreground" title={title}>
            <TemplateTokenText text={title} />
          </span>
          {badge}
        </div>
        {detail && (
          <span className="mt-0.5 block truncate text-[10px] font-medium leading-tight text-muted-foreground">
            {detail}
          </span>
        )}
      </div>
    </div>
  );
}

function FlowSatelliteNode({ data, selected }) {
  const { column, variant } = data;

  const body = () => {
    if (variant === "condition") {
      const meta = CONDITION_KIND_META[data.condition.kind];
      const detail = conditionDetail(data.condition);
      return (
        <SatelliteBody
          column={column}
          selected={selected}
          icon={meta?.icon ?? MoreHorizontal}
          title={data.condition.label}
          detail={
            detail ? `${meta?.label ?? data.condition.kind} · ${detail}` : meta?.label
          }
          badge={
            !data.condition.is_required && (
              <span className="shrink-0 rounded bg-mauve-a3 px-1 py-px text-[9px] font-black uppercase tracking-[0.1em] text-mauve-11">
                Optional
              </span>
            )
          }
        />
      );
    }

    if (variant === "action") {
      const meta = ACTION_KIND_META[data.action.kind];
      // Issue #204 Part 2 — actionSummary appends "When confirmed · X
      // decides" when the action waits for a Decider, so that's readable
      // on the canvas itself, not only after opening the Stage's settings.
      return (
        <SatelliteBody
          column={column}
          selected={selected}
          icon={meta?.icon ?? MoreHorizontal}
          title={actionTitle(data.action)}
          detail={actionSummary(data.action)}
          badge={
            data.action.config?.confirmMode === "confirm" && (
              <span className="shrink-0 rounded bg-violet-a4 px-1 py-px text-[9px] font-black uppercase tracking-[0.1em] text-violet-11">
                Confirm
              </span>
            )
          }
        />
      );
    }

    if (variant === "overflow") {
      return (
        <div className={cn(shell(column, selected), "justify-center")}>
          <MoreHorizontal size={14} className="text-muted-foreground" />
          <span className="text-[12px] font-bold text-muted-foreground tabular-nums">
            {data.overflow} more
          </span>
        </div>
      );
    }

    // variant === "add"
    return (
      <div
        className={cn(
          "flex h-full w-full items-center justify-center gap-1.5 rounded-xl",
          "border border-dashed border-mauve-7 bg-transparent",
          "text-muted-foreground transition-colors duration-150",
          "cursor-pointer hover:border-primary hover:bg-primary/5 hover:text-primary",
          selected && "border-primary text-primary",
        )}
      >
        <Plus size={14} strokeWidth={2.5} />
        <span className="text-[11px] font-bold uppercase tracking-[0.1em]">
          {data.addLabel}
        </span>
      </div>
    );
  };

  return (
    <div
      style={{ width: SAT_W, height: SAT_H }}
      className="animate-in fade-in-0 zoom-in-95 duration-200"
    >
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        className="!h-1.5 !w-1.5 !min-w-0 !border-0 !bg-mauve-8 !opacity-0"
      />
      {body()}
    </div>
  );
}

export default memo(FlowSatelliteNode);
