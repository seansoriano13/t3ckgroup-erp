import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import IpasStatusPill from "./IpasStatusPill";
import OnHoldDialog from "./OnHoldDialog";
import { ipasKey, ipasListKey } from "./ipasKeys";
import { ipasService } from "../../services/ipasService";
import { IPAS_STATE } from "../../constants/ipas";

/**
 * An IPAS's status pill, read-only everywhere (feedback on #595: a pill that
 * put the order On-Hold on a click surprised people). Putting it On-Hold, or
 * clearing it, is the record's More menu item, which opens this control's
 * dialog through `asking` / `onAskingChange`. The write is the database's
 * `ipas_set_on_hold`; the list and the record reload after it, so both show
 * the status it leads to.
 *
 * `figures` is `ipasFigures(ipas)`: the status and the On-Hold note come from
 * there, never worked out here. `canSet` is "Purchasing access or Finance
 * access" on an open IPAS; the database decides in the end.
 */
export default function IpasStatusControl({ ipas, figures, canSet = false, asking = false, onAskingChange = () => {}, className = "" }) {
  const queryClient = useQueryClient();

  const toggle = useMutation({
    mutationFn: ({ onHold, note }) => ipasService.setOnHold(ipas.id, onHold, note),
    onSuccess: (_, { onHold }) => {
      toast.success(onHold ? `${ipas.number} is On-Hold.` : `${ipas.number} is off hold.`);
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ipasListKey }),
        queryClient.invalidateQueries({ queryKey: ipasKey(ipas.id) }),
      ]),
    // A failure shows inside the dialog, with Retry; it stays open.
  });

  const status = figures?.status ?? null;
  if (!status) return null;

  const settable = canSet === true && ipas.state === IPAS_STATE.OPEN;
  return (
    <span className="inline-flex">
      <IpasStatusPill status={status} note={figures.onHoldNote} className={className} />
      {settable && (
        <OnHoldDialog
          open={asking}
          onOpenChange={onAskingChange}
          number={ipas.number}
          onHold={figures.onHold}
          note={figures.onHoldNote}
          onSubmit={(note) => toggle.mutateAsync({ onHold: !figures.onHold, note })}
        />
      )}
    </span>
  );
}
