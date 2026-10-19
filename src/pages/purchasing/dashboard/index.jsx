import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useNavigate } from "react-router";
import { LayoutDashboard } from "lucide-react";

import PageShell from "../../../components/ui/PageShell";
import EmptyState from "../../../components/ui/EmptyState";
import PageLoading from "../../../components/ui/PageLoading";
import QueryError from "../../../components/ui/QueryError";
import FilterBar from "../../../components/ui/FilterBar";
import { FilterSelect } from "../../../components/ui/FilterDropdown";
import { Button } from "../../../components/ui/button";
import { useAuth } from "../../../context/AuthContext";
import { purchasingDashboardService } from "../../../services/purchasingDashboardService";
import { orderMonitoringService } from "../../../services/orderMonitoringService";
import { deliveryDeadlineService } from "../../../services/deliveryDeadlineService";
import { deadlineMark } from "../../../utils/deliveryDeadline";
import { DeadlineLine } from "../order-monitoring/_components/parts";
import { getPermissionContext } from "../../../utils/permissions";
import {
  DASHBOARD_GROUP_HINTS,
  LATE_BY_RULES,
  ageDays,
  dashboardView,
  linkFor,
  rowLabel,
  sorSummary,
} from "../../../utils/purchasingDashboard";

/**
 * The Purchasing Dashboard (#322): where every project's buying stands, grouped
 * by what is outstanding (To source, To price, To order, On order, To check).
 * One SOR shows in every group it has work in, with that group's item count and
 * a line naming all of its groups. Each record opens the place that owns the
 * work. Sits beside Purchase Requests and Order Monitoring, not instead of them.
 */

const ALL = "ALL";
const AGEING = [
  { value: ALL, label: "Any age" },
  { value: "7", label: "7 days or more" },
  { value: "14", label: "14 days or more" },
  { value: "30", label: "30 days or more" },
  { value: LATE_BY_RULES, label: "Late by the ageing rules" },
];

