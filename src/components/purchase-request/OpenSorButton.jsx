import { ArrowUpRight, Briefcase } from "lucide-react";

import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { sorHref } from "@/utils/sorLink";
import { requestKind, REQUEST_KIND } from "@/constants/purchaseRequest";

/**
 * Outline button, top right of the record window, that jumps from a Purchase Request to the SOR it was raised for.
 * Quick View is the landing spot, as for
 * every other link into an SOR. Direct requests have no SOR, so nothing shows.
 *
 * `onBeforeOpen` runs first (the modal closes itself so Quick View isn't
 * stacked under it).
 */
export default function OpenSorButton({ request, onBeforeOpen }) {
  if (!request || requestKind(request) !== REQUEST_KIND.PROJECT) return null;
  const ref = request.sales_reference;

  // A real link to the SOR's page: following it leaves this window, so the SOR never opens underneath it.
  return (
    <Button asChild variant="outline" size="sm" className="gap-1.5">
      <Link to={sorHref(request.opportunity_id)} onClick={() => onBeforeOpen?.()} title={ref ? `Open SOR ${ref}` : "Open SOR"}>
        <Briefcase size={14} />
        Open SOR
        <ArrowUpRight size={14} />
      </Link>
    </Button>
  );
}
