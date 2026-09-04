import { Navigate } from "react-router";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({
  children,
  requireHead = false,
  requireHr = false,
  requireSuperAdmin = false,
  excludeSuperAdmin = false,
}) {
  const { user, isAuthLoading } = useAuth();

  if (isAuthLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-mauve-2 text-muted-foreground font-bold">
        Loading Portal...
      </div>
    );
  }

  //   If not logged in
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const isSA = user.isSuperAdmin || user.is_super_admin;
  const isHrUser = user.isHr || user.is_hr;
  const isHeadUser = user.isHead || user.is_head;

  // Super Admin barrier
  if (requireSuperAdmin && !isSA) {
    return <Navigate to="/" replace />;
  }

  // Explicitly block Super Admins from specific routes (even if they have Head/HR tags)
  if (excludeSuperAdmin && isSA) {
    return <Navigate to="/" replace />;
  }

  //   If not HR and not Head
  if (requireHead && !isHeadUser && !isHrUser && !isSA) {
    return <Navigate to="/" replace />;
  }

  //   if not HR (Super Admins bypass this to access HR pages)
  if (requireHr && !isHrUser && !isSA) {
    return <Navigate to="/" replace />;
  }

  return children;
}
