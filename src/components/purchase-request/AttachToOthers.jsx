import { useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import ModalShell from "@/components/ui/ModalShell";
import Spinner from "@/components/ui/Spinner";
import { purchaseRequestService } from "../../services/purchaseRequestService";
import { ITEM_STATUS_LABELS } from "../../constants/purchaseRequest";
import { refusal, useRefreshRequest } from "./requestHooks";
import { OVER_REQUEST_MODAL } from "./stacking";

/** Said beside an item that shares its Odoo product with another open item, so it cannot be ticked. */
const SHARED_NOTE = "Same product as another open item on this request, so it cannot take this P0 line. Attach it on its own.";

/**
 * #809: shown after a P0 is attached to one item, when the server's offer names other items it covers.
 * Each offered item is pre-ticked with the P0 line it matched and the status it will get. Items that
 * share a product with another open item are listed with a note and cannot be ticked. "Attach to N
 * items" sends the ticked ones in one call; "Skip" sends nothing. The result names each item, with its
 * new status or the reason it failed.
 */
export function AttachToOthers({ open, onClose, requestId, poNumber, offer, orderEarly, earlyReason }) {
  const refresh = useRefreshRequest(requestId);
  // #811: open items with no Odoo product start unticked; only the P0 items are pre-ticked.
  const noProduct = offer.noOdooProduct ?? [];
  const [ticked, setTicked] = useState(() => new Set(offer.offered.map((row) => row.itemId)));
  const [results, setResults] = useState(null);
  const [failure, setFailure] = useState("");
  const names = new Map([...offer.offered, ...offer.unticked, ...noProduct].map((row) => [row.itemId, row.name]));

  const toggle = (itemId, on) => {
    setTicked((current) => {
      const next = new Set(current);
      if (on) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  };

  const attachMutation = useMutation({
    mutationFn: () => {
      const itemIds = [...offer.offered, ...noProduct].filter((row) => ticked.has(row.itemId)).map((row) => row.itemId);
      return purchaseRequestService.attachMany(poNumber, itemIds, {
        orderEarly,
        orderEarlyReason: orderEarly ? earlyReason : "",
      });
    },
    onMutate: () => setFailure(""),
    onSuccess: (list) => setResults(list),
    onError: (error) => setFailure(refusal(error)),
    onSettled: refresh,
  });

  const busy = attachMutation.isPending;
  const count = [...offer.offered, ...noProduct].filter((row) => ticked.has(row.itemId)).length;
  const title = `Attach P0 ${poNumber}`;

  if (results) {
    const attachedCount = results.filter((result) => result.ok).length;
    return (
      <ModalShell
        open={open}
        onOpenChange={(next) => { if (!next) onClose(); }}
        className={OVER_REQUEST_MODAL}
        crumbs={["Purchase Requests", "Attach P0"]}
        actions={
          <Button size="lg" type="button" onClick={onClose}>
            Done
          </Button>
        }
      >
        <p className="text-sm text-muted-foreground">
          {attachedCount} of {results.length} {results.length === 1 ? "item" : "items"} got {poNumber}.
        </p>
        <ul className="divide-y divide-border" data-testid="attach-other-results">
          {results.map((result) => (
            <li key={result.itemId} data-testid="attach-other-result" className="py-2 text-sm">
              <span className="font-medium text-foreground">{names.get(result.itemId) ?? "Item"}: </span>
              {result.ok ? (
                <span className="text-foreground">{ITEM_STATUS_LABELS[result.status] ?? result.status}.</span>
              ) : (
                <span className="text-destructive">{result.message || "Not attached."}</span>
              )}
              {result.ok && result.ipas && <span className="block text-xs text-muted-foreground">{result.ipas}</span>}
            </li>
          ))}
        </ul>
      </ModalShell>
    );
  }

  return (
    <ModalShell
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      className={OVER_REQUEST_MODAL}
      crumbs={["Purchase Requests", "Attach P0"]}
      onSubmit={(e) => {
        e.preventDefault();
        if (count && !busy) attachMutation.mutate();
      }}
      actions={
        <>
          <Button size="lg" type="button" variant="outline" onClick={onClose} disabled={busy}>
            Skip
          </Button>
          <Button size="lg" type="submit" disabled={!count || busy}>
            {busy && <Spinner size="sm" />}
            {`Attach to ${count} ${count === 1 ? "item" : "items"}`}
          </Button>
        </>
      }
    >
      <h3 className="text-sm font-semibold text-foreground">{title} covers these other items too</h3>
      <p className="text-xs text-muted-foreground">Tick the items to attach it to now. Each one keeps its own P0 line.</p>
      <ul className="divide-y divide-border" aria-label="Other items on this request">
        {offer.offered.map((row) => (
          <li key={row.itemId} data-testid="attach-other-row" className="flex items-start gap-3 py-2">
            <Checkbox
              className="mt-0.5"
              aria-label={`Attach to ${row.name}`}
              checked={ticked.has(row.itemId)}
              disabled={busy}
              onCheckedChange={(on) => toggle(row.itemId, on)}
            />
            <div className="min-w-0 text-sm">
              <div className="font-medium text-foreground">{row.name}</div>
              <div className="text-xs text-muted-foreground">
                P0 line: {row.products.join(", ")}. Becomes {ITEM_STATUS_LABELS[row.status] ?? row.status}.
              </div>
            </div>
          </li>
        ))}
        {offer.unticked.map((row) => (
          <li key={row.itemId} data-testid="attach-other-row" className="flex items-start gap-3 py-2">
            <Checkbox className="mt-0.5" aria-label={`Attach to ${row.name}`} checked={false} disabled />
            <div className="min-w-0 text-sm">
              <div className="font-medium text-foreground">{row.name}</div>
              <div className="text-xs text-muted-foreground">{SHARED_NOTE}</div>
            </div>
          </li>
        ))}
      </ul>
      {noProduct.length > 0 && (
        <section aria-label="No Odoo product" className="space-y-1">
          <h4 className="text-sm font-semibold text-foreground">No Odoo product. Tick if this P0 covers them</h4>
          <p className="text-xs text-muted-foreground">No P0 line is picked for these. Purchasing picks the line by hand.</p>
          <ul className="divide-y divide-border">
            {noProduct.map((row) => (
              <li key={row.itemId} data-testid="attach-no-product-row" className="flex items-start gap-3 py-2">
                <Checkbox
                  className="mt-0.5"
                  aria-label={`Attach to ${row.name}`}
                  checked={ticked.has(row.itemId)}
                  disabled={busy}
                  onCheckedChange={(on) => toggle(row.itemId, on)}
                />
                <div className="min-w-0 text-sm">
                  <div className="font-medium text-foreground">{row.name}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {failure && <p className="text-sm text-destructive">{failure}</p>}
    </ModalShell>
  );
}

export default AttachToOthers;
