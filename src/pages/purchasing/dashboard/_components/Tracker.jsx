import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, CalendarClock, FolderKanban, LayoutDashboard, PackageCheck, Store, Truck, UserRound } from "lucide-react";

import { cn } from "@/lib/utils";
import EmptyState from "@/components/ui/EmptyState";
import PageLoading from "@/components/ui/PageLoading";
import QueryError from "@/components/ui/QueryError";
import SlideOver from "@/components/ui/SlideOver";
import PageShell from "@/components/ui/PageShell";
import FilterBar from "@/components/ui/FilterBar";
import ReportFigure from "@/components/ui/ReportFigure";
import { TablePager } from "@/components/ui/TablePager";
import { FilterSelect } from "@/components/ui/FilterDropdown";
import { SortHead, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { IdentityCell } from "@/components/purchasing/list/IdentityCell";
import ExportButton from "@/components/purchasing/list/ExportButton";
import ColumnsMenu from "@/components/purchasing/list/ColumnsMenu";
import { useHiddenColumns } from "@/hooks/useHiddenColumns";
import { useAuth } from "@/context/AuthContext";
import { usePaging } from "@/hooks/usePaging";
import { useTableSort } from "@/hooks/useTableSort";
import { deliveryDeadlineService } from "../../../../services/deliveryDeadlineService";
import { orderMonitoringService } from "../../../../services/orderMonitoringService";
import { purchasingDashboardService } from "../../../../services/purchasingDashboardService";
import { IPAS_SOURCE_LABELS } from "../../../../constants/ipas";
import { formatAmount } from "../../../../utils/ipas";
import { pluralize } from "../../../../utils/plural";
import { useRecordParam } from "../../../../hooks/useRecordParam";
import { NEXT_FILTER, TRACKER_STAGES, buildTracker, sorSummary, stageStates, valueOpenByCurrency } from "../../../../utils/purchasingTracker";
import SorPanel from "./SorPanel";
import { TRACKER_COLUMNS, TRACKER_EXPORT_HEADER, TRACKER_SORT, trackerExportRows } from "./trackerList";
import { Age, DeadlineText, MoveText, StageCircle } from "./trackerParts";
import { ALL, FILED_INCLUDED, NO_CANVASS } from "./useTrackerFilters";
import { useStandingLabel } from "./useStandingLabel";

/**
 * The Purchasing Dashboard's tracker: one row per SOR, one circle per stage of
 * a purchase, and the one next move, with who owes it. The totals above it are
 * the stages; a click on a total, or on a row, narrows or opens it. A SOR opens
 * in a slide-over (`?sor=`) that reads what is next, then the whole purchase
 * stage by stage. It replaces the three tabs (Projects, What needs doing and
 * Register) that read the same work three ways.
 */

/** What the slide-over's header says about a SOR. */
const sorIdentity = (sor) => ({
  ref: sor.short,
  title: sor.projectTitle ?? sor.name,
  subtitle: sorSummary(sor) || "Nothing outstanding",
});

const TRACKER_COLUMN_KEYS = TRACKER_COLUMNS.map((column) => column.key);
const HEAD = "whitespace-nowrap text-label font-bold uppercase tracking-wider";
const CHIP = "h-9 w-auto gap-2 px-2.5";
const CHIP_WRAPPER = "w-auto shrink-0";

const NEXT_OPTIONS = [
  { value: NEXT_FILTER.ALL, label: "Any next move" },
  { value: NEXT_FILTER.OURS, label: "Ours to move" },
  { value: NEXT_FILTER.WAITING, label: "Waiting on someone else" },
  { value: NEXT_FILTER.LATE, label: "Late by the ageing rules" },
];
const AGEING = [
  { value: ALL, label: "Any age" },
  { value: "7", label: "7d or more" },
  { value: "14", label: "14d or more" },
  { value: "30", label: "30d or more" },
];
const CANVASS = [
  { value: ALL, label: "With or without a canvass" },
  { value: NO_CANVASS, label: "Purchased with no canvass" },
];
const FILED = [
  { value: ALL, label: "SORs with something open" },
  { value: FILED_INCLUDED, label: "Include fully filed SORs" },
];

const valuesOf = (list, allLabel) => [
  { value: ALL, label: allLabel },
  ...[...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b)).map((value) => ({ value, label: value })),
];

