import { useLocation, useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";

import ProtectedRoute from "../../components/ProtectedRoute";
import ModalShell from "../../components/ui/ModalShell";
import CostingDesk from "../../components/costing/desk/CostingDesk";
import PrintButton from "../../components/costing/desk/PrintButton";
import { opportunityService } from "../../services/opportunityService";
import { useAuth } from "../../context/AuthContext";
import { getPermissionContext } from "../../utils/permissions";
import { CostingMatrixList } from "./index";

const LIST_PATH = "/costing-matrix";

/**
 * One SOR's Costing Matrix in the record window (the Costing Desk), over the Costing Matrix list. The
 * URL is the SOR's id and works as a deep link. Opened from an SOR's PMS tab it closes back to that
 * SOR, on its PMS tab; otherwise it closes to the list. Who reads what is the database's to decide:
 * someone who may not read this matrix sees a plain line saying so.
 */
function CostingMatrixWindow() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = location.state?.returnTo ?? null;

  // The SOR's name and numbers for the header; someone who can read the matrix but not the SOR row gets none.
  const { data: opportunity } = useQuery({
    queryKey: ["costingDeskOpportunity", id],
    queryFn: () => opportunityService.getOpportunityById(id),
    enabled: Boolean(id),
    retry: false,
  });

  const close = () => {
    if (returnTo?.path) {
      navigate(returnTo.path);
      if (returnTo.sorId) {
        // Back to the SOR the matrix was opened from, on its PMS tab.
        setTimeout(() => window.dispatchEvent(new CustomEvent("OPEN_ENTITY_DETAILS", { detail: { id: returnTo.sorId, type: "OPPORTUNITY", view: "pms" } })), 0);
      }
      return;
    }
    navigate(LIST_PATH);
  };

  return (
    <ModalShell
      open
      onOpenChange={(next) => !next && close()}
      size="record"
      crumbs={["S0 Evaluation", opportunity?.sor_code ?? "SOR"]}
      headerActions={<PrintButton opportunityId={id} opportunity={opportunity} />}
    >
      <CostingDesk opportunityId={id} opportunity={opportunity} />
    </ModalShell>
  );
}

function Behind() {
  const { user } = useAuth();
  // The list is the Closed Book's page; anyone else opened the window from an SOR and sees no list behind it.
  return getPermissionContext(user).isBidDecider ? <CostingMatrixList /> : null;
}

export default function CostingMatrixRecordPage() {
  return (
    <ProtectedRoute>
      <Behind />
      <CostingMatrixWindow />
    </ProtectedRoute>
  );
}
