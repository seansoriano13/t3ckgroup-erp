import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useNavigate } from "react-router";
import { ChevronDown, ChevronRight, ListChecks } from "lucide-react";

import PageShell from "../../../components/ui/PageShell";
import EmptyState from "../../../components/ui/EmptyState";
import PageLoading from "../../../components/ui/PageLoading";
import QueryError from "../../../components/ui/QueryError";
import { Button } from "../../../components/ui/button";
import { useAuth } from "../../../context/AuthContext";
import { orderMonitoringService } from "../../../services/orderMonitoringService";
import { getPermissionContext } from "../../../utils/permissions";
import { ORDER_GROUP, ORDER_GROUP_LABELS, ORDER_GROUPS } from "../../../constants/orderMonitoring";
import TabGroup from "../../../components/ui/TabGroup";
import GroupTable from "./_components/GroupTable";
import OrderRegister, { OrderRegisterToolbar } from "./_components/OrderRegister";
import { useOrderRegisterFilters } from "./_components/useOrderRegisterFilters";
import Tiles from "./_components/Tiles";

/**
 * Order Monitoring (#263, spec #261): every open IPAS across every SOR, opening
 * on what needs doing. Four tiles, then the groups: Needs chasing, Waiting on
 * us, Waiting on someone else, and Filed (collapsed). Each line leads with the
 * one next thing and who owes it. Opening a line goes to its IPAS.
 *
 * Purchasing access, Finance access and Super Admins see the page; anyone
 * else is sent home. The database decides which IPAS each may read.
 *
 * A switch (#264) moves between What needs doing and the Register, the full
 * list behind it. The choice is remembered per person in the browser; storage
 * that is missing or throws only means the page opens on What needs doing.
 */

const OPEN_GROUPS = ORDER_GROUPS.filter((group) => group !== ORDER_GROUP.FILED);

const VIEW = { NEEDS: "needs", REGISTER: "register" };
const VIEW_TABS = [
  { value: VIEW.NEEDS, label: "What needs doing" },
  { value: VIEW.REGISTER, label: "Register" },
];
const viewKey = (userId) => `order_monitoring_view:${userId ?? "anon"}`;

function readView(userId) {
  try {
    return localStorage.getItem(viewKey(userId)) === VIEW.REGISTER ? VIEW.REGISTER : VIEW.NEEDS;
  } catch {
    return VIEW.NEEDS;
  }
}

function writeView(userId, view) {
  try {
    localStorage.setItem(viewKey(userId), view);
  } catch {
    // Storage is blocked or full: the choice just isn't remembered.
  }
}

function OrderMonitoringList({ userId }) {
  const navigate = useNavigate();
  const [filedOpen, setFiledOpen] = useState(false);
  const [view, setView] = useState(() => readView(userId));
  const register = useOrderRegisterFilters();
  const changeView = (next) => {
    setView(next);
    writeView(userId, next);
  };

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
  const ready = !isLoading && !isError;

  return (
    <PageShell
      title="Order Monitoring"
      description="Every open order across every SOR, grouped by what needs doing next."
      tabs={ready ? <TabGroup tabs={VIEW_TABS} activeTab={view} onChange={changeView} /> : null}
      toolbar={ready && view === VIEW.REGISTER ? <OrderRegisterToolbar register={register} options={rows} /> : null}
    >
      {isLoading && <PageLoading label="Order Monitoring" />}
      {isError && <QueryError title="Order Monitoring could not be loaded." onRetry={refetch} />}

      {ready && (
        <>
          {view === VIEW.REGISTER && <OrderRegister onOpen={open} query={register.query} />}

          {view === VIEW.NEEDS && <Tiles counts={counts} />}

          {view === VIEW.NEEDS && rows.length === 0 && (
            <EmptyState
              icon={ListChecks}
              title="No open orders"
              description="Every IPAS you can read is filed or cancelled."
            />
          )}

          {OPEN_GROUPS.map((group) =>
            view !== VIEW.NEEDS || grouped[group].length === 0 ? null : (
              <section key={group} aria-labelledby={`group-${group}`} className="flex flex-col gap-2">
                <h2 id={`group-${group}`} className="text-base font-semibold">
                  {ORDER_GROUP_LABELS[group]} <span className="tabular-nums text-muted-foreground">({grouped[group].length})</span>
                </h2>
                <GroupTable rows={grouped[group]} onOpen={open} />
              </section>
            ),
          )}

          {view === VIEW.NEEDS && filed.length > 0 && (
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
  return <OrderMonitoringList userId={user.id} />;
}