function personOptions(rows, key, names, allLabel) {
  const ids = [...new Set(rows.map((row) => row[key]).filter(Boolean))];
  return [
    { value: ALL, label: allLabel },
    ...ids.map((id) => ({ value: id, label: names[id] ?? "Unknown" })).sort((a, b) => a.label.localeCompare(b.label)),
  ];
}

/** The tracker's data: what the two old tabs read, plus the client deadlines of the SORs they name. */
function useTrackerData() {
  const rowsQuery = useQuery({ queryKey: ["purchasing-dashboard", "rows"], queryFn: () => purchasingDashboardService.rows() });
  const ordersQuery = useQuery({ queryKey: ["order-monitoring", "list"], queryFn: () => orderMonitoringService.list() });
  const rows = useMemo(() => rowsQuery.data ?? [], [rowsQuery.data]);
  const orders = useMemo(() => ordersQuery.data ?? [], [ordersQuery.data]);

  const peopleIds = useMemo(() => [...new Set(rows.flatMap((row) => [row.buyer_id, row.canvasser_id]).filter(Boolean))].sort(), [rows]);
  const { data: names = {} } = useQuery({
    queryKey: ["purchasing-dashboard", "names", peopleIds],
    queryFn: () => purchasingDashboardService.names(peopleIds),
    enabled: peopleIds.length > 0,
  });

  const sorIds = useMemo(
    () => [...new Set([...rows.map((row) => row.opportunity_id), ...orders.flatMap((order) => order.sors.map((sor) => sor.id))].filter(Boolean))].sort(),
    [rows, orders],
  );
  const { data: deadlines } = useQuery({
    queryKey: ["purchasing-dashboard", "deadlines", sorIds],
    queryFn: () => deliveryDeadlineService.forSors(sorIds),
    enabled: sorIds.length > 0,
  });
  const { data: nearDays } = useQuery({
    queryKey: ["order-monitoring", "deadline-near-days"],
    queryFn: () => deliveryDeadlineService.getNearDays(),
    enabled: sorIds.length > 0,
  });

  return {
    rows,
    orders,
    names,
    deadlines,
    nearDays,
    isLoading: rowsQuery.isLoading || ordersQuery.isLoading,
    isError: rowsQuery.isError || ordersQuery.isError,
    refetch: () => Promise.all([rowsQuery.refetch(), ordersQuery.refetch()]),
  };
}

