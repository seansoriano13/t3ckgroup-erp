import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import ItemCanvass from "./ItemCanvass";
import ReplaceItemDialog from "./ReplaceItemDialog";
import { AttachP0Dialog } from "./PoDialogs";
import { ITEM_STATUS, MEMBER_SIDE } from "../../constants/purchaseRequest";
import { purchaseRequestService } from "../../services/purchaseRequestService";
import { refusal, useRefreshRequest } from "./requestHooks";

/**
 * #695 — the buttons under an opened line: Canvass, Attach P0 and Replace. Purchasing only; each is
 * switched off, with the reason as its title, when it makes no sense for the line. (They were in the
 * status menu until the list took the prototype's layout.)
 */
export default function LineButtons({ item, request, actor }) {
  const [attaching, setAttaching] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const refresh = useRefreshRequest(request?.id);
  // #730: the P0 is attached but Odoo did not answer when its IPAS was raised.
  const retry = useMutation({
    mutationFn: () => purchaseRequestService.retryIpas(item.id, item.po_number),
    onSuccess: (ipas) => toast.success(ipas?.message || "IPAS raised."),
    onError: (error) => toast.error(refusal(error)),
    onSettled: refresh,
  });
  if (actor?.side !== MEMBER_SIDE.PURCHASING) return null;

  const cancelled = item.status === ITEM_STATUS.CANCELLED;
  const received = item.status === ITEM_STATUS.RECEIVED;
  const attachOff = cancelled || received ? "Nothing to attach to this line." : null;
  const replaceOff = cancelled ? "This line is already cancelled." : received ? "This line has already arrived." : null;

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Purchasing actions for ${item.name}`}>
      <ItemCanvass item={item} request={request} actor={actor} />
      <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={!!attachOff} title={attachOff ?? undefined} onClick={() => setAttaching(true)}>
        Attach P0
      </Button>
      {item.ipas_pending && item.po_number && (
        <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={retry.isPending} onClick={() => retry.mutate()}>
          Retry IPAS
        </Button>
      )}
      <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={!!replaceOff} title={replaceOff ?? undefined} onClick={() => setReplacing(true)}>
        Replace
      </Button>
      {attaching && <AttachP0Dialog open onOpenChange={setAttaching} item={item} request={request} />}
      {replacing && <ReplaceItemDialog open onOpenChange={setReplacing} item={item} requestId={request?.id} />}
    </div>
  );
}
