import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShoppingBag } from "lucide-react";
import ProtectedRoute from "../../components/ProtectedRoute";
import PageShell from "../../components/ui/PageShell";
import EmptyState from "../../components/ui/EmptyState";
import RetailReport, { RetailRangeControl } from "../../components/sor/RetailReport";
import RetailFilterBar from "../../components/sor/RetailFilterBar";
import { retailOrdersQuery } from "../../services/retailOrderService";
import { useAuth } from "../../context/AuthContext";
import { getPermissionContext } from "../../utils/permissions";
import { DEFAULT_RETAIL_FILTERS } from "../../utils/retailReport";

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

  // One read of the orders, shared with the report (same query key): the filter
  // bar offers only what exists. Not fetched for someone without access.
  const { data: orders = [] } = useQuery({ ...retailOrdersQuery, enabled: hasAccess });

  // The time range is the Page's, so it can sit in the header (Report type).
  const [range, setRange] = useState("3m");
  const [custom, setCustom] = useState({ from: "", to: "" });
  // The filters are the Page's too: one set of controls (the toolbar) drives the
  // whole report, applied with the range by `applyFilters`.
  const [filters, setFilters] = useState(DEFAULT_RETAIL_FILTERS);
  const setFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));

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
      toolbar={
        hasAccess && (
          <RetailFilterBar
            orders={orders}
            filters={filters}
            onChange={setFilter}
            onClearAll={() => setFilters(DEFAULT_RETAIL_FILTERS)}
          />
        )
      }
    >
      {hasAccess ? (
        <RetailReport range={range} custom={custom} filters={filters} />
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
