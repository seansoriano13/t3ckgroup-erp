import { useQuery } from "@tanstack/react-query";
import { ShoppingBag } from "lucide-react";
import ProtectedRoute from "../../components/ProtectedRoute";
import Spinner from "../../components/ui/Spinner";
import RetailOrdersQueue from "../../components/sor/RetailOrdersQueue";
import RetailTab from "../../components/sor/RetailTab";
import { getRetailQueuePendingCount } from "../../services/retailQueueService";
import { commissionService } from "../../services/commissionService";
import { useAuth } from "../../context/AuthContext";

/**
 * Retail — marketplace orders (Shopee, Lazada), on their own screen.
 *
 * Issues #170-#174 built this as two tabs inside the SOR register. They moved
 * here because the register's tab strip was the crowded thing, not retail:
 * the queue is a short, bursty list that is usually empty, and the totals are
 * what somebody actually opens this for. Stacking them on one page — pending
 * review above, what's already counted below — says that in the layout.
 *
 * A retail SOR is a real row with a real Sales Reference and amount, excluded
 * from the pipeline, the commission engine and every aggregate read (see the
 * `is_retail` flag, issue #171). Nothing here deletes one.
 */
function RetailScreen() {
  const { user } = useAuth();

  // Issue #173's gate, unchanged by the move: a Super Admin, or a Sales
  // Director on a live opportunity — the same eligibility as the RLS policy
  // guarding the queue table, because approving an item writes an SOR.
  const isSuperAdmin = !!(user?.is_super_admin || user?.isSuperAdmin);
  const { data: isRetailSalesDirector = false, isLoading: isGateLoading } = useQuery({
    queryKey: ["isSalesDirector", user?.id],
    queryFn: () => commissionService.isSalesDirector(user.id),
    enabled: !isSuperAdmin && !!user?.id,
  });
  const canHandleRetail = isSuperAdmin || isRetailSalesDirector;

  // Drives whether the band renders at all. A permanently-empty review table
  // above the totals would be the same clutter this page was made to remove,
  // so the band appears only when there is something in it.
  const { data: pendingCount = 0 } = useQuery({
    queryKey: ["retailQueueCount"],
    queryFn: () => getRetailQueuePendingCount(),
    refetchInterval: 60_000,
    enabled: canHandleRetail,
  });

  if (!isSuperAdmin && isGateLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
        <Spinner size="sm" />
        <span className="text-sm font-bold uppercase tracking-widest">Checking access…</span>
      </div>
    );
  }

  if (!canHandleRetail) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-24 text-center text-muted-foreground">
        <ShoppingBag size={28} className="opacity-40" />
        <p className="text-sm font-semibold text-foreground">
          You don&apos;t have access to Retail
        </p>
        <p className="max-w-sm text-xs leading-relaxed">
          Reviewing a marketplace order creates an SOR, so this screen is open to
          Super Admins and Sales Directors only.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2">
        <h1 className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-foreground">
          <ShoppingBag size={16} className="text-muted-foreground" />
          Retail
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Marketplace orders from Odoo. Kept out of the pipeline and the
          commission engine, and counted here instead.
        </p>
      </div>

      {pendingCount > 0 && <RetailOrdersQueue />}
      <RetailTab />
    </div>
  );
}

export default function RetailPage() {
  return (
    <ProtectedRoute>
      <RetailScreen />
    </ProtectedRoute>
  );
}
