import ProtectedRoute from "../../../components/ProtectedRoute.jsx";
import PageHeader from "../../../components/ui/PageHeader";
import PageContainer from "../../../components/ui/PageContainer";
import PipelineStageManager from "../../../components/settings/PipelineStageManager.jsx";

export default function PipelineStagesAdminPage() {
  return (
    <ProtectedRoute requireSuperAdmin={true}>
      <PageContainer maxWidth="7xl" className="pt-4">
        <PageHeader
          title="Pipeline Stages"
          description="Manage the sales pipeline stages, their sequence, and their visibility."
        />

        <PipelineStageManager />
      </PageContainer>
    </ProtectedRoute>
  );
}
