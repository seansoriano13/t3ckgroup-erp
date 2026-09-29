import { Navigate, useLocation } from "react-router";

// The module is SORS again (issue #206 renamed it to CRM; see ADR 0024 for why
// that was reversed). /crm keeps working because notificationRouter has been
// minting /crm deep links into notifications that are still sitting unread, and
// because a URL somebody bookmarked should not become a 404 over a rename.
export default function CrmRedirect() {
  const location = useLocation();
  return <Navigate to={`/sors${location.search}${location.hash}`} replace />;
}
