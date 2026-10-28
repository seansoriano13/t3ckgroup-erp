import { ArrowUpRight } from "lucide-react";

import { ExternalLink } from "@/components/ui/external-link";
import { ODOO_NEW_PO_URL } from "../../utils/odooLinks";

/** Plain link to Odoo's blank purchase order form, in a new tab. The app writes nothing to Odoo. */
export default function NewOdooPoLink() {
  return (
    <ExternalLink
      href={ODOO_NEW_PO_URL}
      className="inline-flex items-center gap-0.5 text-sm font-semibold text-foreground underline-offset-2 hover:underline"
    >
      Create a PO in Odoo
      <ArrowUpRight aria-hidden size={12} />
    </ExternalLink>
  );
}
