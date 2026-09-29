import { Navigate, useLocation } from "react-router";

export default function CrmCommissionRedirect() {
  const location = useLocation();
  return <Navigate to={`/sors/commission${location.search}${location.hash}`} replace />;
}
