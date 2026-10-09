import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleDot, Hand, Layers, PackageSearch, Plus } from "lucide-react";

import ProtectedRoute from "../../components/ProtectedRoute";
import PageShell from "../../components/ui/PageShell";
import EmptyState from "../../components/ui/EmptyState";
import Spinner from "../../components/ui/Spinner";
import TabGroup from "../../components/ui/TabGroup";
import FilterBar from "../../components/ui/FilterBar";
import { FilterSelect } from "../../components/ui/FilterDropdown";
import SlideOver, { SlideOverBody, SlideOverFooter } from "../../components/ui/SlideOver";
import { Button } from "../../components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import StatusBadge from "../../components/StatusBadge";
import Avatar from "../../components/Avatar";
import PurchaseRequestView from "../../components/purchase-request/PurchaseRequestView";
import NewPurchaseRequestDialog from "../../components/purchase-request/NewPurchaseRequestDialog";
import RequestBuyer from "../../components/purchase-request/RequestBuyer";
import { useTakeRequest } from "../../components/purchase-request/requestHooks";
import { procurementQueueKey } from "../../components/purchase-request/queryKeys";
import {
  QUEUE_BUYER,
  QUEUE_KIND,
  QUEUE_STATE,
  filterQueue,
  isRequestClosed,
  purchaseRequestService,
} from "../../services/purchaseRequestService";
import { useAuth } from "../../context/AuthContext";
import { useRecordParam } from "../../hooks/useRecordParam";
import { useTableRealtime } from "../../hooks/useTableRealtime";
import { getPermissionContext } from "../../utils/permissions";
import { formatDate } from "../../utils/formatDate.js";
import {
  REQUEST_KIND,
  REQUEST_KIND_LABELS,
  requestIdentity,
  requestKind,
  requestStageLabel,
  sorClosedLabel,
} from "../../constants/purchaseRequest";

/**
 * Purchase Requests (issue #308, spec #209; #179), a Queue page: every
 * Purchase Request the signed-in employee may read — all of them for
 * Purchasing, their own for everyone else — as a table, with the picked one
 * open in a slide-over beside it (`?request=`, where notifications link).
 * Anyone opens a Direct request (no SOR) from here.
 *
 * For Purchasing, level-2 pills slice by Buyer (unassigned / mine / all) and
 * an unassigned row offers Take right in the table. The filter bar narrows by
 * open or closed and by kind (Project / Direct), and searches. The slide-over
 * holds the whole request (`PurchaseRequestView`: members, Requested Items,
 * chat) with the Buyer pinned in its footer.
 */

const HEAD = "text-[10px] font-bold uppercase tracking-wider";
const CHIP = "h-9 w-auto gap-2 px-2.5";
const CHIP_WRAPPER = "w-auto shrink-0";

const STATE_OPTIONS = [
  { value: QUEUE_STATE.OPEN, label: "Open" },
  { value: QUEUE_STATE.CLOSED, label: "Closed" },
  { value: QUEUE_STATE.ALL, label: "Open or closed" },
];

const KIND_OPTIONS = [
  { value: QUEUE_KIND.ALL, label: "Project or Direct" },
  { value: REQUEST_KIND.PROJECT, label: REQUEST_KIND_LABELS[REQUEST_KIND.PROJECT] },
  { value: REQUEST_KIND.DIRECT, label: REQUEST_KIND_LABELS[REQUEST_KIND.DIRECT] },
];

const matches = (row, term) =>
  [row.sales_reference, row.project_title, row.title, requestStageLabel(row), row.buyer_name].some((field) =>
    field?.toLowerCase().includes(term),
  );

function RequestState({ row }) {
  if (isRequestClosed(row)) return <StatusBadge theme="green" label="Closed" />;
  const sorClosed = sorClosedLabel(row.sor_closed);
  if (sorClosed) return <StatusBadge theme="red" label={sorClosed} />;
  return <StatusBadge theme="amber" label="Open" />;
}

function itemsSummary(row) {
  if (!row.item_count) return "No items yet";
  return `${row.open_count} open of ${row.item_count}`;
}

function TakeButton({ requestId }) {
  const take = useTakeRequest(requestId);
  return (
    <Button
      size="xs"
      variant="outline"
      onClick={(e) => {
        e.stopPropagation();
        take.mutate();
      }}
      onKeyDown={(e) => e.stopPropagation()}
      disabled={take.isPending}
      className="gap-1"
    >
      {take.isPending ? <Spinner size="sm" /> : <Hand size={12} />}
      Take
    </Button>
  );
}

