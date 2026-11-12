import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useNavigate } from "react-router";
import { Lock, Scale, UserRound } from "lucide-react";

import PageShell from "../../../components/ui/PageShell";
import EmptyState from "../../../components/ui/EmptyState";
import PageLoading from "../../../components/ui/PageLoading";
import QueryError from "../../../components/ui/QueryError";
import FilterBar from "../../../components/ui/FilterBar";
import TabGroup from "../../../components/ui/TabGroup";
import { FilterSelect } from "../../../components/ui/FilterDropdown";
import {
  SortHead,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";
import { TablePager } from "../../../components/ui/TablePager";
import { useTableSort } from "../../../hooks/useTableSort";
import { usePaging } from "../../../hooks/usePaging";
import { IdentityText } from "../../../components/purchasing/list/IdentityCell";
import {
  StateCell,
  STATE_HEAD_CLASS,
} from "../../../components/purchasing/list/StateCell";
import ExportButton from "../../../components/purchasing/list/ExportButton";
import { useAuth } from "../../../context/AuthContext";
import { canvassService } from "../../../services/canvassService";
import { CANVASS_LIST_KEY } from "../../../constants/canvass";
import { formatDate } from "../../../utils/formatDate";
import {
  ANY,
  CANVASS_EXPORT_HEADER,
  CANVASS_STATUS,
  CANVASS_STATUS_LABELS,
  CANVASS_STATUS_TONES,
  canvassExportRows,
  canvassHref,
  canvassLocked,
  canvassProjectLabel,
  canvassStatusOf,
  canvassWinnersLabel,
  filterCanvasses,
} from "../../../utils/canvassList";

/**
 * The Canvasses page (#973, spec #956): one row per Canvass, which is one per Purchase Request.
 * A row opens the request with its Canvass grid open, the same grid as on the request. The page
 * starts nothing: a Canvass is started from its request. The database limits which rows a person
 * gets; names and counts only, no money.
 */

const HEAD = "text-label font-bold uppercase tracking-wider";
const CHIP = "h-9 w-auto gap-2 px-2.5";
const CHIP_WRAPPER = "w-auto shrink-0";

// The third item is the column's place on a phone card (Table `stackOnPhone`).
const HEADINGS = [
  ["canvass", "Canvass", "title"],
  ["project", "Project", "meta"],
  ["canvasser", "Canvasser", "meta"],
  ["suppliers", "Suppliers", "meta"],
  ["winners", "Winners", "meta"],
  ["changed", "Last changed", "meta"],
  ["status", "Status", "badge"],
];

const CANVASS_SORT = {
  canvass: (r) => r.number,
  project: (r) => canvassProjectLabel(r),
  canvasser: (r) => r.canvasserName,
  suppliers: (r) => r.supplierCount,
  winners: (r) => r.winnerCount,
  changed: (r) => r.updatedAt ?? r.createdAt,
  status: (r) => canvassStatusOf(r).label,
};

const STATUS_PILLS = [
  CANVASS_STATUS.NEEDS_SUPPLIERS,
  CANVASS_STATUS.NEEDS_WINNERS,
  CANVASS_STATUS.WINNERS_PICKED,
];

function CanvassesPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [canvasserId, setCanvasserId] = useState(ANY);
  const [status, setStatus] = useState(ANY);

  const {
    data: rows = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: CANVASS_LIST_KEY,
    queryFn: () => canvassService.list(),
  });

  const canvassers = useMemo(() => {
    const seen = new Map(
      rows
        .filter((r) => r.canvasserId)
        .map((r) => [r.canvasserId, r.canvasserName ?? "Unknown"]),
    );
    return [
      { value: ANY, label: "Any Canvasser" },
      ...[...seen]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ];
  }, [rows]);

  // Search and the Canvasser narrow first; the status pills count within that.
  const narrowed = useMemo(
    () => filterCanvasses(rows, { search, canvasserId }),
    [rows, search, canvasserId],
  );
  const shown = useMemo(
    () => (status === ANY ? narrowed : filterCanvasses(narrowed, { status })),
    [narrowed, status],
  );
  const { sorted: visible, sort, toggle } = useTableSort(shown, CANVASS_SORT);
  const paging = usePaging(visible);
  const exportRows = useMemo(() => canvassExportRows(visible), [visible]);

  const active = Boolean(search) || canvasserId !== ANY || status !== ANY;
  const clearAll = () => {
    setSearch("");
    setCanvasserId(ANY);
    setStatus(ANY);
  };

  const ready = !isLoading && !isError;
  const openCanvass = (row) => navigate(canvassHref({ requestId: row.requestId }));
  return (
    <PageShell
      title="Canvasses"
      description="One Canvass per Purchase Request. Open one to see its grid; a Canvass is started from its request."
      toolbar={
        ready ? (
          <>
            <TabGroup
              variant="pill"
              size="sm"
              activeTab={status}
              onChange={setStatus}
              tabs={[
                { value: ANY, label: "All", badge: narrowed.length },
                ...STATUS_PILLS.map((value) => ({
                  value,
                  label: CANVASS_STATUS_LABELS[value],
                  badge: filterCanvasses(narrowed, { status: value }).length,
                })),
              ]}
            />
            <FilterBar
              search={{
                value: search,
                onChange: setSearch,
                placeholder: "Search number, request, supplier or product",
              }}
              chips={
                <FilterSelect
                  icon={UserRound}
                  options={canvassers}
                  value={canvasserId}
                  onChange={setCanvasserId}
                  label="Canvasser"
                  allValue={ANY}
                  className={CHIP}
                  wrapperClassName={CHIP_WRAPPER}
                />
              }
              hasActiveFilters={active}
              onClearAll={clearAll}
              actions={
                <ExportButton
                  name="canvasses"
                  sheetName="Canvasses"
                  header={CANVASS_EXPORT_HEADER}
                  rows={exportRows}
                />
              }
            />
          </>
        ) : null
      }
    >
      {isLoading && <PageLoading label="Canvasses" />}
      {isError && (
        <QueryError
          title="The Canvasses could not be loaded."
          onRetry={refetch}
        />
      )}

      {ready && rows.length === 0 && (
        <EmptyState
          icon={Scale}
          title="No Canvasses yet"
          description="A Canvass starts on its Purchase Request, when the first supplier is added."
        />
      )}
      {ready && rows.length > 0 && shown.length === 0 && (
        <EmptyState
          icon={Scale}
          title="No Canvass matches"
          description="Try clearing a filter."
        />
      )}

      {ready && shown.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <Table tableId="canvasses" stackOnPhone className="md:min-w-[52rem]">
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  {HEADINGS.map(([key, heading, phone]) => (
                    <SortHead
                      key={key}
                      phone={phone}
                      id={key}
                      sortKey={key}
                      sort={sort}
                      onSort={toggle}
                      className={`${HEAD} ${key === "status" ? STATE_HEAD_CLASS : ""}`}
                    >
                      {heading}
                    </SortHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {paging.rows.map((row) => {
                  const rowStatus = canvassStatusOf(row);
                  return (
                    <TableRow
                      key={row.id}
                      data-testid="canvass-row"
                      tabIndex={0}
                      aria-label={`Open Canvass ${row.number}`}
                      className="cursor-pointer outline-none focus-visible:bg-muted"
                      onClick={() => openCanvass(row)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && e.target === e.currentTarget) {
                          e.preventDefault();
                          openCanvass(row);
                        }
                      }}
                    >
                      <TableCell>
                        <IdentityText
                          reference={
                            <>
                              {row.number}
                              {canvassLocked(row) && (
                                <Lock
                                  size={12}
                                  className="ml-1.5 inline text-muted-foreground"
                                  aria-label="Locked"
                                  role="img"
                                />
                              )}
                            </>
                          }
                          name={row.requestLabel ?? "Purchase Request"}
                        />
                      </TableCell>
                      <TableCell>{canvassProjectLabel(row)}</TableCell>
                      <TableCell>{row.canvasserName ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">{row.supplierCount}</TableCell>
                      <TableCell className="tabular-nums">{canvassWinnersLabel(row)}</TableCell>
                      <TableCell className="tabular-nums">
                        {formatDate(row.updatedAt ?? row.createdAt)}
                      </TableCell>
                      <StateCell
                        state={rowStatus.state}
                        label={rowStatus.label}
                        tones={CANVASS_STATUS_TONES}
                      />
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <TablePager {...paging} noun="canvasses" />
        </div>
      )}
    </PageShell>
  );
}

/** Any signed-in employee may open the list; the database decides which Canvasses they get. */
export default function CanvassesRoute() {
  const { user, isAuthLoading } = useAuth();
  if (isAuthLoading) return <PageLoading label="Canvasses" />;
  if (!user) return <Navigate to="/" replace />;
  return <CanvassesPage />;
}
