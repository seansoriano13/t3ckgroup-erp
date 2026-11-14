import { useLocation, useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";

import ProtectedRoute from "../../../components/ProtectedRoute";
import ModalShell from "../../../components/ui/ModalShell";
import { Button } from "../../../components/ui/button";
import PageShell from "../../../components/ui/PageShell";
import RecordNotFound from "../../../components/ui/RecordNotFound";
import PmsSections from "../../../components/sor/modal/PmsSections";
import { opportunityService } from "../../../services/opportunityService";
import { costingMatrixService } from "../../../services/costingMatrixService";
import { isRecordId, itemToRecordKey, withRecord } from "../../../utils/recordLink";

// Close with no earlier page to return to lands on the Purchasing Dashboard.
const LIST_PATH = "/purchasing/dashboard";

/**
 * One SOR's PMS file on its own page (#1021, B1), in the record window: the same sections as the
 * SOR window's PMS tab (PmsSections), without the SOR window around it. The URL is the SOR's id and works
 * as a deep link. Each section keeps its own read rule; the page adds none. An SOR that is gone, or that
 * the reader may not see at all, shows one plain "not found, or not yours to see" block.
 */
function PmsWindow() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = location.state?.returnTo?.path ?? null;

  // Same header read as the S0 Evaluation page: the full SOR, else the narrow header read (#836).
  const { data: opportunity, isLoading } = useQuery({
    queryKey: ["pmsPageOpportunity", id],
    queryFn: async () => {
      try {
        const full = await opportunityService.getOpportunityById(id);
        if (full) return full;
      } catch {
        // Fall back to the narrow header read when the caller cannot read the full SOR row (#836).
      }
      try {
        return await costingMatrixService.getHeader(id);
      } catch {
        return null;
      }
    },
    // An id that is not an id is not found, with no request sent (#1027).
    enabled: isRecordId(id),
    retry: false,
  });

  const close = () => navigate(returnTo || LIST_PATH);
  const openSor = () => {
    const params = withRecord(new URLSearchParams(), itemToRecordKey({ id, type: "OPPORTUNITY" }), "pms");
    navigate({ pathname: "/sors", search: `?${params}` });
  };

  return (
    <ModalShell
      open
      onOpenChange={(next) => !next && close()}
      size="record"
      crumbs={["PMS", opportunity ? [opportunity.sor_code ?? "SOR", opportunity.sales_reference].filter(Boolean).join(" · ") : "SOR"]}
      headerActions={
        opportunity && !opportunity.standalone ? (
          <Button type="button" size="sm" variant="outline" onClick={openSor}>
            Open SOR
          </Button>
        ) : null
      }
    >
      {isRecordId(id) && isLoading ? (
        <p className="text-sm text-muted-foreground">Loading the PMS file…</p>
      ) : !opportunity ? (
        <div data-testid="record-not-found">
          <RecordNotFound recordType="SOR" onBack={close} backLabel="Close" />
        </div>
      ) : (
        <PmsSections opportunityId={id} opportunity={opportunity} />
      )}
    </ModalShell>
  );
}

export default function PmsRecordPage() {
  return (
    <ProtectedRoute>
      <PageShell title="PMS file" description="One SOR's purchasing file.">
        <PmsWindow />
      </PageShell>
    </ProtectedRoute>
  );
}
