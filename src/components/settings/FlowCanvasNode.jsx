import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { CircleDot, Flag, Octagon } from "lucide-react";

import { cn } from "@/lib/utils";
import { STAGE_H, STAGE_W } from "./flowCanvasLayout";

/**
 * A Stage on the Flow Canvas.
 *
 * Left and right handles carry the flow itself — the moves a deal may make.
 * The two handles on the bottom edge carry no moves at all: they anchor the
 * Stage's gate (its conditions, hanging below-left) and its run (its actions,
 * hanging below-right), so what a Stage *demands* and what it *does* are read
 * off the canvas rather than found by clicking through to a panel.
 *
 * Every handle is named. React Flow resolves an edge that names no handle to
 * whichever source handle it finds first, so an unnamed right-hand output on a
 * node that also carries two bottom anchors is a coin toss — and it lands on
 * the gate anchor, which is why a move used to leave from under the node's
 * bottom-left corner instead of its right edge. IN/OUT are the flow's own
 * handles; GATE/RUN belong to the satellites and are never user-connectable.
 */

export const HANDLE_IN = "in";
export const HANDLE_OUT = "out";

const ROLE = {
  entry: {
    label: "Entry",
    icon: CircleDot,
    tile: "bg-blue-a3 text-blue-11",
    chip: "bg-blue-a3 text-blue-11",
  },
  won: {
    label: "Won",
    icon: Flag,
    tile: "bg-green-a3 text-green-11",
    chip: "bg-green-a3 text-green-11",
  },
  terminal: {
    label: "Terminal",
    icon: Octagon,
    tile: "bg-amber-a3 text-amber-11",
    chip: "bg-amber-a3 text-amber-11",
  },
  plain: {
    label: null,
    icon: CircleDot,
    tile: "bg-mauve-a3 text-mauve-11",
    chip: "",
  },
};

function roleOf({ isEntry, isWon, isTerminal }) {
  if (isEntry) return ROLE.entry;
  if (isWon) return ROLE.won;
  if (isTerminal) return ROLE.terminal;
  return ROLE.plain;
}

const Chip = ({ className, icon: Icon, children }) => (
  <span
    className={cn(
      "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-black uppercase tracking-[0.12em]",
      className || "bg-mauve-a3 text-mauve-11",
    )}
  >
    {Icon && <Icon size={9} strokeWidth={3} />}
    {children}
  </span>
);

/** The dashed anchor a satellite column hangs from. Never user-connectable. */
const SubHandle = ({ id, left, tone, count, label }) => (
  <>
    <Handle
      type="source"
      id={id}
      position={Position.Bottom}
      isConnectable={false}
      className="!h-2 !w-2 !min-w-0 !border-0 !bg-mauve-8"
      style={{ left, opacity: count > 0 ? 1 : 0 }}
    />
    {count > 0 && (
      <span
        className={cn(
          "pointer-events-none absolute top-full mt-2 -translate-x-1/2 rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] tabular-nums",
          tone,
        )}
        style={{ left }}
      >
        {label} · {count}
      </span>
    )}
  </>
);

function FlowCanvasNode({ data, isConnectable, selected }) {
  const { stage, isEntry, isWon, disabled, conditionCount = 0, actionCount = 0 } = data;
  const role = roleOf({ isEntry, isWon, isTerminal: stage.is_terminal });
  const RoleIcon = role.icon;

  return (
    <div
      style={{ width: STAGE_W, minHeight: STAGE_H }}
      className={cn(
        "group/stage relative flex flex-col justify-center gap-2 rounded-2xl bg-card px-4 py-3.5",
        "shadow-[0_1px_2px_rgba(0,0,0,0.05),0_10px_24px_-14px_rgba(0,0,0,0.35)]",
        "transition-[box-shadow,outline-color] duration-150",
        "outline outline-1 -outline-offset-1 outline-mauve-6 hover:outline-mauve-8",
        selected &&
          "outline-2 outline-primary shadow-[0_1px_2px_rgba(0,0,0,0.05),0_14px_32px_-14px_rgba(0,0,0,0.45)]",
      )}
    >
      <Handle
        id={HANDLE_IN}
        type="target"
        position={Position.Left}
        isConnectable={!disabled && isConnectable}
        className="!h-3 !w-3 !border-2 !border-card !bg-mauve-9 !-left-1.5"
      />
      <Handle
        id={HANDLE_OUT}
        type="source"
        position={Position.Right}
        isConnectable={!disabled && isConnectable}
        className={cn(
          "!h-3 !w-3 !border-2 !border-card !bg-primary !-right-1.5",
          disabled && "!bg-mauve-8",
        )}
      />

      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-xl",
            role.tile,
          )}
        >
          <RoleIcon size={17} strokeWidth={2.5} />
        </div>

        <div className="min-w-0 flex-1">
          <div
            className="truncate text-[15px] font-bold leading-tight tracking-[-0.01em] text-foreground"
            title={stage.name}
          >
            {stage.name}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {isEntry && <Chip className={ROLE.entry.chip} icon={CircleDot}>Entry</Chip>}
            {isWon && <Chip className={ROLE.won.chip} icon={Flag}>Won</Chip>}
            {stage.is_terminal && (
              <Chip className={ROLE.terminal.chip} icon={Octagon}>Terminal</Chip>
            )}
            {!isEntry && !isWon && !stage.is_terminal && (
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Stage
              </span>
            )}
          </div>
        </div>
      </div>

      <SubHandle
        id="gate"
        left="24%"
        count={conditionCount}
        label="Gate"
        tone="bg-amber-a3 text-amber-11"
      />
      <SubHandle
        id="run"
        left="76%"
        count={actionCount}
        label="On entry"
        tone="bg-violet-a3 text-violet-11"
      />

      {/* Screen-reader summary: the two chips above read as counts out of context. */}
      <span className="sr-only">
        {conditionCount} condition{conditionCount === 1 ? "" : "s"} to leave,{" "}
        {actionCount} action{actionCount === 1 ? "" : "s"} on entry.
      </span>
    </div>
  );
}

export default memo(FlowCanvasNode);
