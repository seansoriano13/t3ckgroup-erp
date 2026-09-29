import { Briefcase } from "lucide-react";

/**
 * The muted reference every task row (individual or group) shows when it is
 * linked to an SOR — Sales Reference when the deal has one, Company otherwise.
 * Deliberately not clickable: the row already opens the task, and the task
 * modal carries the "Open SOR" button. A second target nested in the row got
 * misclicked and, in primary red, read as a status badge.
 */
export function SorLinkChip({ opportunityId, opportunity, className = "" }) {
  if (!opportunityId || !opportunity) return null;

  const reference = opportunity.sales_reference || opportunity.client_name;

  return (
    <span
      title={`SOR: ${opportunity.client_name}`}
      className={`flex min-w-0 shrink items-center gap-1 text-[11px] font-medium text-muted-foreground ${className}`}
    >
      <Briefcase size={11} className="shrink-0" />
      <span className="truncate">{reference}</span>
    </span>
  );
}
