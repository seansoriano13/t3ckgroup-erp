import ProtectedRoute from "../../../components/ProtectedRoute.jsx";
import PageHeader from "../../../components/ui/PageHeader";
import PageContainer from "../../../components/ui/PageContainer";
import CommissionRatesManager from "../../../components/settings/CommissionRatesManager.jsx";
import CommissionAllocationManager from "../../../components/settings/CommissionAllocationManager.jsx";

export default function CommissionAdminPage() {
  return (
    <ProtectedRoute requireSuperAdmin={true}>
      <PageContainer maxWidth="7xl" className="pt-4">
        <PageHeader
          title="Commission Pool"
          description="Manage the Commission Rates and Department/Position allocations that drive every opportunity's Commission Pool estimate."
        />

        <div className="space-y-6">
          <CommissionRatesManager />
          <CommissionAllocationManager />
        </div>
      </PageContainer>
    </ProtectedRoute>
  );
}
