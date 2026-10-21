import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderKanban, LayoutDashboard } from "lucide-react";

import { cn } from "@/lib/utils";
import EmptyState from "@/components/ui/EmptyState";
import PageLoading from "@/components/ui/PageLoading";
import QueryError from "@/components/ui/QueryError";
import SlideOver from "@/components/ui/SlideOver";
import { FilterSelect } from "@/components/ui/FilterDropdown";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { deliveryDeadlineService } from "../../../../services/deliveryDeadlineService";
import { orderMonitoringService } from "../../../../services/orderMonitoringService";
import { purchasingDashboardService } from "../../../../services/purchasingDashboardService";
import { IPAS_SOURCE_LABELS } from "../../../../constants/ipas";
import { formatAmount } from "../../../../utils/ipas";
import { pluralize } from "../../../../utils/plural";
import { useRecordParam } from "../../../../hooks/useRecordParam";
import { NEXT_FILTER, TRACKER_STAGES, buildTracker, sorSummary, stageStates, valueOpenByCurrency } from "../../../../utils/purchasingTracker";
import SorPanel from "./SorPanel";
import TabHeader from "./TabHeader";
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

const HEAD = "text-label font-bold uppercase tracking-wider";

const NEXT_OPTIONS = [
  { value: NEXT_FILTER.ALL, label: "Any next move" },
  { value: NEXT_FILTER.OURS, label: "Ours to move" },
  { value: NEXT_FILTER.WAITING, label: "Waiting on someone else" },
  { value: NEXT_FILTER.LATE, label: "Late by the ageing rules" },
];
const AGEING = [
  { value: ALL, label: "Any age" },
  { value: "7", label: "7 days or more" },
  { value: "14", label: "14 days or more" },
  { value: "30", label: "30 days or more" },
];
const CANVASS = [
  { value: ALL, label: "With or without a canvass" },
  { value: NO_CANVASS, label: "Ordered with no canvass" },
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
function trackerBar(f, { rows, orders, names }, valueOpen) {
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
          className="h-9 w-auto"
        />
        <FilterSelect options={NEXT_OPTIONS} value={values.next} onChange={set("next")} label="Next move" className="h-9 w-auto" />
        <FilterSelect options={personOptions(rows, "buyer_id", names, "Any Buyer")} value={values.buyerId} onChange={set("buyerId")} label="Buyer" className="h-9 w-auto" />
      </>
    ),
    filters: (
      <div className="flex flex-col gap-2 p-2">
        <FilterSelect options={personOptions(rows, "canvasser_id", names, "Any Canvasser")} value={values.canvasserId} onChange={set("canvasserId")} label="Canvasser" />
        <FilterSelect options={AGEING} value={values.age} onChange={set("age")} label="Ageing" />
        <FilterSelect options={CANVASS} value={values.canvass} onChange={set("canvass")} label="Canvass" />
        <FilterSelect options={valuesOf(orders.map((o) => o.entity), "All entities")} value={values.entity} onChange={set("entity")} label="Entity" />
        <FilterSelect
          options={[{ value: ALL, label: "Import and Local" }, ...Object.entries(IPAS_SOURCE_LABELS).map(([value, label]) => ({ value, label }))]}
          value={values.source}
          onChange={set("source")}
          label="Source"
        />
        <FilterSelect options={valuesOf(orders.map((o) => o.supplier), "All suppliers")} value={values.supplier} onChange={set("supplier")} label="Supplier" />
        <FilterSelect options={FILED} value={values.filed} onChange={set("filed")} label="Filed" />
      </div>
    ),
    activeCount: f.activeCount,
    hasActiveFilters: f.hasActiveFilters,
    onClearAll: f.clearAll,
    // Money is not a stage, so it sits beside the filters instead of as a ninth cell in the stat row.
    actions: valueOpen.length > 0 && (
      <p className="ml-auto text-xs text-muted-foreground" aria-label="Value of open orders, pre-tax">
        Value open{" "}
        {valueOpen.map((v, index) => (
          <span key={v.currency ?? "none"}>
            {index > 0 && " · "}
            <span className="font-semibold tabular-nums text-foreground">{formatAmount(v.total, v.currency)}</span>
          </span>
        ))}
      </p>
    ),
  };
}

