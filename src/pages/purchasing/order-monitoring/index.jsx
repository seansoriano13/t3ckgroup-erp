import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useNavigate } from "react-router";
import { ChevronDown, ChevronRight, ListChecks } from "lucide-react";

import PageShell from "../../../components/ui/PageShell";
import EmptyState from "../../../components/ui/EmptyState";
import PageLoading from "../../../components/ui/PageLoading";
import QueryError from "../../../components/ui/QueryError";
import { Button } from "../../../components/ui/button";
import { Card, CardContent } from "../../../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { useAuth } from "../../../context/AuthContext";
import { orderMonitoringService } from "../../../services/orderMonitoringService";
import { getPermissionContext } from "../../../utils/permissions";
import { formatAmount } from "../../../utils/ipas";
import {
  ORDER_GROUP,
  ORDER_GROUP_LABELS,
  ORDER_GROUPS,
  ORDER_OWNER_LABELS,
} from "../../../constants/orderMonitoring";

/**
 * Order Monitoring (#263, spec #261): every open IPAS across every SOR, opening
 * on what needs doing. Four tiles, then the groups: Needs chasing, Waiting on
 * us, Waiting on someone else, and Filed (collapsed). Each line leads with the
 * one next thing and who owes it. Opening a line goes to its IPAS.
 *
 * Purchasing access, Finance access and Super Admins see the page; anyone
 * else is sent home. The database decides which IPAS each may read.
 */

const HEAD = "text-label font-bold uppercase tracking-wider";
const OPEN_GROUPS = ORDER_GROUPS.filter((group) => group !== ORDER_GROUP.FILED);

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** "3 days" in the wait column, with how far past its rule a late line is. */
function WaitCell({ row }) {
  return (
    <div className="flex flex-col">
      <span className="tabular-nums">{plural(row.daysWaiting ?? 0, "day")}</span>
      {row.late && (
        <span className="text-xs font-semibold text-destructive">
          {plural(row.daysPastRule, "day")} past its {row.ruleDays}-day rule
        </span>
      )}
    </div>
  );
}

function OrderRow({ row, onOpen }) {
  const detail = row.next?.detail;
  return (
    <TableRow className="cursor-pointer" onClick={() => onOpen(row.id)}>
      <TableCell>
        <div className="font-medium">{row.next?.label}</div>
        {detail && (
          <div className="text-xs text-muted-foreground">
            Latest supplier date: {detail.label}, {detail.on}
          </div>
        )}
      </TableCell>
      <TableCell>{ORDER_OWNER_LABELS[row.next?.owner] ?? "—"}</TableCell>
      <TableCell>
        <WaitCell row={row} />
      </TableCell>
      <TableCell>
        <span className="font-mono font-semibold">{row.number}</span>
        <div className="text-xs text-muted-foreground">PO {row.poNumber}</div>
      </TableCell>
      <TableCell>
        {row.sors.length ? row.sors.map((sor) => sor.salesReference).join(", ") : "No SOR"}
        <div className="text-xs text-muted-foreground">{row.entity ?? "—"}</div>
      </TableCell>
      <TableCell>{row.supplier ?? "—"}</TableCell>
    </TableRow>
  );
}

function GroupTable({ rows, onOpen }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="overflow-x-auto">
        <Table tableId="order-monitoring" className="md:min-w-[48rem]">
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              {["Next thing", "Owed by", "Waiting", "IPAS and PO", "SOR and entity", "Supplier"].map((heading) => (
                <TableHead key={heading} className={HEAD}>
                  {heading}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <OrderRow key={row.id} row={row} onOpen={onOpen} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function Tile({ label, children }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-4">
        <span className="text-label font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
        {children}
      </CardContent>
    </Card>
  );
}

function Tiles({ counts }) {
  if (!counts) return null;
  return (
    <section aria-label="Totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile label="Needs chasing">
        <span className="text-2xl font-bold tabular-nums">{counts.needsChasing}</span>
      </Tile>
      <Tile label="Waiting on us">
        <span className="text-2xl font-bold tabular-nums">{counts.waitingOnUs}</span>
      </Tile>
      <Tile label="Waiting on someone else">
        <span className="text-2xl font-bold tabular-nums">{counts.waitingOnOthers}</span>
      </Tile>
      <Tile label="Value open">
        {counts.valueOpen.length === 0 ? (
          <span className="text-2xl font-bold tabular-nums">—</span>
        ) : (
          counts.valueOpen.map((value) => (
            <span key={value.currency ?? "none"} className="text-base font-semibold tabular-nums">
              {formatAmount(value.total, value.currency)}
            </span>
          ))
        )}
      </Tile>
    </section>
  );
}

function OrderMonitoringList() {
  const navigate = useNavigate();
  const [filedOpen, setFiledOpen] = useState(false);

  const { data: rows = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["order-monitoring", "list"],
    queryFn: () => orderMonitoringService.list(),
  });
  const { data: counts } = useQuery({
    queryKey: ["order-monitoring", "counts"],
    queryFn: () => orderMonitoringService.counts(),
  });

  const open = (id) => navigate(`/purchasing/ipas/${id}`);
  const grouped = Object.fromEntries(ORDER_GROUPS.map((group) => [group, rows.filter((row) => row.group === group)]));
  const filed = grouped[ORDER_GROUP.FILED];

  return (
    <PageShell
      frame="full"
      title="Order Monitoring"
      description="Every open order across every SOR, grouped by what needs doing next."
    >
      {isLoading && <PageLoading label="Order Monitoring" />}
      {isError && <QueryError title="Order Monitoring could not be loaded." onRetry={refetch} />}

      {!isLoading && !isError && (
        <>
          <Tiles counts={counts} />

          {rows.length === 0 && (
            <EmptyState
              icon={ListChecks}
              title="No open orders"
              description="Every IPAS you can read is filed or cancelled."
            />
          )}

          {OPEN_GROUPS.map((group) =>
            grouped[group].length === 0 ? null : (
              <section key={group} aria-labelledby={`group-${group}`} className="flex flex-col gap-2">
                <h2 id={`group-${group}`} className="text-base font-semibold">
                  {ORDER_GROUP_LABELS[group]} <span className="tabular-nums text-muted-foreground">({grouped[group].length})</span>
                </h2>
                <GroupTable rows={grouped[group]} onOpen={open} />
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
              {filedOpen && <GroupTable rows={filed} onOpen={open} />}
            </section>
          )}
        </>
      )}
    </PageShell>
  );
}

/** Purchasing access, Finance access or a Super Admin; everyone else is sent home. */
export default function OrderMonitoringPage() {
  const { user, isAuthLoading } = useAuth();
  if (isAuthLoading) return <PageLoading label="Order Monitoring" />;
  const ctx = getPermissionContext(user);
  if (!user || !(ctx.isSuperAdmin || ctx.hasPurchasingFlow || ctx.hasFinanceFlow)) {
    return <Navigate to="/" replace />;
  }
  return <OrderMonitoringList />;
}
