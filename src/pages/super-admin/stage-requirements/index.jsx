import ProtectedRoute from "../../../components/ProtectedRoute.jsx";
import PageHeader from "../../../components/ui/PageHeader";
import PageContainer from "../../../components/ui/PageContainer";
import StageRequirementManager from "../../../components/settings/StageRequirementManager.jsx";

export default function StageRequirementsAdminPage() {
  return (
    <ProtectedRoute requireSuperAdmin={true}>
      <PageContainer maxWidth="7xl" className="pt-4">
        <PageHeader
          title="Stage Requirements"
          description="Configure what must be satisfied before a deal can leave each pipeline stage."
        />

        <StageRequirementManager />
      </PageContainer>
    </ProtectedRoute>
  );
}
