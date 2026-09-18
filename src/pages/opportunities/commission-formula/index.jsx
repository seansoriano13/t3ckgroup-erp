import { Navigate, useLocation } from "react-router";

export default function OpportunitiesCommissionFormulaRedirect() {
  const location = useLocation();
  return <Navigate to={`/crm/commission-formula${location.search}${location.hash}`} replace />;
}
