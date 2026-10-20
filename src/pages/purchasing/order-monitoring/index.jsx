import { Navigate } from "react-router";

/**
 * Order Monitoring (#263) is now two tabs of the Purchasing Dashboard: What
 * needs doing and Register. This route stays so old links, bookmarks and
 * history entries keep working: it opens the dashboard on What needs doing,
 * where Order Monitoring always opened. The dashboard decides who may see it.
 */
export default function OrderMonitoringRedirect() {
  return <Navigate to="/purchasing/dashboard?tab=needs" replace />;
}
