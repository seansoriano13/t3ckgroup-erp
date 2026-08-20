import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";

import { commissionService } from "../../services/commissionService";
import { formatPHP } from "../../constants/sor";
import Spinner from "../ui/Spinner";
import Avatar from "../Avatar";

const ROLE_LABELS = {
  deal_owner: "Deal Owner",
  supporting_salesperson: "Supporting Salesperson",
  sales_director: "Sales Director",
};

function DepartmentRow({ share }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-[12.5px] font-medium text-foreground">{share.name}</span>
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground">{share.allocationPercent}%</span>
        <span className="min-w-[90px] text-right text-[12.5px] font-semibold tabular-nums text-foreground">
          {formatPHP(share.amount)}
        </span>
      </div>
    </div>
  );
}

function RoleShareRow({ share }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <Avatar name={share.employee?.name} src={share.employee?.avatar_path} size="xs" />
        <div className="min-w-0">
          <p className="truncate text-[12.5px] font-semibold text-foreground">
            {share.employee?.name || "Unassigned"}
          </p>
          <p className="text-[10.5px] text-muted-foreground">{ROLE_LABELS[share.role] || share.role}</p>
        </div>
      </div>
      <span className="shrink-0 text-[12.5px] font-semibold tabular-nums text-foreground">
        {formatPHP(share.amount)}
      </span>
    </div>
  );
}

/**
 * A live, derived Commission Pool estimate for one opportunity — never a
 * stored payout. Visible at any pipeline stage.
 */
export default function CommissionPoolPanel({ opportunity }) {
  const { data: breakdown, isLoading, error } = useQuery({
    queryKey: ["commissionBreakdown", opportunity?.id],
    queryFn: () => commissionService.getCommissionBreakdownForOpportunity(opportunity.id),
    enabled: !!opportunity?.id,
  });

  if (!opportunity) return null;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-[12px] text-muted-foreground">
        <Spinner size="sm" />
        Calculating commission estimate…
      </div>
    );
  }

  if (error) {
    return (
      <p className="py-2 text-[12px] text-muted-foreground">
        Commission estimate unavailable: {error.message}
      </p>
    );
  }

  const salesShare = breakdown.departmentShares.find((share) => share.isSales);
  const otherDepartments = breakdown.departmentShares.filter((share) => !share.isSales);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        <Sparkles size={12} />
        Commission Pool
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        A live estimate derived from this opportunity's value — not a payout.
      </p>

      <div className="flex items-baseline justify-between gap-3 rounded-lg bg-mauve-2 px-3 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Commission Pool
        </span>
        <span className="text-[16px] font-bold tabular-nums text-foreground">
          {formatPHP(breakdown.commissionPool)}
        </span>
      </div>

      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Commissionable Revenue</span>
        <span className="tabular-nums">{formatPHP(breakdown.commissionableRevenue)}</span>
      </div>

      {breakdown.salesRoleShares.length > 0 && (
        <div>
          <p className="pb-1 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
            Sales — {salesShare ? formatPHP(salesShare.amount) : null}
          </p>
          <div className="divide-y divide-border/50">
            {breakdown.salesRoleShares.map((share, i) => (
              <RoleShareRow key={`${share.role}-${i}`} share={share} />
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="pb-1 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
          Department Allocation
        </p>
        <div className="divide-y divide-border/50">
          {breakdown.salesRoleShares.length === 0 && salesShare && <DepartmentRow share={salesShare} />}
          {otherDepartments.map((share) => (
            <DepartmentRow key={share.name} share={share} />
          ))}
        </div>
      </div>
    </div>
  );
}
