import { ShoppingCart } from "lucide-react";
import Avatar from "../../Avatar";
import { Button } from "../../ui/button";
import { openItems } from "../../../utils/sorPurchaseRequest";
import { openPurchaseRequest, useSorPurchaseRequest } from "./useSorPurchaseRequest";

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The Now tab's Purchase Request card (#310): how many items, how many are
 * still open, and the Buyer. Renders nothing for an SOR with no Purchase
 * Request, or one the viewer may not read.
 */
export default function PurchaseRequestCard({ opportunityId }) {
  const { data: overview } = useSorPurchaseRequest(opportunityId);
  if (!overview) return null;

  const total = overview.items.length;
  const open = openItems(overview.items).length;

  return (
    <section className="space-y-3" aria-label="Purchase Request">
      <p className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">Purchase Request</p>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/50 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <ShoppingCart size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">
              {total === 0 ? "No items yet" : plural(total, "item")}
              {total > 0 && (
                <span className="font-normal text-muted-foreground">
                  {" · "}
                  {open === 0 ? "all closed" : `${open} open`}
                </span>
              )}
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              {overview.buyer ? (
                <>
                  <Avatar src={overview.buyer.avatarPath} name={overview.buyer.name} size="xs" />
                  <span>Buyer: {overview.buyer.name}</span>
                </>
              ) : (
                <span>No Buyer yet</span>
              )}
            </p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => openPurchaseRequest(overview.requestId)}>
          Open request
        </Button>
      </div>
    </section>
  );
}
