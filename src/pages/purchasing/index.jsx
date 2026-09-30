import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { CircleDot, FileText, PackageSearch, UserRound } from "lucide-react";

import ProtectedRoute from "../../components/ProtectedRoute";
import PageShell from "../../components/ui/PageShell";
import EmptyState from "../../components/ui/EmptyState";
import Spinner from "../../components/ui/Spinner";
import FilterBar from "../../components/ui/FilterBar";
import { FilterSelect } from "../../components/ui/FilterDropdown";
import SlideOver, { SlideOverBody, SlideOverFooter } from "../../components/ui/SlideOver";
import { DetailRow, DetailSection, PersonChip } from "../../components/ui/DetailParts";
import StatusBadge from "../../components/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import Avatar from "../../components/Avatar";
import { purchasingService } from "../../services/purchasingService";
import { employeeService } from "../../services/employeeService";
import {
  daysWaiting,
  displayOutcome,
  procurementAffinity,
  PROCUREMENT_OUTCOME_LABELS,
} from "../../constants/procurement";
import { useAuth } from "../../context/AuthContext";
import { useRecordParam } from "../../hooks/useRecordParam";
import { formatDate } from "../../utils/formatDate.js";
import { BuyerSelect } from "./_components/BuyerSelect";

/**
 * The Purchasing queue (issue #39), a Queue page (#439).
 *
 * Every other read of a procurement request is scoped to one thing — one deal,
 * one task, one purchaser. This is the only screen that answers "what is
 * purchasing sourcing this week", which until now meant opening Tasks one at a
 * time, and is why that answer has been living in a spreadsheet.
 *
 * A row opens the request in the slide-over (`?record=`). What purchasing does
 * to a request here is assign a Buyer; resolving it still happens on the SOR
 * the ask came from ("Open SOR"), so there is exactly one place a request is
 * answered.
 */

const HEAD = "text-[10px] font-bold uppercase tracking-wider";
const CHIP = "h-9 w-auto gap-2 px-2.5";
const CHIP_WRAPPER = "w-auto shrink-0";

/** How long a request has been waiting, in words a purchaser reads at a glance. */
function waitedFor(request, now) {
  const days = daysWaiting(request, now);
  if (days === null) return "—";
  if (days === 0) return "Today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

const matches = (request, term) =>
  [
    request.requested_name,
    request.requested_description,
    request.opportunity?.sales_reference,
    request.opportunity?.client_name,
    request.requester?.name,
  ].some((field) => field?.toLowerCase().includes(term));

function QueueRow({ request, now, onOpen, buyers, currentUserId }) {
  const { raw: outcomeRaw, label: outcomeLabel } = displayOutcome(request);
  const days = daysWaiting(request, now);
  const sor = request.opportunity;

  return (
    <TableRow
      tabIndex={0}
      onClick={() => onOpen(request.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) {
          e.preventDefault();
          onOpen(request.id);
        }
      }}
      className="group cursor-pointer outline-none focus-visible:bg-muted"
    >
      <TableCell>
        <span className="block text-sm font-bold text-foreground">{request.requested_name}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {Number(request.requested_quantity)} {request.requested_unit || "unit"}
        </span>
      </TableCell>

      <TableCell>
        <span className="block text-sm font-semibold text-foreground">{sor.sales_reference || "Unregistered"}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{sor.client_name}</span>
      </TableCell>

      <TableCell>
        <div className="flex items-center gap-2">
          <Avatar src={request.requester?.avatar_path} name={request.requester?.name} size="xs" />
          <span className="truncate text-xs font-medium text-foreground">{request.requester?.name || "—"}</span>
        </div>
      </TableCell>

      <TableCell onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <BuyerSelect
          request={request}
          buyers={buyers}
          currentUserId={currentUserId}
          className="-ml-2 h-8 w-40 border-transparent bg-transparent shadow-none hover:bg-mauve-a3 focus:ring-0"
        />
      </TableCell>

      <TableCell>
        <span
          className={
            days !== null && days >= 7
              ? "text-xs font-bold tabular-nums text-red-11"
              : "text-xs font-medium tabular-nums text-muted-foreground"
          }
        >
          {waitedFor(request, now)}
        </span>
      </TableCell>

      <TableCell className="text-right">
        <StatusBadge status={outcomeRaw} label={outcomeLabel} />
      </TableCell>
    </TableRow>
  );
}

