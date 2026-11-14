import { Navigate } from "react-router";

/**
 * My SORs (later My SOR Work) is now the "My work" view of the SORS register.
 * The old address stays so bookmarks and older notification links still land
 * on the person's work.
 */
export default function MySorsPage() {
  return <Navigate to="/sors?view=mine" replace />;
}
