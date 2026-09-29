import ProtectedRoute from "@/components/ProtectedRoute.jsx";
import FlowCanvas from "@/components/flow-canvas/FlowCanvas.jsx";
import { FlowDataProvider } from "@/components/flow-canvas/FlowDataContext.jsx";

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
 * Staging and production both. Until the 2026-09-29 cutover this was
 * staging-only ("production is never the drafting surface"); the operator
 * opened it on production from then on (ADR 0019 amendment). Every edit here
 * is a real row on whatever database the build points at, so on production
 * it is live for staff the moment it is saved.
 */
export default function FlowCanvasAdminPage() {
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
