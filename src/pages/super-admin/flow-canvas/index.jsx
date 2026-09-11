import { useState } from "react";
import { History } from "lucide-react";

import ProtectedRoute from "@/components/ProtectedRoute.jsx";
import FlowCanvas from "@/components/settings/FlowCanvas.jsx";
import { FlowDataProvider } from "@/components/settings/FlowDataContext.jsx";
import FlowSnapshotHistoryPanel from "@/components/settings/FlowSnapshotHistoryPanel.jsx";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { isProductionSupabase } from "@/lib/supabase.js";

/**
 * The Flow Canvas (issue #36) — one screen, one nav entry, for what was always
 * one activity: building and refining the CRM process.
 *
 * It edits `sales_flows` directly — real Sale Types, Stages and Scratch SORs.
 * The Live/Sandbox toggle and its one shared Sandbox document are gone (issue
 * #186); the canvas always opens straight onto the real Sales Flow. A Super
 * Admin can still reach the Flow Snapshot history, through the floating button
 * where the mode bar used to be, until the version rail (#192) replaces it.
 *
 * Full-bleed: this screen is an editor, not a report. `_app.jsx` drops its
 * wrapper for this route; every control floats over the canvas rather than
 * sitting in a page header.
 *
 * Staging only. "The canvas and its Scratch SORs live on staging. Production is
 * never the drafting surface" is a spec condition, not a nicety — Scratch SORs
 * are real rows on whatever database they are created against.
 */
export default function FlowCanvasAdminPage() {
  const { user } = useAuth();
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
        {user?.is_super_admin && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="absolute left-3 top-3 z-30 gap-1.5 rounded-2xl bg-card/85 backdrop-blur-md"
            onClick={() => setHistoryOpen(true)}
          >
            <History size={14} /> Snapshot History
          </Button>
        )}

        <FlowDataProvider>
          <FlowCanvas />
        </FlowDataProvider>

        <FlowSnapshotHistoryPanel open={historyOpen} onOpenChange={setHistoryOpen} />
      </div>
    </ProtectedRoute>
  );
}
