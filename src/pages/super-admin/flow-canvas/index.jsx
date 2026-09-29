import ProtectedRoute from "@/components/ProtectedRoute.jsx";
import FlowCanvas from "@/components/flow-canvas/FlowCanvas.jsx";
import { FlowDataProvider } from "@/components/flow-canvas/FlowDataContext.jsx";
import { isProductionSupabase } from "@/lib/supabase.js";

/**
 * The Flow Canvas (issue #36) — one screen, one nav entry, for what was always
 * one activity: building and refining the SORS process.
 *
 * It edits `sales_flows` directly — real Sale Types, Stages and Scratch SORs.
 * The Live/Sandbox toggle and its one shared Sandbox document are gone (issue
 * #186); the canvas always opens straight onto the real Sales Flow. The
 * Snapshot history dialog is gone too (issue #192) — the canvas's own version
 * rail replaces it, open to everyone who can already publish from here, not
 * just Super Admins.
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
        <FlowDataProvider>
          <FlowCanvas />
        </FlowDataProvider>
      </div>
    </ProtectedRoute>
  );
}
