import { Navigate } from "react-router";

// The Commission Rates and Department Allocations are edited in place on the
// Commission Dashboard's Formula tab (#441); this old admin route only redirects.
export default function CommissionAdminRedirect() {
  return <Navigate to="/sors/commission?tab=formula" replace />;
}
