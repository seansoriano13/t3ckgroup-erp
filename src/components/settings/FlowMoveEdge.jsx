import { useState } from "react";
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath } from "@xyflow/react";
import { Plus, X } from "lucide-react";

import Dropdown from "@/components/ui/Dropdown";
import AddStagePopoverForm from "./AddStagePopoverForm";

/**
 * A move between two Stages.
 *
 * React Flow's stock edge is a bare path: the only way to remove one is to
 * click a 2px line and press Delete, which is not a control anybody finds. This
 * one carries its own affordances — a wide invisible hit area so the line is
 * reachable, a delete button, and (issue #196) a plus at the midpoint that
 * inserts a Stage into the move — both appearing on hover or selection,
 * labelled with the move they act on so the click is never a guess.
 *
 * Rerouting is React Flow's own reconnect gesture (drag either end onto another
 * Stage); the fat hit path is what makes the endpoints grabbable at all.
 */
export default function FlowMoveEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  selected,
  data,
}) {
  const [hovered, setHovered] = useState(false);
  const [insertOpen, setInsertOpen] = useState(false);

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 18,
  });

  const hasNames = Boolean(data?.fromName && data?.toName);
  const deleteLabel = hasNames
    ? `Delete the move from ${data.fromName} to ${data.toName}`
    : "Delete this move";
  const insertLabel = hasNames
    ? `Insert a Stage between ${data.fromName} and ${data.toName}`
    : "Insert a Stage on this move";

  const show = (hovered || selected || insertOpen) && !data?.disabled;

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />

      {/* The line is 1.75px wide; this is what the pointer actually hits. */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={22}
        className="react-flow__edge-interaction"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />

      {!data?.disabled && (
        <EdgeLabelRenderer>
          <div
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: show ? "all" : "none",
            }}
            className={`absolute flex items-center gap-1.5 transition-opacity duration-150 ${show ? "opacity-100" : "opacity-0"}`}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            {data?.canInsertStage && (
              <Dropdown
                isOpen={insertOpen}
                onToggle={() => setInsertOpen((prev) => !prev)}
                onClose={() => setInsertOpen(false)}
                usePortal
                placement="bottom-start"
                popoverClassName="popover-enter z-[10001] w-72 rounded-2xl bg-popover p-3 shadow-2xl ring-1 ring-mauve-6"
                trigger={
                  <button
                    type="button"
                    aria-label={insertLabel}
                    title={insertLabel}
                    className="flex size-6 items-center justify-center rounded-full bg-card text-muted-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06),0_6px_16px_-8px_rgba(0,0,0,0.4)] outline outline-1 -outline-offset-1 outline-mauve-6 transition-colors hover:bg-mauve-9 hover:text-white hover:outline-mauve-9"
                  >
                    <Plus size={13} strokeWidth={3} />
                  </button>
                }
              >
                {({ close }) => (
                  <AddStagePopoverForm
                    onSubmit={(name) => data?.onInsertStage?.(name)}
                    close={close}
                  />
                )}
              </Dropdown>
            )}

            <button
              type="button"
              aria-label={deleteLabel}
              title={deleteLabel}
              onClick={(event) => {
                event.stopPropagation();
                data?.onDelete?.(id);
              }}
              className="flex size-6 items-center justify-center rounded-full bg-card text-muted-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06),0_6px_16px_-8px_rgba(0,0,0,0.4)] outline outline-1 -outline-offset-1 outline-mauve-6 transition-colors hover:bg-destructive hover:text-destructive-foreground hover:outline-destructive"
            >
              <X size={13} strokeWidth={3} />
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
