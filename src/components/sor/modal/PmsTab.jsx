import CostingMatrixSection from "../../costing/CostingMatrixSection";
import { useCostingTier } from "../../costing/useCostingMatrix";
import IpasSorSection from "../../ipas/IpasSorSection";
import HandoffsSorSection from "../HandoffsSorSection";
import PurchaseRequestCard from "./PurchaseRequestCard";

/**
 * PMS (#267): one SOR's purchasing file. The Costing Matrix, then the Purchase
 * Request card (#310), the IPAS summaries (#249, #265) and the Transmittals and
 * Packing Lists (#257), which moved here from the Summary and This stage
 * unchanged. Each section but the matrix renders nothing when it has nothing to
 * show; before the matrix opens it says so in one plain line. Either way an SOR
 * with no matrix yet and no orders shows a calm page, not an error.
 */
export default function PmsTab({ opportunityId, opportunity }) {
  // The tab is for everyone who can see the SOR (Finance gets the IPAS here, #319); the matrix section
  // only for a viewer with a Costing Matrix read tier. Each other section keeps its own visibility rule.
  const { data: costingTier } = useCostingTier(opportunityId);
  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 p-6">
      {/* #267: the grid once the SOR's Costing Matrix has been opened (#462); until then one plain line. */}
      {costingTier && <CostingMatrixSection opportunityId={opportunityId} opportunity={opportunity} />}

      {/* #310: renders nothing for an SOR with no Purchase Request. Moved here from the Summary and This stage (#268). */}
      <PurchaseRequestCard opportunityId={opportunityId} />

      {/* #249: renders nothing when no IPAS names this SOR (or the viewer cannot read it). */}
      <IpasSorSection opportunityId={opportunityId} />

      {/* #257: renders nothing when no Transmittal or Packing List names this SOR. */}
      <HandoffsSorSection opportunityId={opportunityId} />
    </div>
  );
}
