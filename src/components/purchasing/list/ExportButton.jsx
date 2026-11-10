import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { manilaToday } from "@/lib/manilaDate.js";
import { downloadXlsx } from "@/utils/xlsx";

/**
 * Takes a list to Excel (spec #631), the same way from every Purchasing list.
 * Lifted from the IPAS list's export: the list hands over the rows it shows,
 * in the order shown, as arrays of cells (see utils/xlsx.js), and the headings
 * they sit under. Nothing is worked out here.
 *
 *   <ExportButton name="purchase-requests" sheetName="Purchase Requests"
 *     header={HEADER} rows={rowsAsCells(visible)} />
 *
 * The file is `<name>-<Manila date>.xlsx`. It is the last control of a
 * FilterBar's `actions`, and is disabled while the list has no rows.
 */
export default function ExportButton({ name, sheetName, header, rows }) {
  const exportToExcel = () => {
    downloadXlsx(`${name}-${manilaToday()}.xlsx`, { sheetName, header, rows });
  };

  return (
    <Button
      size="sm"
      variant="outline"
      className="h-9 gap-1.5"
      onClick={exportToExcel}
      disabled={rows.length === 0}
      aria-label="Export to Excel"
      title="Export to Excel"
    >
      <Download size={14} />
      Export
    </Button>
  );
}
