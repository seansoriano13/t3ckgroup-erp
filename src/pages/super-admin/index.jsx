import { Navigate } from "react-router";

// Issue #177 — System Announcements moved into Settings, gated the same way
// this page was (Super Admin). The route stays so an old bookmark or link
// still resolves instead of 404ing.
export default function SuperAdminDashboard() {
  return <Navigate to="/settings?tab=announcements" replace />;
}