const sheetIdentity = (now) => (r) => {
  const { raw, label } = displayOutcome(r);
  return {
    ref: r.opportunity.sales_reference || "Unregistered",
    title: r.requested_name,
    badge: <StatusBadge status={raw} label={label} />,
    subtitle: `waiting ${waitedFor(r, now)}`,
  };
};

function RequestSheet({ request, now, index, total, onStep, onClose, onOpenSor, buyers, currentUserId }) {
  return (
    <SlideOver
      record={request}
      icon={PackageSearch}
      crumb="Purchasing Queue"
      identity={sheetIdentity(now)}
      index={index}
      total={total}
      onStep={onStep}
      onClose={onClose}
      onOpenFull={(r) => onOpenSor(r.opportunity.id)}
      openFullLabel="Open SOR"
    >
      {(r) => (
        <>
          <SlideOverBody>
            <DetailSection title="Request">
              <dl className="divide-y divide-border">
                <DetailRow label="Product">{r.requested_name}</DetailRow>
                <DetailRow label="Quantity">
                  {Number(r.requested_quantity)} {r.requested_unit || "unit"}
                </DetailRow>
                <DetailRow label="Description">{r.requested_description}</DetailRow>
                <DetailRow label="Raised">{formatDate(r.created_at)}</DetailRow>
                <DetailRow label="Waiting">{waitedFor(r, now)}</DetailRow>
              </dl>
            </DetailSection>
            <DetailSection title="Requested by">
              {r.requester ? (
                <PersonChip
                  person={{ id: r.requester.id, name: r.requester.name, avatarPath: r.requester.avatar_path }}
                />
              ) : (
                "—"
              )}
            </DetailSection>
            <DetailSection title="SOR">
              <dl className="divide-y divide-border">
                <DetailRow label="Reference">{r.opportunity.sales_reference || "Unregistered"}</DetailRow>
                <DetailRow label="Client">{r.opportunity.client_name}</DetailRow>
              </dl>
            </DetailSection>
          </SlideOverBody>
          <SlideOverFooter>
            <DetailSection title="Buyer">
              <BuyerSelect request={r} buyers={buyers} currentUserId={currentUserId} className="w-full" />
            </DetailSection>
          </SlideOverFooter>
        </>
      )}
    </SlideOver>
  );
}

