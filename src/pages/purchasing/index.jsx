import { useState, useMemo } from "react";
import { useNavigate } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PackageSearch, ExternalLink } from "lucide-react";
import toast from "react-hot-toast";

import ProtectedRoute from "../../components/ProtectedRoute";
import PageContainer from "../../components/ui/PageContainer";
import PageHeader from "../../components/ui/PageHeader";
import Spinner from "../../components/ui/Spinner";
import StatusBadge from "../../components/StatusBadge";
import Avatar from "../../components/Avatar";
import FilterBar from "../../components/ui/FilterBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { purchasingService } from "../../services/purchasingService";
import { employeeService } from "../../services/employeeService";
import { daysWaiting, displayOutcome, procurementAffinity, PROCUREMENT_OUTCOME_LABELS } from "../../constants/procurement";
import { useAuth } from "../../context/AuthContext";

/**
 * The Purchasing queue (issue #39).
 *
 * Every other read of a procurement request is scoped to one thing — one deal,
 * one task, one purchaser. This is the only screen that answers "what is
 * purchasing sourcing this week", which until now meant opening Tasks one at a
 * time, and is why that answer has been living in a spreadsheet.
 *
 * A row is deliberately not editable here. This ticket is the list; resolving
 * still happens where it already does, on the SOR the ask came from, so there
 * is exactly one place a request is answered.
 */

