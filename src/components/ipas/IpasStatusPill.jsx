import { Button } from "../ui/button";
import StatusBadge from "../StatusBadge";
import { IPAS_STATUS_LABELS } from "../../constants/ipas";

/**
 * The IPAS Status pill (ADR 0054): the step the order is at, in the team's own words, coloured through
 * IPAS_STATUS_THEME (constants/status.js) by StatusBadge. A cancelled IPAS has no status and no pill.
 * On-Hold is a flag over the step, so a held order reads "On-Hold · In Transit" in the dark grey it has
 * always had.
 *
 * Read-only by default. Given `onClick` a held pill is a button (a way to clear On-Hold); the click never
 * reaches the row behind it. A pill that is not held is never a button: putting an order On-Hold is the
 * record's More menu.
 */
const HELD_STYLE = "bg-mauve-11 text-mauve-1 border-mauve-11 hover:bg-mauve-12 hover:text-mauve-1";

const SHAPE =
  "inline-block h-5 max-w-full truncate rounded-full border px-2 text-center align-middle text-label font-bold uppercase leading-[18px] tracking-wider whitespace-nowrap shrink-0";

export default function IpasStatusPill({ status, onHold = false, note = null, onClick = null, className = "" }) {
  if (!status) return null;
  const stepLabel = IPAS_STATUS_LABELS[status] ?? status;

  if (!onHold) {
    return (
      <span data-testid="ipas-status-pill" data-status={status} className="inline-flex max-w-full">
        <StatusBadge status={status} label={stepLabel} className={className} title={stepLabel} />
      </span>
    );
  }

  // A held pill, read-only or a button: the same marks, label and look either way.
  const label = `On-Hold · ${stepLabel}`;
  const title = note ? `${label}: ${note}` : label;
  const held = {
    "data-testid": "ipas-status-pill",
    "data-status": status,
    "data-on-hold": "true",
    className: `${SHAPE} ${HELD_STYLE} ${className}`,
  };
  if (!onClick) {
    return (
      <span {...held} title={title}>
        {label}
      </span>
    );
  }
  return (
    <Button
      type="button"
      variant="ghost"
      {...held}
      className={`h-5 rounded-full px-2 text-label font-bold ${held.className}`}
      title={`${title}. Click to clear On-Hold.`}
      aria-label={`${label}. Clear On-Hold`}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {label}
    </Button>
  );
}