function QueueRow({ row, selected, onOpen, canTake }) {
  const { reference, title } = requestIdentity(row);
  return (
    <TableRow
      tabIndex={0}
      aria-selected={selected}
      data-testid="queue-row"
      onClick={() => onOpen(row.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) {
          e.preventDefault();
          onOpen(row.id);
        }
      }}
      className="group cursor-pointer outline-none focus-visible:bg-muted aria-selected:bg-muted/60"
    >
      <TableCell>
        {requestKind(row) === REQUEST_KIND.DIRECT ? (
          <StatusBadge theme="blue" label={reference} />
        ) : (
          <span className="block font-mono text-xs font-semibold text-foreground">{reference}</span>
        )}
        <span className="mt-0.5 block max-w-[22rem] truncate text-sm text-foreground">{title}</span>
      </TableCell>
      <TableCell>
        <span className="text-xs text-muted-foreground">{requestStageLabel(row) || "—"}</span>
      </TableCell>
      <TableCell>
        <span className="text-xs font-medium tabular-nums text-foreground">{itemsSummary(row)}</span>
      </TableCell>
      <TableCell>
        {row.buyer_id ? (
          <div className="flex items-center gap-2">
            <Avatar src={row.buyer_avatar_path} name={row.buyer_name} size="xs" />
            <span className="truncate text-xs font-medium text-foreground">{row.buyer_name}</span>
          </div>
        ) : canTake ? (
          <TakeButton requestId={row.id} />
        ) : (
          <span className="text-xs text-muted-foreground">Unassigned</span>
        )}
      </TableCell>
      <TableCell>
        <span className="text-xs tabular-nums text-muted-foreground">{formatDate(row.last_activity_at || row.created_at)}</span>
      </TableCell>
      <TableCell className="text-right">
        <RequestState row={row} />
      </TableCell>
    </TableRow>
  );
}

const sheetIdentity = (row) => ({
  ref: requestIdentity(row).reference,
  title: requestIdentity(row).title,
  badge: <RequestState row={row} />,
  subtitle: [requestStageLabel(row), itemsSummary(row)].filter(Boolean).join(" · "),
});

