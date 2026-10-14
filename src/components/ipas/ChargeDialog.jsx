import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldBox } from "@/components/ui/FieldBox";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/SelectField";
import { ipasService } from "../../services/ipasService";
import { IPAS_OPTION_LIST } from "../../constants/ipas";
import { getCurrentLocalDate } from "../../utils/formatDate.js";
import { ipasErrorMessage } from "../../utils/ipas";
import { isIsoDate, optionsForPicker, parseAmountInput } from "../../utils/ipasPayments";
import { ipasKey, ipasListKey } from "./ipasKeys";

const asText = (value) => (value === null || value === undefined ? "" : String(value));

/**
 * Record or edit one charge on an IPAS (#244): a kind from the list the
 * business edits, a date and a PHP amount. A charge that covers several POs is
 * entered as this IPAS's own share, worked out by Purchasing, so it counts
 * once across purchases. `charge` null adds one. Mounted only while open.
 */
/** `onFailed(error, retry)`, when given, shows a failed save in the page (with Retry) instead of a toast alone. */
export default function ChargeDialog({ open, onOpenChange, ipas, charge = null, onFailed }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <Body ipas={ipas} charge={charge} onFailed={onFailed} onClose={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function Body({ ipas, charge, onFailed, onClose }) {
  const queryClient = useQueryClient();
  const editing = Boolean(charge);

  const [form, setForm] = useState({
    kindId: charge?.kind_id ?? "",
    chargedOn: charge?.charged_on ?? getCurrentLocalDate(),
    amountPhp: asText(charge?.amount_php),
  });
  const set = (field) => (value) => setForm((prev) => ({ ...prev, [field]: value }));

  const kinds = optionsForPicker(ipas.options ?? [], IPAS_OPTION_LIST.CHARGE_KIND, charge?.kind_id).map((option) => ({
    value: option.id,
    label: option.active ? option.label : `${option.label} (deactivated)`,
  }));

  const amount = parseAmountInput(form.amountPhp);
  const problems = [];
  if (!form.kindId) problems.push("Pick the kind of charge.");
  if (!isIsoDate(form.chargedOn)) problems.push("Give the date of the charge.");
  if (!amount.ok || amount.value === null || amount.value <= 0) problems.push("Amount must be a number more than zero.");
  const ready = problems.length === 0;

  const save = useMutation({
    mutationFn: () => {
      const values = { kindId: form.kindId, chargedOn: form.chargedOn, amountPhp: form.amountPhp };
      return editing ? ipasService.updateCharge(charge.id, values) : ipasService.addCharge(ipas.id, values);
    },
    onSuccess: () => {
      toast.success(editing ? "Charge updated." : "Charge recorded.");
      queryClient.invalidateQueries({ queryKey: ipasKey(ipas.id) });
      queryClient.invalidateQueries({ queryKey: ipasListKey });
      onClose();
    },
    onError: (error) => (onFailed ? onFailed(error, () => save.mutate()) : toast.error(ipasErrorMessage(error))),
  });

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader className="shrink-0 pr-10">
        <DialogTitle>{editing ? "Edit charge" : "Record a charge"}</DialogTitle>
        <DialogDescription>
          Importation charges are in pesos. If a charge covers several Odoo POs, enter this IPAS&apos;s own share.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <FieldBox label="Kind" bare>
          <SelectField options={kinds} value={form.kindId} onChange={set("kindId")} placeholder="Pick a kind" />
        </FieldBox>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FieldBox label="Date" bare>
            <Input type="date" value={form.chargedOn} onChange={(e) => set("chargedOn")(e.target.value)} />
          </FieldBox>
          <FieldBox label="Amount (PHP)" bare>
            <Input
              inputMode="decimal"
              value={form.amountPhp}
              onChange={(e) => set("amountPhp")(e.target.value)}
              placeholder="0.00"
              error={form.amountPhp !== "" && !amount.ok ? "Not a number" : undefined}
            />
          </FieldBox>
        </div>
        {!ready && (
          <ul className="space-y-0.5 text-xs text-muted-foreground" aria-label="Still to fix">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" size="lg" onClick={onClose}>
          Cancel
        </Button>
        <Button size="lg" disabled={!ready || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : editing ? "Save charge" : "Record charge"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
