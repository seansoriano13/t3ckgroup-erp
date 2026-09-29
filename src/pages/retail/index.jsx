import { ShoppingBag } from "lucide-react";
import ProtectedRoute from "../../components/ProtectedRoute";
import PageContainer from "../../components/ui/PageContainer";
import PageHeader from "../../components/ui/PageHeader";
import RetailOrdersQueue from "../../components/sor/RetailOrdersQueue";
import RetailTab from "../../components/sor/RetailTab";
import { useAuth } from "../../context/AuthContext";
import { getPermissionContext } from "../../utils/permissions";

/**
 * Retail — marketplace orders (Shopee, Lazada), on their own screen.
 *
 * Issues #170-#174 built this as two tabs inside the SOR register. They moved
 * here because the register's tab strip was the crowded thing, not retail:
 * the queue is a short, bursty list that is usually empty, and the totals are
 * what somebody actually opens this for. Stacking them on one page — pending
 * review above, what's already counted below — says that in the layout.
 *
 * A Retail SOR is a real row with a real Sales Reference and amount, excluded
 * from the pipeline, the commission engine and every aggregate read (see the
 * `is_retail` flag, issue #171). Nothing here deletes one.
 */
function RetailScreen() {
  // The Retail access right (System Access Rights in the employee form; on by
  // default for SALES), or a Super Admin. The same eligibility as the RLS
  // policy guarding the queue table, because approving an item writes an SOR.
  const { user } = useAuth();
  const { isSuperAdmin, hasRetailAccess } = getPermissionContext(user);
  const hasAccess = isSuperAdmin || hasRetailAccess;

  if (!hasAccess) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-24 text-center text-muted-foreground">
        <ShoppingBag size={28} className="opacity-40" />
        <p className="text-sm font-semibold text-foreground">
          You don&apos;t have access to Retail
        </p>
        <p className="max-w-sm text-xs leading-relaxed">
          Reviewing a marketplace order creates an SOR, so this screen needs the
          Retail access right. Ask a Super Admin or HR to turn it on for you.
        </p>
      </div>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Retail"
        description="Marketplace orders from Odoo. Kept out of the pipeline and the commission engine, and counted here instead."
      />
      {/* Always mounted, including when nothing is pending: the queue carries a
          collapsible Dismissed history alongside the review rows, and hiding
          the section on an empty pending count would put that history out of
          reach exactly when somebody goes looking for it. */}
      <RetailOrdersQueue />
      <RetailTab />
    </PageContainer>
  );
}

export default function RetailPage() {
  return (
    <ProtectedRoute>
      <RetailScreen />
    </ProtectedRoute>
  );
}
