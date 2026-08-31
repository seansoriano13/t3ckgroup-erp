import ProtectedRoute from "../../../components/ProtectedRoute.jsx";
import FlowCanvas from "../../../components/settings/FlowCanvas.jsx";
import { isProductionSupabase } from "../../../lib/supabase.js";

/**
 * The Flow Canvas (issue #36) — where the CRM process gets built with the
 * Operations Manager rather than described to her.
 *
 * Full-bleed: this screen is an editor, not a report. A page header and a
 * centred column would spend the two things the canvas needs most — vertical
 * room and edge-to-edge width — on chrome that says what the toolbar already
 * says. `_app.jsx` drops its wrapper for this route; every control lives on the
 * canvas, floating over the surface it acts on.
 *
 * Available to everyone. The canvas is scaffolding, scheduled to be hidden once
 * the flow it produces is implemented as the production pipeline.
 *
 * Staging only. "The canvas and its Scratch SORs live on staging. Production
 * is never the drafting surface" is a spec condition, not a nicety —
 * Scratch SORs are real rows on whatever database they are created against,
 * and the whole reason they are safe to create and discard freely is that
 * staging can never be a production record.
 */
export default function FlowCanvasAdminPage() {
  return (
    <ProtectedRoute>
      {isProductionSupabase ? (
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
      ) : (
        <FlowCanvas />
      )}
    </ProtectedRoute>
  );
}