/** The filter bar: search, three inline choices, the rest in Filters. */
function trackerBar(f, { rows, orders, names }, valueOpen, columns, exportRows) {
  const { values, set } = f;
  return {
    search: { value: f.search, onChange: f.setSearch, placeholder: "Search SOR, IPAS or PO" },
    chips: (
      <>
        <FilterSelect
          options={[{ value: ALL, label: "Every stage" }, ...TRACKER_STAGES.map((s) => ({ value: s.key, label: s.label }))]}
          value={values.stage}
          onChange={set("stage")}
          label="Stage"
          className={CHIP}
          wrapperClassName={CHIP_WRAPPER}
        />
        <FilterSelect options={NEXT_OPTIONS} value={values.next} onChange={set("next")} label="Next move" className={CHIP} wrapperClassName={CHIP_WRAPPER} />
        <FilterSelect options={personOptions(rows, "buyer_id", names, "Any Buyer")} value={values.buyerId} onChange={set("buyerId")} label="Buyer" className={CHIP} wrapperClassName={CHIP_WRAPPER} />
      </>
    ),
    // The same grid of small dropdowns as the IPAS list's Filters.
    filters: (
      <div className="grid gap-2 sm:grid-cols-2">
        <FilterSelect icon={UserRound} options={personOptions(rows, "canvasser_id", names, "Any Canvasser")} value={values.canvasserId} onChange={set("canvasserId")} label="Canvasser" allValue={ALL} />
        <FilterSelect icon={CalendarClock} options={AGEING} value={values.age} onChange={set("age")} label="Ageing" allValue={ALL} />
        <FilterSelect icon={PackageCheck} options={CANVASS} value={values.canvass} onChange={set("canvass")} label="Canvass" allValue={ALL} />
        <FilterSelect icon={Building2} options={valuesOf(orders.map((o) => o.entity), "All entities")} value={values.entity} onChange={set("entity")} label="Entity" allValue={ALL} />
        <FilterSelect
          icon={Truck}
          options={[{ value: ALL, label: "Import and Local" }, ...Object.entries(IPAS_SOURCE_LABELS).map(([value, label]) => ({ value, label }))]}
          value={values.source}
          onChange={set("source")}
          label="Source"
          allValue={ALL}
        />
        <FilterSelect icon={Store} options={valuesOf(orders.map((o) => o.supplier), "All suppliers")} value={values.supplier} onChange={set("supplier")} label="Supplier" allValue={ALL} />
        <FilterSelect icon={FolderKanban} options={FILED} value={values.filed} onChange={set("filed")} label="Filed" allValue={ALL} />
      </div>
    ),
    activeCount: f.activeCount,
    hasActiveFilters: f.hasActiveFilters,
    onClearAll: f.clearAll,
    // Money is not a stage, so it sits at the right end of the bar, then Columns and Export.
    actions: (
      <>
        {valueOpen.length > 0 && (
          <p className="ml-auto text-xs text-muted-foreground" aria-label="Value of open orders, pre-tax">
            Value open{" "}
            {valueOpen.map((v, index) => (
              <span key={v.currency ?? "none"}>
                {index > 0 && " · "}
                <span className="font-semibold tabular-nums text-foreground">{formatAmount(v.total, v.currency)}</span>
              </span>
            ))}
          </p>
        )}
        <ColumnsMenu columns={columns.list} hidden={columns.hidden} onToggle={columns.toggle} />
        <ExportButton name="purchasing-dashboard" sheetName="Purchasing Dashboard" header={TRACKER_EXPORT_HEADER} rows={exportRows} />
      </>
    ),
  };
}

/**
 * `filters` is `useTrackerFilters()`; `handlers` open the record a line names
 * (`onOpenRow`, `onOpenOrder`, `onOpenSor`). `suspended` hides the SOR panel
 * while a Purchase Request sits over it.
 */
