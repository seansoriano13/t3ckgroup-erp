import ProtectedRoute from "../../../components/ProtectedRoute";
import CommissionDashboardView from "../../../components/sor/CommissionDashboardView";

export default function CommissionDashboardPage() {
  return (
    <ProtectedRoute>
      <CommissionDashboardView />
    </ProtectedRoute>
  );
}
