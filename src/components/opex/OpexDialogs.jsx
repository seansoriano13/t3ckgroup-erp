import { useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import ModalShell from "@/components/ui/ModalShell";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/SelectField";
import { opexReportService } from "@/services/opexReportService";
import { normalizePoNumber } from "@/constants/procurement";
import { COST_GROUPS, DEFAULT_COST_GROUP, normalizeS0, parseTyped } from "@/utils/opexReport";
import { opexKeys } from "./useOpexReport";

/** The OPEX Report's short steps, each a compact window like Purchasing's raise steps. */

export function NewOpexReportDialog({ open, onOpenChange }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const s0 = normalizeS0(text);

  const close = (next) => {
    if (!next) setText("");
    onOpenChange(next);
  };

  const start = async (e) => {
    e.preventDefault();
    if (!s0) return;
    setSaving(true);
    try {
      const { report, existed } = await opexReportService.create(s0);
      if (existed) toast(`${s0} already has an OPEX Report. Opening it.`);
      else queryClient.invalidateQueries({ queryKey: opexKeys.list });
      close(false);
      navigate(`/finance/opex/${report.s0_number}`);
    } catch {
      toast.error("The OPEX Report could not be started.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      open={open}
      onOpenChange={close}
      crumbs={["OPEX Report", "New OPEX Report"]}
      dirty={text.trim() !== ""}
      discardWhat="OPEX Report"
      onSubmit={start}
      actions={
        <Button type="submit" variant="primary" disabled={saving || !s0}>
          {saving ? "Starting…" : "Start OPEX Report"}
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">An OPEX Report is for one S0. It reads what Odoo says the project spent.</p>
      <Input label="S0 number" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. S06637" autoFocus />
    </ModalShell>
  );
}

export function AddP0Dialog({ open, onOpenChange, onAdd }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = /^[A-Z]+\d+$/.test(normalizePoNumber(text) ?? "");
  const close = (next) => {
    if (!next) setText("");
    onOpenChange(next);
  };
  return (
    <ModalShell
      open={open}
      onOpenChange={close}
      crumbs={["OPEX Report", "Add a P0"]}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ok) return;
        setBusy(true);
        const added = await onAdd(text);
        setBusy(false);
        if (added) close(false);
      }}
      actions={
        <Button type="submit" variant="primary" disabled={!ok || busy}>
          {busy ? "Checking Odoo…" : "Add P0"}
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">For a P0 of this S0 that has no Project tag and no Source Document naming it. Odoo is asked first.</p>
      <Input label="P0 number" placeholder="e.g. P02367" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
    </ModalShell>
  );
}

const GROUP_OPTIONS = COST_GROUPS.map((g) => ({ value: g.key, label: g.label }));
const BLANK_COST = { id: null, cost_date: "", description: "", amount: "", note: "", cost_group: DEFAULT_COST_GROUP };

/** Add or edit a Typed cost. `cost` is null for a new one; Delete sits on the left when editing. */
export function TypedCostDialog({ open, onOpenChange, cost, onSave, onDelete }) {
  const [draft, setDraft] = useState(BLANK_COST);
  const [shownFor, setShownFor] = useState(null);
  const [saving, setSaving] = useState(false);
  const target = open ? (cost?.id ?? "new") : null;
  if (target !== shownFor) {
    setShownFor(target);
    if (open) {
      setDraft(
        cost
          ? { id: cost.id, cost_date: cost.cost_date ?? "", description: cost.description, amount: String(cost.amount), note: cost.note ?? "", cost_group: cost.group ?? cost.cost_group }
          : BLANK_COST,
      );
    }
  }
  const amount = parseTyped(draft.amount);
  const ok = draft.description.trim() !== "" && amount !== null && Number.isFinite(amount);

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      crumbs={["OPEX Report", cost ? "Edit Typed cost" : "Add Typed cost"]}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ok) return;
        setSaving(true);
        const saved = await onSave({ ...draft, description: draft.description.trim(), amount });
        setSaving(false);
        if (saved) onOpenChange(false);
      }}
      footerStart={
        cost ? (
          <Button type="button" variant="destructive" size="sm" onClick={() => onDelete(cost)}>
            Delete
          </Button>
        ) : null
      }
      actions={
        <Button type="submit" variant="primary" disabled={!ok || saving}>
          Save Typed cost
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">A cost Odoo does not have, such as a fee paid in cash. It counts in the group you pick.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Description" containerClassName="sm:col-span-2" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} autoFocus />
        <Input label="Amount (pesos)" inputMode="decimal" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
        <Input label="Date" type="date" value={draft.cost_date} onChange={(e) => setDraft({ ...draft, cost_date: e.target.value })} />
        <SelectField label="Counts as" options={GROUP_OPTIONS} value={draft.cost_group} onChange={(v) => setDraft({ ...draft, cost_group: v })} />
        <Input label="Note (optional)" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
      </div>
    </ModalShell>
  );
}

export function LeaveOutDialog({ expense, onOpenChange, onConfirm }) {
  const [note, setNote] = useState("");
  return (
    <ConfirmDialog
      open={Boolean(expense)}
      onOpenChange={(o) => {
        if (!o) setNote("");
        onOpenChange(o);
      }}
      title={`Leave out "${expense?.description ?? ""}"?`}
      description="It stays on the list, crossed out, and stops counting. Put it back any time."
      confirmLabel="Leave out"
      onConfirm={() => {
        onConfirm(expense, note);
        setNote("");
      }}
    >
      <Input label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
    </ConfirmDialog>
  );
}

/** A zero-price line's unit price, typed in place under the line. */
export function PriceForm({ line, onSave, onClear }) {
  const [text, setText] = useState(line.typedPrice == null ? "" : String(line.typedPrice));
  const n = parseTyped(text);
  const ok = n !== null && Number.isFinite(n) && n >= 0;
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onSave(n);
      }}
    >
      <Input
        label="Unit price (pesos)"
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        containerClassName="w-48"
        title="In pesos, even for a P0 in another currency"
      />
      <Button type="submit" size="sm" variant="outline" disabled={!ok}>
        Save price
      </Button>
      {line.typedPrice != null && (
        <Button type="button" size="sm" variant="ghost" onClick={onClear}>
          Back to Odoo&apos;s zero
        </Button>
      )}
      <p className="basis-full text-xs text-muted-foreground">
        Odoo has this line at zero. {line.quantity} × the price you type × {line.sharePercent}% counts to this S0.
      </p>
    </form>
  );
}
