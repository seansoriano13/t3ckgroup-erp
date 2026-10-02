import StatusBadge from "../StatusBadge";
import { incomeStatus } from "../../utils/retailReport";

const INCOME_BADGES = {
  ok: { label: "OK", theme: "mauve" },
  missing: { label: "Missing", theme: "amber" },
  suspect: { label: "Suspect", theme: "red" },
};

/** An order's income status on the Retail screen: Suspect reads apart from Missing. */
export default function IncomeBadge({ order }) {
  const { label, theme } = INCOME_BADGES[incomeStatus(order)];
  return <StatusBadge theme={theme}>{label}</StatusBadge>;
}
