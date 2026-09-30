import { Navigate } from "react-router";

// The Commission Formula now lives on the Commission Dashboard's Formula tab.
export default function CommissionFormulaRedirect() {
  return <Navigate to="/sors/commission?tab=formula" replace />;
}
