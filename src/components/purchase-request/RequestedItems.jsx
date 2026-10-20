import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
// eslint-disable-next-line no-unused-vars
import { LayoutGroup, MotionConfig, motion } from "framer-motion";
import QueryError from "@/components/ui/QueryError";
import { PackageSearch } from "lucide-react";

import EmptyState from "@/components/ui/EmptyState";
import Spinner from "@/components/ui/Spinner";
import AddRequestedItems from "./AddRequestedItems";
import RequestedItemRow from "./RequestedItemRow";
import { SPRING, groupItems } from "./requestedItemGroups";
import RequestedItemActions from "./RequestedItemActions";
import RequestedItemCanvass from "./RequestedItemCanvass";
import StatusBadge from "../StatusBadge";
import { purchaseRequestService } from "../../services/purchaseRequestService";
import {
  ITEM_STATUS,
  ITEM_STATUS_LABELS,
  ITEM_STATUS_THEME,
  isClosedStatus,
} from "../../constants/purchaseRequest";
import { purchaseRequestKeys } from "./queryKeys";

/** Which rows are open, and whether the list is wide enough for two columns. */
function useListLayout() {
  const [open, setOpen] = useState(() => new Set());
  const toggle = useCallback(
    (id) =>
      setOpen((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );
  const [node, setNode] = useState(null);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const check = () => setWide(node.clientWidth >= 720);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return { open, toggle, wide, setNode };
}

/**
 * Issue #305 — a Purchase Request's Requested Items, and the way to add more.
 * Self-contained, for the request view (#308) to mount: `request` needs `id`
 * and `opportunity_id`. Each row's action slot holds the status controls
 * (#306) for whatever the signed-in member may do; `renderActions(item)`
 * replaces them.
 */
export default function RequestedItems({ request, renderActions }) {
  const requestId = request?.id;

  const itemsQuery = useQuery({
    queryKey: purchaseRequestKeys.items(requestId),
    queryFn: () => purchaseRequestService.listItems(requestId),
    enabled: !!requestId,
  });
  const { data: stockSnapshot } = useQuery({
    queryKey: purchaseRequestKeys.stock(requestId),
    queryFn: () => purchaseRequestService.stockSnapshot(requestId),
    enabled: !!requestId && !!request?.opportunity_id,
  });

  const { data: actor } = useQuery({
    queryKey: purchaseRequestKeys.itemActor(requestId),
    queryFn: () => purchaseRequestService.itemActor(requestId),
    enabled: !!requestId && !renderActions,
  });

  const items = itemsQuery.data || [];
  const byId = new Map(items.map((i) => [i.id, i]));
  const substituteOf = new Map(
    items
      .filter((i) => i.substitute_for_item_id)
      .map((i) => [i.substitute_for_item_id, i]),
  );
  const { open: openRows, toggle, wide, setNode } = useListLayout();
  const groups = groupItems(items);
  const open = items.filter((i) => !isClosedStatus(i.status)).length;

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
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
        <QueryError
          title="Couldn't load the items."
          onRetry={itemsQuery.refetch}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title="Nothing requested yet"
          description="Whoever may request items adds what needs buying: a line from the SOR's Product List, or a new product."
          className="py-10"
        />
      ) : (
        <MotionConfig reducedMotion="user">
          <LayoutGroup>
            <div ref={setNode} className="flex flex-col gap-8">
              {groups.map((g) => (
                <motion.section
                  key={g.key}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={SPRING}
                  className="flex flex-col gap-3"
                  aria-label={g.label}
                  data-testid={`requested-group-${g.key}`}
                >
                  <motion.h4
                    layout="position"
                    className="flex items-baseline gap-2 px-1 text-xs font-semibold text-foreground"
                  >
                    {g.label}
                    <span className="font-medium tabular-nums text-muted-foreground">
                      {g.list.length}
                    </span>
                  </motion.h4>
                  <ul className="flex flex-col gap-2">
                    {g.list.map((item) => (
                      <RequestedItemRow
                        key={item.id}
                        item={item}
                        stockSnapshot={stockSnapshot}
                        open={openRows.has(item.id)}
                        onToggle={() => toggle(item.id)}
                        wide={wide}
                        canvass={
                          <RequestedItemCanvass
                            item={item}
                            request={request}
                            actor={actor}
                          />
                        }
                        replaces={byId.get(item.substitute_for_item_id)}
                        replacedBy={substituteOf.get(item.id)}
                        actions={
                          renderActions ? (
                            <div className="flex items-center gap-2">
                              <StatusBadge
                                label={
                                  ITEM_STATUS_LABELS[item.status] || item.status
                                }
                                theme={ITEM_STATUS_THEME[item.status]}
                              />
                              {renderActions(item)}
                            </div>
                          ) : (
                            <RequestedItemActions
                              item={item}
                              request={request}
                              actor={actor}
                            />
                          )
                        }
                      />
                    ))}
                  </ul>
                </motion.section>
              ))}
            </div>
          </LayoutGroup>
        </MotionConfig>
      )}
    </section>
  );
}
