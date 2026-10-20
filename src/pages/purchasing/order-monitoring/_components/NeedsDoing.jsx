import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ListChecks } from "lucide-react";

import EmptyState from "../../../../components/ui/EmptyState";
import PageLoading from "../../../../components/ui/PageLoading";
import QueryError from "../../../../components/ui/QueryError";
import { Button } from "../../../../components/ui/button";
import { orderMonitoringService } from "../../../../services/orderMonitoringService";
import { ORDER_GROUP, ORDER_GROUP_LABELS, ORDER_GROUPS } from "../../../../constants/orderMonitoring";
import GroupTable from "./GroupTable";
import Tiles from "./Tiles";

const OPEN_GROUPS = ORDER_GROUPS.filter((group) => group !== ORDER_GROUP.FILED);

/**
 * Order Monitoring's What needs doing (#263, spec #261), a Purchasing Dashboard
 * tab: every open IPAS across every SOR. Four totals, then the groups: Needs
 * chasing, Waiting on us, Waiting on someone else, and Filed (collapsed). Each
 * line leads with the one next thing and who owes it; `onOpen(id)` opens its IPAS.
 */
export default function NeedsDoing({ onOpen }) {
  const [filedOpen, setFiledOpen] = useState(false);

  const { data: rows = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["order-monitoring", "list"],
    queryFn: () => orderMonitoringService.list(),
  });
  const { data: counts } = useQuery({
    queryKey: ["order-monitoring", "counts"],
    queryFn: () => orderMonitoringService.counts(),
  });

  if (isLoading) return <PageLoading label="Order Monitoring" />;
  if (isError) return <QueryError title="Order Monitoring could not be loaded." onRetry={refetch} />;

  const grouped = Object.fromEntries(ORDER_GROUPS.map((group) => [group, rows.filter((row) => row.group === group)]));
  const filed = grouped[ORDER_GROUP.FILED];

  return (
    <div className="flex flex-col gap-8">
      <Tiles counts={counts} />

      {rows.length === 0 && (
        <EmptyState icon={ListChecks} title="No open orders" description="Every IPAS you can read is filed or cancelled." />
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
