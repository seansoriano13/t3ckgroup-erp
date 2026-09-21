import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Handshake, Lock } from "lucide-react";

import ProtectedRoute from "../../components/ProtectedRoute";
import PageContainer from "../../components/ui/PageContainer";
import PageHeader from "../../components/ui/PageHeader";
import Spinner from "../../components/ui/Spinner";
import { useAuth } from "../../context/AuthContext";
import { opportunityService } from "../../services/opportunityService";

/**
 * My SORs — every SOR this person was called into.
 *
 * ADR 0021 scopes an SOR's data to Stage Visits and gives a Stage Participant
 * real, enforced access to the Stages they were pulled into. What it never
 * gave them was anywhere to find those deals: `sor_read` is Super Admin, Deal
 * Team or Always-sees, so the SORS register structurally cannot list one. On
 * staging that left 11 people holding 33 valid windows, every one of them
 * reachable only through a single notification that scrolls away.
 *
 * Its own screen rather than a section of the register, for the reason Retail
 * ended up on its own screen (issues #170-#174): the register's tab strip was
 * already the crowded thing. Under Sales rather than Workspace because SORS is
 * a Sales module that other departments collaborate into — the deals are the
 * Sales module's, the involvement is personal.
 *
 * Closed windows stay listed, grouped apart. A deal someone worked last month
 * is the thing they are most likely to come here looking for, and dropping it
 * silently is the same disappearing act this screen exists to undo.
 */
const SOURCE_LABEL = {
  action: "a task on this Stage",
  assignment: "an assignment on this Stage",
  purchase_request: "a purchase request",
};

function SorRow({ row, onOpen }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(row.opportunityId)}
      className="flex w-full flex-col gap-2 rounded-2xl border border-mauve-6 bg-mauve-2 p-4 text-left transition-colors hover:border-mauve-8"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm font-black tracking-tight text-foreground">
          {row.salesReference || "No Sales Reference"}
        </span>
        <span className="min-w-0 truncate text-sm text-muted-foreground">
          {row.projectTitle || "Untitled"}
        </span>
        {!row.isOpen && (
          <span className="inline-flex items-center gap-1 rounded-md bg-mauve-4 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            <Lock size={10} /> Closed
          </span>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Now on <span className="font-bold text-foreground">{row.currentStageName || "—"}</span>
      </p>

      {/* Q7: why they can see it, and how far it reaches — the same wording the
          Flow Canvas uses for the identical setting, so the two cannot drift. */}
      <ul className="space-y-1">
        {row.windows.map((w) => (
          <li key={w.id} className="text-xs leading-relaxed text-muted-foreground">
            Called in at{" "}
            <span className="font-bold text-foreground">{w.calledInAtStageName || "this deal"}</span>
            {SOURCE_LABEL[w.source] ? ` by ${SOURCE_LABEL[w.source]}` : ""} — sees {w.reachLabel}
            {w.closedAt ? " (window closed)" : ""}
          </li>
        ))}
      </ul>
    </button>
  );
}

/**
 * The one way into an SOR from anywhere that is not the register.
 *
 * GlobalDetailManager (mounted in SideNav) fetches through
 * `getOpportunityForModal`, which branches on `sor_access_level` and reads
 * `sor_participant_record` / `sor_locked_summary` when the table row is out of
 * reach. Rendering `OpportunityDetailsModal` here instead would hand it an
 * `opportunityId` with no record: SorModal resolves its own access level but
 * does not fetch the SOR, so a Participant would get an empty modal — the
 * failure commit 5409ca8 fixed one layer down, rebuilt here.
 */
function openSor(opportunityId) {
  window.dispatchEvent(
    new CustomEvent("OPEN_ENTITY_DETAILS", { detail: { id: opportunityId, type: "OPPORTUNITY" } }),
  );
}

function MySorsScreen() {
  const { user } = useAuth();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["mySors", user?.id],
    queryFn: () => opportunityService.getMySors(user.id),
    enabled: !!user?.id,
  });

  const { open, closed } = useMemo(
    () => ({
      open: rows.filter((r) => r.isOpen),
      closed: rows.filter((r) => !r.isOpen),
    }),
    [rows],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
        <Spinner size="sm" />
        <span className="text-sm font-bold uppercase tracking-widest">Loading…</span>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-24 text-center text-muted-foreground">
        <Handshake size={28} className="opacity-40" />
        <p className="text-sm font-semibold text-foreground">Nobody has called you into an SOR yet</p>
        <p className="max-w-sm text-xs leading-relaxed">
          When a task, an assignment, or a purchase request pulls you into an SOR,
          it appears here for as long as your access lasts — and stays listed after
          it closes.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
        <section className="space-y-3">
          <h2 className="text-xs font-black uppercase tracking-widest text-muted-foreground">
            Open — {open.length}
          </h2>
          {open.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nothing open. Everything below has closed behind you.
            </p>
          ) : (
            <div className="space-y-2">
              {open.map((row) => (
                <SorRow key={row.opportunityId} row={row} onOpen={openSor} />
              ))}
            </div>
          )}
        </section>

        {closed.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-xs font-black uppercase tracking-widest text-muted-foreground">
              Closed — {closed.length}
            </h2>
            <div className="space-y-2">
              {closed.map((row) => (
                <SorRow key={row.opportunityId} row={row} onOpen={openSor} />
              ))}
            </div>
          </section>
        )}
    </div>
  );
}

export default function MySorsPage() {
  return (
    <ProtectedRoute>
      <PageContainer>
        <PageHeader
          title="My SORs"
          description="SORs you were called into, and how far your access reaches"
        />
        <MySorsScreen />
      </PageContainer>
    </ProtectedRoute>
  );
}
