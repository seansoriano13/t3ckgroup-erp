import { useState } from "react";
import { Printer } from "lucide-react";
import toast from "react-hot-toast";

import { Button } from "../../ui/button";
import { useAuth } from "../../../context/AuthContext";
import { openCostingMatrixPrintWindow, printCostingMatrix } from "../../../lib/pdf/costingMatrixPrinter";

/** Prints the SOR's Costing Matrix. The window opens in the click (popup blockers); the matrix is read and composed into it afterwards. */
export default function PrintButton({ opportunityId, opportunity }) {
  const { user } = useAuth();
  const [printing, setPrinting] = useState(false);
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
    <Button type="button" size="sm" variant="outline" disabled={printing} onClick={handlePrint}>
      <Printer size={14} aria-hidden="true" />
      Print
    </Button>
  );
}
