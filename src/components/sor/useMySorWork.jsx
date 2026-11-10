import PageLoading from "@/components/ui/PageLoading";
import { useMemo, useState } from "react";
import QueryError from "@/components/ui/QueryError";
import { useQuery } from "@tanstack/react-query";
import { Handshake } from "lucide-react";

import EmptyState from "../ui/EmptyState";
import MySorsTable from "./MySorsTable";
import MySorsFilterBar from "./MySorsFilterBar";
import { useSavedFilters } from "../../hooks/useSavedFilters";
import {
  DEFAULT_MY_SORS_FILTERS,
  applyMySorsFilters,
  hasActiveMySorsFilters,
  migrateSavedMySorsFilters,
} from "../../utils/mySorsFilters";
import { useAuth } from "../../context/AuthContext";
import { opportunityService } from "../../services/opportunityService";

/**
 * The register's "My work" view: every SOR this person owes something on or
 * was called into, the move waiting longest on top.
 *
 * ADR 0021 scopes an SOR's data to Stage Visits and gives a Stage Participant
 * real access to the Stages they were pulled into, but `sor_read` is Super
 * Admin, Deal Team or Always-sees, so the register's own list can never show
 * them. This view reads through `getMySors` instead, which is why it is the
 * only view someone without register access gets.
 *
 * It used to be its own screen (My SORs, then My SOR Work). It lives in the
 * register's view strip now, so the crowded list is one click away instead of
 * one menu item away, and nobody has to learn two places for one deal.
 *
 * Ended windows stay listed behind the Access filter (#478): a deal someone
 * worked last month is what they most often come looking for.
 */

/**
 * GlobalDetailManager fetches through `getOpportunityForModal`, which branches
 * on `sor_access_level`, so a Participant gets their scoped view rather than
 * an empty modal. Lands on Quick View: what pulled this person in is rarely
 * "read the whole record", and Quick View links to the rest.
 */
function openSor(opportunityId) {
  window.dispatchEvent(
    new CustomEvent("OPEN_ENTITY_DETAILS", { detail: { id: opportunityId, type: "OPPORTUNITY_QUICK_VIEW" } }),
  );
}

/** The view's toolbar (its own filters) and body, for the register's PageShell. */
export function useMySorWork() {
  const { user } = useAuth();
  const { initial, hasSavedDefault, saveDefault, clearDefault, isDirty } = useSavedFilters(
    "my_sors",
    user?.id,
    DEFAULT_MY_SORS_FILTERS,
  );
  const [filters, setFilters] = useState(() => migrateSavedMySorsFilters(initial));
  const setFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));

  const { data: rows = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["mySors", user?.id],
    queryFn: () => opportunityService.getMySors(user.id),
    enabled: !!user?.id,
  });

  const shown = useMemo(() => applyMySorsFilters(rows, filters), [rows, filters]);
  const endedCount = useMemo(() => rows.filter((r) => !r.isOpen).length, [rows]);

  let body;
  if (isError) {
    body = <QueryError title="Your SORs could not be loaded." onRetry={refetch} />;
  } else if (isLoading) {
    body = <PageLoading label="your SORs" />;
  } else if (rows.length === 0) {
    body = (
      <EmptyState
        icon={Handshake}
        title="Nothing on an SOR needs you"
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

  const toolbar = rows.length > 0 && (
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
  );

  return { toolbar, body };
}

