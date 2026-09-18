import { Navigate, useLocation } from "react-router";

// The oldest of the three names this module has had. #206 moved it to /crm;
// ADR 0024 moved it to /sors and settled the name for good. This points at the
// current one directly rather than hopping through /crm — a redirect that
// redirects is how you get a loop the day somebody edits one of them.
// Old links, including ones sitting unread in a sent notification, still land
// on the same page or SOR.
export default function OpportunitiesRedirect() {
  const location = useLocation();
  return <Navigate to={`/sors${location.search}${location.hash}`} replace />;
}
