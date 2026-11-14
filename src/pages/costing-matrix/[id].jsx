import { useLocation, useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import ProtectedRoute from "../../components/ProtectedRoute";
import { costingKeys } from "../../components/costing/costingKeys";
import { useCostingMatrix } from "../../components/costing/useCostingMatrix";
import ModalShell from "../../components/ui/ModalShell";
import { Button } from "../../components/ui/button";
import CostingDesk from "../../components/costing/desk/CostingDesk";
import PrintButton from "../../components/costing/desk/PrintButton";
import { opportunityService } from "../../services/opportunityService";
import { costingMatrixService } from "../../services/costingMatrixService";
import { useAuth } from "../../context/AuthContext";
import { getPermissionContext } from "../../utils/permissions";
import { CostingMatrixList } from "./index";

const LIST_PATH = "/costing-matrix";

/**
 * One SOR's Costing Matrix in the record window (the Costing Desk), over the Costing Matrix list. The
 * URL is the SOR's id (or, for an evaluation started from an S0 alone, its own id; #966) and works as a deep link. Opened from an SOR's PMS tab it closes back to that
 * SOR, on its PMS tab; otherwise it closes to the list. Who reads what is the database's to decide:
 * someone who may not read this matrix sees a plain line saying so.
 */
function CostingMatrixWindow() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const returnTo = location.state?.returnTo ?? null;

  // The SOR's name and numbers for the header; falls back to the narrow header read when the full SOR cannot be read (#836).
  const { data: opportunity } = useQuery({
    queryKey: ["costingDeskOpportunity", id],
    queryFn: async () => {
      try {
        const full = await opportunityService.getOpportunityById(id);
        if (full) return full;
      } catch {
        // Fall back to the narrow header read when the caller cannot read the full SOR row (#836).
      }
      return costingMatrixService.getHeader(id);
    },
    enabled: Boolean(id),
    retry: false,
  });

  // The same read the sheet makes (one shared query): when it gives nothing, the header offers no actions.
  const { data: matrix } = useCostingMatrix(id);
  const readable = Boolean(matrix);

  const close = () => {
    // The list behind the window shows this SOR's figures; closing the sheet brings them up to date (#892).
    queryClient.invalidateQueries({ queryKey: costingKeys.matrixPage });
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

  // The way to the SOR's PMS tab, where its IPAS are listed (#718, story 58).
  const openPms = () => window.dispatchEvent(new CustomEvent("OPEN_ENTITY_DETAILS", { detail: { id, type: "OPPORTUNITY", view: "pms" } }));

  return (
    <ModalShell
      open
      onOpenChange={(next) => !next && close()}
      size="record"
      crumbs={["S0 Evaluation", opportunity?.standalone ? `${opportunity.sales_reference ?? "S0"} · No SOR` : (opportunity?.sor_code ?? "SOR")]}
      headerActions={
        // Someone who may not read the evaluation gets no actions above "not yours to see" (#1038).
        readable ? (
          <>
            {!opportunity?.standalone && (
              <Button type="button" size="sm" variant="outline" onClick={openPms}>
                SOR PMS tab
              </Button>
            )}
            <PrintButton opportunityId={id} opportunity={opportunity} />
          </>
        ) : null
      }
    >
      <CostingDesk opportunityId={id} opportunity={opportunity} />
    </ModalShell>
  );
}

function Behind() {
  const { user } = useAuth();
  // The list is the Closed Book's page and the page of whoever is named on a standalone evaluation; anyone else opened
  // the window from an SOR and sees no list behind it.
  return getPermissionContext(user).canOpenCostingPage ? <CostingMatrixList /> : null;
}

export default function CostingMatrixRecordPage() {
  return (
    <ProtectedRoute>
      <Behind />
      <CostingMatrixWindow />
    </ProtectedRoute>
  );
}