export default function Tracker({ filters: f, handlers, suspended = false }) {
  const { user } = useAuth();
  const data = useTrackerData();
  const labelOf = useStandingLabel();
  const { recordId, open, step, close } = useRecordParam("sor");

  // Remembered per employee on this browser.
  const columns = useHiddenColumns(`erp_purchasing_dashboard_columns_${user?.id ?? "anon"}`, { known: TRACKER_COLUMN_KEYS });
  const shown = TRACKER_COLUMNS.filter((column) => column.locked || columns.show(column.key));

  const today = useMemo(() => new Date(), []);
  const tracker = useMemo(
    () => buildTracker({ rows: data.rows, orders: data.orders, deadlines: data.deadlines, nearDays: data.nearDays, labelOf, filters: f.query, today }),
    [data.rows, data.orders, data.deadlines, data.nearDays, labelOf, f.query, today],
  );
  const { sorted: visible, sort, toggle } = useTableSort(tracker.sors, TRACKER_SORT);
  const paging = usePaging(visible);
  const exportRows = useMemo(() => trackerExportRows(visible, today), [visible, today]);

  const page = (children, toolbar) => (
    <PageShell title="Purchasing Dashboard" description="Where every project's buying stands, and what to do next." toolbar={toolbar}>
      {children}
    </PageShell>
  );

  if (data.isLoading) return page(<PageLoading label="Purchasing Dashboard" />);
  if (data.isError) return page(<QueryError title="The Purchasing Dashboard could not be loaded." onRetry={data.refetch} />);
  if (data.rows.length === 0 && data.orders.length === 0) {
    return page(<EmptyState icon={LayoutDashboard} title="Nothing outstanding" description="No SOR you can read has buying left to do." />);
  }

  const { stages } = tracker;
  const toggleStage = (key) => f.set("stage")(f.values.stage === key ? ALL : key);
  const lateOrders = tracker.orders.filter((order) => order.late).length;
  const valueOpen = valueOpenByCurrency(tracker.orders);

  const stats = [
    ...stages.map((stage) => ({
      label: stage.label,
      value: stage.count,
      sub: pluralize(stage.sorCount, "SOR"),
      onClick: () => toggleStage(stage.key),
    })),
    { label: "Late orders", value: lateOrders, tone: "attention", sub: "past their ageing rule", onClick: () => f.set("next")(NEXT_FILTER.LATE) },
  ];

  const picked = visible.findIndex((sor) => sor.key === recordId);
  const panelSor = !suspended && picked >= 0 ? visible[picked] : null;
  const openOnKey = (event, key) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open(key);
    }
  };

  const toolbar = (
    <FilterBar
      {...trackerBar(f, data, valueOpen, { list: TRACKER_COLUMNS, hidden: columns.hidden, toggle: columns.toggle }, exportRows)}
    />
  );

  return page(
    <div className="flex flex-col gap-6">
      {/* Seven totals hold one row from xl; below that they wrap. */}
      <div role="group" aria-label="Stage totals">
        <ReportFigure stats={stats} listClassName="xl:grid-cols-7" />
      </div>

      {visible.length === 0 ? (
        <EmptyState icon={FolderKanban} title="No SOR matches" description="Change the search or the filters." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <Table tableId="purchasing-tracker" className="md:min-w-[62rem]">
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  {shown.map((column) =>
                    column.stage ? (
                      // A stage circle column does not sort: its circles are the same shape for every row.
                      <TableHead key={column.key} className={cn(HEAD, "px-2 text-center")}>
                        {column.label}
                      </TableHead>
                    ) : (
                      <SortHead key={column.key} id={column.key} sortKey={column.key} sort={sort} onSort={toggle} className={HEAD}>
                        {column.label}
                      </SortHead>
                    ),
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {paging.rows.map((sor) => {
                  const states = stageStates(sor);
                  return (
                    <TableRow
                      key={sor.key}
                      tabIndex={0}
                      aria-label={`${sor.name}, open`}
                      data-state={recordId === sor.key ? "selected" : undefined}
                      className={cn("cursor-pointer", sor.lateCount > 0 && "bg-destructive/5 hover:bg-destructive/10")}
                      onClick={() => open(sor.key)}
                      onKeyDown={(event) => openOnKey(event, sor.key)}
                    >
                      {shown.map((column) => {
                        if (column.key === "sor") {
                          // "Direct request" and "No SOR" are words, not numbers, so they are not mono.
                          const word = sor.direct || sor.noSor ? sor.short : undefined;
                          return (
                            <IdentityCell
                              key={column.key}
                              hairline={sor.direct}
                              reference={word ? undefined : sor.short}
                              word={word}
                              name={sor.noSor ? "Orders with no SOR" : sor.projectTitle}
                            />
                          );
                        }
                        if (column.stage) {
                          const index = TRACKER_STAGES.findIndex((stage) => stage.key === column.key);
                          return (
                            <TableCell key={column.key} className="px-2 text-center">
                              <span className="inline-flex">
                                <StageCircle stage={column.stage} state={states[index]} />
                              </span>
                            </TableCell>
                          );
                        }
                        if (column.key === "next-move") {
                          return (
                            <TableCell key={column.key} className="max-w-[18rem]">
                              <MoveText next={sor.next} />
                            </TableCell>
                          );
                        }
                        return (
                          <TableCell key={column.key}>
                            <div className="flex flex-col gap-0.5">
                              <DeadlineText deadline={sor.deadline} />
                              <Age days={sor.ageDays} late={sor.lateCount > 0} />
                            </div>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <TablePager {...paging} noun="SORs" />
        </div>
      )}

      <SlideOver
        record={panelSor}
        icon={FolderKanban}
        crumb="Purchasing Dashboard"
        identity={sorIdentity}
        index={Math.max(picked, 0)}
        total={visible.length}
        onStep={(direction) => visible[picked + direction] && step(visible[picked + direction].key)}
        onClose={close}
      >
        {(sor) => (
          <SorPanel
            sor={sor}
            labelOf={labelOf}
            today={today}
            onOpenRow={handlers.onOpenRow}
            onOpenOrder={handlers.onOpenOrder}
            onOpenSor={handlers.onOpenSor}
          />
        )}
      </SlideOver>
    </div>,
    toolbar,
  );
}
