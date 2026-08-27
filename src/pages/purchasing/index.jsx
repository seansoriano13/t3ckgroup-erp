import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { PackageSearch, ExternalLink } from "lucide-react";

import ProtectedRoute from "../../components/ProtectedRoute";
import PageContainer from "../../components/ui/PageContainer";
import PageHeader from "../../components/ui/PageHeader";
import Spinner from "../../components/ui/Spinner";
import StatusBadge from "../../components/StatusBadge";
import Avatar from "../../components/Avatar";
import { procurementService } from "../../services/procurementService";
import { daysWaiting, displayOutcome } from "../../constants/procurement";

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

function QueueRow({ request, now, onOpenSor }) {
  const { raw: outcomeRaw, label: outcomeLabel } = displayOutcome(request);
  const days = daysWaiting(request, now);
  const sor = request.opportunity;

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

  // The age column is measured from when the queue was fetched, not from when
  // React happened to render — so every row on screen is measured against the
  // same instant, and reading the clock stays out of render entirely.
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["procurementQueue"],
    queryFn: async () => ({
      rows: await procurementService.listOpenQueue(),
      fetchedAt: Date.now(),
    }),
  });

  const requests = data?.rows;
  const now = data?.fetchedAt;

  const openSor = (opportunityId) =>
    navigate("/opportunities", { state: { openOpportunityId: opportunityId } });

  const count = requests?.length ?? 0;

  return (
    <PageContainer maxWidth="7xl" className="pt-4">
      <PageHeader
        title="Procurement Queue"
        description="Every product still waiting on purchasing, across all SORs."
      />

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
                {requests.map((request) => (
                  <QueueRow
                    key={request.id}
                    request={request}
                    now={now}
                    onOpenSor={openSor}
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
