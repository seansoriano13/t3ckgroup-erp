import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  Award,
  ChevronDown,
  ChevronUp,
  ExternalLink as ExternalLinkIcon,
  Pencil,
  Plus,
  ShoppingCart,
  Trash2,
} from "lucide-react";

import { ExternalLink } from "@/components/ui/external-link";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CAPTION_BASE } from "@/lib/captionStyle";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { AttachmentField, AttachmentList } from "./ui/Attachments";
import { SelectField } from "./ui/SelectField";
import { confirmDeleteToast } from "./ui/CustomToast";
import { costingKeys } from "./costing/costingKeys";
import { pesos } from "./costing/gridFormat";
import { useFileAttachments } from "../hooks/useFileAttachments";
import { canvassService } from "../services/canvassService";
import { CANVASS_CURRENCIES, DEFAULT_CURRENCY } from "../constants/canvass";
import { offerCurrency } from "../utils/canvassMath";

/**
 * The Canvass (#275, built in #276): the supplier comparison for one Costing Matrix Component,
 * recorded as Offers. `subject` is `{ componentId }` (or `{ requestedItemId }` once #280 mounts it
 * on a Requested Item).
 *
 * Money is whatever the service sent. A reader without the money tier gets Offers with no price
 * keys at all, so every price, the comparison rate and the PHP figure simply do not draw. The
 * panel never asks who the reader is; it draws what arrived.
 *
 * The winner (#278) and sign-off (#279) are later tickets and add to this panel.
 */

const hasKey = (offer, key) => Object.prototype.hasOwnProperty.call(offer, key);

