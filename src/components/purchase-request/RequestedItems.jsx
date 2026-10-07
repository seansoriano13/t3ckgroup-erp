import { useQuery } from "@tanstack/react-query";
import { PackageSearch } from "lucide-react";

import EmptyState from "@/components/ui/EmptyState";
import Spinner from "@/components/ui/Spinner";
import AddRequestedItems from "./AddRequestedItems";
import RequestedItemRow from "./RequestedItemRow";
import { purchaseRequestService } from "../../services/purchaseRequestService";
import { opportunityService } from "../../services/opportunityService";
import { isClosedStatus } from "../../constants/purchaseRequest";
import { purchaseRequestKeys, sorStockKey } from "./queryKeys";

/**
 * Issue #305 — a Purchase Request's Requested Items, and the way to add more.
 * Self-contained, for the request view (#308) to mount: `request` needs `id`
 * and `opportunity_id`. `renderActions(item)` fills each row's action slot
 * (#306's status controls).
 */
export default function RequestedItems({ request, renderActions }) {
  const requestId = request?.id;

  const itemsQuery = useQuery({
    queryKey: purchaseRequestKeys.items(requestId),
    queryFn: () => purchaseRequestService.listItems(requestId),
    enabled: !!requestId,
  });
  const { data: stockSnapshot } = useQuery({
    queryKey: sorStockKey(request?.opportunity_id),
    queryFn: () => opportunityService.getStockSnapshot(request.opportunity_id),
    enabled: !!request?.opportunity_id,
  });

  const items = itemsQuery.data || [];
  const open = items.filter((i) => !isClosedStatus(i.status)).length;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">
          Requested Items
          {items.length > 0 && (
            <span className="ml-2 text-xs font-medium text-muted-foreground">
              {open} open of {items.length}
            </span>
          )}
        </h3>
        <AddRequestedItems request={request} items={items} />
      </div>

      {itemsQuery.isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : itemsQuery.isError ? (
        <p className="py-8 text-center text-sm text-destructive">Couldn&apos;t load the items.</p>
      ) : items.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title="Nothing requested yet"
          description="The Deal Team adds what needs buying: a line from the SOR's Product List, or a new product."
          className="py-10"
        />
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <RequestedItemRow
              key={item.id}
              item={item}
              stockSnapshot={stockSnapshot}
              actions={renderActions?.(item)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
