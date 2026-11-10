import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { Sparkles, ArrowRight, Users, ShieldCheck, UserCheck } from "lucide-react";
import { commissionService } from "../../services/commissionService";
import { useAuth } from "../../context/AuthContext";
import { formatPHP } from "../../constants/sor";
import Spinner from "../ui/Spinner";
import { Button } from "../ui/button";
import { CAPTION_BASE } from "@/lib/captionStyle";

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
 * Clean, cohesive 3-column metric layout with participant split cards and privacy masking.
 */
export default function OpportunityCommissionFooter({ opportunity, onClose }) {
  const { user } = useAuth();
  const navigate = useSafeNavigate();

  const isSuperAdmin = !!(user?.is_super_admin || user?.isSuperAdmin);
  const isHead = !!(user?.is_head || user?.isHead);
  const isAccounting =
    isSuperAdmin ||
    user?.department?.toLowerCase().includes("accounting") ||
    user?.department?.toLowerCase().includes("finance");
  const canViewAllFinancials = isSuperAdmin || isAccounting;

  const { data: breakdown, isLoading, error } = useQuery({
    queryKey: ["commissionBreakdown", opportunity?.id],
    queryFn: () => commissionService.getCommissionBreakdownForOpportunity(opportunity.id),
    enabled: !!opportunity?.id,
  });

  if (!opportunity) return null;

  const handleOpenDashboard = () => {
    if (onClose) onClose();
    navigate("/sors/commission", {
      state: { openOpportunityId: opportunity.id },
    });
  };

  const salesRoleShares = breakdown?.salesRoleShares || [];
  const salesDeptShare = breakdown?.departmentShares?.find((d) => d.name === "Sales")?.amount || 0;

  return (
    <div className="space-y-3.5 rounded-2xl border border-border bg-card p-4 sm:p-5 shadow-xs">
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-border/60 pb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
            <Sparkles size={14} />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Commission Estimate & Sales Attribution
            </span>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-muted text-muted-foreground">
              Live Pool
            </span>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleOpenDashboard}
          className="self-end shrink-0 sm:self-center"
        >
          <span>View in Commission Dashboard</span>
          <ArrowRight size={13} className="text-muted-foreground" />
        </Button>
      </div>

      {/* 3-Column Metrics Layout with Role-Based Privacy Masking */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Spinner size="xs" />
          <span>Calculating commission estimate…</span>
        </div>
      ) : error ? (
        <div className="text-xs text-muted-foreground py-2">
          Commission estimate unavailable.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Col 1: Commissionable Revenue */}
          <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
            <span className={`${CAPTION_BASE} tracking-wider text-muted-foreground block mb-0.5`}>
              Commissionable Revenue
            </span>
            <p className="text-sm font-extrabold tabular-nums text-foreground">
              {formatPHP(breakdown?.commissionableRevenue)}
            </p>
          </div>

          {/* Col 2: Commission Pool (1%) */}
          <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
            <span className={`${CAPTION_BASE} tracking-wider text-muted-foreground block mb-0.5`}>
              Commission Pool (1%)
            </span>
            <p className="text-sm font-extrabold tabular-nums text-foreground">
              {canViewAllFinancials ? formatPHP(breakdown?.commissionPool) : "••••••"}
            </p>
          </div>

          {/* Col 3: Sales Dept (50%) */}
          <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
            <span className={`${CAPTION_BASE} tracking-wider text-muted-foreground block mb-0.5`}>
              Sales Dept (50%)
            </span>
            <p className="text-sm font-extrabold tabular-nums text-foreground">
              {canViewAllFinancials || isHead ? formatPHP(salesDeptShare) : "50.00% Pool"}
            </p>
          </div>
        </div>
      )}

      {/* Participant Allocation Breakdown (Deal Owner, Support Cast, Sales Director) */}
      {!isLoading && !error && (
        <div className="space-y-2 pt-1 border-t border-border/60">
          <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 pt-1">
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
                const isCurrentUser = share.employee?.id === user?.id;
                const canSeeParticipantAmount = canViewAllFinancials || isHead || isCurrentUser;

                const isDealOwner = share.role === "deal_owner";
                const isDirector = share.role === "sales_director";
                const roleTitle = isDealOwner
                  ? "Deal Owner"
                  : isDirector
                  ? "Sales Director"
                  : "Supporting Sales";

                const displayAmount = canSeeParticipantAmount
                  ? formatPHP(share.amount)
                  : share.percent != null
                  ? `${share.percent}% Share`
                  : "••••••";

                return (
                  <div
                    key={`${share.role}-${idx}`}
                    className={`flex items-center justify-between gap-2 rounded-xl border border-border/60 p-2.5 transition-colors hover:bg-muted/50 ${
                      isCurrentUser ? "bg-muted/40 font-semibold" : "bg-muted/20"
                    }`}
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
                        <p className="text-xs font-bold text-foreground truncate flex items-center gap-1.5">
                          <span>{share.employee?.name || "Unassigned"}</span>
                          {isCurrentUser && (
                            <span className="rounded bg-muted px-1.5 py-0.2 text-[9px] font-bold text-foreground">
                              You
                            </span>
                          )}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {roleTitle} {share.percent != null ? `(${share.percent}%)` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-extrabold tabular-nums text-foreground">
                        {displayAmount}
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
