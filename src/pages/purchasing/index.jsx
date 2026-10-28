import { useMemo, useState } from "react";
import QueryError from "@/components/ui/QueryError";
import { useQuery } from "@tanstack/react-query";
import { Hand, Layers, PackageSearch, Plus, UserRound } from "lucide-react";

import ProtectedRoute from "../../components/ProtectedRoute";
import PageShell from "../../components/ui/PageShell";
import EmptyState from "../../components/ui/EmptyState";
import Spinner from "../../components/ui/Spinner";
import TabGroup from "../../components/ui/TabGroup";
import FilterBar from "../../components/ui/FilterBar";
import { FilterSelect } from "../../components/ui/FilterDropdown";
import { Button } from "../../components/ui/button";
import { SortHead, Table, TableBody, TableCell, TableHeader, TableRow } from "../../components/ui/table";
import { TablePager } from "../../components/ui/TablePager";
import { useTableSort } from "../../hooks/useTableSort";
import { usePaging } from "../../hooks/usePaging";
import { useSavedFilters } from "../../hooks/useSavedFilters";
import { IdentityCell } from "../../components/purchasing/list/IdentityCell";
import { AwardedBadge } from "../../components/purchasing/AwardedBadge";
import { sorAwardService } from "../../services/sorAwardService";
import { StateCell, STATE_HEAD_CLASS } from "../../components/purchasing/list/StateCell";
import ExportButton from "../../components/purchasing/list/ExportButton";
import { listAge, listAgeDays, listDate } from "../../utils/listDates";
import { QUEUE_EXPORT_HEADER, REQUEST_STATE, REQUEST_STATE_TONES, queueExportRows, requestStateOf } from "../../components/purchase-request/queueList";
import StatusBadge from "../../components/StatusBadge";
import Avatar from "../../components/Avatar";
import PurchaseRequestModal from "../../components/purchase-request/PurchaseRequestModal";
import NewPurchaseRequestDialog from "../../components/purchase-request/NewPurchaseRequestDialog";
import { useTakeRequest } from "../../components/purchase-request/requestHooks";
import { procurementQueueKey } from "../../components/purchase-request/queryKeys";
import {
  QUEUE_BUYER,
  QUEUE_KIND,
  QUEUE_STATE,
  filterQueue,
  purchaseRequestService,
} from "../../services/purchaseRequestService";
import { salesFlowService } from "../../services/salesFlowService";
import { useAuth } from "../../context/AuthContext";
import { useRecordParam } from "../../hooks/useRecordParam";
import { useTableRealtime } from "../../hooks/useTableRealtime";
import { getPermissionContext } from "../../utils/permissions";
import {
  REQUEST_KIND,
  REQUEST_KIND_LABELS,
  requestIdentity,
  requestKind,
  requestStageLabel,
} from "../../constants/purchaseRequest";
import { flowStageTonesByName } from "../../constants/salesFlow";

/**
 * Purchase Requests (issue #308, spec #209; #179), a Queue page: every
 * Purchase Request the signed-in employee may read — all of them for
 * Purchasing, their own for everyone else — as a table, with the picked one
 * open in a slide-over beside it (`?request=`, where notifications link).
 * Anyone opens a Direct request (no SOR) from here.
 *
 * Pills slice by state (Open / Closed / All, with counts). For Purchasing, an
 * unassigned row offers Take right in the table. The filter bar searches and
 * narrows by Buyer (Any buyer / Unassigned / Mine, Purchasing only) and kind
 * (Project / Direct), saves them as a default, and exports the rows shown. A
 * request opens (`?request=`) in the record window at every width
 * (`PurchaseRequestModal`: Buyer, Requested Items, members, chat).
 */

const HEAD = "text-label font-bold uppercase tracking-wider";
const CHIP = "h-9 w-auto gap-2 px-2.5";
const CHIP_WRAPPER = "w-auto shrink-0";

const BUYER_OPTIONS = [
  { value: QUEUE_BUYER.ALL, label: "Any buyer" },
  { value: QUEUE_BUYER.UNASSIGNED, label: "Unassigned" },
  { value: QUEUE_BUYER.MINE, label: "Mine" },
];

// What "Save as default" remembers. Buyer only counts for Purchasing.
const FILTER_DEFAULTS = { state: QUEUE_STATE.OPEN, kind: QUEUE_KIND.ALL, buyer: QUEUE_BUYER.ALL };

const KIND_OPTIONS = [
  { value: QUEUE_KIND.ALL, label: "Project or Direct" },
  { value: REQUEST_KIND.PROJECT, label: REQUEST_KIND_LABELS[REQUEST_KIND.PROJECT] },
  { value: REQUEST_KIND.DIRECT, label: REQUEST_KIND_LABELS[REQUEST_KIND.DIRECT] },
];

