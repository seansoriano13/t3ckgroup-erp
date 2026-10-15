import { useState } from "react";
import toast from "react-hot-toast";
import { Check } from "lucide-react";

import { Button } from "../ui/button";
import { transmittalService } from "../../services/transmittalService";
import { TRANSMITTAL_STATE } from "../../constants/transmittals";

/**
 * The Check by plates (#254, spec #251): two signature slots, each signed by a
 * person on the Check by list. The second signature closes the slip. The
 * database refuses what it must (the preparer, the same person twice, a PO
 * slip without Received in Odoo); these only show and send.
 */

const caption = "text-label font-bold uppercase tracking-wider text-muted-foreground";

const formatWhen = (value) => (value ? new Date(value).toLocaleString() : "");

function Plate({ label, plate, canSign, busy, onSign }) {
  return (
    <div className="flex-1 space-y-1 rounded-lg border border-border p-3">
      <p className={caption}>{label}</p>
      {plate ? (
        <p>
          {plate.name ?? "—"} · {formatWhen(plate.at)}
        </p>
      ) : canSign ? (
        <Button size="sm" className="gap-1.5" onClick={onSign} disabled={busy}>
          <Check size={14} />
          Sign Check by
        </Button>
      ) : (
        <p className="text-muted-foreground">Not yet.</p>
      )}
    </div>
  );
}

export function CheckBySection({ transmittal, canCheck, currentUserId, onChanged }) {
  const [busy, setBusy] = useState(false);
  const { first, second } = transmittal.checkBy;
  const awaiting = transmittal.state === TRANSMITTAL_STATE.AWAITING_CHECK;
  const closed = transmittal.state === TRANSMITTAL_STATE.CLOSED;
  if (!awaiting && !closed && !first && !second) return null;
  // A plate is open to the caller only while the slip awaits Check by, and not to the other slot's signer.
  const mayTakeFirst = canCheck && awaiting && !first && second?.id !== currentUserId;
  const mayTakeSecond = canCheck && awaiting && !second && first?.id !== currentUserId;

  const sign = async (slot) => {
    setBusy(true);
    try {
      await transmittalService.checkBy(transmittal.id, slot);
      toast.success("Check by signed.");
      onChanged?.();
    } catch (error) {
      toast.error(error.message || "The Check by could not be signed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4 text-[13px]">
      <p className="text-sm font-semibold">Check by</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Plate label="Check by (1)" plate={first} canSign={mayTakeFirst} busy={busy} onSign={() => sign(1)} />
        <Plate label="Check by (2)" plate={second} canSign={mayTakeSecond} busy={busy} onSign={() => sign(2)} />
      </div>
    </div>
  );
}
