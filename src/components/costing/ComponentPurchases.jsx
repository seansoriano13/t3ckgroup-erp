import { useState } from "react";
import { Link } from "react-router";
import toast from "react-hot-toast";

import { Button } from "../ui/button";
import { supabase } from "../../lib/supabase";
import { purchaseRequestService } from "../../services/purchaseRequestService";
import { IPAS_STATE_LABELS } from "../../constants/ipas";
import { PickPoLinesDialog } from "../purchase-request/PoDialogs";

/**
 * Under a Component's P.O./RFQ No. (#283): the PO numbers of its Requested Items (beside the typed
 * one), each PO's IPAS as "TGIPAS_050 · Open", and "purchased 3 of 5" when its Purchased items don't
 * cover its quantity. No money, so every tier sees it; the IPAS links only for a tier above
 * participant, and the IPAS page itself still decides who may read it.
 *
 * When Purchasing reads "Pick the PO line again" (a refresh removed a picked line), each Purchased item
 * with a PO offers the pick again here, from the PO's IPAS copy. Purchasing can also unlink a
 * Requested Item from the Component (kept in the matrix's history), so the Component can be removed.
 */
export default function ComponentPurchases({ component, linkIpas, canPick, onPicked }) {
  const purchases = component.purchases;
  const [picking, setPicking] = useState(null);
  if (!purchases) return null;

  const typed = (component.po_rfq_no || "").trim();
  const requestPos = purchases.poNumbers.filter((po) => po !== typed);
  const withIpas = purchases.ipas.filter((i) => i.ipasId);
  const repick = canPick && component.landed_cost?.blankReason === "line_removed";
  const pickable = repick ? purchases.requests.filter((r) => r.poNumber && ["purchased", "received"].includes(r.status)) : [];

  const startPick = async (request) => {
    const ipas = purchases.ipas.find((i) => i.poNumber === request.poNumber);
    if (!ipas?.ipasId) return;
    const { data } = await supabase.from("ipas").select("odoo_copy").eq("id", ipas.ipasId).maybeSingle();
    const lineIds = (data?.odoo_copy?.lines ?? []).map((line) => line.line_id).filter((id) => id !== null && id !== undefined);
    setPicking({ request, lineIds });
  };

  const unlink = async (request) => {
    try {
      await purchaseRequestService.detachComponent(request.itemId);
      toast.success(`${request.name || "Requested Item"} unlinked from Component ${component.number}.`);
      onPicked?.();
    } catch (error) {
      toast.error((error?.message || "Something went wrong.").replace(/^[a-z_]+: /, ""));
    }
  };
  const unlinkable = canPick ? purchases.requests : [];

  if (requestPos.length === 0 && withIpas.length === 0 && !purchases.orderedShort && pickable.length === 0 && unlinkable.length === 0) return null;

  return (
    <div className="mt-1.5 space-y-1 text-xs text-muted-foreground" data-testid="component-purchases">
      {requestPos.length > 0 && <p>{requestPos.join(", ")}</p>}
      {withIpas.map((i) => {
        const text = `${i.number} · ${IPAS_STATE_LABELS[i.state] || i.state}`;
        return (
          <p key={i.poNumber} data-testid="component-ipas">
            {linkIpas ? (
              <Link to={`/purchasing/ipas/${i.ipasId}`} className="underline underline-offset-2 hover:text-foreground">
                {text}
              </Link>
            ) : (
              text
            )}
          </p>
        );
      })}
      {purchases.orderedShort && (
        <p className="text-amber-12" data-testid="ordered-short">
          purchased {purchases.orderedShort.ordered} of {purchases.orderedShort.of}
        </p>
      )}
      {pickable.map((request) => (
        <Button key={request.itemId} type="button" size="sm" variant="outline" onClick={() => startPick(request)}>
          Pick the PO line again{pickable.length > 1 ? ` (${request.poNumber})` : ""}
        </Button>
      ))}
      {unlinkable.map((request) => (
        <Button key={`unlink-${request.itemId}`} type="button" size="sm" variant="ghost" onClick={() => unlink(request)}>
          Unlink {request.name || "Requested Item"}
        </Button>
      ))}
      {picking && (
        <PickPoLinesDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setPicking(null);
              onPicked?.();
            }
          }}
          item={{ id: picking.request.itemId, name: picking.request.name, po_number: picking.request.poNumber, odoo_po_line_ids: picking.request.pickedLineIds }}
          requestId={picking.request.requestId}
          lineIds={picking.lineIds}
        />
      )}
    </div>
  );
}
