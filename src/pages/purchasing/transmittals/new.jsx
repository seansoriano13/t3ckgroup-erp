import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";

import ProtectedRoute from "../../../components/ProtectedRoute";
import ModalShell from "../../../components/ui/ModalShell";
import EmptyState from "../../../components/ui/EmptyState";
import PageLoading from "../../../components/ui/PageLoading";
import TransmittalForm from "../../../components/transmittals/TransmittalForm";
import { transmittalKeys } from "../../../components/transmittals/transmittalKeys";
import { useAuth } from "../../../context/AuthContext";
import { getPermissionContext } from "../../../utils/permissions";
import { transmittalService } from "../../../services/transmittalService";
import { TRANSMITTAL_ORIGIN, TRANSMITTAL_STAFF_LIST } from "../../../constants/transmittals";
import TransmittalsListPage from "./index";

const LIST_PATH = "/purchasing/transmittals";

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

  const [actionsSlot, setActionsSlot] = useState(null);
  const close = () => navigate(LIST_PATH);

  return (
    <ModalShell
      open
      onOpenChange={(next) => !next && close()}
      size="wide"
      expandable
      crumbs={["Transmittal", "Raise a Transmittal"]}
      actionsRef={setActionsSlot}
    >
      {checking || loadingLists ? (
        <PageLoading label="Transmittal" />
      ) : !canPrepare ? (
        <EmptyState
          title="You can't raise a Transmittal"
          description="Purchasing, and the Warehouse and Logistics lists, raise TG03 slips."
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Pick the lines, set the slip, then Submit to open its first stage.
          </p>
          <TransmittalForm
            defaultOrigin={originFor({ hasPurchasingFlow, lists })}
            onSaved={(id) => navigate(`/purchasing/transmittals/${id}`)}
            actionsSlot={actionsSlot}
          />
        </>
      )}
    </ModalShell>
  );
}

export default function NewTransmittalPage() {
  // A modal over the Transmittals list; the URL keeps working as a deep link.
  return (
    <>
      <TransmittalsListPage />
      <ProtectedRoute>
        <NewTransmittal />
      </ProtectedRoute>
    </>
  );
}
