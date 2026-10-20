import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { LayoutDashboard } from "lucide-react";

import EmptyState from "../../../../components/ui/EmptyState";
import PageLoading from "../../../../components/ui/PageLoading";
import QueryError from "../../../../components/ui/QueryError";
import FilterBar from "../../../../components/ui/FilterBar";
import ReportFigure from "../../../../components/ui/ReportFigure";
import { FilterSelect } from "../../../../components/ui/FilterDropdown";
import { Button } from "../../../../components/ui/button";
import { purchasingDashboardService } from "../../../../services/purchasingDashboardService";
import { orderMonitoringService } from "../../../../services/orderMonitoringService";
import { deliveryDeadlineService } from "../../../../services/deliveryDeadlineService";
import { deadlineMark } from "../../../../utils/deliveryDeadline";
import { DeadlineLine } from "../../order-monitoring/_components/parts";
import {
  DASHBOARD_GROUP_HINTS,
  LATE_BY_RULES,
  ageDays,
  dashboardView,
  rowLabel,
  sorSummary,
} from "../../../../utils/purchasingDashboard";
import { ALL, NO_CANVASS } from "./useProjectsFilters";

/**
 * The Purchasing Dashboard's Projects tab (#322): where every project's buying
 * stands, grouped by what is outstanding (To source, To price, To order, On
 * order, To check). One SOR shows in every group it has work in, with that
 * group's item count and a line naming all of its groups. Each record is a
 * button; `onOpen(row)` decides where it opens.
 *
 * The filters live in the page (`./useProjectsFilters`) so their bar
 * (`ProjectsToolbar`) can sit in PageShell's toolbar slot.
 */

const AGEING = [
  { value: ALL, label: "Any age" },
  { value: "7", label: "7 days or more" },
  { value: "14", label: "14 days or more" },
  { value: "30", label: "30 days or more" },
  { value: LATE_BY_RULES, label: "Late by the ageing rules" },
];
const CANVASS = [
  { value: ALL, label: "With or without a canvass" },
  { value: NO_CANVASS, label: "Ordered with no canvass" },
];

const ROWS_KEY = ["purchasing-dashboard", "rows"];

/** The dashboard's rows and the names of the people on them, shared by the toolbar and the tab. */
function useDashboardRows() {
  const query = useQuery({ queryKey: ROWS_KEY, queryFn: () => purchasingDashboardService.rows() });
  const rows = useMemo(() => query.data ?? [], [query.data]);
  const peopleIds = useMemo(() => rows.flatMap((row) => [row.buyer_id, row.canvasser_id]), [rows]);
  const { data: names = {} } = useQuery({
    queryKey: ["purchasing-dashboard", "names", [...new Set(peopleIds.filter(Boolean))].sort()],
    queryFn: () => purchasingDashboardService.names(peopleIds),
    enabled: rows.length > 0,
  });
  return { ...query, rows, names };
}

function personOptions(rows, key, names, allLabel) {
  const ids = [...new Set(rows.map((row) => row[key]).filter(Boolean))];
  return [
    { value: ALL, label: allLabel },
    ...ids.map((id) => ({ value: id, label: names[id] ?? "Unknown" })).sort((a, b) => a.label.localeCompare(b.label)),
  ];
}

/** The Projects tab's filter bar: Buyer, Canvasser and Ageing inline, the canvass check in Filters. */
export function ProjectsToolbar({ filters }) {
  const { rows, names, isLoading, isError } = useDashboardRows();
  if (isLoading || isError) return null;
  const f = filters;
  return (
    <FilterBar
      search={{ value: f.sor, onChange: f.setSor, placeholder: "Search SOR" }}
      chips={
        <>
          <FilterSelect options={personOptions(rows, "buyer_id", names, "Any Buyer")} value={f.buyerId} onChange={f.setBuyerId} label="Buyer" className="h-9 w-auto" />
          <FilterSelect options={personOptions(rows, "canvasser_id", names, "Any Canvasser")} value={f.canvasserId} onChange={f.setCanvasserId} label="Canvasser" className="h-9 w-auto" />
          <FilterSelect options={AGEING} value={f.age} onChange={f.setAge} label="Ageing" className="h-9 w-auto" />
        </>
      }
      filters={
        <div className="flex flex-col gap-2 p-2">
          <FilterSelect options={CANVASS} value={f.canvass} onChange={f.setCanvass} label="Canvass" />
        </div>
      }
      activeCount={f.canvass !== ALL ? 1 : 0}
      hasActiveFilters={f.active}
      onClearAll={f.clearAll}
    />
  );
}

