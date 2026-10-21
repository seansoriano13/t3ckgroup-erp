import { Button } from "../ui/button";
import { IPAS_STATUS, IPAS_STATUS_LABELS } from "../../constants/ipas";

/**
 * The IPAS Status pill (spec #595, #597), in the sheet's colours: Pending red,
 * Requested yellow, Ongoing pink, Paid green, Done blue, On-Hold dark grey. A
 * cancelled IPAS has no status and no pill. Each class is written out in full
 * so Tailwind sees it.
 *
 * Read-only by default. Given `onClick` it is a button (the list's and the
 * record's way to put an IPAS On-Hold or clear it); the click never reaches the
 * row behind it.
 */
const STYLE = {
  [IPAS_STATUS.PENDING]: "bg-red-3 text-red-11 border-red-7 hover:bg-red-4 hover:text-red-11",
  [IPAS_STATUS.REQUESTED]: "bg-yellow-3 text-yellow-11 border-yellow-7 hover:bg-yellow-4 hover:text-yellow-11",
  [IPAS_STATUS.ONGOING]: "bg-pink-3 text-pink-11 border-pink-7 hover:bg-pink-4 hover:text-pink-11",
  [IPAS_STATUS.PAID]: "bg-green-3 text-green-12 border-green-7 hover:bg-green-4 hover:text-green-12",
  [IPAS_STATUS.DONE]: "bg-blue-3 text-blue-11 border-blue-7 hover:bg-blue-4 hover:text-blue-11",
  [IPAS_STATUS.ON_HOLD]: "bg-mauve-11 text-mauve-1 border-mauve-11 hover:bg-mauve-12 hover:text-mauve-1",
};

const SHAPE =
  "inline-block h-5 max-w-full truncate rounded-full border px-2 text-center align-middle text-label font-bold uppercase leading-[18px] tracking-wider whitespace-nowrap shrink-0";

export default function IpasStatusPill({ status, note = null, onClick = null, className = "" }) {
  if (!status) return null;
  const label = IPAS_STATUS_LABELS[status] ?? status;
  const style = STYLE[status] ?? STYLE[IPAS_STATUS.PENDING];
  const title = status === IPAS_STATUS.ON_HOLD && note ? `${label}: ${note}` : label;

  if (!onClick) {
    return (
      <span data-testid="ipas-status-pill" data-status={status} title={title} className={`${SHAPE} ${style} ${className}`}>
        {label}
      </span>
    );
  }

  const turnsOn = status !== IPAS_STATUS.ON_HOLD;
  return (
    <Button
      type="button"
      variant="ghost"
      data-testid="ipas-status-pill"
      data-status={status}
      title={`${title}. ${turnsOn ? "Click to put it On-Hold." : "Click to clear On-Hold."}`}
      aria-label={`${label}. ${turnsOn ? "Put On-Hold" : "Clear On-Hold"}`}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={`${SHAPE} h-5 rounded-full px-2 text-label font-bold ${style} ${className}`}
    >
      {label}
    </Button>
  );
}
