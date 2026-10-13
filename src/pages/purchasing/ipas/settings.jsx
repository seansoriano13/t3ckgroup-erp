import { Navigate } from "react-router";

import { useAuth } from "../../../context/AuthContext";
import { getPermissionContext } from "../../../utils/permissions";

/**
 * IPAS settings moved into the Purchasing tab of Settings (#241), next to the
 * rest of the app's configuration. This route stays so old links, bookmarks and
 * history entries keep working: it sends Purchasing access and Super Admins
 * there, and anyone else home, as it always did.
 */
export default function IpasSettingsRedirect() {
  const { user } = useAuth();
  const { isSuperAdmin, hasPurchasingFlow } = getPermissionContext(user);

  if (isSuperAdmin || hasPurchasingFlow) return <Navigate to="/settings?tab=purchasing" replace />;
  return <Navigate to="/" replace />;
}
