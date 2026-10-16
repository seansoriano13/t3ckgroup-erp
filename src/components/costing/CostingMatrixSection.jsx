import { Calculator } from "lucide-react";

import SectionHeader from "../ui/SectionHeader";
import { useAuth } from "../../context/AuthContext";
import { useCostingMatrix } from "./useCostingMatrix";
import TenderLineGrid from "./TenderLineGrid";

/**
 * The Costing Matrix section of the PMS tab (#267). It renders only once the
 * SOR's matrix exists: before "Open Costing Matrix" runs (#462) the PMS tab shows
 * its other sections and no grid, no empty state, no error.
 */
export default function CostingMatrixSection({ opportunityId }) {
  const { user } = useAuth();
  const { data: matrix } = useCostingMatrix(opportunityId);
  if (!matrix) return null;

  return (
    <section className="space-y-3" aria-label="Costing Matrix">
      <SectionHeader
        title={
          <>
            <Calculator size={16} aria-hidden="true" />
            Costing Matrix
          </>
        }
        description="What the client asked for, line by line."
        className="pb-2"
      />
      <TenderLineGrid matrix={matrix} opportunityId={opportunityId} actorId={user?.id ?? null} />
    </section>
  );
}
