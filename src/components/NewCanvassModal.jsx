import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Award, Check, Plus, Trash2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CAPTION_BASE } from "@/lib/captionStyle";
import ModalShell from "./ui/ModalShell";
import { Button } from "./ui/button";
import { SelectField } from "./ui/SelectField";
import CanvassSupplierField, { canvassFieldClass } from "./CanvassSupplierField";
import { canvassService } from "../services/canvassService";
import { CANVASS_CURRENCIES, CANVASS_LIST_KEY, DEFAULT_CURRENCY, MIN_CANVASS_OFFERS } from "../constants/canvass";
import { warningToast } from "./ui/CustomToast";
import { procurementQueueKey } from "./purchase-request/queryKeys";
import { moreOffersWarning } from "../utils/canvassMath";
import { useReferenceRate } from "../hooks/useReferenceRate";
import { getCurrentLocalDate } from "../utils/formatDate.js";

/**
 * The New Canvass form. A Canvass is a comparison, so the form is built for one: every row is one
 * Canvass (what is being bought) with three Offer columns side by side, and the winner is picked
 * in the row. Add a row for the next product, then save them all, or save and go straight on to
 * the Purchase Request for the lot (ADR 0034).
 *
 * Nothing is written until Save. Each row is saved in turn (it starts the Canvass with its first
 * Offer, adds the rest, then marks the winner). A row that is saved is locked and stays saved if a
 * later row fails, so trying again never makes a second Canvass. Lead time, validity, source link,
 * brochure and the rest of an Offer are filled in afterwards in the Canvass panel.
 */

const OFFERS_PER_ROW = MIN_CANVASS_OFFERS;

const blankOffer = () => ({
  supplierName: "",
  odooSupplierId: null,
  brand: "",
  description: "",
  currency: DEFAULT_CURRENCY,
  unitPrice: "",
  comparisonRate: "",
  leadTime: "",
});

const hasText = (offer) => [offer.supplierName, offer.brand, offer.description].some((v) => v.trim());
const hasAnything = (offer) => hasText(offer) || offer.unitPrice !== "" || offer.leadTime.trim() !== "";
const isForeign = (offer) => offer.currency !== DEFAULT_CURRENCY;
const needsRate = (offer) => isForeign(offer) && offer.comparisonRate === "";
const isBlankRow = (row) => !row.productName.trim() && !row.offers.some(hasAnything);

const toInput = (offer) => ({
  supplierName: offer.supplierName.trim(),
  odooSupplierId: offer.supplierName.trim() ? offer.odooSupplierId : null,
  brand: offer.brand.trim(),
  description: offer.description.trim(),
  currency: offer.currency,
  leadTime: offer.leadTime.trim(),
  unitPrice: offer.unitPrice === "" ? null : Number(offer.unitPrice),
  comparisonRate: isForeign(offer) && offer.comparisonRate !== "" ? Number(offer.comparisonRate) : null,
});

/** What is stopping a row from being saved, or null. A Canvass on a subject already knows what it buys. */
function rowIssue(row, hasSubject = false) {
  if (!hasSubject && !row.productName.trim()) return "Say what is being bought.";
  if (!row.offers.some(hasText)) return "Add at least one offer: a supplier, a brand or a description.";
  if (row.winner !== null) {
    const winner = row.offers[row.winner];
    if (!hasText(winner)) return "The winner has no details yet.";
    if (needsRate(winner)) return "The winner is in a foreign currency: add its comparison rate first.";
  }
  return null;
}

