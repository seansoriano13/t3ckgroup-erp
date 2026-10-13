import StatusBadge from "../StatusBadge";
import { IPAS_STATE_LABELS, IPAS_STATE_THEME } from "../../constants/ipas";

/** An IPAS's lifecycle state: Open, Filed or Cancelled. */
export default function IpasStateBadge({ state }) {
  return <StatusBadge theme={IPAS_STATE_THEME[state]} label={IPAS_STATE_LABELS[state] || state} />;
}
