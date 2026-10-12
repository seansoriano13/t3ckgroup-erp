import ProtectedRoute from "@/components/ProtectedRoute.jsx";
import FlowCanvas from "@/components/flow-canvas/FlowCanvas.jsx";
import { FlowDataProvider } from "@/components/flow-canvas/FlowDataContext.jsx";
import PageShell from "@/components/ui/PageShell";
import DesktopNotice from "@/components/ui/DesktopNotice";

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
 * A Tool page (ADR 0029): the shared PageShell header (compact title) over a
 * full-width frame, with the canvas as the body. `_app.jsx` drops its wrapper
 * for this route. The canvas is a custom surface, so its own controls (Sale
 * Type menu, Publish, version rail) still float over it rather than sitting in
 * the header's action slot.
 *
 * Staging and production both. Until the 2026-09-29 cutover this was
 * staging-only ("production is never the drafting surface"); the operator
 * opened it on production from then on (ADR 0019 amendment). Every edit here
 * is a real row on whatever database the build points at, so on production
 * it is live for staff the moment it is saved.
 */
export default function FlowCanvasAdminPage() {
  return (
    <ProtectedRoute>
      <PageShell
        title="Flow Canvas"
        description="Build and refine the SORS process: Sale Types, Stages and their rules."
        frame="full"
      >
        <div className="relative flex h-full flex-col">
          <DesktopNotice className="m-3" />
          <FlowDataProvider>
            <FlowCanvas />
          </FlowDataProvider>
        </div>
      </PageShell>
    </ProtectedRoute>
  );
}
