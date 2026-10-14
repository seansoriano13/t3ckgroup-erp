import { memo } from "react";
import { BRACKET_H } from "./flowCanvasLayout";

const ARM = 14;
const INSET = 10;

/**
 * The brace a bracket draws above the Stages that share its label — the
 * canvas's answer to "group these Stages under a heading, for context"
 * (issue: bracket labels, migration 20260828100000). Never a Stage itself:
 * not draggable, not selectable, not connectable, drawn behind every real
 * node so it reads as an annotation over the Stages rather than competing
 * with them.
 *
 * Spans the box `bracketBox` computed from every member Stage's position —
 * so it still spans correctly however those Stages are scattered, and moves
 * with them the moment one is dragged, same as everything else on this
 * canvas.
 */
function FlowBracketNode({ data }) {
  const { label, width } = data;
  const midY = BRACKET_H - ARM;

  return (
    <div style={{ width, height: BRACKET_H }} className="pointer-events-none relative">
      <svg width={width} height={BRACKET_H} className="absolute inset-0 overflow-visible">
        <path
          d={`M ${INSET} ${BRACKET_H} L ${INSET} ${midY} L ${width - INSET} ${midY} L ${width - INSET} ${BRACKET_H}`}
          fill="none"
          stroke="var(--violet-8)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span
        className="absolute top-0 left-1/2 -translate-x-1/2 truncate rounded-full bg-violet-9 px-2.5 py-1 text-label font-black tracking-[0.14em] text-white uppercase shadow-sm"
        style={{ maxWidth: width - 8 }}
        title={label}
      >
        {label}
      </span>
    </div>
  );
}

export default memo(FlowBracketNode);