/**
 * `filters` is `useTrackerFilters()`; `handlers` open the record a line names
 * (`onOpenRow`, `onOpenOrder`, `onOpenSor`). `suspended` hides the SOR panel
 * while a Purchase Request sits over it.
 */
export default function Tracker({ filters: f, handlers, suspended = false }) {
  const data = useTrackerData();
  const labelOf = useStandingLabel();
  const { recordId, open, step, close } = useRecordParam("sor");

  const today = useMemo(() => new Date(), []);
  const tracker = useMemo(
    () => buildTracker({ rows: data.rows, orders: data.orders, deadlines: data.deadlines, nearDays: data.nearDays, labelOf, filters: f.query, today }),
    [data.rows, data.orders, data.deadlines, data.nearDays, labelOf, f.query, today],
  );

  if (data.isLoading) return <PageLoading label="Purchasing Dashboard" />;
  if (data.isError) return <QueryError title="The Purchasing Dashboard could not be loaded." onRetry={data.refetch} />;
  if (data.rows.length === 0 && data.orders.length === 0) {
    return <EmptyState icon={LayoutDashboard} title="Nothing outstanding" description="No SOR you can read has buying left to do." />;
  }

  const { sors, stages } = tracker;
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

  const picked = sors.findIndex((sor) => sor.key === recordId);
  const panelSor = !suspended && picked >= 0 ? sors[picked] : null;
  const openOnKey = (event, key) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open(key);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <TabHeader bar={trackerBar(f, data, valueOpen)} stats={stats} statsLabel="Stage totals" />

      {sors.length === 0 ? (
        <EmptyState icon={FolderKanban} title="No SOR matches" description="Change the search or the filters." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <Table tableId="purchasing-tracker" className="md:min-w-[62rem]">
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className={HEAD}>SOR</TableHead>
                  {TRACKER_STAGES.map((stage) => (
                    <TableHead key={stage.key} className={cn(HEAD, "w-[4.5rem] whitespace-normal px-1 text-center leading-tight")}>
                      {stage.label}
                    </TableHead>
                  ))}
                  <TableHead className={HEAD}>Next move</TableHead>
                  <TableHead className={HEAD}>Deadline</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sors.map((sor) => (
                  <TableRow
                    key={sor.key}
                    tabIndex={0}
                    aria-label={`${sor.name}, open`}
                    data-state={recordId === sor.key ? "selected" : undefined}
                    className={cn("cursor-pointer", sor.lateCount > 0 && "bg-destructive/5 hover:bg-destructive/10")}
                    onClick={() => open(sor.key)}
                    onKeyDown={(event) => openOnKey(event, sor.key)}
                  >
                    <TableCell>
                      <div className="font-mono text-xs font-semibold">{sor.short}</div>
                      <div className="line-clamp-1 max-w-[16rem] text-xs text-muted-foreground" title={sor.projectTitle ?? undefined}>
                        {sor.projectTitle}
                      </div>
                    </TableCell>
                    {stageStates(sor).map((state, index) => (
                      <TableCell key={state.key} className="px-1 text-center">
                        <span className="inline-flex">
                          <StageCircle stage={TRACKER_STAGES[index]} state={state} />
                        </span>
                      </TableCell>
                    ))}
                    <TableCell className="max-w-[18rem]">
                      <MoveText next={sor.next} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <DeadlineText deadline={sor.deadline} />
                        <Age days={sor.ageDays} late={sor.lateCount > 0} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <SlideOver
        record={panelSor}
        icon={FolderKanban}
        crumb="Purchasing Dashboard"
        identity={sorIdentity}
        index={Math.max(picked, 0)}
        total={sors.length}
        onStep={(direction) => sors[picked + direction] && step(sors[picked + direction].key)}
        onClose={close}
      >
        {(sor) => (
          <SorPanel
            sor={sor}
            checkIds={tracker.checkIds}
            labelOf={labelOf}
            today={today}
            onOpenRow={handlers.onOpenRow}
            onOpenOrder={handlers.onOpenOrder}
            onOpenSor={handlers.onOpenSor}
          />
        )}
      </SlideOver>
    </div>
  );
}
