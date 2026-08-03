import ProtectedRoute from "../../components/ProtectedRoute.jsx";

import SystemUpdateBanner from "../../components/SystemUpdateBanner.jsx";
import SystemUpdateManager from "../../components/SystemUpdateManager.jsx";
import PageHeader from "../../components/ui/PageHeader";
import PageContainer from "../../components/ui/PageContainer";

export default function SuperAdminDashboard() {
  return (
    <ProtectedRoute requireSuperAdmin={true}>
      <PageContainer className="pt-4">
        <PageHeader
          title="Admin Control"
          description="Configure tracking rules and broadcast system updates."
        />

        <SystemUpdateBanner />

        <SystemUpdateManager />
      </PageContainer>
    </ProtectedRoute>
  );
}
