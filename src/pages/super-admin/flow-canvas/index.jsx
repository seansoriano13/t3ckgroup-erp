import ProtectedRoute from "../../../components/ProtectedRoute.jsx";
import PageHeader from "../../../components/ui/PageHeader";
import PageContainer from "../../../components/ui/PageContainer";
import FlowCanvas from "../../../components/settings/FlowCanvas.jsx";

/**
 * The Flow Canvas (issue #36) — where the CRM process gets built with the
 * Operations Manager rather than described to her.
 *
 * Super-Admin only, and deliberately no finer permission model than that: the
 * canvas is scaffolding, scheduled to be hidden once the flow it produces is
 * implemented as the production pipeline, and building a role for a module
 * with a removal date is the scope creep this project exists to prevent.
 */
export default function FlowCanvasAdminPage() {
  return (
    <ProtectedRoute requireSuperAdmin={true}>
      <PageContainer maxWidth="7xl" className="pt-4">
        <PageHeader
          title="Flow Canvas"
          description="Build each Sale Type's Sales Flow — its Stages, and the moves a deal may make between them."
        />

        <div className="mt-6">
          <FlowCanvas />
        </div>
      </PageContainer>
    </ProtectedRoute>
  );
}
