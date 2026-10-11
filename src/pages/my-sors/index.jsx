import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Handshake } from "lucide-react";

import ProtectedRoute from "../../components/ProtectedRoute";
import PageShell from "../../components/ui/PageShell";
import EmptyState from "../../components/ui/EmptyState";
import Spinner from "../../components/ui/Spinner";
import MySorsTable from "../../components/sor/MySorsTable";
import MySorsFilterBar from "../../components/sor/MySorsFilterBar";
import { useSavedFilters } from "../../hooks/useSavedFilters";
import { DEFAULT_MY_SORS_FILTERS, applyMySorsFilters, hasActiveMySorsFilters } from "../../utils/mySorsFilters";
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
 * Ended windows stay listed, tagged "Access ended" and behind the Access
 * filter (#478). A deal someone worked last month is the thing they are most
 * likely to come here looking for, and dropping it silently is the same
 * disappearing act this screen exists to undo.
 */
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
 *
 * Lands on Quick View, not the full modal directly — what pulled this
 * person in is rarely "read the whole record", it's "what do I still owe
 * here", and Quick View's own "View Full Details" button is there for
 * whoever needs the rest.
 */
function openSor(opportunityId) {
  window.dispatchEvent(
    new CustomEvent("OPEN_ENTITY_DETAILS", { detail: { id: opportunityId, type: "OPPORTUNITY_QUICK_VIEW" } }),
  );
}

function MySorsScreen() {
  const { user } = useAuth();
  const { initial, hasSavedDefault, saveDefault, clearDefault, isDirty } = useSavedFilters(
    "my_sors",
    user?.id,
    DEFAULT_MY_SORS_FILTERS,
  );
  const [filters, setFilters] = useState(initial);
  const setFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["mySors", user?.id],
    queryFn: () => opportunityService.getMySors(user.id),
    enabled: !!user?.id,
  });

  // #478: ended windows stay listed (a deal worked last month is what people
  // come here for), but behind the Access filter so the list stays short.
  const shown = useMemo(() => applyMySorsFilters(rows, filters), [rows, filters]);
  const endedCount = useMemo(() => rows.filter((r) => !r.isOpen).length, [rows]);

  let body;
  if (isLoading) {
    body = (
      <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
        <Spinner size="sm" />
        <span className="text-sm font-bold uppercase tracking-widest">Loading…</span>
      </div>
    );
  } else if (rows.length === 0) {
    body = (
      <EmptyState
        icon={Handshake}
        title="Nobody has called you into an SOR yet"
        description="When a task, an assignment, a purchase request or a mention pulls you into an SOR, it appears here."
      />
    );
  } else if (shown.length === 0) {
    const onlyDefault = !hasActiveMySorsFilters(filters);
    body = (
      <EmptyState
        title={onlyDefault ? "No open access right now" : "No SOR matches these filters"}
        description={
          onlyDefault && endedCount > 0
            ? `${endedCount} SOR${endedCount === 1 ? "" : "s"} where your access has ended. Set Access to "Access ended" to see ${endedCount === 1 ? "it" : "them"}.`
            : undefined
        }
      />
    );
  } else {
    body = <MySorsTable rows={shown} onOpen={openSor} />;
  }

  return (
    <PageShell
      title="My SORs"
      description="SORs you were called or mentioned into, and how far your access reaches."
      toolbar={
        rows.length > 0 && (
          <MySorsFilterBar
            rows={rows}
            filters={filters}
            onChange={setFilter}
            onClearAll={() => setFilters(DEFAULT_MY_SORS_FILTERS)}
            saveDefault={{
              hasSavedDefault,
              isDirty: isDirty(filters),
              onSave: () => saveDefault(filters),
              onClear: clearDefault,
            }}
          />
        )
      }
    >
      {body}
    </PageShell>
  );
}

export default function MySorsPage() {
  return (
    <ProtectedRoute>
      <MySorsScreen />
    </ProtectedRoute>
  );
}