function OfferColumn({ label, offer, canWin, isWinner, onChange, onWin }) {
  const foreign = isForeign(offer);
  const today = getCurrentLocalDate();
  const { data: referenceRate, isFetched: referenceChecked } = useReferenceRate(offer.currency, today, { enabled: foreign });

  // A new foreign Offer starts from today's Reference Rate; whatever is typed is never replaced.
  useEffect(() => {
    if (!foreign || !referenceChecked || !referenceRate || offer.comparisonRate !== "") return;
    onChange({ comparisonRate: String(referenceRate.php_per_unit) });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new rate or currency re-suggests
  }, [referenceRate, referenceChecked, offer.currency]);

  return (
    <div
      data-testid="new-canvass-offer"
      className={`min-w-0 space-y-2 rounded-xl border p-3 transition-colors ${isWinner ? "border-amber-7 bg-amber-a2" : "border-border/60 bg-card"}`}
    >
      <div className="flex items-center justify-between">
        <span className={`${CAPTION_BASE} tracking-wider text-muted-foreground`}>{label}</span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={!canWin}
          aria-pressed={isWinner}
          aria-label={`${isWinner ? "Clear" : "Pick"} ${label.toLowerCase()} as the winner`}
          title={canWin ? "Mark this offer the winner" : "Fill in this offer first"}
          onClick={onWin}
          className={`h-auto rounded-lg px-1.5 py-1 text-[11px] font-semibold ${
            isWinner ? "text-amber-11" : "text-muted-foreground hover:bg-amber-a3 hover:text-amber-11"
          }`}
        >
          {isWinner ? <Check size={12} className="mr-1" aria-hidden="true" /> : <Award size={12} className="mr-1" aria-hidden="true" />}
          {isWinner ? "Winner" : "Pick winner"}
        </Button>
      </div>

      <CanvassSupplierField
        autoFocus={false}
        label={`${label} supplier`}
        value={offer.supplierName}
        onTyped={(name) => onChange({ supplierName: name, odooSupplierId: null })}
        onPicked={(supplier) => onChange({ supplierName: supplier.name, odooSupplierId: supplier.id })}
      />
      <Input
        aria-label={`${label} brand`}
        value={offer.brand}
        onChange={(e) => onChange({ brand: e.target.value })}
        placeholder="Brand"
        containerClassName="min-w-0"
        className={canvassFieldClass}
      />
      <Textarea
        aria-label={`${label} description`}
        value={offer.description}
        onChange={(e) => onChange({ description: e.target.value })}
        rows={2}
        placeholder="Description"
        className="min-h-0 resize-none rounded-md px-2.5 py-1.5 text-[12.5px] md:text-[12.5px]"
      />
      <div className="grid grid-cols-[5.5rem_1fr] gap-2">
        <SelectField
          aria-label={`${label} currency`}
          size="sm"
          options={CANVASS_CURRENCIES.map((code) => ({ value: code, label: code }))}
          value={offer.currency}
          onChange={(next) => onChange({ currency: next || DEFAULT_CURRENCY, comparisonRate: "" })}
        />
        <Input
          type="number"
          min="0"
          step="any"
          aria-label={`${label} unit price`}
          value={offer.unitPrice}
          onChange={(e) => onChange({ unitPrice: e.target.value })}
          placeholder={`Unit price (${offer.currency})`}
          containerClassName="min-w-0"
          className={canvassFieldClass}
        />
      </div>
      {foreign && (
        <Input
          type="number"
          min="0"
          step="any"
          aria-label={`${label} comparison rate`}
          value={offer.comparisonRate}
          onChange={(e) => onChange({ comparisonRate: e.target.value })}
          placeholder={`Comparison rate (PHP per ${offer.currency})`}
          containerClassName="min-w-0"
          className={canvassFieldClass}
        />
      )}
      <Input
        aria-label={`${label} lead time`}
        value={offer.leadTime}
        onChange={(e) => onChange({ leadTime: e.target.value })}
        placeholder="Lead time"
        containerClassName="min-w-0"
        className={canvassFieldClass}
      />
    </div>
  );
}

/**
 * `subject` ({ requestedItemId } or { componentId }) makes it the form for that one subject's
 * Canvass: a single row with no product name, and no Purchase Request step. `subjectLabel` names it
 * in the header. `onSaved(started)` runs once the Canvass is saved (the modal then stays for its
 * owner to replace with the Canvass itself).
 */
