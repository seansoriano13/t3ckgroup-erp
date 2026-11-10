import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { deliveryDeadlineService } from "../../services/deliveryDeadlineService";
import { ipasErrorMessage } from "../../utils/ipas";
import { DEFAULT_NEAR_DAYS, INVALID_NEAR_DAYS_MESSAGE, isValidNearDays } from "../../utils/deliveryDeadline";

const NEAR_DAYS_KEY = ["order-monitoring", "deadline-near-days"];

/**
 * Beside the Ageing rules (#467, spec #461): how many days before the client's
 * delivery deadline an order not yet Received in Odoo is marked near. Default
 * 5. Marking only; nothing is blocked and nobody is notified. Purchasing access
 * and Super Admins edit it (the database decides).
 */
export default function DeliveryDeadlineSetting() {
  const queryClient = useQueryClient();
  const [text, setText] = useState(null);
  const [error, setError] = useState(null);

  const { data: nearDays } = useQuery({
    queryKey: NEAR_DAYS_KEY,
    queryFn: () => deliveryDeadlineService.getNearDays(),
  });

  const save = useMutation({
    mutationFn: (days) => deliveryDeadlineService.setNearDays(days),
    onSuccess: () => {
      setText(null);
      setError(null);
      toast.success("Delivery deadline setting saved.");
      queryClient.invalidateQueries({ queryKey: NEAR_DAYS_KEY });
    },
    onError: (err) => toast.error(ipasErrorMessage(err)),
  });

  const shown = text ?? String(nearDays ?? DEFAULT_NEAR_DAYS);

  const onSave = () => {
    const trimmed = shown.trim();
    const days = /^\d+$/.test(trimmed) ? Number(trimmed) : NaN;
    if (!isValidNearDays(days)) {
      setError(INVALID_NEAR_DAYS_MESSAGE);
      return;
    }
    setError(null);
    save.mutate(days);
  };

  return (
    <section className="space-y-3 border-t border-border pt-6" aria-labelledby="delivery-deadline-heading">
      <div>
        <h2 id="delivery-deadline-heading" className="text-sm font-semibold text-foreground">
          Client delivery deadline
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          An order not yet Received in Odoo is marked near once today is within this many days of its SOR&apos;s delivery
          deadline, and late after it. Nothing is blocked and nobody is notified.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-foreground">Mark as near within</span>
        <Input
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          className="w-24"
          aria-label="Days before the delivery deadline"
          value={shown}
          onChange={(e) => {
            setError(null);
            setText(e.target.value);
          }}
        />
        <span className="text-sm text-foreground">days</span>
        <Button type="button" onClick={onSave} disabled={save.isPending || text === null}>
          Save deadline setting
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