function GroupSection({ group, rows, onOpen, today, lateIpasIds, deadlineOf }) {
  return (
    <section aria-labelledby={`group-${group.key}`} className="flex flex-col gap-2">
      <div>
        <h2 id={`group-${group.key}`} className="text-base font-semibold">
          {group.label}{" "}
          <span className="tabular-nums text-muted-foreground">
            ({group.itemCount} {group.itemCount === 1 ? "item" : "items"}, {group.sorCount} {group.sorCount === 1 ? "SOR" : "SORs"})
          </span>
        </h2>
        <p className="text-sm text-muted-foreground">{DASHBOARD_GROUP_HINTS[group.key]}</p>
      </div>
      {group.sors.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing here.</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {group.sors.map((sor) => {
            const name = sor.direct ? "Direct request" : `${sor.salesReference ?? "No S number"} — ${sor.projectTitle}`;
            return (
              <li key={sor.id} className="flex flex-col gap-1.5 px-4 py-3" data-testid={`sor-${group.key}-${sor.id}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span title={name} className="min-w-0 line-clamp-2 break-words font-medium">
                    {name}
                  </span>
                  <span className="shrink-0 tabular-nums text-sm">
                    {sor.itemCount} {group.label.toLowerCase()}
                  </span>
                </div>
                {group.key === "on_order" && <DeadlineLine deadline={deadlineOf(sor.id)} />}
                <p className="text-xs text-muted-foreground">All outstanding: {sorSummary(rows, sor.id)}</p>
                <div className="flex flex-wrap gap-1.5">
                  {sor.rows.map((row) => {
                    const label = rowLabel(row);
                    const late = row.target_kind === "ipas" && lateIpasIds.has(row.target_id);
                    const facts = ` · ${row.item_count} · ${ageDays(row.since, today)}d${late ? " · late" : ""}`;
                    // A record's label is often a long Odoo item name: one line, the whole name on hover.
                    return (
                      <Button
                        key={`${row.target_kind}-${row.target_id}`}
                        variant="outline"
                        size="sm"
                        title={label}
                        aria-label={`${label}${facts}`}
                        className="max-w-full"
                        onClick={() => onOpen(row)}
                      >
                        <span className="min-w-0 max-w-[24rem] truncate">{label}</span>
                        <span className="shrink-0 whitespace-pre">{facts}</span>
                      </Button>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default function Projects({ filters, onOpen }) {
  const { rows, isLoading, isError, refetch } = useDashboardRows();

  // The ageing rules (#262) live in Order Monitoring; its standing marks which
  // IPAS are late, and the dashboard reuses that rather than a second copy.
  const hasIpas = rows.some((row) => row.target_kind === "ipas");
  const { data: orders = [] } = useQuery({
    queryKey: ["order-monitoring", "list"],
    queryFn: () => orderMonitoringService.list(),
    enabled: hasIpas,
  });
  const lateIpasIds = useMemo(() => new Set(orders.filter((order) => order.late).map((order) => order.id)), [orders]);

  // The client's delivery deadline (#467), merged in here for the SORs in the On order group only.
  const onOrderSorIds = useMemo(
    () => [...new Set(rows.filter((row) => row.grp === "on_order" && row.opportunity_id).map((row) => row.opportunity_id))].sort(),
    [rows],
  );
  const { data: deadlines = new Map() } = useQuery({
    queryKey: ["purchasing-dashboard", "deadlines", onOrderSorIds],
    queryFn: () => deliveryDeadlineService.forSors(onOrderSorIds),
    enabled: onOrderSorIds.length > 0,
  });
  const { data: nearDays } = useQuery({
    queryKey: ["order-monitoring", "deadline-near-days"],
    queryFn: () => deliveryDeadlineService.getNearDays(),
    enabled: onOrderSorIds.length > 0,
  });

  if (isLoading) return <PageLoading label="Purchasing Dashboard" />;
  if (isError) return <QueryError title="The Purchasing Dashboard could not be loaded." onRetry={refetch} />;
  if (rows.length === 0) {
    return <EmptyState icon={LayoutDashboard} title="Nothing outstanding" description="No SOR you can read has buying left to do." />;
  }

  const today = new Date();
  // Whatever is in the On order group is not received yet, so it is marked against the deadline.
  const deadlineOf = (sorId) => {
    const dueAt = deadlines.get(sorId)?.dueAt;
    return dueAt ? deadlineMark({ dueAt, nearDays, today }) : null;
  };
  const { age } = filters;
  const view = dashboardView(
    rows,
    {
      sor: filters.sor,
      buyerId: filters.buyerId === ALL ? null : filters.buyerId,
      canvasserId: filters.canvasserId === ALL ? null : filters.canvasserId,
      minAgeDays: age === ALL || age === LATE_BY_RULES ? null : Number(age),
      lateIpasIds: age === LATE_BY_RULES ? lateIpasIds : null,
      noCanvass: filters.canvass === NO_CANVASS,
    },
    today,
  );

  return (
    <div className="flex flex-col gap-8">
      <section aria-label="Group counts">
        <ReportFigure
          stats={view.groups.map((group) => ({
            label: group.label,
            value: group.itemCount,
            sub: `${group.sorCount} ${group.sorCount === 1 ? "SOR" : "SORs"}`,
          }))}
        />
      </section>
      {view.groups.map((group) => (
        <GroupSection key={group.key} group={group} rows={rows} onOpen={onOpen} today={today} lateIpasIds={lateIpasIds} deadlineOf={deadlineOf} />
      ))}
    </div>
  );
}
