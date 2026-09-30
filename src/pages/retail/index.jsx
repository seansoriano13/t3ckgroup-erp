import { useState } from "react";
import { ShoppingBag } from "lucide-react";
import ProtectedRoute from "../../components/ProtectedRoute";
import PageShell from "../../components/ui/PageShell";
import EmptyState from "../../components/ui/EmptyState";
import RetailReport, { RetailRangeControl } from "../../components/sor/RetailReport";
import { useAuth } from "../../context/AuthContext";
import { getPermissionContext } from "../../utils/permissions";

/**
 * Retail — marketplace orders (Shopee, Lazada), as a report.
 *
 * Issues #170-#174 built this as a review queue plus a totals list: an order
 * was approved into a hidden SOR before it counted. Retail orders are already
 * entered in Odoo and have no stages, so the queue is hidden for now and this
 * screen is pure data — totals, a monthly trend by storefront, and the orders
 * behind them — read from `retail_orders`, which `odoo-sor-sync` keeps current.
 * No SOR is created and nothing here is approved or edited.
 *
 * The queue component (`RetailOrdersQueue`), its table and the approve function
 * are still in the codebase: bringing approvals back is a matter of mounting
 * the component again, once Sales say what they want from Retail.
 */
function RetailScreen() {
  // The Retail access right (System Access Rights in the employee form; on by
  // default for SALES), or a Super Admin. The same eligibility as the RLS
  // policy guarding `retail_orders`.
  const { user } = useAuth();
  const { isSuperAdmin, hasRetailAccess } = getPermissionContext(user);
  const hasAccess = isSuperAdmin || hasRetailAccess;

  // The time range is the Page's, so it can sit in the header (Report type).
  const [range, setRange] = useState("3m");
  const [custom, setCustom] = useState({ from: "", to: "" });

  return (
    <PageShell
      title="Retail"
      description="Marketplace orders from Odoo. Kept out of the pipeline and the commission engine, and counted here instead."
      action={
        hasAccess && (
          <RetailRangeControl
            range={range}
            onRangeChange={setRange}
            custom={custom}
            onCustomChange={setCustom}
          />
        )
      }
    >
      {hasAccess ? (
        <RetailReport range={range} custom={custom} />
      ) : (
        <EmptyState
          icon={ShoppingBag}
          title="You don't have access to Retail"
          description="This screen needs the Retail access right. Ask a Super Admin or HR to turn it on for you."
          className="py-24"
        />
      )}
    </PageShell>
  );
}

export default function RetailPage() {
  return (
    <ProtectedRoute>
      <RetailScreen />
    </ProtectedRoute>
  );
}
