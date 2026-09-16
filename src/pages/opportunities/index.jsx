import { Navigate, useLocation } from "react-router";

// Issue #206: the module renamed from "SOR / CRM" to "CRM" and moved to
// /crm. Old /opportunities links — including ones already sitting in a sent
// notification — must keep landing on the same page or SOR, so this redirects
// rather than deleting the route.
export default function OpportunitiesRedirect() {
  const location = useLocation();
  return <Navigate to={`/crm${location.search}${location.hash}`} replace />;
}
