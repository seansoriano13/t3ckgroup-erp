import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { Flag, Hourglass, Plus, ReceiptText } from "lucide-react";

import ProtectedRoute from "../../../components/ProtectedRoute";
import PageShell from "../../../components/ui/PageShell";
import EmptyState from "../../../components/ui/EmptyState";
import QueryError from "../../../components/ui/QueryError";
import PageLoading from "../../../components/ui/PageLoading";
import TabGroup from "../../../components/ui/TabGroup";
import { Button } from "../../../components/ui/button";
import { FieldBox } from "../../../components/ui/FieldBox";
import { Checkbox } from "../../../components/ui/checkbox";
import FilterBar from "../../../components/ui/FilterBar";
import { FilterSelect } from "../../../components/ui/FilterDropdown";
import { TablePager } from "../../../components/ui/TablePager";
import { SortHead, Table, TableBody, TableCell, TableHeader, TableRow } from "../../../components/ui/table";
import { usePaging } from "../../../hooks/usePaging";
import { useTableSort } from "../../../hooks/useTableSort";
import { IdentityCell } from "../../../components/purchasing/list/IdentityCell";
import { StateCell, STATE_HEAD_CLASS } from "../../../components/purchasing/list/StateCell";
import ExportButton from "../../../components/purchasing/list/ExportButton";
import { listDate } from "../../../utils/listDates";
import { useAuth } from "../../../context/AuthContext";
import { transmittalService } from "../../../services/transmittalService";
import { transmittalKeys } from "../../../components/transmittals/transmittalKeys";
import {
  TRANSMITTAL_ORIGIN_LABELS,
  TRANSMITTAL_PRIORITIES,
  TRANSMITTAL_PRIORITY_LABELS,
  TRANSMITTAL_STAFF_LIST,
  TRANSMITTAL_STATE,
} from "../../../constants/transmittals";

/**
 * The Transmittals list (#252, spec #251): every TG03 slip the signed-in
 * employee may read, newest first, with tabs for open, closed and cancelled and
 * a "Prepared by me" filter. The database returns only what the caller may
 * read; the navigation offers the screen to the readers.
 */

const TAB = {
  OPEN: "open",
  CLOSED: "closed",
  CANCELLED: "cancelled",
  ALL: "all",
};

/** "Waiting on" (#254): what each slip is waiting on. */
const WAITING = {
  ANY: "any",
  WAREHOUSE: "waiting_warehouse",
  TECHNICAL: "waiting_technical",
  AWAITING_MY_CHECK: "awaiting_my_check",
};

const WAITING_OPTIONS = [
  { value: WAITING.ANY, label: "Anyone" },
  { value: WAITING.WAREHOUSE, label: "Warehouse" },
  { value: WAITING.TECHNICAL, label: "Technical" },
  { value: WAITING.AWAITING_MY_CHECK, label: "Awaiting my Check by" },
];

const ANY_PRIORITY = "any";
const PRIORITY_OPTIONS = [
  { value: ANY_PRIORITY, label: "Any priority" },
  ...TRANSMITTAL_PRIORITIES.map((p) => ({ value: p, label: TRANSMITTAL_PRIORITY_LABELS[p] })),
];

/** State -> StatusBadge tone, the one place this list maps them. */
const STATE_TONES = {
  [TRANSMITTAL_STATE.DRAFT]: "mauve",
  [TRANSMITTAL_STATE.WAREHOUSE_CHECKING]: "amber",
  [TRANSMITTAL_STATE.WAREHOUSE_RELEASING]: "amber",
  [TRANSMITTAL_STATE.TECHNICAL_INSPECTION]: "amber",
  [TRANSMITTAL_STATE.AWAITING_CHECK]: "blue",
  [TRANSMITTAL_STATE.CLOSED]: "green",
  [TRANSMITTAL_STATE.CANCELLED]: "red",
};

const COLUMNS = [
  { id: "tg03", label: "TG03" },
  { id: "prepared", label: "Prepared" },
  { id: "origin", label: "Origin" },
  { id: "priority", label: "Priority" },
  { id: "lines", label: "Lines" },
  { id: "na", label: "NA" },
  { id: "state", label: "State" },
];

const SORT = {
  tg03: (r) => r.number,
  prepared: (r) => (r.preparedOn ? new Date(r.preparedOn).getTime() : null),
  origin: (r) => TRANSMITTAL_ORIGIN_LABELS[r.origin] ?? r.origin,
  priority: (r) => TRANSMITTAL_PRIORITY_LABELS[r.priority] ?? r.priority,
  lines: (r) => r.lineCount,
  na: (r) => r.naCount,
  state: (r) => r.stateLabel,
};

