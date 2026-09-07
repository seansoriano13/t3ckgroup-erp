import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import ProtectedRoute from "@/components/ProtectedRoute.jsx";
import FlowCanvas from "@/components/settings/FlowCanvas.jsx";
import { FlowDataProvider } from "@/components/settings/FlowDataContext.jsx";
import { SandboxFlowDataProvider } from "@/components/settings/SandboxFlowDataProvider.jsx";
import FlowCanvasModeBar from "@/components/settings/FlowCanvasModeBar.jsx";
import FlowSnapshotHistoryPanel from "@/components/settings/FlowSnapshotHistoryPanel.jsx";
import Spinner from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import { flowPlanService } from "@/services/flowPlanService";
import { isProductionSupabase } from "@/lib/supabase.js";

/**
 * The Flow Canvas (issue #36) and its Sandbox mode (issues #115-117, folded
 * in by this reshape) — one screen, one nav entry, for what was always one
 * activity: building and refining the CRM process.
 *
 * **Live** edits `sales_flows` directly — real Sale Types, Stages and
 * Scratch SORs, Super-Admin-gated. **Sandbox** binds the same `FlowCanvas` to
 * the one shared Yjs document instead (ADR 0016); nothing it touches is a
 * live record, so it stays open to anyone, exactly as it was as a standalone
 * Flow Plan. Switching modes only ever swaps the data provider underneath —
 * `FlowCanvas` itself does not know which one it is talking to.
 *
 * Full-bleed: this screen is an editor, not a report. `_app.jsx` drops its
 * wrapper for this route; every control, including the mode toggle, floats
 * over the canvas rather than sitting in a page header.
 *
 * Staging only, for Live. "The canvas and its Scratch SORs live on staging.
 * Production is never the drafting surface" is a spec condition, not a
 * nicety — Scratch SORs are real rows on whatever database they are created
 * against.
 */
export default function FlowCanvasAdminPage() {
  const { user } = useAuth();
  const [mode, setMode] = useState("live");
  const [historyOpen, setHistoryOpen] = useState(false);

  if (isProductionSupabase) {
    return (
      <ProtectedRoute>
        <div className="flex h-full items-center justify-center p-8">
          <div className="max-w-md rounded-2xl bg-amber-a2 px-8 py-7 text-center outline outline-1 -outline-offset-1 outline-amber-a6">
            <p className="text-base font-bold tracking-[-0.01em] text-foreground">
              The Flow Canvas is not available here
            </p>
            <p className="mx-auto mt-2 text-sm leading-relaxed text-muted-foreground">
              It draws against staging only — every Sale Type, Stage and Scratch SOR it creates
              is a real row, and production is never the drafting surface. Open this screen on
              staging instead.
            </p>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="relative flex h-full flex-col">
        <FlowCanvasModeBar
          mode={mode}
          onModeChange={setMode}
          canSeeHistory={Boolean(user?.is_super_admin)}
          onOpenHistory={() => setHistoryOpen(true)}
        />

        {mode === "sandbox" ? (
          <SandboxCanvas actorId={user?.id} />
        ) : (
          <FlowDataProvider>
            <FlowCanvas />
          </FlowDataProvider>
        )}

        <FlowSnapshotHistoryPanel open={historyOpen} onOpenChange={setHistoryOpen} />
      </div>
    </ProtectedRoute>
  );
}

/** Provisions the one shared Sandbox on first use, then binds the canvas to it. */
function SandboxCanvas({ actorId }) {
  const { data: sandbox, isLoading } = useQuery({
    queryKey: ["flow_plans", "sandbox"],
    queryFn: () => flowPlanService.getOrCreateSandbox(actorId),
  });

  if (isLoading || !sandbox) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <SandboxFlowDataProvider key={sandbox.id} planId={sandbox.id}>
      <FlowCanvas />
    </SandboxFlowDataProvider>
  );
}
