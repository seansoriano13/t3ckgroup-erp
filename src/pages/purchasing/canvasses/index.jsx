import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useSearchParams } from "react-router";
import {
  Link2,
  Lock,
  Scale,
  Trophy,
  UserRound,
  FileText,
} from "lucide-react";

import PageShell from "../../../components/ui/PageShell";
import EmptyState from "../../../components/ui/EmptyState";
import PageLoading from "../../../components/ui/PageLoading";
import QueryError from "../../../components/ui/QueryError";
import FilterBar from "../../../components/ui/FilterBar";
import TabGroup from "../../../components/ui/TabGroup";
import { FilterSelect } from "../../../components/ui/FilterDropdown";
import { Button } from "../../../components/ui/button";
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
import CanvassPanel from "../../../components/CanvassPanel";
import CanvassRequestBadge from "../../../components/CanvassRequestBadge";
import { useAuth } from "../../../context/AuthContext";
import { canvassService } from "../../../services/canvassService";
import { CANVASS_LIST_KEY } from "../../../constants/canvass";
import {
  ANY,
  CANVASS_EXPORT_HEADER,
  CANVASS_STATE,
  CANVASS_STATE_TONES,
  LINKED_FILTER,
  REQUEST_FILTER,
  WINNER_FILTER,
  canvassExportRows,
  canvassRequestState,
  canvassStateOf,
  canvassSubjectLabel,
  canvassWinnerLabel,
  filterCanvasses,
} from "../../../utils/canvassList";
import { getPermissionContext } from "../../../utils/permissions";

/**
 * The Canvasses page (ADR 0034, #566): every Canvass in one place, project ones on a Costing
 * Matrix Component included. A row opens that Canvass in the Canvass panel. The database limits
 * which rows a person gets; names only, no money.
 */

const WINNER = [
  { value: ANY, label: "Winner or not" },
  { value: WINNER_FILTER.YES, label: "Has a winner" },
  { value: WINNER_FILTER.NO, label: "No winner" },
];
const LINKED = [
  { value: ANY, label: "Linked or not" },
  { value: LINKED_FILTER.LINKED, label: "On a Component or item" },
  { value: LINKED_FILTER.FREE, label: "Not linked" },
];

const REQUEST = [
  { value: ANY, label: "Any request" },
  { value: REQUEST_FILTER.NOT_YET, label: "Not requested yet" },
  { value: REQUEST_FILTER.CREATED, label: "Request created" },
];

const HEAD = "text-label font-bold uppercase tracking-wider";
const CHIP = "h-9 w-auto gap-2 px-2.5";
const CHIP_WRAPPER = "w-auto shrink-0";

const HEADINGS = [
  ["canvass", "Canvass"],
  ["canvasser", "Canvasser"],
  ["winner", "Winner"],
  ["request", "Request"],
  ["state", "State"],
];

const CANVASS_SORT = {
  canvass: (r) => r.number,
  canvasser: (r) => r.canvasserName,
  winner: (r) => (r.winner ? canvassWinnerLabel(r) : null),
  request: (r) => canvassRequestState(r)?.label,
  state: (r) => canvassStateOf(r).label,
};

