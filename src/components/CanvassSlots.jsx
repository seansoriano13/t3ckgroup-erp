import { useState } from "react";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { FieldBox } from "./ui/FieldBox";
import { Textarea } from "@/components/ui/textarea";
import { CAPTION_BASE } from "@/lib/captionStyle";
import { MIN_CANVASS_OFFERS } from "../constants/canvass";
import { slotsCovered, supplierSlots } from "../utils/canvassMath";
import { formatDateOnly } from "../utils/formatDate.js";


/**
 * A Canvass's three supplier slots (#721, ADR 0047), like the sheet's CANVASS MATRIX tab. Slot n
 * shows Offer n; an empty slot 2 or 3 can be marked "No other supplier" with a reason, and one
 * reason can serve both. A winner needs the three slots filled or explained, so the strip says how
 * many are. More than three Offers are fine and are counted, not shown here.
 *
 * `marks` are the Canvass's "No other supplier" rows `{ slot, reason, created_at, actor }`.
 * `onMark({ slots, reason })` and `onClear(slot)` do the writing; the database owns the rules.
 */
export default function CanvassSlots({ offers = [], marks = [], canEdit = false, isPending = false, onMark, onClear }) {
  const { slots, extra } = supplierSlots(offers, marks);
  const covered = slotsCovered(offers, marks);
  const [marking, setMarking] = useState(null);
  const [reason, setReason] = useState("");
  const [both, setBoth] = useState(false);

  const isOpen = (slot) => slots[slot - 1]?.kind === "empty";
  const otherSlot = marking === 2 ? 3 : 2;
  const canShareReason = marking !== null && isOpen(otherSlot);
  const blank = reason.trim() === "";

  const close = () => {
    setMarking(null);
    setReason("");
    setBoth(false);
  };

  const save = () => {
    if (blank) return;
    const picked = both && canShareReason ? [marking, otherSlot].sort() : [marking];
    onMark({ slots: picked, reason: reason.trim() });
    close();
  };

  return (
    <section className="space-y-2" data-testid="supplier-slots" aria-label="Supplier slots">
      <p className="text-xs text-muted-foreground" data-testid="slots-summary">
        {covered >= MIN_CANVASS_OFFERS
          ? `${MIN_CANVASS_OFFERS} of ${MIN_CANVASS_OFFERS} supplier slots filled or explained.`
          : `${covered} of ${MIN_CANVASS_OFFERS} supplier slots filled or explained. A winner needs all ${MIN_CANVASS_OFFERS}.`}
        {extra.length > 0 && ` ${extra.length} more offer${extra.length === 1 ? "" : "s"} below.`}
      </p>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        {slots.map((s) => (
          <div
            key={s.slot}
            data-testid={`slot-${s.slot}`}
            className="flex min-w-0 flex-col gap-1 rounded-xl border border-border/60 bg-card p-2.5"
          >
            <span className={`${CAPTION_BASE} tracking-wider text-muted-foreground`}>Supplier {s.slot}</span>
            {s.kind === "offer" && <span className="text-xs text-muted-foreground">Offer {s.slot} added</span>}
            {s.kind === "none" && (
              <>
                <span className="text-sm font-bold text-foreground">No other supplier</span>
                <span className="whitespace-pre-wrap text-xs text-muted-foreground">{s.mark.reason}</span>
                <span className="text-[11px] text-muted-foreground/80">
                  {[s.mark.actor?.name, s.mark.created_at ? formatDateOnly(String(s.mark.created_at).slice(0, 10)) : null].filter(Boolean).join(" · ")}
                </span>
                {canEdit && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={isPending}
                    onClick={() => onClear(s.slot)}
                    aria-label={`Remove the No other supplier note on supplier ${s.slot}`}
                    className="h-auto self-start rounded-lg px-1.5 py-1 text-[11px] font-semibold text-muted-foreground"
                  >
                    Remove
                  </Button>
                )}
              </>
            )}
            {s.kind === "empty" && (
              <>
                <span className="text-xs text-muted-foreground">Not added yet</span>
                {canEdit && s.slot > 1 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={isPending}
                    onClick={() => {
                      setMarking(s.slot);
                      setBoth(false);
                    }}
                    aria-label={`No other supplier for supplier ${s.slot}`}
                    className="h-auto self-start rounded-lg px-2 py-1 text-[11px] font-semibold"
                  >
                    No other supplier
                  </Button>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {marking !== null && (
        <div className="space-y-2 rounded-xl border border-border/60 bg-card p-3" data-testid="no-other-supplier-form">
          <FieldBox label={`Why is there no other supplier for supplier ${marking}?`} bare>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="e.g. Sole distributor in the Philippines"
              className="min-h-0 resize-none rounded-md px-2.5 py-1.5 text-[12.5px] md:text-[12.5px]"
            />
          </FieldBox>
          {canShareReason && (
            <FieldBox inline className="text-xs text-foreground">
              <Checkbox checked={both} onCheckedChange={(value) => setBoth(Boolean(value))} />
              Use the same reason for supplier {otherSlot}
            </FieldBox>
          )}
          <div className="flex items-center gap-2">
            <Button type="button" size="xs" disabled={blank || isPending} onClick={save}>
              Save
            </Button>
            <Button type="button" variant="ghost" size="xs" onClick={close}>
              Cancel
            </Button>
            {blank && <span className="text-[11px] text-muted-foreground">A reason is needed.</span>}
          </div>
        </div>
      )}
    </section>
  );
}
