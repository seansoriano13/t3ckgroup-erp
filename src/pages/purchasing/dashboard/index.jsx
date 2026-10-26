import { Navigate, useNavigate } from "react-router";

import PageLoading from "../../../components/ui/PageLoading";
import PurchaseRequestModal from "../../../components/purchase-request/PurchaseRequestModal";
import { useAuth } from "../../../context/AuthContext";
import { useRecordParam } from "../../../hooks/useRecordParam";
import { getPermissionContext } from "../../../utils/permissions";
import { linkFor } from "../../../utils/purchasingDashboard";
import Tracker from "./_components/Tracker";
import { useTrackerFilters } from "./_components/useTrackerFilters";

/**
 * The Purchasing Dashboard: one tracker of every SOR's buying, from the first
 * Requested Item to the filed IPAS, with the next move and who owes it. It
 * replaces the Projects, What needs doing and Register tabs, which read the
 * same work three ways. A SOR opens in a slide-over (`?sor=`); a Purchase
 * Request picked from it opens here (`?request=`, like the Purchase Requests
 * list); every other record opens the place that owns it. The old
 * `/purchasing/order-monitoring` redirects here, and a leftover `?tab=` is ignored.
 */
function PurchasingDashboard() {
  const navigate = useNavigate();
  const filters = useTrackerFilters();
  const { recordId, open, close } = useRecordParam("request");

  const openRow = (row) => {
    if (row.target_kind === "purchase_request") {
      open(row.target_id);
      return;
    }
    const link = linkFor(row);
    navigate(link.to, link.state ? { state: link.state } : undefined);
  };
  // An order that names a Transmittal opens that slip (#588); every other order opens its IPAS.
  const openOrder = (order) =>
    navigate(order.next?.slip?.id ? `/purchasing/transmittals/${order.next.slip.id}` : `/purchasing/ipas/${order.id}`);
  // A SOR opens on the SOR Register; a Direct request has no SOR, so it opens its request.
  const openSor = (sor) => {
    if (sor.oppId) navigate("/sors", { state: { openOpportunityId: sor.oppId } });
    else if (sor.rows[0]) openRow(sor.rows[0]);
  };

  return (
    <>
      <Tracker filters={filters} handlers={{ onOpenRow: openRow, onOpenOrder: openOrder, onOpenSor: openSor }} suspended={Boolean(recordId)} />

      {recordId && <PurchaseRequestModal requestId={recordId} onClose={close} />}
    </>
  );
}

/** Purchasing access, Finance access or a Super Admin; everyone else is sent home. */
export default function PurchasingDashboardPage() {
  const { user, isAuthLoading } = useAuth();
  if (isAuthLoading) return <PageLoading label="Purchasing Dashboard" />;
  const ctx = getPermissionContext(user);
  if (!user || !(ctx.isSuperAdmin || ctx.hasPurchasingFlow || ctx.hasFinanceFlow)) {
    return <Navigate to="/" replace />;
  }
  return <PurchasingDashboard />;
}
