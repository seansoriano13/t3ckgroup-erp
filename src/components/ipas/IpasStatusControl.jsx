import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import IpasStatusPill from "./IpasStatusPill";
import OnHoldDialog from "./OnHoldDialog";
import { ipasKey, ipasListKey } from "./ipasKeys";
import { ipasService } from "../../services/ipasService";
import { IPAS_STATE } from "../../constants/ipas";

/**
 * An IPAS's status pill that Purchasing or Finance can click to put the order
 * On-Hold or clear it (#597), on the list and on the record. Everyone else, and
 * a filed or cancelled IPAS, gets the plain read-only pill. The write is the
 * database's `ipas_set_on_hold`; the list and the record reload after it, so
 * both show the status it leads to.
 *
 * `figures` is `ipasFigures(ipas)`: the status and the On-Hold note come from
 * there, never worked out here. `canSet` is "Purchasing access or Finance
 * access"; the database decides in the end.
 */
export default function IpasStatusControl({ ipas, figures, canSet, className = "" }) {
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);

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

  const clickable = canSet === true && ipas.state === IPAS_STATE.OPEN;
  // React bubbles a click from the portaled dialog up through the row it sits in, which
  // would open the IPAS behind it; the wrapper keeps every click inside the control.
  return (
    <span className="inline-flex" onClick={(event) => event.stopPropagation()}>
      <IpasStatusPill
        status={status}
        note={figures.onHoldNote}
        onClick={clickable ? () => setAsking(true) : null}
        className={className}
      />
      {clickable && (
        <OnHoldDialog
          open={asking}
          onOpenChange={setAsking}
          number={ipas.number}
          onHold={figures.onHold}
          note={figures.onHoldNote}
          onSubmit={(note) => toggle.mutateAsync({ onHold: !figures.onHold, note })}
        />
      )}
    </span>
  );
}
