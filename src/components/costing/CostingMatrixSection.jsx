import { Calculator } from "lucide-react";

import SectionHeader from "../ui/SectionHeader";
import { useAuth } from "../../context/AuthContext";
import { useCostingMatrix } from "./useCostingMatrix";
import TenderLineGrid from "./TenderLineGrid";

/**
 * The Costing Matrix section of the PMS tab (#267). The grid renders only once the
 * SOR's matrix exists: before "Open Costing Matrix" runs (#462) the PMS tab shows
 * one plain line in its place and its other sections. That is a normal state: no
 * empty grid, no error.
 */
export default function CostingMatrixSection({ opportunityId, opportunity }) {
  const { user } = useAuth();
  const { data: matrix, isSuccess } = useCostingMatrix(opportunityId);
  if (!matrix) {
    if (!isSuccess) return null;
    return (
      <p className="rounded-xl border border-border/70 bg-card/50 px-4 py-3 text-sm text-muted-foreground" data-testid="no-costing-matrix">
        No Costing Matrix yet. It opens when the flow&apos;s &quot;Open Costing Matrix&quot; step runs.
      </p>
    );
  }

  return (
    <section className="space-y-3" aria-label="Costing Matrix">
      <SectionHeader
        title={
          <>
            <Calculator size={16} aria-hidden="true" />
            Costing Matrix
          </>
        }
        description="What the client asked for, line by line, and what we supply and pay for each."
        className="pb-2"
      />
      <TenderLineGrid matrix={matrix} opportunityId={opportunityId} opportunity={opportunity} actorId={user?.id ?? null} />
    </section>
  );
}
