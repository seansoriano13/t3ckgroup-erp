import { useState } from "react";
import { Calculator, Printer } from "lucide-react";
import toast from "react-hot-toast";

import { Button } from "../ui/button";
import SectionHeader from "../ui/SectionHeader";
import { openCostingMatrixPrintWindow, printCostingMatrix } from "../../lib/pdf/costingMatrixPrinter";
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
  const [printing, setPrinting] = useState(false);
  if (!matrix) {
    if (!isSuccess) return null;
    return (
      <p className="rounded-xl border border-border/70 bg-card/50 px-4 py-3 text-sm text-muted-foreground" data-testid="no-costing-matrix">
        No Costing Matrix yet. It opens when the flow&apos;s &quot;Open Costing Matrix&quot; step runs.
      </p>
    );
  }

  // The window opens in the click (popup blockers); the matrix is read and composed into it afterwards.
  const handlePrint = async () => {
    const printWindow = openCostingMatrixPrintWindow();
    if (!printWindow) {
      toast.error("Allow pop-ups for this site to print the Costing Matrix.");
      return;
    }
    setPrinting(true);
    try {
      await printCostingMatrix(opportunityId, { printWindow, opportunity, printedBy: user?.name ?? null });
    } catch (error) {
      toast.error(error?.message || "The Costing Matrix could not be printed.");
    } finally {
      setPrinting(false);
    }
  };

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
      >
        <Button type="button" size="sm" variant="outline" disabled={printing} onClick={handlePrint}>
          <Printer size={14} aria-hidden="true" />
          Print
        </Button>
      </SectionHeader>
      <TenderLineGrid matrix={matrix} opportunityId={opportunityId} opportunity={opportunity} actorId={user?.id ?? null} isFinalAcquire={Boolean(user?.isFinalAcquire)} />
    </section>
  );
}