/** How long a request has been waiting, in words a purchaser reads at a glance. */
function waitedFor(request, now) {
  const days = daysWaiting(request, now);
  if (days === null) return "—";
  if (days === 0) return "Today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

function QueueRow({ request, now, onOpenSor, buyers, currentUserId }) {
  const queryClient = useQueryClient();
  const { raw: outcomeRaw, label: outcomeLabel } = displayOutcome(request);
  const days = daysWaiting(request, now);
  const sor = request.opportunity;

  const { mutate: assign, isPending: isAssigning } = useMutation({
    mutationFn: (newAssigneeId) =>
      purchasingService.assignRequests([request.id], newAssigneeId, currentUserId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["procurementQueue"] });
      toast.success("Request reassigned.");
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <tr className="group border-b border-border last:border-0 transition-colors hover:bg-mauve-a2">
      <td className="px-4 py-3">
        <span className="block text-sm font-bold text-foreground">
          {request.requested_name}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {Number(request.requested_quantity)} {request.requested_unit || "unit"}
        </span>
      </td>

      <td className="px-4 py-3">
        <button
          type="button"
          onClick={() => onOpenSor(sor.id)}
          className="group/sor flex items-center gap-1.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded"
        >
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-foreground group-hover/sor:text-primary">
              {sor.sales_reference || "Unregistered"}
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {sor.client_name}
            </span>
          </span>
          <ExternalLink
            size={13}
            className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          />
        </button>
      </td>

      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Avatar
            src={request.requester?.avatar_path}
            name={request.requester?.name}
            size="xs"
          />
          <span className="truncate text-xs font-medium text-foreground">
            {request.requester?.name || "—"}
          </span>
        </div>
      </td>

      <td className="px-4 py-3">
        <Select
          value={request.assignee?.id || "unassigned"}
          onValueChange={(val) => {
            if (val !== "unassigned" && val !== request.assignee?.id) assign(val);
          }}
          disabled={isAssigning}
        >
          <SelectTrigger className="h-8 w-40 border-transparent bg-transparent hover:bg-mauve-a3 focus:ring-0 shadow-none -ml-2">
            <SelectValue>
              {request.assignee ? (
                <div className="flex items-center gap-2">
                  <Avatar
                    src={request.assignee.avatar_path}
                    name={request.assignee.name}
                    size="xs"
                  />
                  <span className="truncate text-xs font-medium text-foreground">
                    {request.assignee.name}
                  </span>
                </div>
              ) : (
                <span className="text-xs font-semibold uppercase tracking-wider text-amber-11">
                  Unassigned
                </span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="start">
            <SelectItem value="unassigned" disabled>
              Unassigned
            </SelectItem>
            {buyers.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                <div className="flex items-center gap-2">
                  <Avatar src={b.avatar_path} name={b.name} size="xs" />
                  <span className="truncate">{b.name}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>

      <td className="px-4 py-3">
        <span
          className={
            days !== null && days >= 7
              ? "text-xs font-bold tabular-nums text-red-11"
              : "text-xs font-medium tabular-nums text-muted-foreground"
          }
        >
          {waitedFor(request, now)}
        </span>
      </td>

      <td className="px-4 py-3 text-right">
        <StatusBadge status={outcomeRaw} label={outcomeLabel} />
      </td>
    </tr>
  );
}

function PurchasingQueue() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [filterAssignee, setFilterAssignee] = useState("all");
  const [filterOutcome, setFilterOutcome] = useState("all");
  const [filterSor, setFilterSor] = useState("all");

  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => employeeService.getAllEmployees(),
  });

  const buyers = useMemo(() => {
    return [...employees].sort(
      (a, b) => procurementAffinity(a) - procurementAffinity(b) || a.name.localeCompare(b.name)
    );
  }, [employees]);

  // The age column is measured from when the queue was fetched, not from when
  // React happened to render — so every row on screen is measured against the
  // same instant, and reading the clock stays out of render entirely.
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["procurementQueue"],
    queryFn: async () => ({
      rows: await purchasingService.listOpenQueue(),
      fetchedAt: Date.now(),
    }),
  });

  const requests = data?.rows;
  const now = data?.fetchedAt;

  const openSor = (opportunityId) =>
    navigate("/opportunities", { state: { openOpportunityId: opportunityId } });

  const uniqueSors = useMemo(() => {
    if (!requests) return [];
    return Array.from(new Map(requests.map((r) => [r.opportunity.id, r.opportunity])).values())
      .sort((a, b) => (a.sales_reference || a.client_name).localeCompare(b.sales_reference || b.client_name));
  }, [requests]);

  const filteredRequests = useMemo(() => {
    if (!requests) return [];
    return requests.filter(req => {
      if (filterAssignee === "unassigned" && req.assignee) return false;
      if (filterAssignee !== "all" && filterAssignee !== "unassigned" && req.assignee?.id !== filterAssignee) return false;
      const { raw } = displayOutcome(req);
      if (filterOutcome !== "all" && raw !== filterOutcome) return false;
      if (filterSor !== "all" && req.opportunity?.id !== filterSor) return false;
      return true;
    });
  }, [requests, filterAssignee, filterOutcome, filterSor]);

  const count = filteredRequests?.length ?? 0;

  return (
    <PageContainer maxWidth="7xl" className="pt-4">
      <PageHeader
        title="Purchasing Queue"
        description="Every product still waiting on purchasing, across all SORs."
      />

      <FilterBar
        className="mb-6"
        hasActiveFilters={filterAssignee !== "all" || filterOutcome !== "all" || filterSor !== "all"}
        onClearAll={() => {
          setFilterAssignee("all");
          setFilterOutcome("all");
          setFilterSor("all");
        }}
      >
        <Select value={filterAssignee} onValueChange={setFilterAssignee}>
          <SelectTrigger className="w-[180px] bg-background">
            <SelectValue placeholder="Assignee" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any Assignee</SelectItem>
            <SelectItem value="unassigned">Unassigned</SelectItem>
            {buyers.map((b) => (
              <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterOutcome} onValueChange={setFilterOutcome}>
          <SelectTrigger className="w-[180px] bg-background">
            <SelectValue placeholder="Outcome" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any Outcome</SelectItem>
            {Object.entries(PROCUREMENT_OUTCOME_LABELS).map(([val, label]) => (
              <SelectItem key={val} value={val}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterSor} onValueChange={setFilterSor}>
          <SelectTrigger className="w-[200px] bg-background">
            <SelectValue placeholder="SOR" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any SOR</SelectItem>
            {uniqueSors.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.sales_reference || s.client_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterBar>

      {isLoading && (
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      )}

      {isError && (
        <div className="rounded-2xl border border-red-6 bg-red-a2 px-5 py-8 text-center">
          <p className="text-sm font-semibold text-red-11">
            The queue could not be loaded.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{error?.message}</p>
        </div>
      )}

      {!isLoading && !isError && count === 0 && (
        <div className="rounded-2xl border border-dashed border-mauve-7 px-5 py-16 text-center">
          <PackageSearch size={26} className="mx-auto mb-3 text-muted-foreground/60" />
          <p className="text-sm font-semibold text-foreground">Nothing to source</p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
            Every product sales has sent to purchasing has an answer against it.
          </p>
        </div>
      )}

      {!isLoading && !isError && count > 0 && (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">
              {count} open {count === 1 ? "request" : "requests"}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] border-collapse">
              <thead>
                <tr className="border-b border-border text-left">
                  {["Product", "SOR", "Requested by", "Assigned to", "Waiting", ""].map(
                    (heading, i) => (
                      <th
                        key={heading || `col-${i}`}
                        className={`px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.12em] text-muted-foreground ${
                          heading === "" ? "text-right" : ""
                        }`}
                      >
                        {heading}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {filteredRequests.map((request) => (
                  <QueueRow
                    key={request.id}
                    request={request}
                    now={now}
                    onOpenSor={openSor}
                    buyers={buyers}
                    currentUserId={user?.id}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </PageContainer>
  );
}

export default function PurchasingQueuePage() {
  return (
    <ProtectedRoute requirePurchasing={true}>
      <PurchasingQueue />
    </ProtectedRoute>
  );
}