function personOptions(rows, key, names, allLabel) {
  const ids = [...new Set(rows.map((row) => row[key]).filter(Boolean))];
  return [
    { value: ALL, label: allLabel },
    ...ids.map((id) => ({ value: id, label: names[id] ?? "Unknown" })).sort((a, b) => a.label.localeCompare(b.label)),
  ];
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
          {group.sors.map((sor) => (
            <li key={sor.id} className="flex flex-col gap-1.5 px-4 py-3" data-testid={`sor-${group.key}-${sor.id}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">
                  {sor.direct ? "Direct request" : `${sor.salesReference ?? "No S number"} — ${sor.projectTitle}`}
                </span>
                <span className="tabular-nums text-sm">
                  {sor.itemCount} {group.label.toLowerCase()}
                </span>
              </div>
              {group.key === "on_order" && <DeadlineLine deadline={deadlineOf(sor.id)} />}
              <p className="text-xs text-muted-foreground">All outstanding: {sorSummary(rows, sor.id)}</p>
              <div className="flex flex-wrap gap-1.5">
                {sor.rows.map((row) => (
                  <Button
                    key={`${row.target_kind}-${row.target_id}`}
                    variant="outline"
                    size="sm"
                    onClick={() => onOpen(row)}
                  >
                    {rowLabel(row)} · {row.item_count} · {ageDays(row.since, today)}d
                    {row.target_kind === "ipas" && lateIpasIds.has(row.target_id) ? " · late" : ""}
                  </Button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PurchasingDashboard() {
  const navigate = useNavigate();
  const [sor, setSor] = useState("");
  const [buyerId, setBuyerId] = useState(ALL);
  const [canvasserId, setCanvasserId] = useState(ALL);
  const [age, setAge] = useState(ALL);
  const [noCanvass, setNoCanvass] = useState(false);

  const { data: rows = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["purchasing-dashboard", "rows"],
    queryFn: () => purchasingDashboardService.rows(),
  });
  const peopleIds = useMemo(() => rows.flatMap((row) => [row.buyer_id, row.canvasser_id]), [rows]);
  const { data: names = {} } = useQuery({
    queryKey: ["purchasing-dashboard", "names", [...new Set(peopleIds.filter(Boolean))].sort()],
    queryFn: () => purchasingDashboardService.names(peopleIds),
    enabled: rows.length > 0,
  });

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

  const today = new Date();
  // Whatever is in the On order group is not received yet, so it is marked against the deadline.
  const deadlineOf = (sorId) => {
    const dueAt = deadlines.get(sorId)?.dueAt;
    return dueAt ? deadlineMark({ dueAt, nearDays, today }) : null;
  };
  const filters = {
    sor,
    buyerId: buyerId === ALL ? null : buyerId,
    canvasserId: canvasserId === ALL ? null : canvasserId,
    minAgeDays: age === ALL || age === LATE_BY_RULES ? null : Number(age),
    lateIpasIds: age === LATE_BY_RULES ? lateIpasIds : null,
    noCanvass,
  };
  const view = dashboardView(rows, filters, today);
  const active = Boolean(sor) || buyerId !== ALL || canvasserId !== ALL || age !== ALL || noCanvass;
  const clearAll = () => {
    setSor("");
    setBuyerId(ALL);
    setCanvasserId(ALL);
    setAge(ALL);
    setNoCanvass(false);
  };
  const open = (row) => {
    const link = linkFor(row);
    navigate(link.to, link.state ? { state: link.state } : undefined);
  };
  const ready = !isLoading && !isError;

  return (
    <PageShell
      title="Purchasing Dashboard"
      description="Where every project's buying stands. One SOR shows in every group it has work in."
      toolbar={
        ready ? (
          <FilterBar
            search={{ value: sor, onChange: setSor, placeholder: "Search SOR" }}
            chips={
              <>
                <FilterSelect options={personOptions(rows, "buyer_id", names, "Any Buyer")} value={buyerId} onChange={setBuyerId} label="Buyer" className="h-9 w-auto" />
                <FilterSelect options={personOptions(rows, "canvasser_id", names, "Any Canvasser")} value={canvasserId} onChange={setCanvasserId} label="Canvasser" className="h-9 w-auto" />
                <FilterSelect options={AGEING} value={age} onChange={setAge} label="Ageing" className="h-9 w-auto" />
              </>
            }
            actions={
              <Button variant={noCanvass ? "default" : "outline"} size="sm" aria-pressed={noCanvass} onClick={() => setNoCanvass((value) => !value)}>
                Ordered with no canvass
              </Button>
            }
            hasActiveFilters={active}
            onClearAll={clearAll}
          />
        ) : null
      }
    >
      {isLoading && <PageLoading label="Purchasing Dashboard" />}
      {isError && <QueryError title="The Purchasing Dashboard could not be loaded." onRetry={refetch} />}

      {ready && rows.length === 0 && (
        <EmptyState icon={LayoutDashboard} title="Nothing outstanding" description="No SOR you can read has buying left to do." />
      )}

      {ready && rows.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Group counts">
            {view.groups.map((group) => (
              <div key={group.key} className="rounded-lg border px-3 py-2">
                <div className="text-xs text-muted-foreground">{group.label}</div>
                <div className="text-xl font-semibold tabular-nums">{group.itemCount}</div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {group.sorCount} {group.sorCount === 1 ? "SOR" : "SORs"}
                </div>
              </div>
            ))}
          </div>
          {view.groups.map((group) => (
            <GroupSection key={group.key} group={group} rows={rows} onOpen={open} today={today} lateIpasIds={lateIpasIds} deadlineOf={deadlineOf} />
          ))}
        </>
      )}
    </PageShell>
  );
}

/** Purchasing access, Finance access or a Super Admin; everyone else is sent home. */
export default function PurchasingDashboardPage() {
  const { user, isAuthLoading } = useAuth();
  if (isAuthLoading) return <PageLoading label="Purchasing Dashboard" />;
  const ctx = getPermissionContext(user);
  if (!user || !(ctx.isSuperAdmin || ctx.hasPurchasingFlow || ctx.hasFinanceFlow)) {
    return <Navigate to="/" replace />;
  }
  return <PurchasingDashboard />;
}
