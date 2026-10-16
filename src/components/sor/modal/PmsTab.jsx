import CostingMatrixSection from "../../costing/CostingMatrixSection";
import IpasSorSection from "../../ipas/IpasSorSection";
import HandoffsSorSection from "../HandoffsSorSection";

/**
 * PMS (#267): one SOR's purchasing file. The Costing Matrix, then the IPAS
 * summaries (#249, #265) and the Transmittals and Packing Lists (#257), which
 * moved here from the Summary and This stage unchanged. Each section renders
 * nothing when it has nothing to show, so an SOR with no matrix yet and no
 * orders shows an empty page, not an error.
 */
export default function PmsTab({ opportunityId }) {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 p-6">
      {/* #267: renders nothing until the SOR's Costing Matrix has been opened (#462). */}
      <CostingMatrixSection opportunityId={opportunityId} />

      {/* #249: renders nothing when no IPAS names this SOR (or the viewer cannot read it). */}
      <IpasSorSection opportunityId={opportunityId} />

      {/* #257: renders nothing when no Transmittal or Packing List names this SOR. */}
      <HandoffsSorSection opportunityId={opportunityId} />
    </div>
  );
}
