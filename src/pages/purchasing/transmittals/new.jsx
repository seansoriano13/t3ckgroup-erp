import { Link, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";

import ProtectedRoute from "../../../components/ProtectedRoute";
import PageShell from "../../../components/ui/PageShell";
import EmptyState from "../../../components/ui/EmptyState";
import PageLoading from "../../../components/ui/PageLoading";
import { Button } from "../../../components/ui/button";
import TransmittalForm from "../../../components/transmittals/TransmittalForm";
import { transmittalKeys } from "../../../components/transmittals/transmittalKeys";
import { useAuth } from "../../../context/AuthContext";
import { getPermissionContext } from "../../../utils/permissions";
import { transmittalService } from "../../../services/transmittalService";
import { TRANSMITTAL_ORIGIN, TRANSMITTAL_STAFF_LIST } from "../../../constants/transmittals";

/** The preparer's side, which Origin defaults to: Purchasing, then the Warehouse, then Logistics. */
function originFor({ hasPurchasingFlow, lists }) {
  if (hasPurchasingFlow) return TRANSMITTAL_ORIGIN.PURCHASING;
  if (lists.includes(TRANSMITTAL_STAFF_LIST.WAREHOUSE)) return TRANSMITTAL_ORIGIN.WAREHOUSE;
  if (lists.includes(TRANSMITTAL_STAFF_LIST.LOGISTICS)) return TRANSMITTAL_ORIGIN.LOGISTICS;
  return "";
}

/**
 * Raises a Transmittal (#252): a draft slip, submitted from here or later. The
 * database decides who may raise one (Purchasing access, or the Warehouse or
 * Logistics list); the page asks it first, so nobody fills a form it refuses.
 */
function NewTransmittal() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { hasPurchasingFlow } = getPermissionContext(user);

  const { data: canPrepare, isLoading: checking } = useQuery({
    queryKey: [...transmittalKeys.list, "can-prepare", user?.id],
    queryFn: () => transmittalService.canPrepare(),
    enabled: Boolean(user?.id),
  });
  const { data: lists = [], isLoading: loadingLists } = useQuery({
    queryKey: [...transmittalKeys.list, "my-lists", user?.id],
    queryFn: () => transmittalService.myStaffLists(user?.id),
    enabled: Boolean(user?.id),
  });

  const back = (
    <Button variant="outline" size="sm" asChild className="gap-1.5">
      <Link to="/purchasing/transmittals">
        <ArrowLeft size={14} />
        Transmittals
      </Link>
    </Button>
  );

  return (
    <PageShell
      title="Raise a Transmittal"
      description="Tick the slip as on paper, then add the lines. Submit to open its first stage."
      action={back}
    >
      {checking || loadingLists ? (
        <PageLoading label="Transmittal" />
      ) : !canPrepare ? (
        <EmptyState
          title="You can't raise a Transmittal"
          description="Purchasing, and the Warehouse and Logistics lists, raise TG03 slips."
        />
      ) : (
        <TransmittalForm
          defaultOrigin={originFor({ hasPurchasingFlow, lists })}
          onSaved={(id) => navigate(`/purchasing/transmittals/${id}`)}
          onCancel={() => navigate("/purchasing/transmittals")}
        />
      )}
    </PageShell>
  );
}

export default function NewTransmittalPage() {
  return (
    <ProtectedRoute>
      <NewTransmittal />
    </ProtectedRoute>
  );
}