function PurchasingQueue() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { recordId, open, step, close } = useRecordParam();

  const [search, setSearch] = useState("");
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
    navigate("/sors", { state: { openOpportunityId: opportunityId } });

  const uniqueSors = useMemo(() => {
    if (!requests) return [];
    return Array.from(new Map(requests.map((r) => [r.opportunity.id, r.opportunity])).values())
      .sort((a, b) => (a.sales_reference || a.client_name).localeCompare(b.sales_reference || b.client_name));
  }, [requests]);

  const filteredRequests = useMemo(() => {
    if (!requests) return [];
    const term = search.trim().toLowerCase();
    return requests.filter((req) => {
      if (term && !matches(req, term)) return false;
      if (filterAssignee === "unassigned" && req.assignee) return false;
      if (filterAssignee !== "all" && filterAssignee !== "unassigned" && req.assignee?.id !== filterAssignee) return false;
      const { raw } = displayOutcome(req);
      if (filterOutcome !== "all" && raw !== filterOutcome) return false;
      if (filterSor !== "all" && req.opportunity?.id !== filterSor) return false;
      return true;
    });
  }, [requests, search, filterAssignee, filterOutcome, filterSor]);

  const count = filteredRequests.length;
  const index = filteredRequests.findIndex((r) => String(r.id) === recordId);
  const openRequest = index >= 0 ? filteredRequests[index] : null;

  const hasActiveFilters = search !== "" || filterAssignee !== "all" || filterOutcome !== "all" || filterSor !== "all";

  const assigneeOptions = [
    { value: "all", label: "Any buyer" },
    { value: "unassigned", label: "Unassigned" },
    ...buyers.map((b) => ({ value: b.id, label: b.name })),
  ];
  const outcomeOptions = [
    { value: "all", label: "Any outcome" },
    ...Object.entries(PROCUREMENT_OUTCOME_LABELS).map(([value, label]) => ({ value, label })),
  ];
  const sorOptions = [
    { value: "all", label: "Any SOR" },
    ...uniqueSors.map((s) => ({ value: s.id, label: s.sales_reference || s.client_name })),
  ];

  const toolbar = (
    <FilterBar
      search={{ value: search, onChange: setSearch, placeholder: "Search requests" }}
      chips={
        <>
          <FilterSelect
            icon={UserRound}
            label="Assignee"
            options={assigneeOptions}
            value={filterAssignee}
            onChange={setFilterAssignee}
            allValue="all"
            className={CHIP}
            wrapperClassName={CHIP_WRAPPER}
          />
          <FilterSelect
            icon={CircleDot}
            label="Outcome"
            options={outcomeOptions}
            value={filterOutcome}
            onChange={setFilterOutcome}
            allValue="all"
            className={CHIP}
            wrapperClassName={CHIP_WRAPPER}
          />
          <FilterSelect
            icon={FileText}
            label="SOR"
            options={sorOptions}
            value={filterSor}
            onChange={setFilterSor}
            allValue="all"
            className={CHIP}
            wrapperClassName={CHIP_WRAPPER}
          />
        </>
      }
      hasActiveFilters={hasActiveFilters}
      onClearAll={() => {
        setSearch("");
        setFilterAssignee("all");
        setFilterOutcome("all");
        setFilterSor("all");
      }}
    />
  );

  return (
    <>
      <PageShell
        title="Purchasing Queue"
        description="Every product still waiting on purchasing, across all SORs."
        toolbar={toolbar}
      >
        {isLoading && (
          <div className="flex justify-center py-20">
            <Spinner />
          </div>
        )}

        {isError && (
          <div className="rounded-xl border border-red-6 bg-red-a2 px-5 py-8 text-center">
            <p className="text-sm font-semibold text-red-11">The queue could not be loaded.</p>
            <p className="mt-1 text-xs text-muted-foreground">{error?.message}</p>
          </div>
        )}

        {!isLoading && !isError && count === 0 && (
          <EmptyState
            icon={PackageSearch}
            title={hasActiveFilters ? "No matching requests" : "Nothing to source"}
            description={
              hasActiveFilters
                ? "No open request matches these filters."
                : "Every product sales has sent to purchasing has an answer against it."
            }
          />
        )}

        {!isLoading && !isError && count > 0 && (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="overflow-x-auto">
              <Table className="min-w-[52rem]">
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    {["Product", "SOR", "Requested by", "Assigned to", "Waiting", "Status"].map((heading) => (
                      <TableHead key={heading} className={`${HEAD} ${heading === "Status" ? "text-right" : ""}`}>
                        {heading}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRequests.map((request) => (
                    <QueueRow
                      key={request.id}
                      request={request}
                      now={now}
                      onOpen={open}
                      buyers={buyers}
                      currentUserId={user?.id}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
              {count} open {count === 1 ? "request" : "requests"}
            </div>
          </div>
        )}
      </PageShell>

      <RequestSheet
        request={openRequest}
        now={now}
        index={index}
        total={count}
        onStep={(d) => {
          const to = filteredRequests[index + d];
          if (to) step(to.id);
        }}
        onClose={close}
        onOpenSor={openSor}
        buyers={buyers}
        currentUserId={user?.id}
      />
    </>
  );
}

export default function PurchasingQueuePage() {
  return (
    <ProtectedRoute requirePurchasing={true}>
      <PurchasingQueue />
    </ProtectedRoute>
  );
}
