import ProtectedRoute from "../../../components/ProtectedRoute.jsx";
import PageHeader from "../../../components/ui/PageHeader";
import PageContainer from "../../../components/ui/PageContainer";
import FlowCanvas from "../../../components/settings/FlowCanvas.jsx";
import { isProductionSupabase } from "../../../lib/supabase.js";

/**
 * The Flow Canvas (issue #36) — where the CRM process gets built with the
 * Operations Manager rather than described to her.
 *
 * Super-Admin only, and deliberately no finer permission model than that: the
 * canvas is scaffolding, scheduled to be hidden once the flow it produces is
 * implemented as the production pipeline, and building a role for a module
 * with a removal date is the scope creep this project exists to prevent.
 *
 * Staging only. "The canvas and its Scratch SORs live on staging. Production
 * is never the drafting surface" is a spec requirement, not a nicety —
 * Scratch SORs are real rows on whatever database they are created against,
 * and the whole reason they are safe to create and discard freely is that
 * staging can never be a production record.
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
          {isProductionSupabase ? (
            <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-6 text-center">
              <p className="text-sm font-black text-foreground">
                The Flow Canvas is not available here
              </p>
              <p className="mx-auto mt-1 max-w-prose text-xs text-muted-foreground">
                It draws against staging only — every Sale Type, Stage and Scratch SOR it creates
                is a real row, and production is never the drafting surface. Open this screen on
                staging instead.
              </p>
            </div>
          ) : (
            <FlowCanvas />
          )}
        </div>
      </PageContainer>
    </ProtectedRoute>
  );
}
