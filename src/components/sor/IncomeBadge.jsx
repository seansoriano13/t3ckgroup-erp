import StatusBadge from "../StatusBadge";
import { INCOME_STATUS, incomeStatus } from "../../utils/retailReport";

const INCOME_BADGES = {
  [INCOME_STATUS.OK]: { label: "OK", theme: "mauve" },
  [INCOME_STATUS.MISSING]: { label: "Missing", theme: "amber" },
  [INCOME_STATUS.SUSPECT]: { label: "Suspect", theme: "red" },
};

/** An order's income status on the Retail screen: Suspect reads apart from Missing. */
export default function IncomeBadge({ order }) {
  const { label, theme } = INCOME_BADGES[incomeStatus(order)];
  return <StatusBadge theme={theme}>{label}</StatusBadge>;
}
