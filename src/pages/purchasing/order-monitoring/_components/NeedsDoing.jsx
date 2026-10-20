import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ListChecks } from "lucide-react";

import EmptyState from "../../../../components/ui/EmptyState";
import PageLoading from "../../../../components/ui/PageLoading";
import QueryError from "../../../../components/ui/QueryError";
import { Button } from "../../../../components/ui/button";
import { FilterSelect } from "../../../../components/ui/FilterDropdown";
import TabHeader from "../../dashboard/_components/TabHeader";
import { IPAS_SOURCE_LABELS } from "../../../../constants/ipas";
import { orderMonitoringService } from "../../../../services/orderMonitoringService";
import { ORDER_GROUP, ORDER_GROUP_LABELS, ORDER_GROUPS } from "../../../../constants/orderMonitoring";
import GroupTable from "./GroupTable";
import { needsDoingStats } from "./Tiles";
import { ALL, applyNeedsDoingFilters } from "./useNeedsDoingFilters";

const optionsOf = (values, allLabel) => [
  { value: ALL, label: allLabel },
  ...[...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b)).map((value) => ({ value, label: value })),
];

const OPEN_GROUPS = ORDER_GROUPS.filter((group) => group !== ORDER_GROUP.FILED);

/**
 * Order Monitoring's What needs doing (#263, spec #261), a Purchasing Dashboard
 * tab: every open IPAS across every SOR. Four totals, then the groups: Needs
 * chasing, Waiting on us, Waiting on someone else, and Filed (collapsed). Each
 * line leads with the one next thing and who owes it; `onOpen(id)` opens its IPAS.
 */
export default function NeedsDoing({ onOpen, filters: f }) {
  const [filedOpen, setFiledOpen] = useState(false);

  const { data: rows = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["order-monitoring", "list"],
    queryFn: () => orderMonitoringService.list(),
  });
  if (isLoading) return <PageLoading label="Order Monitoring" />;
  if (isError) return <QueryError title="Order Monitoring could not be loaded." onRetry={refetch} />;

  const shown = applyNeedsDoingFilters(rows, f);
  const grouped = Object.fromEntries(ORDER_GROUPS.map((group) => [group, shown.filter((row) => row.group === group)]));
  const choices = {
    entity: optionsOf(rows.map((row) => row.entity), "All entities"),
    supplier: optionsOf(rows.map((row) => row.supplier), "All suppliers"),
  };
  const filed = grouped[ORDER_GROUP.FILED];

  return (
    <div className="flex flex-col gap-8">
      <TabHeader
        statsLabel="Totals"
        stats={needsDoingStats(shown)}
        bar={{
          search: { value: f.search, onChange: f.setSearch, placeholder: "Search IPAS, PO or S number" },
          chips: (
            <>
              <FilterSelect
                options={[{ value: ALL, label: "Every group" }, ...ORDER_GROUPS.map((group) => ({ value: group, label: ORDER_GROUP_LABELS[group] }))]}
                value={f.filters.group}
                onChange={f.set("group")}
                label="Group"
                className="h-9 w-auto"
              />
              <FilterSelect options={choices.entity} value={f.filters.entity} onChange={f.set("entity")} label="Entity" className="h-9 w-auto" />
              <FilterSelect
                options={[{ value: ALL, label: "Import and Local" }, ...Object.entries(IPAS_SOURCE_LABELS).map(([value, label]) => ({ value, label }))]}
                value={f.filters.source}
                onChange={f.set("source")}
                label="Source"
                className="h-9 w-auto"
              />
            </>
          ),
          filters: (
            <div className="flex flex-col gap-2 p-2">
              <FilterSelect options={choices.supplier} value={f.filters.supplier} onChange={f.set("supplier")} label="Supplier" />
              <FilterSelect
                options={[{ value: ALL, label: "Late or not" }, { value: "late", label: "Late by the ageing rules" }]}
                value={f.filters.late}
                onChange={f.set("late")}
                label="Ageing"
              />
            </div>
          ),
          activeCount: [f.filters.supplier, f.filters.late].filter((value) => value !== ALL).length,
          hasActiveFilters: f.hasActiveFilters,
          onClearAll: f.clearAll,
        }}
      />

      {shown.length === 0 && (
        <EmptyState icon={ListChecks} title={rows.length === 0 ? "No open orders" : "No orders match"}
          description={rows.length === 0 ? "Every IPAS you can read is filed or cancelled." : "Change the search or the filters."} />
      )}

      {OPEN_GROUPS.map((group) =>
        grouped[group].length === 0 ? null : (
          <section key={group} aria-labelledby={`group-${group}`} className="flex flex-col gap-2">
            <h2 id={`group-${group}`} className="text-base font-semibold">
              {ORDER_GROUP_LABELS[group]} <span className="tabular-nums text-muted-foreground">({grouped[group].length})</span>
            </h2>
            <GroupTable rows={grouped[group]} onOpen={onOpen} />
          </section>
        ),
      )}

      {filed.length > 0 && (
        <section aria-label="Filed" className="flex flex-col gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-fit gap-1.5"
            aria-expanded={filedOpen}
            onClick={() => setFiledOpen((value) => !value)}
          >
            {filedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {ORDER_GROUP_LABELS[ORDER_GROUP.FILED]} <span className="tabular-nums">({filed.length})</span>
          </Button>
          {filedOpen && <GroupTable rows={filed} onOpen={onOpen} />}
        </section>
      )}
    </div>
  );
}
