import { Navigate, useLocation } from "react-router";

/**
 * HR Verifications now live on Task Approvals, beside the head's grade step.
 * Old links and bookmarks land there, keeping any ?record= and deep-link state.
 */
export default function HrVerificationRedirect() {
  const location = useLocation();
  return <Navigate to={`/approvals/tasks${location.search}`} state={location.state} replace />;
}
