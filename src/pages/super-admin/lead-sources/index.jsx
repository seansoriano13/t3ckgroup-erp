import { Navigate } from "react-router";

// Issue #177 — Lead Sources moved into Settings, gated the same way this
// page was (Super Admin). The route stays so an old bookmark or link still
// resolves instead of 404ing.
export default function LeadSourcesAdminPage() {
  return <Navigate to="/settings" replace />;
}