const matches = (row, term) =>
  [row.pr_number, row.sales_reference, row.project_title, row.title, requestStageLabel(row), row.buyer_name].some((field) =>
    field?.toLowerCase().includes(term),
  );

/**
 * The SOR's Stage as the SOR list shows it: a flow Stage in its tone (looked up
 * by name, the only part of it the row carries), a legacy status by its code.
 */
function StageCell({ row, tones }) {
  const label = requestStageLabel(row);
  if (!label) return <span className="text-xs text-muted-foreground">—</span>;
  if (row.stage_name) return <StatusBadge label={label} theme={tones.get(row.stage_name) || "mauve"} title={label} />;
  return <StatusBadge label={label} status={row.sor_status} title={label} />;
}

// Stage, Progress, Last activity and Age hide below md so Request, Buyer and Status stay in view; the row sheet has the rest.
const NARROW_HIDDEN = new Set(["Stage", "Progress", "Last activity", "Age"]);

const REQUEST_SORT = {
  request: (r) => requestIdentity(r).title,
  stage: (r) => requestStageLabel(r),
  progress: (r) => (r.item_count ? (r.item_count - r.open_count) / r.item_count : null),
  buyer: (r) => r.buyer_name,
  "last-activity": (r) => new Date(r.last_activity_at || r.created_at).getTime(),
  age: (r) => listAgeDays(r.created_at),
  state: (r) => requestStateOf(r).label,
};
const AGE_STALE_DAYS = 7;

// One segment per item; a closed item is filled, an open one is not.
function ProgressCell({ row }) {
  if (!row.item_count) return <span className="text-xs text-muted-foreground">No items yet</span>;
  const done = row.item_count - row.open_count;
  return (
    <div className="w-full min-w-[8rem]">
      <div className="flex gap-0.5" aria-hidden="true">
        {Array.from({ length: row.item_count }, (_, i) => (
          <span key={i} className={`h-1 flex-1 rounded-full ${i < done ? "bg-green-9" : "bg-mauve-5"}`} />
        ))}
      </div>
      <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
        {done} of {row.item_count} done
      </p>
    </div>
  );
}

