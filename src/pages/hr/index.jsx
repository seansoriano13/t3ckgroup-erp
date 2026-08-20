import { Navigate } from "react-router";
import { useAuth } from "../../context/AuthContext";

/**
 * Smart redirect shim for /hr parent route.
 */
export default function HrRedirect() {
  const { user } = useAuth();

  const isSuperAdmin = !!(user?.is_super_admin || user?.isSuperAdmin);
  const isHr = !!(user?.is_hr || user?.isHr);

  if (isSuperAdmin || isHr) {
    return <Navigate to="/hr/management" replace />;
  }

  return <Navigate to="/" replace />;
}
