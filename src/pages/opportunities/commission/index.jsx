import { Navigate, useLocation } from "react-router";

export default function OpportunitiesCommissionRedirect() {
  const location = useLocation();
  return <Navigate to={`/crm/commission${location.search}${location.hash}`} replace />;
}
