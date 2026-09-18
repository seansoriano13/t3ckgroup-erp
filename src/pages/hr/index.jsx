import { Navigate } from "react-router";
import { useAuth } from "../../context/AuthContext";

/**
 * Smart redirect shim for /hr parent route.
 *
 * A leave manager has no business in the Employee Directory — their access
 * is the narrower leave-management capability, not full HR — but the nav
 * already sends them to Offsets & Leaves and the route itself admits them
 * (issue #101). Landing here from a bookmark or a trimmed link should not
 * bounce them to the dashboard when they have a real HR page to land on.
 */
export default function HrRedirect() {
  const { user } = useAuth();

  const isSuperAdmin = !!(user?.is_super_admin || user?.isSuperAdmin);
  const isHr = !!(user?.is_hr || user?.isHr);
  const canManageLeaves = !!(user?.can_manage_leaves || user?.canManageLeaves);

  if (isSuperAdmin || isHr) {
    return <Navigate to="/hr/management" replace />;
  }

  if (canManageLeaves) {
    return <Navigate to="/hr/offsets" replace />;
  }

  return <Navigate to="/" replace />;
}
