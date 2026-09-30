import ProtectedRoute from "../../../components/ProtectedRoute";
import PageContainer from "../../../components/ui/PageContainer";
import CommissionDashboardView from "../../../components/sor/CommissionDashboardView";

export default function CommissionDashboardPage() {
  return (
    <ProtectedRoute>
      <PageContainer maxWidth="full" className="pt-4 px-0 sm:px-0 lg:px-0">
        <CommissionDashboardView />
      </PageContainer>
    </ProtectedRoute>
  );
}
