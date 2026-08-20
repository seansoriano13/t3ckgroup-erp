import ProtectedRoute from "../../../components/ProtectedRoute.jsx";
import PageHeader from "../../../components/ui/PageHeader";
import PageContainer from "../../../components/ui/PageContainer";
import LeadSourceManager from "../../../components/settings/LeadSourceManager.jsx";

export default function LeadSourcesAdminPage() {
  return (
    <ProtectedRoute requireSuperAdmin={true}>
      <PageContainer maxWidth="7xl" className="pt-4">
        <PageHeader
          title="Lead Sources"
          description="Manage the lead source options available when registering a SOR opportunity."
        />

        <LeadSourceManager />
      </PageContainer>
    </ProtectedRoute>
  );
}
