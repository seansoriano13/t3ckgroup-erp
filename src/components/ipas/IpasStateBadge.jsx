import StatusBadge from "../StatusBadge";
import { IPAS_STATE_LABELS } from "../../constants/ipas";

/** An IPAS's lifecycle state: Open, Filed or Cancelled. Its colour is registered in constants/status.js. */
export default function IpasStateBadge({ state }) {
  return <StatusBadge status={state} label={IPAS_STATE_LABELS[state] || state} />;
}
