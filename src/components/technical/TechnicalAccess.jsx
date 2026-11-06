import { Navigate } from "react-router";

import { useAuth } from "../../context/AuthContext";
import { getPermissionContext } from "../../utils/permissions";

/**
 * Every employee can type the Technical address; only a Technical in-charge, someone on the Evaluation list and
 * Super Admins get past this, and the database refuses the read to anyone else whatever the screen does.
 */
export default function TechnicalAccess({ children }) {
  const { user } = useAuth();
  const ctx = getPermissionContext(user);
  if (!ctx.canOpenTechnical) return <Navigate to="/" replace />;
  return children;
}