function AgeCell({ row }) {
  const days = listAgeDays(row.created_at);
  return (
    <span className={`text-xs font-medium tabular-nums ${days > AGE_STALE_DAYS ? "text-amber-11" : "text-muted-foreground"}`}>
      {listAge(row.created_at)}
    </span>
  );
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

function QueueRow({ row, selected, onOpen, canTake, stageTones, awardedOn }) {
  const { reference, title } = requestIdentity(row);
  const direct = requestKind(row) === REQUEST_KIND.DIRECT;
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
      {/* A Direct request is marked quietly: a hairline on the left and the word, never colour alone. */}
      <IdentityCell
        hairline={direct}
        reference={direct ? undefined : reference}
        word={direct ? reference : undefined}
        name={title}
      >
        {row.pr_number ? <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">{row.pr_number}</span> : null}
      </IdentityCell>
      <TableCell className="hidden md:table-cell">
        <StageCell row={row} tones={stageTones} />
        <AwardedBadge date={awardedOn} className="mt-1" />
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <ProgressCell row={row} />
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
      <TableCell className="hidden md:table-cell">
        <span className="text-xs tabular-nums text-muted-foreground">{listDate(row.last_activity_at || row.created_at)}</span>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <AgeCell row={row} />
      </TableCell>
      <StateCell {...requestStateOf(row)} tones={REQUEST_STATE_TONES} />
    </TableRow>
  );
}

function PurchaseRequests() {
  const { user } = useAuth();
  const { isSuperAdmin, hasPurchasingFlow } = getPermissionContext(user);
  const purchaser = isSuperAdmin || hasPurchasingFlow;
  const { recordId, open, close } = useRecordParam("request");

  const { initial, hasSavedDefault, saveDefault, clearDefault, isDirty } = useSavedFilters(
    "purchase_requests",
    user?.id,
    FILTER_DEFAULTS,
  );
  const [state, setState] = useState(initial.state);
  const [kind, setKind] = useState(initial.kind);
  const [buyerPick, setBuyer] = useState(initial.buyer);
  // Only Purchasing has Buyers to slice by; everyone else sees all of theirs.
  const buyer = purchaser ? buyerPick : QUEUE_BUYER.ALL;
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  // Every item, member and Buyer change posts a message, so this one signal
  // keeps the list (and any request open beside it) current.
  useTableRealtime("purchase_request_messages", {
    invalidateKeys: [procurementQueueKey],
    debounceMs: 500,
  });

  const { data: rows = [], isLoading, isError, refetch } = useQuery({
    queryKey: procurementQueueKey,
    queryFn: () => purchaseRequestService.listQueue(),
  });
  // Every flow's Stages, shared with the SOR list's cache, to colour the Stage column.
  const { data: flowStagesIndex } = useQuery({
    queryKey: ["allFlowStagesIndex"],
    queryFn: () => salesFlowService.getAllStagesIndex(),
  });
  const stageTones = useMemo(() => flowStageTonesByName(flowStagesIndex), [flowStagesIndex]);
  // #746: the Date of Award of each request's SOR, for the "Awarded" badge.
  const sorIds = useMemo(() => [...new Set(rows.map((r) => r.opportunity_id).filter(Boolean))].sort(), [rows]);
  const { data: awards } = useQuery({
    queryKey: ["purchase-request", "awards", sorIds],
    queryFn: () => sorAwardService.forSors(sorIds),
    enabled: sorIds.length > 0,
  });

  // Search, kind and Buyer narrow first; the Open / Closed / All pills count within that.
  const narrowed = useMemo(() => {
    const term = search.trim().toLowerCase();
    return filterQueue(rows, { kind, buyer }, user?.id).filter((r) => !term || matches(r, term));
  }, [rows, kind, buyer, search, user?.id]);
  const filtered = useMemo(() => filterQueue(narrowed, { state }), [narrowed, state]);
  const { sorted: visible, sort, toggle } = useTableSort(filtered, REQUEST_SORT);
  const paging = usePaging(visible);
  const counts = {
    [QUEUE_STATE.OPEN]: filterQueue(narrowed, { state: QUEUE_STATE.OPEN }).length,
    [QUEUE_STATE.CLOSED]: filterQueue(narrowed, { state: QUEUE_STATE.CLOSED }).length,
    [QUEUE_STATE.ALL]: narrowed.length,
  };
  const exportRows = useMemo(() => queueExportRows(visible), [visible]);

  const filters = { state, kind, buyer: buyerPick };
  const hasActiveFilters =
    search !== "" || state !== FILTER_DEFAULTS.state || kind !== FILTER_DEFAULTS.kind || (purchaser && buyerPick !== FILTER_DEFAULTS.buyer);

  const toolbar = (
    <>
      <TabGroup
        variant="pill"
        size="sm"
        activeTab={state}
        onChange={setState}
        tabs={[
          { value: QUEUE_STATE.OPEN, label: "Open", badge: counts[QUEUE_STATE.OPEN] },
          { value: QUEUE_STATE.CLOSED, label: "Closed", badge: counts[QUEUE_STATE.CLOSED] },
          { value: QUEUE_STATE.ALL, label: "All", badge: counts[QUEUE_STATE.ALL] },
        ]}
      />
      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: "Search requests" }}
        chips={
          <>
            {purchaser && (
              <FilterSelect
                icon={UserRound}
                label="Buyer"
                options={BUYER_OPTIONS}
                value={buyerPick}
                onChange={setBuyer}
                allValue={QUEUE_BUYER.ALL}
                className={CHIP}
                wrapperClassName={CHIP_WRAPPER}
              />
            )}
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
          setState(FILTER_DEFAULTS.state);
          setKind(FILTER_DEFAULTS.kind);
          setBuyer(FILTER_DEFAULTS.buyer);
        }}
        saveDefault={{
          hasSavedDefault,
          isDirty: isDirty(filters),
          onSave: () => saveDefault(filters),
          onClear: clearDefault,
        }}
        actions={
          <ExportButton name="purchase-requests" sheetName="Purchase Requests" header={QUEUE_EXPORT_HEADER} rows={exportRows} />
        }
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
          <QueryError title="Purchase Requests could not be loaded." onRetry={refetch} />
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
              <Table tableId="purchasing" className="md:min-w-[52rem]">
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    {["Request", "Stage", "Progress", "Buyer", "Last activity", "Age", "State"].map((heading) => (
                      <SortHead
                        key={heading}
                        id={heading.toLowerCase().replace(/[^a-z0-9]+/g, "-")}
                        sortKey={heading.toLowerCase().replace(/[^a-z0-9]+/g, "-")}
                        sort={sort}
                        onSort={toggle}
                        className={`${HEAD} ${heading === "State" ? STATE_HEAD_CLASS : ""} ${NARROW_HIDDEN.has(heading) ? "hidden md:table-cell" : ""}`}
                      >
                        {heading}
                      </SortHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paging.rows.map((row) => (
                    <QueueRow
                      key={row.id}
                      row={row}
                      selected={String(row.id) === recordId}
                      onOpen={open}
                      canTake={purchaser}
                      stageTones={stageTones}
                      awardedOn={awards?.get(row.opportunity_id)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
            <TablePager {...paging} noun="requests" />
          </div>
        )}
      </PageShell>

      {recordId && <PurchaseRequestModal requestId={recordId} onClose={close} />}

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