/** A quoted amount in the Offer's own currency: peso sign for PHP, the code for the rest. */
const quoted = (offer) => {
  if (!hasKey(offer, "unit_price")) return null;
  if (offer.unit_price === null || offer.unit_price === undefined) return "—";
  if (offerCurrency(offer) === DEFAULT_CURRENCY) return pesos(offer.unit_price);
  const amount = Number(offer.unit_price).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${offerCurrency(offer)} ${amount}`;
};

const fieldClass =
  "h-auto rounded-md border border-border bg-card px-2.5 py-1.5 text-[13px] text-foreground outline-none focus:border-mauve-8";

/**
 * The Offer's supplier (#277): free text that suggests matching Odoo suppliers as it is typed.
 * Picking one records its Odoo id beside the name; typing again afterwards drops the id, since the
 * name no longer says which Odoo supplier it was. A supplier Odoo doesn't know is simply typed.
 */
function SupplierField({ value, onTyped, onPicked }) {
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState(value.trim());

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value.trim()), 250);
    return () => clearTimeout(timer);
  }, [value]);

  const { data: suggestions = [] } = useQuery({
    queryKey: ["canvass-supplier-search", debounced],
    queryFn: () => canvassService.searchSuppliers(debounced),
    enabled: open && debounced.length >= 2,
    staleTime: 60_000,
  });

  return (
    <div className="relative min-w-0">
      <Input
        autoFocus
        aria-label="Supplier"
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-autocomplete="list"
        autoComplete="off"
        value={value}
        onChange={(e) => {
          onTyped(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
        placeholder="Supplier"
        containerClassName="min-w-0"
        className={`${fieldClass} font-semibold`}
      />
      {open && suggestions.length > 0 && (
        <ul
          role="listbox"
          aria-label="Odoo suppliers"
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-auto rounded-md border border-border bg-card py-1 shadow-md"
        >
          {suggestions.map((supplier) => (
            <li key={supplier.id} role="option" aria-selected={false}>
              <Button
                type="button"
                variant="ghost"
                // mousedown, not click: the input's blur would close the list before a click lands.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPicked(supplier);
                  setOpen(false);
                }}
                className="h-auto w-full justify-start rounded-none px-2.5 py-1.5 text-left text-[13px] font-normal text-foreground"
              >
                {supplier.name}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OfferForm({ initial, canReadMoney, onSubmit, onCancel, isPending }) {
  const [supplierName, setSupplierName] = useState(initial?.supplier_name || "");
  const [odooSupplierId, setOdooSupplierId] = useState(initial?.odoo_supplier_id ?? null);
  const [brand, setBrand] = useState(initial?.brand || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [sourceLink, setSourceLink] = useState(initial?.source_link || "");
  const [currency, setCurrency] = useState(initial ? offerCurrency(initial) : DEFAULT_CURRENCY);
  const [unitPrice, setUnitPrice] = useState(initial?.unit_price ?? "");
  const [comparisonRate, setComparisonRate] = useState(initial?.comparison_rate ?? "");
  const [validUntil, setValidUntil] = useState(initial?.valid_until || "");
  const [leadTime, setLeadTime] = useState(initial?.lead_time || "");
  const [qualityNote, setQualityNote] = useState(initial?.quality_note || "");
  const [remarks, setRemarks] = useState(initial?.remarks || "");
  const [existingBrochure, setExistingBrochure] = useState(initial?.brochure || []);
  const attachments = useFileAttachments({ max: 3 });

  const foreign = currency !== DEFAULT_CURRENCY;
  const canSubmit = supplierName.trim() || brand.trim() || description.trim();

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    const uploaded = await attachments.upload();
    const input = {
      supplierName: supplierName.trim(),
      odooSupplierId: supplierName.trim() ? odooSupplierId : null,
      brand: brand.trim(),
      description: description.trim(),
      sourceLink: sourceLink.trim(),
      currency,
      validUntil: validUntil || null,
      leadTime: leadTime.trim(),
      qualityNote: qualityNote.trim(),
      remarks: remarks.trim(),
      brochure: [...existingBrochure, ...uploaded],
    };
    if (canReadMoney) {
      input.unitPrice = unitPrice === "" ? null : Number(unitPrice);
      input.comparisonRate = foreign && comparisonRate !== "" ? Number(comparisonRate) : null;
    }
    onSubmit(input);
  };

  return (
    <form
      onSubmit={submit}
      aria-label={initial ? "Edit offer" : "New offer"}
      className="space-y-2.5 rounded-xl border border-dashed border-mauve-7 bg-muted/20 p-3"
    >
      <div className="grid grid-cols-2 gap-2">
        <SupplierField
          value={supplierName}
          onTyped={(name) => {
            setSupplierName(name);
            setOdooSupplierId(null);
          }}
          onPicked={(supplier) => {
            setSupplierName(supplier.name);
            setOdooSupplierId(supplier.id);
          }}
        />
        <Input
          aria-label="Brand"
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          placeholder="Brand"
          containerClassName="min-w-0"
          className={fieldClass}
        />
      </div>

      <Textarea
        aria-label="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        placeholder="Description"
        className="min-h-0 resize-none rounded-md px-2.5 py-1.5 text-[12.5px] md:text-[12.5px]"
      />

      <div className="grid grid-cols-[6rem_1fr_1fr] gap-2">
        <SelectField
          aria-label="Currency"
          size="sm"
          options={CANVASS_CURRENCIES.map((code) => ({ value: code, label: code }))}
          value={currency}
          onChange={(next) => setCurrency(next || DEFAULT_CURRENCY)}
        />
        {canReadMoney && (
          <Input
            type="number"
            min="0"
            step="any"
            aria-label={`Unit price in ${currency}`}
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
            placeholder={`Unit price (${currency})`}
            containerClassName="min-w-0"
            className={fieldClass}
          />
        )}
        {canReadMoney && foreign && (
          <Input
            type="number"
            min="0"
            step="any"
            aria-label="Comparison rate"
            value={comparisonRate}
            onChange={(e) => setComparisonRate(e.target.value)}
            placeholder={`Comparison rate (PHP per ${currency})`}
            containerClassName="min-w-0"
            className={fieldClass}
          />
        )}
      </div>
      {canReadMoney && foreign && (
        <p className="text-[11px] text-muted-foreground">
          The comparison rate is the rate you compared at, to read this quote in PHP. It is not the rate that will be paid.
        </p>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Input
          type="date"
          aria-label="Quote valid until"
          value={validUntil}
          onChange={(e) => setValidUntil(e.target.value)}
          title="Quote valid until"
          containerClassName="min-w-0"
          className={fieldClass}
        />
        <Input
          aria-label="Lead time"
          value={leadTime}
          onChange={(e) => setLeadTime(e.target.value)}
          placeholder="Lead time"
          containerClassName="min-w-0"
          className={fieldClass}
        />
        <Input
          aria-label="Quality note"
          value={qualityNote}
          onChange={(e) => setQualityNote(e.target.value)}
          placeholder="Quality note"
          containerClassName="min-w-0"
          className={fieldClass}
        />
      </div>

      <Input
        aria-label="Source link"
        value={sourceLink}
        onChange={(e) => setSourceLink(e.target.value)}
        placeholder="Source link (optional)"
        containerClassName="min-w-0"
        className={fieldClass}
      />

      <Textarea
        aria-label="Remarks"
        value={remarks}
        onChange={(e) => setRemarks(e.target.value)}
        rows={1}
        placeholder="Remarks (optional)"
        className="min-h-0 resize-none rounded-md px-2.5 py-1.5 text-[12.5px] md:text-[12.5px]"
      />

      {existingBrochure.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <AttachmentList attachments={existingBrochure} compact />
          {existingBrochure.map((file) => (
            <Button
              key={file.url}
              type="button"
              variant="link"
              onClick={() => setExistingBrochure((prev) => prev.filter((f) => f.url !== file.url))}
              className="h-auto p-0 text-[10px] font-semibold text-red-11 hover:underline"
            >
              remove
            </Button>
          ))}
        </div>
      )}

      <AttachmentField label="Brochure" attachments={attachments} hint="Optional — up to 3 files." />

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          className="h-auto rounded-lg px-3 py-1.5 text-[12px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={!canSubmit || isPending || attachments.isUploading}
          className="h-auto rounded-lg px-3.5 py-1.5 text-[12px] font-bold transition-opacity disabled:opacity-40"
        >
          {attachments.isUploading ? "Uploading…" : "Save offer"}
        </Button>
      </div>
    </form>
  );
}

function OfferRow({ offer, index, count, canEdit, canReadMoney, onUpdate, onRemove, onMove, onWin, isPending }) {
  const [isEditing, setIsEditing] = useState(false);
  const title = offer.supplier_name || offer.brand || "this offer";

  if (isEditing) {
    return (
      <OfferForm
        initial={offer}
        canReadMoney={canReadMoney}
        isPending={isPending}
        onCancel={() => setIsEditing(false)}
        onSubmit={(patch) => {
          onUpdate(offer.id, patch);
          setIsEditing(false);
        }}
      />
    );
  }

  const foreign = offerCurrency(offer) !== DEFAULT_CURRENCY;
  // A foreign Offer can't win without the rate its Acquire would be converted at.
  const needsRate = canReadMoney && foreign && (offer.comparison_rate === null || offer.comparison_rate === undefined || offer.comparison_rate === "");

  return (
    <div
      data-testid="offer"
      className={`group flex items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
        offer.is_winner ? "border-amber-7 bg-amber-a2" : "border-border/60 bg-card hover:border-mauve-8"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {offer.is_winner && <Award size={14} className="text-amber-11" aria-label="Winning offer" />}
          <span className="text-sm font-bold text-foreground">{offer.supplier_name || offer.brand || "—"}</span>
          {offer.supplier_name && offer.brand && (
            <span className="text-xs text-muted-foreground">{offer.brand}</span>
          )}
          {offer.source_link && (
            <ExternalLink
              href={offer.source_link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground"
              title={offer.source_link}
            >
              <ExternalLinkIcon size={11} />
            </ExternalLink>
          )}
          {offer.expired && (
            <span className="rounded-full bg-red-a3 px-1.5 py-0.5 text-[10px] font-bold text-red-11">Quote expired</span>
          )}
          {quoted(offer) && (
            <span className="ml-auto shrink-0 text-right text-sm font-bold tabular-nums text-foreground">
              {quoted(offer)}
              {foreign && (
                <span className="block text-[11px] font-normal text-muted-foreground" data-testid="php-figure">
                  {offer.php_figure === null || offer.php_figure === undefined
                    ? "No comparison rate yet"
                    : `${pesos(offer.php_figure)} at ${offer.comparison_rate}`}
                </span>
              )}
            </span>
          )}
        </div>
        {offer.description && (
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{offer.description}</p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          {offer.lead_time && <span>Lead time: {offer.lead_time}</span>}
          {offer.valid_until && <span>Valid until {offer.valid_until}</span>}
          {offer.quality_note && <span>Quality: {offer.quality_note}</span>}
        </div>
        {offer.remarks && <p className="mt-1 text-[11px] italic text-muted-foreground/80">{offer.remarks}</p>}
        {offer.brochure?.length > 0 && (
          <div className="mt-1.5">
            <AttachmentList attachments={offer.brochure} compact />
          </div>
        )}
      </div>

      {canEdit && (
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {!offer.is_winner && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={isPending || needsRate}
              onClick={() => onWin(offer.id)}
              aria-label={`Mark ${title} the winner`}
              title={needsRate ? "Add the comparison rate before this offer can win" : "Mark this offer the winner"}
              className="mr-1 h-auto rounded-lg px-1.5 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-amber-a3 hover:text-amber-11"
            >
              <Award size={12} className="mr-1" aria-hidden="true" />
              Winner
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={index === 0 || isPending}
            onClick={() => onMove(index, -1)}
            aria-label={`Move ${title} up`}
            className="h-auto w-auto rounded-lg p-1 text-muted-foreground hover:bg-mauve-a3 hover:text-foreground"
          >
            <ChevronUp size={13} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={index === count - 1 || isPending}
            onClick={() => onMove(index, 1)}
            aria-label={`Move ${title} down`}
            className="h-auto w-auto rounded-lg p-1 text-muted-foreground hover:bg-mauve-a3 hover:text-foreground"
          >
            <ChevronDown size={13} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => setIsEditing(true)}
            aria-label={`Edit ${title}`}
            className="h-auto w-auto rounded-lg p-1 text-muted-foreground hover:bg-mauve-a3 hover:text-foreground"
          >
            <Pencil size={13} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() =>
              confirmDeleteToast("Remove this offer?", `${title} comes off the comparison.`, () => onRemove(offer.id))
            }
            disabled={isPending}
            aria-label={`Remove ${title}`}
            className="h-auto w-auto rounded-lg p-1 text-muted-foreground hover:bg-red-a3 hover:text-red-11"
          >
            <Trash2 size={13} />
          </Button>
        </div>
      )}
    </div>
  );
}

export default function CanvassPanel({ open, onOpenChange, subject, subjectLabel, userId, canEdit, opportunityId }) {
  const queryClient = useQueryClient();
  const [isAdding, setIsAdding] = useState(false);
  const [reasonDraft, setReasonDraft] = useState(null);
  const attachments = useFileAttachments({ max: 3 });

  const subjectId = subject?.componentId || subject?.requestedItemId;
  const queryKey = ["canvass", subject?.componentId ? "component" : "requestedItem", subjectId];

  // A purchaser opening the panel opens the Canvass: opening is idempotent, so a second purchaser
  // lands on the same one. A reader who cannot write only looks, and sees nothing if none exists.
  const { data: canvass, isLoading } = useQuery({
    queryKey,
    queryFn: () => (canEdit ? canvassService.open(subject, userId) : canvassService.get(subject)),
    enabled: open && Boolean(subjectId),
  });

  const offers = canvass?.offers || [];
  const canReadMoney = Boolean(canvass?.canReadMoney);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey });
    if (opportunityId) queryClient.invalidateQueries({ queryKey: costingKeys.canvasses(opportunityId) });
  };
  const onError = (err) => toast.error(err.message);

  const addMutation = useMutation({
    mutationFn: (input) => canvassService.addOffer(canvass.id, input, userId),
    onSuccess: () => {
      invalidate();
      setIsAdding(false);
    },
    onError,
  });

  const updateMutation = useMutation({
    mutationFn: ({ offerId, patch }) => canvassService.updateOffer(offerId, patch),
    onSuccess: invalidate,
    onError,
  });

  const removeMutation = useMutation({
    mutationFn: (offerId) => canvassService.removeOffer(offerId),
    onSuccess: () => {
      invalidate();
      toast.success("Offer removed.");
    },
    onError,
  });

  // Winning fills the Component (#278), so the matrix has to be read again as well as the Canvass.
  const winnerMutation = useMutation({
    mutationFn: (offerId) => canvassService.markWinner(canvass.id, offerId),
    onSuccess: (result) => {
      invalidate();
      if (opportunityId) queryClient.invalidateQueries({ queryKey: costingKeys.all(opportunityId) });
      const filled = result?.filled || {};
      const what = [filled.acquire && "Acquire", filled.offer_specification && "Offer Specification", filled.documents && "documents"].filter(Boolean);
      toast.success(what.length ? `Winner marked. Filled ${what.join(", ")} from this Canvass.` : "Winner marked.");
    },
    onError,
  });

  const reorderMutation = useMutation({
    mutationFn: (ids) => canvassService.reorderOffers(canvass.id, ids),
    onSuccess: invalidate,
    onError,
  });

  const reasonMutation = useMutation({
    mutationFn: (reason) => canvassService.setReason(canvass.id, reason),
    onSuccess: () => {
      invalidate();
      setReasonDraft(null);
    },
    onError,
  });

  const attachMutation = useMutation({
    mutationFn: (next) => canvassService.setAttachments(canvass.id, next),
    onSuccess: invalidate,
    onError,
  });

  const move = (index, by) => {
    const ids = offers.map((o) => o.id);
    const target = index + by;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorderMutation.mutate(ids);
  };

  const handleAttach = async () => {
    const uploaded = await attachments.upload();
    attachMutation.mutate([...(canvass?.attachments || []), ...uploaded]);
    attachments.clear();
  };

  const busy = updateMutation.isPending || removeMutation.isPending || reorderMutation.isPending || winnerMutation.isPending;
  const reason = reasonDraft ?? canvass?.reason ?? "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart size={16} />
            Canvass{canvass?.number ? ` ${canvass.number}` : ""} — {subjectLabel}
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
          {isLoading && <p className="py-6 text-center text-xs text-muted-foreground">Loading…</p>}

          {!isLoading && !canvass && (
            <p className="py-6 text-center text-xs text-muted-foreground">Nobody has started a Canvass here yet.</p>
          )}

          {!isLoading && canvass && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">
                  {offers.length} offer{offers.length === 1 ? "" : "s"}
                  {canvass.moreOffersWarning && (
                    <span className="ml-1.5 text-amber-11" data-testid="more-offers-warning">
                      · {canvass.moreOffersWarning}
                    </span>
                  )}
                </span>
                {canvass.signed_off_at && (
                  <span className="text-[11px] font-semibold text-green-11">
                    Signed off by {canvass.signer?.name || "—"}
                  </span>
                )}
              </div>

              <div className="space-y-1.5">
                {offers.map((offer, index) => (
                  <OfferRow
                    key={offer.id}
                    offer={offer}
                    index={index}
                    count={offers.length}
                    canEdit={canEdit}
                    canReadMoney={canReadMoney}
                    isPending={busy}
                    onUpdate={(id, patch) => updateMutation.mutate({ offerId: id, patch })}
                    onRemove={(id) => removeMutation.mutate(id)}
                    onMove={move}
                    onWin={(id) => winnerMutation.mutate(id)}
                  />
                ))}
              </div>

              {canEdit && isAdding && (
                <OfferForm
                  canReadMoney={canReadMoney}
                  isPending={addMutation.isPending}
                  onCancel={() => setIsAdding(false)}
                  onSubmit={(input) => addMutation.mutate(input)}
                />
              )}

              {canEdit && !isAdding && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsAdding(true)}
                  className="h-auto flex w-full items-center justify-center gap-1.5 rounded-xl border-dashed border-mauve-7 py-2 text-[12px] font-bold text-muted-foreground transition-colors hover:border-mauve-8 hover:bg-mauve-a3 hover:text-foreground"
                >
                  <Plus size={14} /> Add offer
                </Button>
              )}

              <div className="space-y-1.5 border-t border-border/60 pt-3">
                <span className={`${CAPTION_BASE} tracking-wider text-muted-foreground`}>Why this supplier</span>
                {canEdit ? (
                  <Textarea
                    aria-label="Why this supplier"
                    value={reason}
                    onChange={(e) => setReasonDraft(e.target.value)}
                    onBlur={() => {
                      if (reasonDraft !== null && reasonDraft.trim() !== (canvass.reason || "")) {
                        reasonMutation.mutate(reasonDraft);
                      } else {
                        setReasonDraft(null);
                      }
                    }}
                    rows={3}
                    placeholder="The reason the winner was chosen, in your own words. It prints as written."
                    className="min-h-0 resize-none rounded-md px-2.5 py-1.5 text-[12.5px] md:text-[12.5px]"
                  />
                ) : (
                  <p className="whitespace-pre-wrap text-xs text-foreground">{canvass.reason || "—"}</p>
                )}
              </div>

              <div className="space-y-1.5 border-t border-border/60 pt-3">
                <span className={`${CAPTION_BASE} tracking-wider text-muted-foreground`}>Original canvass sheet</span>
                {(canvass.attachments || []).length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <AttachmentList attachments={canvass.attachments} compact />
                    {canEdit &&
                      canvass.attachments.map((file) => (
                        <Button
                          key={file.url}
                          type="button"
                          variant="link"
                          onClick={() => attachMutation.mutate(canvass.attachments.filter((a) => a.url !== file.url))}
                          className="h-auto p-0 text-[10px] font-semibold text-red-11 hover:underline"
                        >
                          remove
                        </Button>
                      ))}
                  </div>
                )}
                {canEdit && (
                  <AttachmentField
                    label=""
                    attachments={attachments}
                    hint="Optional — the working sheet, however you canvassed."
                  />
                )}
                {canEdit && attachments.files.length > 0 && (
                  <Button
                    type="button"
                    onClick={handleAttach}
                    disabled={attachments.isUploading}
                    className="h-auto rounded-lg bg-mauve-12 hover:bg-mauve-12/90 px-3 py-1.5 text-[11px] font-bold text-mauve-1 disabled:opacity-40"
                  >
                    {attachments.isUploading ? "Uploading…" : "Attach"}
                  </Button>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border/60 pt-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="h-auto rounded-lg px-3 py-1.5 text-[12px] font-semibold text-muted-foreground hover:text-foreground"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
