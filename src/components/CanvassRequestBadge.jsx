import StatusBadge from "./StatusBadge";
import { canvassRequestState } from "../utils/canvassList";

/**
 * Whether a Purchase Request still has to be made from a Canvass: "Needs winner", "Ready to
 * request", or the status of the request it became ("Not checked", "Purchased"). It is a status and
 * nothing more, so it is never a link; the request's name is in its tooltip, and the Canvass panel
 * has the link that opens the request. Shows nothing for a Canvass that has no request in its flow.
 * `source` is a Canvasses list row, or the same fields (kind, winner, requestId, requestLabel,
 * requestItemStatus).
 */
export default function CanvassRequestBadge({ source }) {
  const state = canvassRequestState(source);
  if (!state) return null;
  const named = state.requestId && state.requestLabel ? `${state.requestLabel} · ${state.label}` : state.label;
  return <StatusBadge label={state.label} theme={state.theme} title={named} />;
}
