import StatusBadge from "@/components/StatusBadge";
import { formatDateWith } from "../../utils/formatDate";

/** "Awarded · Nov 12": shown on an SOR's requests once it has a Date of Award. Nothing without one. */
export function AwardedBadge({ date, className = "" }) {
  if (!date) return null;
  const on = formatDateWith(date, { month: "short", day: "numeric", timeZone: "Asia/Manila" });
  return <StatusBadge label={`Awarded · ${on}`} theme="green" className={className} title={`Date of Award ${on}`} />;
}
