import { Navigate } from "react-router";
import { useAuth } from "../../context/AuthContext";

/**
 * Smart redirect shim for /approvals.
 * Forwards users to the primary queue they have permission to access.
 */
export default function ApprovalsRedirect() {
  const { user } = useAuth();

  const isSuperAdmin = !!(user?.is_super_admin || user?.isSuperAdmin);
  const isHead = !!(user?.is_head || user?.isHead);
  const isHr = !!(user?.is_hr || user?.isHr);
  const isIpasApprover = !!(user?.is_ipas_approver || user?.isIpasApprover);

  if (isSuperAdmin || isHead) {
    return <Navigate to="/approvals/tasks" replace />;
  }

  if (isHr) {
    return <Navigate to="/approvals/hr-verification" replace />;
  }

  // Someone whose only queue is IPAS goes straight to it (#247).
  if (isIpasApprover) {
    return <Navigate to="/approvals/ipas" replace />;
  }

  return <Navigate to="/" replace />;
}
