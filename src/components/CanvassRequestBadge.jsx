import { Link } from "react-router";

import StatusBadge from "./StatusBadge";
import { canvassRequestState } from "../utils/canvassList";

/**
 * Whether a Purchase Request still has to be made from a Canvass: "Needs winner", "Ready to
 * request", or the request it became ("PR-12 · Cancelled"), a link that opens that request. Shows
 * nothing for a Canvass that has no request in its flow. `source` is a Canvasses list row, or the
 * same fields (kind, winner, requestId, requestLabel, requestItemStatus).
 */
export default function CanvassRequestBadge({ source }) {
  const state = canvassRequestState(source);
  if (!state) return null;
  const badge = <StatusBadge label={state.label} theme={state.theme} title={state.label} />;
  if (!state.requestId) return badge;
  return (
    <Link
      to={`/purchasing?request=${state.requestId}`}
      aria-label={`Open Purchase Request ${state.label}`}
      className="inline-flex max-w-full rounded-full outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring"
      onClick={(e) => e.stopPropagation()}
    >
      {badge}
    </Link>
  );
}
