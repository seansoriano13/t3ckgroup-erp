import { TriangleAlert } from "lucide-react";

/**
 * "PO P02445 is with Flywheel Corp. — canvass chose Redleaf", under the P.O./RFQ No. (#281). It only
 * says so: nothing is blocked and nothing is written.
 */
export default function SupplierMismatch({ mismatch }) {
  if (!mismatch) return null;
  const { po, poSupplier, winner } = mismatch;
  return (
    <p className="mt-1 flex items-start gap-1 text-xs text-amber-700 dark:text-amber-400" data-testid="supplier-mismatch">
      <TriangleAlert size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>
        PO {po} is with {poSupplier ?? "another supplier"} — canvass chose {winner ?? "a different supplier"}
      </span>
    </p>
  );
}
