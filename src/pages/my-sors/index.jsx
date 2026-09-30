import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Handshake, Search } from "lucide-react";

import ProtectedRoute from "../../components/ProtectedRoute";
import PageShell from "../../components/ui/PageShell";
import EmptyState from "../../components/ui/EmptyState";
import TabGroup from "../../components/ui/TabGroup";
import { Input } from "../../components/ui/input";
import Spinner from "../../components/ui/Spinner";
import MySorsTable from "../../components/sor/MySorsTable";
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
  const [pill, setPill] = useState(null);
  const [search, setSearch] = useState("");

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

  // Open first; land on Closed only when nothing is open, so a person whose
  // windows all closed still sees their deals.
  const active = pill ?? (open.length === 0 && closed.length > 0 ? "closed" : "open");
  const needle = search.trim().toLowerCase();
  const shown = (active === "open" ? open : closed).filter(
    (r) =>
      !needle ||
      (r.salesReference || "").toLowerCase().includes(needle) ||
      (r.projectTitle || "").toLowerCase().includes(needle),
  );

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
        description="When a task, an assignment, or a purchase request pulls you into an SOR, it appears here for as long as your access lasts."
      />
    );
  } else if (shown.length === 0) {
    body = (
      <EmptyState
        title={needle ? "No SOR matches your search" : `Nothing ${active}`}
        description={needle ? "Try a Sales Reference or project name." : undefined}
      />
    );
  } else {
    body = <MySorsTable rows={shown} onOpen={openSor} />;
  }

  return (
    <PageShell
      title="My SORs"
      description="SORs you were called into, and how far your access reaches"
      toolbar={
        rows.length > 0 && (
          <>
            <TabGroup
              variant="pill"
              activeTab={active}
              onChange={setPill}
              tabs={[
                { value: "open", label: `Open ${open.length}` },
                { value: "closed", label: `Closed ${closed.length}` },
              ]}
            />
            <div className="w-full max-w-xs">
              <Input
                icon={Search}
                type="search"
                aria-label="Search SORs"
                placeholder="Search reference or project"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </>
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
