import { useState } from "react";
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath } from "@xyflow/react";
import { X } from "lucide-react";

/**
 * A move between two Stages.
 *
 * React Flow's stock edge is a bare path: the only way to remove one is to
 * click a 2px line and press Delete, which is not a control anybody finds. This
 * one carries its own affordances — a wide invisible hit area so the line is
 * reachable, and a delete button that appears on hover or selection, labelled
 * with the move it would remove so the click is never a guess.
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

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 18,
  });

  const label = data?.fromName && data?.toName
    ? `Delete the move from ${data.fromName} to ${data.toName}`
    : "Delete this move";

  const show = (hovered || selected) && !data?.disabled;

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
            className={`absolute transition-opacity duration-150 ${show ? "opacity-100" : "opacity-0"}`}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            <button
              type="button"
              aria-label={label}
              title={label}
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
