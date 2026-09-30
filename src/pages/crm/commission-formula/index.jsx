import { Navigate } from "react-router";

export default function CrmCommissionFormulaRedirect() {
  return <Navigate to="/sors/commission?tab=formula" replace />;
}
