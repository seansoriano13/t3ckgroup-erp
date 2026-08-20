import ProtectedRoute from "../../../components/ProtectedRoute";
import PageContainer from "../../../components/ui/PageContainer";
import PageHeader from "../../../components/ui/PageHeader";
import CommissionDashboardView from "../../../components/sor/CommissionDashboardView";

export default function CommissionDashboardPage() {
  return (
    <ProtectedRoute>
      <PageContainer maxWidth="full" className="pt-4 px-0 sm:px-0 lg:px-0">
        <PageHeader
          title="Commission Dashboard"
          description="Live commission pool analytics, revenue accumulation across sales opportunities, and department allocations."
        />
        <CommissionDashboardView />
      </PageContainer>
    </ProtectedRoute>
  );
}
