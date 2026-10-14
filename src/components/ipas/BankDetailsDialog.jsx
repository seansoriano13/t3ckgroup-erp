import { useState } from "react";

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

/**
 * Type or change the supplier's bank details (#245): Bank Name, Account Name
 * and Account #. Purchasing only; the database compares the Account # with the
 * supplier's last IPAS and flags a difference, so this says so before saving.
 * Mounted only while open, so the fields start from what is stored.
 */
/** `onSave(values)` is the page's: the dialog closes at once and the page saves behind it. */
export default function BankDetailsDialog({ open, onOpenChange, ipas, onSave }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <Body ipas={ipas} onSave={onSave} onClose={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function Body({ ipas, onSave, onClose }) {
  const current = ipas.bankDetails;
  const [form, setForm] = useState({
    bankName: current?.bankName ?? "",
    accountName: current?.accountName ?? "",
    accountNumber: current?.accountNumber ?? "",
  });
  const set = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const unchanged =
    form.bankName.trim() === (current?.bankName ?? "") &&
    form.accountName.trim() === (current?.accountName ?? "") &&
    form.accountNumber.trim() === (current?.accountNumber ?? "");

  const save = () => {
    onSave(form);
    onClose();
  };

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader className="shrink-0 pr-10">
        <DialogTitle>Bank details</DialogTitle>
        <DialogDescription>
          A changed Account # is how payment fraud usually gets in. If it differs from this supplier&apos;s last IPAS
          it is flagged and the approvals given so far are cleared. Spaces and dashes don&apos;t count as a difference.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <FieldBox label="Bank Name" bare>
          <Input value={form.bankName} onChange={set("bankName")} maxLength={200} autoComplete="off" />
        </FieldBox>
        <FieldBox label="Account Name" bare>
          <Input value={form.accountName} onChange={set("accountName")} maxLength={200} autoComplete="off" />
        </FieldBox>
        <FieldBox label="Account #" bare>
          <Input
            value={form.accountNumber}
            onChange={set("accountNumber")}
            maxLength={100}
            autoComplete="off"
            inputMode="text"
          />
        </FieldBox>
      </div>

      <DialogFooter>
        <Button variant="outline" size="lg" onClick={onClose}>
          Cancel
        </Button>
        <Button size="lg" disabled={unchanged} onClick={save}>
          Save bank details
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
