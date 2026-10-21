import { Navigate } from "react-router";

/**
 * Order Monitoring (#263) is part of the Purchasing Dashboard's tracker now.
 * This route stays so old links, bookmarks and history entries keep working:
 * it opens the dashboard. The dashboard decides who may see it.
 */
export default function OrderMonitoringRedirect() {
  return <Navigate to="/purchasing/dashboard" replace />;
}
