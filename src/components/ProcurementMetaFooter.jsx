import { Check } from "lucide-react";
import {
  PO_VERIFICATION,
  PO_VERIFICATION_LABELS,
} from "../constants/procurement";
import { formatDueDate } from "../utils/formatDate";
import { cn } from "@/lib/utils";

/**
 * What purchasing recorded for one product: PO, vendor, the Odoo product it
 * resolved to, and when it's expected — plus their free-text remarks.
 * Formatted in clean stacked rows for high scannability.
 *
 * `divider` is the only thing that ever differed between the purchasing-side
 * and sales-side renderings of this block, which is why there is one component
 * rather than two near-identical ones.
 */
export default function ProcurementMetaFooter({ request, divider = true }) {
  const hasFields = Boolean(
    request.po_number ||
      request.odoo_vendor ||
      request.odoo_product_ref ||
      request.eta,
  );
  const hasNote = Boolean(request.outcome_note);
  if (!hasFields && !hasNote) return null;

  return (
    <div
      className={cn(
        "space-y-1.5 text-[12px] text-muted-foreground",
        divider ? "border-t border-border/50 pt-2" : "pt-1.5",
      )}
    >
      {request.po_number && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-[68px] text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            PO:
          </span>
          <span className="rounded bg-mauve-3 px-1.5 py-0.5 font-mono text-[11.5px] font-semibold text-foreground">
            {request.po_number}
          </span>
          {request.verification === PO_VERIFICATION.VERIFIED && (
            <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              <Check size={11} strokeWidth={2.5} />
              <span>Confirmed in Odoo</span>
            </span>
          )}
          {request.verification === PO_VERIFICATION.NOT_FOUND && (
            <span className="text-[11px] font-medium text-red-600 dark:text-red-400">
              (Not found in Odoo)
            </span>
          )}
          {request.verification === PO_VERIFICATION.PENDING && (
            <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
              ({PO_VERIFICATION_LABELS[PO_VERIFICATION.PENDING]})
            </span>
          )}
        </div>
      )}

      {request.odoo_vendor && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-[68px] text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Vendor:
          </span>
          <span className="font-semibold text-foreground">{request.odoo_vendor}</span>
        </div>
      )}

      {request.odoo_product_ref && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-[68px] text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Odoo SKU:
          </span>
          <span className="max-w-[400px] truncate font-medium text-foreground">
            {request.odoo_product_ref}
          </span>
        </div>
      )}

      {request.eta && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-[68px] text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            ETA:
          </span>
          <span className="font-semibold text-foreground">{formatDueDate(request.eta)}</span>
        </div>
      )}

      {hasNote && (
        <div className="mt-1 rounded-md bg-mauve-3/50 px-2.5 py-1.5 text-[12px] italic text-foreground">
          &ldquo;{request.outcome_note}&rdquo;
        </div>
      )}
    </div>
  );
}
