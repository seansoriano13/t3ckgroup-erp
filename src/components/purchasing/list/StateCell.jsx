import StatusBadge from "@/components/StatusBadge";
import { TableCell } from "@/components/ui/table";

/**
 * The State column every Purchasing list ends with (spec #631): right-aligned,
 * a StatusBadge. Each list maps its states to badge tones in ONE place, a
 * plain object next to the list:
 *
 *   const TONES = { open: "amber", closed: "green" };
 *   <StateCell state={row.state} tones={TONES} label="Open" />
 *
 * `label` defaults to the state itself (StatusBadge upper-cases it); pass it
 * when the shown word differs from the state (a SOR's closed reason). A state
 * the map does not know falls back to the quiet mauve tone.
 */
export function StateCell({ state, tones, label, className = "" }) {
  return (
    <TableCell className={`text-right ${className}`.trim()}>
      <StatusBadge label={label ?? String(state).replace(/_/g, " ")} theme={tones[state] ?? "mauve"} />
    </TableCell>
  );
}

/** The State heading's alignment, to add to its SortHead's className. */
export const STATE_HEAD_CLASS = "text-right";

