import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { Sparkles, ArrowRight } from "lucide-react";
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
 * Compact footer strip at the bottom of the SOR details modal.
 * Summarizes the live Commission Pool & Commissionable Revenue,
 * and provides a 1-click deep-link to the full Commission Dashboard.
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

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-2xl border border-border/70 bg-gradient-to-r from-muted/40 via-card to-muted/20 p-4 sm:px-5 sm:py-3.5 shadow-xs">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Sparkles size={17} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Commission Estimate
            </span>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">
              Live
            </span>
          </div>
          {isLoading ? (
            <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground pt-0.5">
              <Spinner size="xs" />
              <span>Calculating commission estimate…</span>
            </div>
          ) : error ? (
            <span className="text-[12px] text-muted-foreground pt-0.5">
              Unavailable
            </span>
          ) : (
            <div className="flex items-baseline gap-3 pt-0.5 flex-wrap">
              <div className="flex items-baseline gap-1.5">
                <span className="text-[11px] text-muted-foreground">Commission Pool:</span>
                <span className="text-[14px] font-bold tabular-nums text-foreground">
                  {formatPHP(breakdown.commissionPool)}
                </span>
              </div>
              <span className="text-border/80">•</span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-[11px] text-muted-foreground">Commissionable Revenue:</span>
                <span className="text-[13px] font-semibold tabular-nums text-muted-foreground">
                  {formatPHP(breakdown.commissionableRevenue)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={handleOpenDashboard}
        className="inline-flex items-center gap-1.5 self-end sm:self-center shrink-0 px-3 py-1.5 rounded-lg border border-border/80 bg-background hover:bg-muted/60 text-foreground font-semibold text-[12px] transition-all shadow-2xs hover:border-border"
      >
        <span>View in Commission Dashboard</span>
        <ArrowRight size={13} className="text-muted-foreground" />
      </button>
    </div>
  );
}