const EXPORT_HEADER = ["TG03", "Company", "Prepared", "Origin", "Priority", "Lines", "NA", "State"];
const exportRows = (rows) =>
  rows.map((r) => [
    r.number,
    r.entity || null,
    listDate(r.preparedOn) || null,
    TRANSMITTAL_ORIGIN_LABELS[r.origin] ?? r.origin,
    TRANSMITTAL_PRIORITY_LABELS[r.priority] ?? r.priority,
    r.lineCount,
    r.naCount || null,
    r.stateLabel,
  ]);

const matchesSearch = (row, term) =>
  [row.number, row.entity, ...(row.poNumbers ?? [])].some((field) => field?.toLowerCase().includes(term));

const CHIP = "h-9 w-auto gap-2 px-2.5";
const CHIP_WRAPPER = "w-auto shrink-0";

const HEAD = "text-label font-bold uppercase tracking-wider";

function TransmittalsList() {
  const navigate = useNavigate();
  const { user } = useAuth();
  // Raising follows the database's rule (Purchasing, or the Warehouse or
  // Logistics list); a Super Admin or a Technical member reads but doesn't raise.
  const { data: canRaise = false } = useQuery({
    queryKey: [...transmittalKeys.list, "can-prepare", user?.id],
    queryFn: () => transmittalService.canPrepare(),
    enabled: Boolean(user?.id),
  });

  const [tab, setTab] = useState(TAB.OPEN);
  const [mineOnly, setMineOnly] = useState(false);
  const [waiting, setWaiting] = useState(WAITING.ANY);
  const [priority, setPriority] = useState(ANY_PRIORITY);
  const [hasNaOnly, setHasNaOnly] = useState(false);
  const [search, setSearch] = useState("");

  const { data: rows = [], isLoading, isError, refetch } = useQuery({
    queryKey: [...transmittalKeys.list],
    queryFn: () => transmittalService.list(),
  });

  const inTab = (row, t) => {
    if (t === TAB.OPEN) return ![TRANSMITTAL_STATE.CLOSED, TRANSMITTAL_STATE.CANCELLED].includes(row.state);
    if (t === TAB.CLOSED) return row.state === TRANSMITTAL_STATE.CLOSED;
    if (t === TAB.CANCELLED) return row.state === TRANSMITTAL_STATE.CANCELLED;
    return true;
  };
  const { data: myLists = [] } = useQuery({
    queryKey: [...transmittalKeys.list, "my-lists", user?.id],
    queryFn: () => transmittalService.myStaffLists(user?.id),
    enabled: Boolean(user?.id),
  });
  const onCheckBy = myLists.includes(TRANSMITTAL_STAFF_LIST.CHECK_BY);

  const matchesWaiting = (row) => {
    if (waiting === WAITING.WAREHOUSE) {
      return [TRANSMITTAL_STATE.WAREHOUSE_CHECKING, TRANSMITTAL_STATE.WAREHOUSE_RELEASING].includes(row.state);
    }
    if (waiting === WAITING.TECHNICAL) return row.state === TRANSMITTAL_STATE.TECHNICAL_INSPECTION;
    if (waiting === WAITING.AWAITING_MY_CHECK) {
      return row.state === TRANSMITTAL_STATE.AWAITING_CHECK && onCheckBy && row.preparedById !== user?.id;
    }
    return true;
  };

  // Search and the filters narrow first; the tabs count within that.
  const term = search.trim().toLowerCase();
  const narrowed = rows.filter(
    (row) =>
      (!term || matchesSearch(row, term)) &&
      (!mineOnly || row.preparedById === user?.id) &&
      (!hasNaOnly || row.hasNa) &&
      (priority === ANY_PRIORITY || row.priority === priority) &&
      matchesWaiting(row),
  );

  const count = (t) => narrowed.filter((row) => inTab(row, t)).length;
  const filtered = narrowed.filter((row) => inTab(row, tab));
  const { sorted: visible, sort, toggle } = useTableSort(filtered, SORT);
  const paging = usePaging(visible);
  const rowsToExport = useMemo(() => exportRows(visible), [visible]);

  const filtersSet = (mineOnly ? 1 : 0) + (hasNaOnly ? 1 : 0);
  const hasActiveFilters = search !== "" || waiting !== WAITING.ANY || priority !== ANY_PRIORITY || filtersSet > 0;
  const clearAll = () => {
    setSearch("");
    setWaiting(WAITING.ANY);
    setPriority(ANY_PRIORITY);
    setMineOnly(false);
    setHasNaOnly(false);
  };

  const toolbar = (
    <>
      <TabGroup
        variant="pill"
        size="sm"
        activeTab={tab}
        onChange={setTab}
        tabs={[
          { value: TAB.OPEN, label: "Open", badge: count(TAB.OPEN) },
          { value: TAB.CLOSED, label: "Closed", badge: count(TAB.CLOSED) },
          { value: TAB.CANCELLED, label: "Cancelled", badge: count(TAB.CANCELLED) },
          { value: TAB.ALL, label: "All", badge: narrowed.length },
        ]}
      />
      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: "Search Transmittals" }}
        chips={
          <>
            <FilterSelect
              icon={Hourglass}
              label="Waiting on"
              options={WAITING_OPTIONS}
              value={waiting}
              onChange={setWaiting}
              allValue={WAITING.ANY}
              className={CHIP}
              wrapperClassName={CHIP_WRAPPER}
            />
            <FilterSelect
              icon={Flag}
              label="Priority"
              options={PRIORITY_OPTIONS}
              value={priority}
              onChange={setPriority}
              allValue={ANY_PRIORITY}
              className={CHIP}
              wrapperClassName={CHIP_WRAPPER}
            />
          </>
        }
        filters={
          <div className="flex flex-col gap-2.5 text-[13px]">
            <FieldBox inline>
              <Checkbox checked={mineOnly} onCheckedChange={(v) => setMineOnly(Boolean(v))} />
              <span>Prepared by me</span>
            </FieldBox>
            <FieldBox inline>
              <Checkbox checked={hasNaOnly} onCheckedChange={(v) => setHasNaOnly(Boolean(v))} />
              <span>Has NA</span>
            </FieldBox>
          </div>
        }
        activeCount={filtersSet}
        hasActiveFilters={hasActiveFilters}
        onClearAll={clearAll}
        actions={<ExportButton name="transmittals" sheetName="Transmittals" header={EXPORT_HEADER} rows={rowsToExport} />}
      />
    </>
  );

  return (
    <PageShell
      title="Transmittals"
      description="TG03 slips: the goods the Warehouse and Technical check, numbered as on paper."
      action={
        canRaise && (
          <Button size="sm" onClick={() => navigate("/purchasing/transmittals/new")} className="gap-1.5">
            <Plus size={14} />
            Raise Transmittal
          </Button>
        )
      }
      toolbar={toolbar}
    >
      {isLoading && <PageLoading label="Transmittals" />}
      {isError && <QueryError title="Transmittals could not be loaded." onRetry={refetch} />}

      {!isLoading && !isError && visible.length === 0 && (
        <EmptyState
          icon={ReceiptText}
          title={rows.length === 0 ? "No Transmittals yet" : "No matching Transmittals"}
          description={
            rows.length === 0
              ? "A Transmittal is raised when goods come in against a PO. Purchasing, Logistics and the Warehouse raise them."
              : "Nothing in this tab. Try another tab or clear the filters."
          }
        />
      )}

      {!isLoading && !isError && visible.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <Table tableId="transmittals" className="md:min-w-[48rem]">
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  {COLUMNS.map(({ id, label }) => (
                    <SortHead
                      key={id}
                      id={id}
                      sortKey={id}
                      sort={sort}
                      onSort={toggle}
                      className={`${HEAD} ${id === "state" ? STATE_HEAD_CLASS : ""}`}
                    >
                      {label}
                    </SortHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {paging.rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/purchasing/transmittals/${row.id}`)}
                  >
                    <IdentityCell reference={row.number} name={row.entity} />
                    <TableCell className="tabular-nums text-muted-foreground">{listDate(row.preparedOn)}</TableCell>
                    <TableCell>{TRANSMITTAL_ORIGIN_LABELS[row.origin] ?? row.origin}</TableCell>
                    <TableCell>{TRANSMITTAL_PRIORITY_LABELS[row.priority] ?? row.priority}</TableCell>
                    <TableCell>{row.lineCount}</TableCell>
                    <TableCell className={row.naCount ? "font-semibold text-destructive" : "text-muted-foreground"}>
                      {row.naCount || "—"}
                    </TableCell>
                    <StateCell state={row.state} label={row.stateLabel} tones={STATE_TONES} />
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <TablePager {...paging} noun="Transmittals" />
        </div>
      )}
    </PageShell>
  );
}

export default function TransmittalsListPage() {
  return (
    <ProtectedRoute>
      <TransmittalsList />
    </ProtectedRoute>
  );
}