function CanvassesPage({ userId, canEdit }) {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [canvasserId, setCanvasserId] = useState(ANY);
  const [state, setState] = useState(CANVASS_STATE.OPEN);
  const [winner, setWinner] = useState(ANY);
  const [linked, setLinked] = useState(ANY);
  const [request, setRequest] = useState(ANY);

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

  // Search and the dropdowns narrow first; the Open / Winner picked / Signed off / All pills count within that.
  const narrowed = useMemo(
    () =>
      filterCanvasses(rows, { search, canvasserId, winner, linked, request }),
    [rows, search, canvasserId, winner, linked, request],
  );
  const countOf = (pill) => filterCanvasses(narrowed, { state: pill }).length;
  const counts = {
    [CANVASS_STATE.OPEN]: countOf(CANVASS_STATE.OPEN),
    [CANVASS_STATE.WON]: countOf(CANVASS_STATE.WON),
    [CANVASS_STATE.SIGNED]: countOf(CANVASS_STATE.SIGNED),
    [CANVASS_STATE.ALL]: narrowed.length,
  };
  // Signed off is history on old records: its pill shows only while some old Canvass carries it.
  const hasSignedHistory = rows.some((r) => r.signedOffAt);
  const shown = useMemo(
    () => (state === CANVASS_STATE.ALL ? narrowed : filterCanvasses(narrowed, { state })),
    [narrowed, state],
  );
  const { sorted: visible, sort, toggle } = useTableSort(shown, CANVASS_SORT);
  const paging = usePaging(visible);
  const exportRows = useMemo(() => canvassExportRows(visible), [visible]);

  const active =
    Boolean(search) ||
    canvasserId !== ANY ||
    state !== CANVASS_STATE.OPEN ||
    winner !== ANY ||
    linked !== ANY ||
    request !== ANY;
  const clearAll = () => {
    setSearch("");
    setCanvasserId(ANY);
    setState(CANVASS_STATE.OPEN);
    setWinner(ANY);
    setLinked(ANY);
    setRequest(ANY);
  };

  // The open Canvass is in the address: ?canvass=<id>.
  const canvassParam = params.get("canvass");
  const openRow = useMemo(
    () => (canvassParam && rows.find((r) => r.id === canvassParam)) || null,
    [canvassParam, rows],
  );
  const ready = !isLoading && !isError;
  const openCanvass = (id) => setParams({ canvass: id });
  return (
    <PageShell
      title="Canvasses"
      description="Every Canvass in one place, project ones included. Open one to see its Offers."
      toolbar={
        ready ? (
          <>
            <TabGroup
              variant="pill"
              size="sm"
              activeTab={state}
              onChange={setState}
              tabs={[
                {
                  value: CANVASS_STATE.OPEN,
                  label: "Open",
                  badge: counts[CANVASS_STATE.OPEN],
                },
                {
                  value: CANVASS_STATE.WON,
                  label: "Winner picked",
                  badge: counts[CANVASS_STATE.WON],
                },
                ...(hasSignedHistory
                  ? [
                      {
                        value: CANVASS_STATE.SIGNED,
                        label: "Signed off",
                        badge: counts[CANVASS_STATE.SIGNED],
                      },
                    ]
                  : []),
                {
                  value: CANVASS_STATE.ALL,
                  label: "All",
                  badge: counts[CANVASS_STATE.ALL],
                },
              ]}
            />
            <FilterBar
              search={{
                value: search,
                onChange: setSearch,
                placeholder: "Search Canvasses",
              }}
              chips={
                <>
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
                  <FilterSelect
                    icon={Trophy}
                    options={WINNER}
                    value={winner}
                    onChange={setWinner}
                    label="Winner"
                    allValue={ANY}
                    className={CHIP}
                    wrapperClassName={CHIP_WRAPPER}
                  />
                  <FilterSelect
                    icon={FileText}
                    options={REQUEST}
                    value={request}
                    onChange={setRequest}
                    label="Request"
                    allValue={ANY}
                    className={CHIP}
                    wrapperClassName={CHIP_WRAPPER}
                  />
                </>
              }
              filters={
                <FilterSelect
                  icon={Link2}
                  options={LINKED}
                  value={linked}
                  onChange={setLinked}
                  label="Linked"
                  allValue={ANY}
                />
              }
              activeCount={linked !== ANY ? 1 : 0}
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
          description="A Canvass starts on a product line of a project, or on a line of a Direct request, when its first Offer is saved."
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
            <Table tableId="canvasses" className="md:min-w-[44rem]">
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  {HEADINGS.map(([key, heading]) => (
                    <SortHead
                      key={key}
                      id={key}
                      sortKey={key}
                      sort={sort}
                      onSort={toggle}
                      className={`${HEAD} ${key === "state" ? STATE_HEAD_CLASS : ""}`}
                    >
                      {heading}
                    </SortHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {paging.rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-testid="canvass-row"
                    tabIndex={0}
                    aria-label={`Open Canvass ${row.number}`}
                    className="cursor-pointer outline-none focus-visible:bg-muted"
                    onClick={() => openCanvass(row.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && e.target === e.currentTarget) {
                        e.preventDefault();
                        openCanvass(row.id);
                      }
                    }}
                  >
                    <TableCell>
                      <div className="flex items-start gap-2.5">
                        <div className="min-w-0">
                          <IdentityText
                            reference={
                              <>
                                {row.number}
                                {row.locked && (
                                  <Lock
                                    size={12}
                                    className="ml-1.5 inline text-muted-foreground"
                                    aria-label="Locked"
                                    role="img"
                                  />
                                )}
                              </>
                            }
                            name={canvassSubjectLabel(row)}
                          />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{row.canvasserName ?? "—"}</TableCell>
                    <TableCell>
                      {canvassWinnerLabel(row)}
                      <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
                        {row.offerCount} offer{row.offerCount === 1 ? "" : "s"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <CanvassRequestBadge source={row} />
                    </TableCell>
                    <StateCell
                      {...canvassStateOf(row)}
                      tones={CANVASS_STATE_TONES}
                    />
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <TablePager {...paging} noun="canvasses" />
        </div>
      )}

      {openRow && (
        <CanvassPanel
          open
          onOpenChange={(next) => !next && setParams({})}
          subject={{ canvassId: openRow.id }}
          subjectLabel={canvassSubjectLabel(openRow) || openRow.number}
          userId={userId}
          canEdit={canEdit}
          opportunityId={openRow.opportunityId ?? undefined}
          canvasserName={openRow.canvasserName ?? undefined}
        />
      )}
    </PageShell>
  );
}

/** Any signed-in employee may open a Canvass behind a Requested Item; only Purchasing and Super Admins edit. */
export default function CanvassesRoute() {
  const { user, isAuthLoading } = useAuth();
  if (isAuthLoading) return <PageLoading label="Canvasses" />;
  const ctx = getPermissionContext(user);
  if (!user) return <Navigate to="/" replace />;
  return (
    <CanvassesPage
      userId={user.id}
      canEdit={Boolean(ctx.isSuperAdmin || ctx.hasPurchasingFlow)}
    />
  );
}