export default function NewCanvassModal({ open, onOpenChange, userId, subject = null, subjectLabel = null, onSaved }) {
  const hasSubject = Boolean(subject);
  const queryClient = useQueryClient();
  const keys = useRef(0);
  const makeRow = () => ({
    key: ++keys.current,
    productName: "",
    offers: Array.from({ length: OFFERS_PER_ROW }, blankOffer),
    winner: null,
    saved: null,
  });
  const [rows, setRows] = useState(() => [makeRow()]);
  const [requestTitle, setRequestTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const patchRow = (key, patch) => setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const patchOffer = (key, index, patch) =>
    setRows((cur) =>
      cur.map((r) => (r.key === key ? { ...r, offers: r.offers.map((o, i) => (i === index ? { ...o, ...patch } : o)) } : r)),
    );

  const live = rows.filter((r) => !isBlankRow(r) || r.saved);
  const toSave = live.filter((r) => !r.saved);
  const issues = toSave.map((row) => rowIssue(row, hasSubject));
  const canSave = toSave.length > 0 && issues.every((issue) => !issue);
  const requestReady = Boolean(requestTitle.trim()) && live.length > 0 && live.every((r) => r.winner !== null && !r.saved?.problem) && (toSave.length === 0 || canSave);

  /** Starts the Canvass with the first Offer, adds the others, marks the winner. */
  const saveRow = async (row) => {
    const filled = row.offers.map((offer, index) => ({ offer, index })).filter(({ offer }) => hasText(offer));
    const [first, ...rest] = filled;
    const started = await canvassService.start(subject || {}, { productName: hasSubject ? "" : row.productName }, toInput(first.offer), userId);
    patchRow(row.key, { saved: { canvassId: started.canvassId, number: started.number, problem: null } });
    try {
      const offerIds = { [first.index]: started.offer.id };
      for (const { offer, index } of rest) {
        const made = await canvassService.addOffer(started.canvassId, toInput(offer), userId);
        offerIds[index] = made.id;
      }
      if (row.winner !== null) await canvassService.markWinner(started.canvassId, offerIds[row.winner]);
    } catch (err) {
      patchRow(row.key, { saved: { canvassId: started.canvassId, number: started.number, problem: err.message } });
      throw new Error(`${started.number} was started but not finished: ${err.message} Finish it from the Canvasses page.`);
    }
    return started;
  };

  const submit = async (withRequest) => {
    setBusy(true);
    const savedIds = live.filter((r) => r.saved).map((r) => r.saved.canvassId);
    let startedNumber = "";
    try {
      for (const row of toSave) {
        const started = await saveRow(row);
        savedIds.push(started.canvassId);
        startedNumber = started.number;
      }
      if (withRequest) {
        const made = await canvassService.createPurchaseRequest({ title: requestTitle, items: savedIds.map((canvassId) => ({ canvassId })) });
        toast.success("Purchase Request created.");
        if (made.unsignedCanvassIds.length > 0) warningToast("The Canvasses are not signed off yet.");
        queryClient.invalidateQueries({ queryKey: procurementQueueKey });
      } else if (hasSubject) {
        toast.success(`Canvass ${startedNumber} started.`);
      } else {
        toast.success(`${savedIds.length} Canvass${savedIds.length === 1 ? "" : "es"} saved.`);
      }
      if (hasSubject) onSaved?.();
      else onOpenChange(false);
    } catch (err) {
      toast.error(err.message);
    } finally {
      queryClient.invalidateQueries({ queryKey: CANVASS_LIST_KEY });
      setBusy(false);
    }
  };

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      size="wide"
      expandable
      crumbs={["Canvass", subjectLabel || "New Canvass"]}
      actions={
        <>
          <Button type="button" size="lg" variant="outline" disabled={busy || !canSave} onClick={() => submit(false)}>
            Save
          </Button>
          {!hasSubject && (
            <Button type="button" size="lg" disabled={busy || !requestReady} onClick={() => submit(true)}>
              Save and create Purchase Request
            </Button>
          )}
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        {hasSubject
          ? "Compare the offers side by side and pick a winner. Saving the first offer starts this Canvass and gives it its number."
          : "One row is one Canvass: what is being bought and the offers you are comparing, side by side. Pick a winner in each row, add a row for the next product, then save."}
      </p>

      <div className="space-y-4">
        {rows.map((row, r) => {
          const number = r + 1;
          const issue = row.saved ? null : isBlankRow(row) ? null : rowIssue(row, hasSubject);
          const filledOffers = row.offers.filter(hasText);
          const warning = !row.saved && !isBlankRow(row) ? moreOffersWarning(filledOffers) : null;

          if (row.saved) {
            const winner = row.winner !== null ? row.offers[row.winner] : null;
            return (
              <div key={row.key} data-testid="new-canvass-row" className="rounded-xl border border-border/60 bg-muted/30 px-4 py-3 text-sm">
                <span className="font-semibold tabular-nums">{row.saved.number}</span>
                <span className="ml-2">{row.productName.trim()}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {row.saved.problem
                    ? `Not finished: ${row.saved.problem}`
                    : `Saved${winner ? ` · winner ${[winner.supplierName, winner.brand].filter((v) => v.trim()).join(" · ")}` : ""}`}
                </span>
              </div>
            );
          }

          return (
            <section key={row.key} data-testid="new-canvass-row" aria-label={`Canvass ${number}`} className="space-y-3 rounded-2xl border border-border p-3">
              {!hasSubject && (
              <div className="flex items-center gap-2">
                <span className="w-6 shrink-0 text-center text-xs font-semibold tabular-nums text-muted-foreground">{number}</span>
                <Input
                  aria-label={`Canvass ${number} product`}
                  value={row.productName}
                  onChange={(e) => patchRow(row.key, { productName: e.target.value })}
                  placeholder="What is being bought, e.g. Laser printer toner, black"
                  containerClassName="min-w-0 flex-1"
                  className={`${canvassFieldClass} font-semibold`}
                />
                {rows.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove canvass ${number}`}
                    onClick={() => setRows((cur) => cur.filter((x) => x.key !== row.key))}
                    className="h-auto w-auto rounded-lg p-1.5 text-muted-foreground hover:bg-red-a3 hover:text-red-11"
                  >
                    <Trash2 size={14} />
                  </Button>
                )}
              </div>
              )}

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {row.offers.map((offer, c) => (
                  <OfferColumn
                    key={c}
                    label={`Canvass ${number} offer ${c + 1}`}
                    offer={offer}
                    canWin={hasText(offer) && !needsRate(offer)}
                    isWinner={row.winner === c}
                    onChange={(patch) => patchOffer(row.key, c, patch)}
                    onWin={() => patchRow(row.key, { winner: row.winner === c ? null : c })}
                  />
                ))}
              </div>

              {(issue || warning) && (
                <p role={issue ? "alert" : undefined} className={`text-[11px] ${issue ? "text-destructive" : "text-muted-foreground"}`}>
                  {issue || warning}
                </p>
              )}
            </section>
          );
        })}
      </div>

      {!hasSubject && (
      <Button
        type="button"
        variant="outline"
        onClick={() => setRows((cur) => [...cur, makeRow()])}
        className="h-auto flex w-full items-center justify-center gap-1.5 rounded-xl border-dashed border-mauve-7 py-2 text-[12px] font-bold text-muted-foreground transition-colors hover:border-mauve-8 hover:bg-mauve-a3 hover:text-foreground"
      >
        <Plus size={14} /> Add another canvass
      </Button>
      )}

      {!hasSubject && (
      <div className="space-y-1.5 border-t border-border/60 pt-3">
        <span className={`${CAPTION_BASE} tracking-wider text-muted-foreground`}>Then the Purchase Request</span>
        <Input
          aria-label="Purchase Request title"
          value={requestTitle}
          onChange={(e) => setRequestTitle(e.target.value)}
          placeholder="Title of the request (optional)"
          containerClassName="min-w-0"
          className={canvassFieldClass}
        />
        <p className="text-[11px] text-muted-foreground">
          Give it a title and pick a winner in every row to save and create one request for all of them in one step. Otherwise save now and create it later.
        </p>
      </div>
      )}
    </ModalShell>
  );
}
