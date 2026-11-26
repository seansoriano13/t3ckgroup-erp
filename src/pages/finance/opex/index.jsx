import { Navigate } from "react-router";

import ProtectedRoute from "../../../components/ProtectedRoute";
import OpexList from "../../../components/opex/OpexList";
import { useAuth } from "../../../context/AuthContext";
import { getPermissionContext } from "../../../utils/permissions";

/**
 * The OPEX list (#1244, spec #1241; redesigned 2026-11-26 to match the Purchasing lists).
 * Finance access and Super Admins only; the database refuses everyone else whatever the
 * screen does. A row opens its report in the record window at /finance/opex/:s0.
 */
export default function OpexPage() {
  const { user } = useAuth();
  const { isSuperAdmin, hasFinanceFlow } = getPermissionContext(user);
  if (user && !(isSuperAdmin || hasFinanceFlow)) return <Navigate to="/" replace />;
  return (
    <ProtectedRoute>
      <OpexList />
    </ProtectedRoute>
  );
}
