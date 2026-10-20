import { useQuery } from "@tanstack/react-query";
import { Navigate, useNavigate, useSearchParams } from "react-router";

import PageShell from "../../../components/ui/PageShell";
import PageLoading from "../../../components/ui/PageLoading";
import TabGroup from "../../../components/ui/TabGroup";
import PurchaseRequestSlideOver from "../../../components/purchase-request/PurchaseRequestSlideOver";
import { usePurchaseRequest } from "../../../components/purchase-request/requestHooks";
import { useAuth } from "../../../context/AuthContext";
import { useRecordParam } from "../../../hooks/useRecordParam";
import { orderMonitoringService } from "../../../services/orderMonitoringService";
import { getPermissionContext } from "../../../utils/permissions";
import { linkFor } from "../../../utils/purchasingDashboard";
import Projects, { ProjectsToolbar } from "./_components/Projects";
import { useProjectsFilters } from "./_components/useProjectsFilters";
import NeedsDoing from "../order-monitoring/_components/NeedsDoing";
import OrderRegister, { OrderRegisterToolbar } from "../order-monitoring/_components/OrderRegister";
import { useOrderRegisterFilters } from "../order-monitoring/_components/useOrderRegisterFilters";

/**
 * The Purchasing Dashboard (#322, ADR 0034's feedback session): one page, three
 * level-1 tabs that stay separate views. Projects groups every project's buying
 * by what is outstanding; Order Monitoring's What needs doing and Register
 * (#263, #264) list every open IPAS and every order. It opens on What needs
 * doing; the tab lives in `?tab=`, which the old `/purchasing/order-monitoring`
 * redirects to.
 *
 * A Purchase Request picked on Projects opens here, in its slide-over
 * (`?request=`, like the Purchase Requests list); every other record opens the
 * place that owns it.
 */

const DASHBOARD_TAB = { PROJECTS: "projects", NEEDS: "needs", REGISTER: "register" };
const TABS = [
  { value: DASHBOARD_TAB.PROJECTS, label: "Projects" },
  { value: DASHBOARD_TAB.NEEDS, label: "What needs doing" },
  { value: DASHBOARD_TAB.REGISTER, label: "Register" },
];

/** The register's filter choices come from the open-order list What needs doing also reads. */
function RegisterToolbar({ register }) {
  const { data: rows = [], isLoading, isError } = useQuery({
    queryKey: ["order-monitoring", "list"],
    queryFn: () => orderMonitoringService.list(),
  });
  if (isLoading || isError) return null;
  return <OrderRegisterToolbar register={register} options={rows} />;
}

function PurchasingDashboard({ userId }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.value === params.get("tab")) ? params.get("tab") : DASHBOARD_TAB.NEEDS;
  const changeTab = (value) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", value);
        return next;
      },
      { replace: true },
    );

  const projects = useProjectsFilters();
  const register = useOrderRegisterFilters();
  const { recordId, open, close } = useRecordParam("request");
  const { data: request = null } = usePurchaseRequest(recordId);

  const openProjectRow = (row) => {
    if (row.target_kind === "purchase_request") {
      open(row.target_id);
      return;
    }
    const link = linkFor(row);
    navigate(link.to, link.state ? { state: link.state } : undefined);
  };
  const openIpas = (id) => navigate(`/purchasing/ipas/${id}`);

  const toolbar = {
    [DASHBOARD_TAB.PROJECTS]: <ProjectsToolbar filters={projects} />,
    [DASHBOARD_TAB.NEEDS]: null,
    [DASHBOARD_TAB.REGISTER]: <RegisterToolbar register={register} />,
  }[tab];

  return (
    <>
      <PageShell
        title="Purchasing Dashboard"
        description="Where every project's buying stands, and what needs doing today."
        tabs={<TabGroup variant="underline" tabs={TABS} activeTab={tab} onChange={changeTab} />}
        toolbar={toolbar}
      >
        {tab === DASHBOARD_TAB.PROJECTS && <Projects filters={projects} onOpen={openProjectRow} />}
        {tab === DASHBOARD_TAB.NEEDS && <NeedsDoing onOpen={openIpas} />}
        {tab === DASHBOARD_TAB.REGISTER && <OrderRegister onOpen={openIpas} query={register.query} />}
      </PageShell>

      <PurchaseRequestSlideOver
        request={recordId ? request : null}
        userId={userId}
        crumb="Purchasing Dashboard"
        onClose={close}
      />
    </>
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
  return <PurchasingDashboard userId={user.id} />;
}