function PurchaseRequests() {
  const { user } = useAuth();
  const { isSuperAdmin, hasPurchasingFlow } = getPermissionContext(user);
  const purchaser = isSuperAdmin || hasPurchasingFlow;
  const { recordId, open, step, close } = useRecordParam("request");

  const [buyerPill, setBuyer] = useState(QUEUE_BUYER.ALL);
  // Only Purchasing has Buyers to slice by; everyone else sees all of theirs.
  const buyer = purchaser ? buyerPill : QUEUE_BUYER.ALL;
  const [state, setState] = useState(QUEUE_STATE.OPEN);
  const [kind, setKind] = useState(QUEUE_KIND.ALL);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  // Every item, member and Buyer change posts a message, so this one signal
  // keeps the list (and any request open beside it) current.
  useTableRealtime("purchase_request_messages", {
    invalidateKeys: [procurementQueueKey],
    debounceMs: 500,
  });

  const { data: rows = [], isLoading, isError, error } = useQuery({
    queryKey: procurementQueueKey,
    queryFn: () => purchaseRequestService.listQueue(),
  });

  // Search, open/closed and kind narrow first; the pills count within that.
  const scoped = useMemo(() => {
    const term = search.trim().toLowerCase();
    return filterQueue(rows, { state, kind }).filter((r) => !term || matches(r, term));
  }, [rows, state, kind, search]);
  const visible = useMemo(() => filterQueue(scoped, { buyer }, user?.id), [scoped, buyer, user?.id]);
  const counts = {
    [QUEUE_BUYER.UNASSIGNED]: filterQueue(scoped, { buyer: QUEUE_BUYER.UNASSIGNED }).length,
    [QUEUE_BUYER.MINE]: filterQueue(scoped, { buyer: QUEUE_BUYER.MINE }, user?.id).length,
    [QUEUE_BUYER.ALL]: scoped.length,
  };

  // The open request may sit outside the current slice (a notification's
  // link, or a request just taken off "Unassigned"): it stays open, without
  // stepping.
  const openRow = rows.find((r) => String(r.id) === recordId) || null;
  const index = visible.findIndex((r) => String(r.id) === recordId);
  const stepping = index >= 0;

  const hasActiveFilters = search !== "" || state !== QUEUE_STATE.OPEN || kind !== QUEUE_KIND.ALL;

  const toolbar = (
    <>
      {purchaser && (
        <TabGroup
          variant="pill"
          size="sm"
          activeTab={buyer}
          onChange={setBuyer}
          tabs={[
            { value: QUEUE_BUYER.UNASSIGNED, label: "Unassigned", badge: counts[QUEUE_BUYER.UNASSIGNED] },
            { value: QUEUE_BUYER.MINE, label: "Mine", badge: counts[QUEUE_BUYER.MINE] },
            { value: QUEUE_BUYER.ALL, label: "All", badge: counts[QUEUE_BUYER.ALL] },
          ]}
        />
      )}
      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: "Search requests" }}
        chips={
          <>
            <FilterSelect
              icon={CircleDot}
              label="Status"
              options={STATE_OPTIONS}
              value={state}
              onChange={setState}
              allValue={QUEUE_STATE.OPEN}
              className={CHIP}
              wrapperClassName={CHIP_WRAPPER}
            />
            <FilterSelect
              icon={Layers}
              label="Kind"
              options={KIND_OPTIONS}
              value={kind}
              onChange={setKind}
              allValue={QUEUE_KIND.ALL}
              className={CHIP}
              wrapperClassName={CHIP_WRAPPER}
            />
          </>
        }
        hasActiveFilters={hasActiveFilters}
        onClearAll={() => {
          setSearch("");
          setState(QUEUE_STATE.OPEN);
          setKind(QUEUE_KIND.ALL);
        }}
      />
    </>
  );

  return (
    <>
      <PageShell
        title="Purchase Requests"
        description={
          purchaser
            ? "Every Purchase Request: take one, work its items, talk it through."
            : "Ask Purchasing to buy something, and follow your requests here."
        }
        action={
          <Button size="sm" onClick={() => setCreating(true)} className="gap-1.5">
            <Plus size={14} />
            New Purchase Request
          </Button>
        }
        toolbar={toolbar}
      >
        {isLoading && (
          <div className="flex justify-center py-20">
            <Spinner />
          </div>
        )}

        {isError && (
          <div className="rounded-xl border border-red-6 bg-red-a2 px-5 py-8 text-center">
            <p className="text-sm font-semibold text-red-11">Purchase Requests could not be loaded.</p>
            <p className="mt-1 text-xs text-muted-foreground">{error?.message}</p>
          </div>
        )}

        {!isLoading && !isError && visible.length === 0 && (
          <EmptyState
            icon={PackageSearch}
            title={rows.length === 0 ? "No Purchase Requests yet" : "No matching requests"}
            description={
              rows.length === 0
                ? "Need something bought? Open a Purchase Request and Purchasing takes it from there."
                : "Nothing in this slice. Try another tab or clear the filters."
            }
          />
        )}

        {!isLoading && !isError && visible.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="overflow-x-auto">
              <Table className="min-w-[52rem]">
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    {["Request", "Stage", "Items", "Buyer", "Last activity", "Status"].map((heading) => (
                      <TableHead key={heading} className={`${HEAD} ${heading === "Status" ? "text-right" : ""}`}>
                        {heading}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((row) => (
                    <QueueRow
                      key={row.id}
                      row={row}
                      selected={String(row.id) === recordId}
                      onOpen={open}
                      canTake={purchaser}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
              {visible.length} {visible.length === 1 ? "request" : "requests"}
            </div>
          </div>
        )}
      </PageShell>

      <SlideOver
        record={openRow}
        icon={PackageSearch}
        crumb="Purchase Requests"
        identity={sheetIdentity}
        index={stepping ? index : 0}
        total={stepping ? visible.length : 1}
        onStep={(d) => {
          const to = visible[index + d];
          if (to) step(to.id);
        }}
        onClose={close}
        onOpenFull={(row) => {
          window.dispatchEvent(
            new CustomEvent("OPEN_ENTITY_DETAILS", {
              detail: { id: row.id, type: "PURCHASE_REQUEST" },
            }),
          );
        }}
        openFullLabel="Open full screen"
      >
        {(row) => (
          <>
            <SlideOverBody>
              <PurchaseRequestView requestId={row.id} hideBuyer />
            </SlideOverBody>
            <SlideOverFooter>
              <RequestBuyer request={row} />
            </SlideOverFooter>
          </>
        )}
      </SlideOver>

      <NewPurchaseRequestDialog open={creating} onOpenChange={setCreating} onOpened={open} />
    </>
  );
}

// Every employee: a request is read by its members and Purchasing (the
// database decides), and anyone may open one.
export default function PurchaseRequestsPage() {
  return (
    <ProtectedRoute>
      <PurchaseRequests />
    </ProtectedRoute>
  );
}
