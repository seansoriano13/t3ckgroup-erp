import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { Sparkles, ArrowRight, Users, ShieldCheck, UserCheck } from "lucide-react";
import { commissionService } from "../../services/commissionService";
import { formatPHP } from "../../constants/sor";
import Spinner from "../ui/Spinner";

function useSafeNavigate() {
  try {
    return useNavigate();
  } catch {
    return (path) => {
      if (typeof window !== "undefined") {
        window.location.href = path;
      }
    };
  }
}

/**
 * Dedicated commission and participant allocation footer section in the SOR Details Modal.
 * Clean, cohesive monochrome/neutral design.
 */
export default function OpportunityCommissionFooter({ opportunity, onClose }) {
  const navigate = useSafeNavigate();

  const { data: breakdown, isLoading, error } = useQuery({
    queryKey: ["commissionBreakdown", opportunity?.id],
    queryFn: () => commissionService.getCommissionBreakdownForOpportunity(opportunity.id),
    enabled: !!opportunity?.id,
  });

  if (!opportunity) return null;

  const handleOpenDashboard = () => {
    if (onClose) onClose();
    navigate("/opportunities/commission", {
      state: { openOpportunityId: opportunity.id },
    });
  };

  const salesRoleShares = breakdown?.salesRoleShares || [];
  const salesDeptShare = breakdown?.departmentShares?.find((d) => d.name === "Sales")?.amount || 0;

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card p-4 sm:p-5 shadow-xs">
      {/* Header & Main Summary */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-border/60 pb-3.5">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
            <Sparkles size={17} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Commission Estimate & Sales Attribution
              </span>
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-muted text-muted-foreground">
                Live Pool
              </span>
            </div>
            {isLoading ? (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-0.5">
                <Spinner size="xs" />
                <span>Calculating commission estimate…</span>
              </div>
            ) : error ? (
              <span className="text-xs text-muted-foreground pt-0.5">
                Unavailable
              </span>
            ) : (
              <div className="flex items-baseline gap-3 pt-1 flex-wrap">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xs text-muted-foreground">Commissionable Revenue:</span>
                  <span className="text-sm font-bold tabular-nums text-foreground">
                    {formatPHP(breakdown.commissionableRevenue)}
                  </span>
                </div>
                <span className="text-border/80">•</span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xs text-muted-foreground">Commission Pool (1%):</span>
                  <span className="text-sm font-bold tabular-nums text-foreground">
                    {formatPHP(breakdown.commissionPool)}
                  </span>
                </div>
                <span className="text-border/80">•</span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xs text-muted-foreground">Sales Dept (50%):</span>
                  <span className="text-sm font-bold tabular-nums text-foreground">
                    {formatPHP(salesDeptShare)}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={handleOpenDashboard}
          className="inline-flex items-center gap-1.5 self-end sm:self-center shrink-0 px-3 py-1.5 rounded-xl border border-border bg-background hover:bg-muted text-foreground font-bold text-xs transition-all shadow-2xs"
        >
          <span>View in Commission Dashboard</span>
          <ArrowRight size={13} className="text-muted-foreground" />
        </button>
      </div>

      {/* Participant Allocation Breakdown (Deal Owner, Support Cast, Sales Director) */}
      {!isLoading && !error && (
        <div className="space-y-2 pt-1">
          <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Users size={12} />
            <span>Assigned Sales Participants & Earnings Allocation</span>
          </p>

          {salesRoleShares.length === 0 ? (
            <p className="text-xs text-muted-foreground py-1">
              No sales participants credited or registered for this project yet.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {salesRoleShares.map((share, idx) => {
                const isDealOwner = share.role === "deal_owner";
                const isDirector = share.role === "sales_director";
                const roleTitle = isDealOwner
                  ? "Deal Owner"
                  : isDirector
                  ? "Sales Director"
                  : "Supporting Sales";

                return (
                  <div
                    key={`${share.role}-${idx}`}
                    className="flex items-center justify-between gap-2 rounded-xl bg-muted/30 border border-border/60 p-2.5 transition-colors hover:bg-muted/50"
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        {isDealOwner ? (
                          <UserCheck size={14} />
                        ) : isDirector ? (
                          <ShieldCheck size={14} />
                        ) : (
                          <Users size={14} />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-foreground truncate">
                          {share.employee?.name || "Unassigned"}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {roleTitle} {share.percent != null ? `(${share.percent}%)` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-extrabold tabular-nums text-foreground">
                        {formatPHP(share.amount)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
