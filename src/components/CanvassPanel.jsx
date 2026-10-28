import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  ArrowUpRight,
  Award,
  ChevronLeft,
  ChevronRight,
  ExternalLink as ExternalLinkIcon,
  Pencil,
  Plus,
  Printer,
  Lock,
  LockOpen,
  Trash2,
  X,
} from "lucide-react";

import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { ExternalLink } from "@/components/ui/external-link";
import { APPROVE_CLASS } from "@/components/ui/approveClass";
import DetailGrid from "@/components/record/DetailGrid";
import PropertyPills from "@/components/record/PropertyPills";
import RecordHeader from "@/components/record/RecordHeader";
import RecordMoreMenu from "@/components/record/RecordMoreMenu";
import { STATE } from "@/components/record/statePalette";
import YourMoveCard from "@/components/record/YourMoveCard";
import { STATUS_THEME } from "@/constants/status";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CAPTION_BASE } from "@/lib/captionStyle";
import ModalShell from "./ui/ModalShell";
import CanvassOffersGrid from "./CanvassOffersGrid";
import CanvassSlots from "./CanvassSlots";
import CanvassSignoffDialog from "./CanvassSignoffDialog";
import CanvassUnlockDialog from "./CanvassUnlockDialog";
import PurchaseRequestModal from "./purchase-request/PurchaseRequestModal";
import { procurementQueueKey } from "./purchase-request/queryKeys";
import CanvassSupplierField, { canvassFieldClass as fieldClass } from "./CanvassSupplierField";
import CanvassRequestBadge from "./CanvassRequestBadge";
import { Button } from "./ui/button";
import { AttachmentField, AttachmentList } from "./ui/Attachments";
import { SelectField } from "./ui/SelectField";
import { costingKeys } from "./costing/costingKeys";
import { pesos } from "./costing/gridFormat";
import { useFileAttachments } from "../hooks/useFileAttachments";
import { useCanvassApprover } from "../hooks/useCanvassApprover";
import { canvassService } from "../services/canvassService";
import { openCanvassPrintWindow, printCanvass } from "../lib/pdf/canvassPrinter";
import { canPrintCanvass } from "../lib/pdf/canvassViewModel";
import { useAuth } from "../context/AuthContext";
import { CANVASS_CURRENCIES, CANVASS_KIND, MIN_CANVASS_OFFERS, CANVASS_LIST_KEY, CANVASS_LOCKED_MESSAGE, DEFAULT_CURRENCY } from "../constants/canvass";
import { getPermissionContext } from "../utils/permissions";
import { CANVASS_STATE_TONES, canvassRequestState, canvassStateOf } from "../utils/canvassList";
import { canPickWinner, offerCurrency } from "../utils/canvassMath";
import { projectOffer } from "../utils/offerProjection";
import { useCostingMatrix, useCostingTier } from "./costing/useCostingMatrix";
import { COSTING_TIER } from "../constants/costing";
import { useReferenceRate } from "../hooks/useReferenceRate";
import { formatReferenceRate } from "../utils/referenceRate";
import { getCurrentLocalDate } from "../utils/formatDate.js";

/**
 * The Canvass (#275, built in #276): the supplier comparison for one Costing Matrix Component,
 * recorded as Offers. `subject` is `{ componentId }`, `{ requestedItemId }`, `{ canvassId }` (one
 * picked on the Canvasses page), or `{}` for a new Canvass with no subject (ADR 0034).
 *
 * Opening the panel writes nothing. A Canvass not started yet shows the first Offer's form; saving
 * that Offer starts the Canvass and gives it its number (`canvassService.start`). One with no
 * subject also asks what is being bought, since it has no row to borrow a name from.
 *
 * Money is whatever the service sent. A reader without the money tier gets Offers with no price
 * keys at all, so every price, the comparison rate and the PHP figure simply do not draw. The
 * panel never asks who the reader is; it draws what arrived.
 *
 * The winner (#278) and the sign-off (#279) sit below the Offers: the purchasing approver list signs
 * from here (never the person who opened the Canvass), and any later change unsigns it.
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

/** A section heading in the record body, in sentence case. */
function SectionHeading({ title }) {
  return <h3 className="text-[15px] font-black tracking-tight text-foreground">{title}</h3>;
}

/** `inline` stacks the fields for one card's width, so an Offer is edited or added in its own place in the grid. */
function OfferForm({ initial, canReadMoney, onSubmit, onCancel, isPending, inline = false }) {
  const [supplierName, setSupplierName] = useState(initial?.supplier_name || "");
  const [odooSupplierId, setOdooSupplierId] = useState(initial?.odoo_supplier_id ?? null);
  const [brand, setBrand] = useState(initial?.brand || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [sourceLink, setSourceLink] = useState(initial?.source_link || "");
  const [currency, setCurrency] = useState(initial ? offerCurrency(initial) : DEFAULT_CURRENCY);
  const [unitPrice, setUnitPrice] = useState(initial?.unit_price ?? "");
  const [comparisonRate, setComparisonRate] = useState(initial?.comparison_rate ?? "");
  // Whether the comparison rate holds the Reference Rate we put there (#317), so a change of
  // currency may replace it. Anything typed, or an Offer's saved rate, is never replaced.
  const [rateIsSuggested, setRateIsSuggested] = useState(false);
  const [validUntil, setValidUntil] = useState(initial?.valid_until || "");
  const [leadTime, setLeadTime] = useState(initial?.lead_time || "");
  const [qualityNote, setQualityNote] = useState(initial?.quality_note || "");
  const [remarks, setRemarks] = useState(initial?.remarks || "");
  const [existingBrochure, setExistingBrochure] = useState(initial?.brochure || []);
  const attachments = useFileAttachments({ max: 3 });

  const foreign = currency !== DEFAULT_CURRENCY;
  const today = getCurrentLocalDate();
  const { data: referenceRate, isFetched: referenceChecked, isError: referenceFailed } = useReferenceRate(currency, today, {
    enabled: canReadMoney && foreign,
  });

  // Pre-fill a new Offer from today's Reference Rate. The typed value is what is stored and
  // printed (#275); a saved Offer is never re-filled.
  useEffect(() => {
    if (initial || !canReadMoney || !foreign || !referenceChecked) return;
    const blank = comparisonRate === "" || comparisonRate === null;
    if (!blank && !rateIsSuggested) return;
    setComparisonRate(referenceRate ? String(referenceRate.php_per_unit) : "");
    setRateIsSuggested(Boolean(referenceRate));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new rate or currency re-suggests
  }, [referenceRate, referenceChecked, currency, foreign, canReadMoney]);

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
      <div className={`grid gap-2 ${inline ? "grid-cols-1" : "grid-cols-2"}`}>
        <CanvassSupplierField
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

      <div className={`grid gap-2 ${inline ? "grid-cols-[5.5rem_1fr]" : "grid-cols-[6rem_1fr_1fr]"}`}>
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
            onChange={(e) => {
              setComparisonRate(e.target.value);
              setRateIsSuggested(false);
            }}
            placeholder={`Comparison rate (PHP per ${currency})`}
            containerClassName={inline ? "col-span-2 min-w-0" : "min-w-0"}
            className={fieldClass}
          />
        )}
      </div>
      {canReadMoney && foreign && referenceChecked && (
        <p className="text-[11px] text-muted-foreground" data-testid="offer-reference-rate">
          {referenceFailed
            ? "The Reference Rate couldn't be loaded. Type the rate you compared at."
            : referenceRate
            ? `Reference Rate: ${formatReferenceRate(referenceRate, today)}${referenceRate.rate_date < today ? " (the latest available)" : ""}.`
            : `No Reference Rate for ${currency} yet. Type the rate you compared at.`}
        </p>
      )}
      {canReadMoney && foreign && (
        <p className="text-[11px] text-muted-foreground">
          The comparison rate is the rate you compared at, to read this quote in PHP. It is not the rate that will be paid.
        </p>
      )}

      <div className={`grid gap-2 ${inline ? "grid-cols-2" : "grid-cols-3"}`}>
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
          containerClassName={inline ? "col-span-2 min-w-0" : "min-w-0"}
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
              className="h-auto p-0 text-[10px] font-semibold text-muted-foreground underline hover:text-foreground"
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

/**
 * "If this offer wins" (#321): the Component's Acquire and Markup Price under this Offer, and, for the
 * Closed Book, the Tender Line's margin and what the matrix summary would become. A look at the live
 * matrix, never stored. Shows nothing where the Offer has no figure (a foreign Offer with no rate).
 */
function OfferProjection({ projection }) {
  if (!projection) return null;
  const { margin, summary } = projection;
  return (
    <div className="mt-1.5 rounded-lg bg-mauve-a2 px-2 py-1.5 text-[11px] text-muted-foreground" data-testid="offer-projection">
      <span className="font-semibold text-foreground">If this offer wins</span>
      <span className="ml-2" data-testid="projection-acquire">Acquire {pesos(projection.acquireUnit)}</span>
      {projection.markupPriceUnit !== null && (
        <span className="ml-2" data-testid="projection-markup-price">Markup Price {pesos(projection.markupPriceUnit)}</span>
      )}
      {margin && (
        <span className="ml-2" data-testid="projection-margin">
          Margin {pesos(margin.projected.amount)}
          {margin.projected.percent !== null && ` (${margin.projected.percent}%)`} · now {pesos(margin.current.amount)}
        </span>
      )}
      {summary && (
        <span className="ml-2" data-testid="projection-summary">
          Revenue {pesos(summary.revenue.to)} · now {pesos(summary.revenue.from)}
        </span>
      )}
    </div>
  );
}

function OfferRow({ offer, projection, index, count, canEdit, canReadMoney, canPick = true, onUpdate, onRemove, onMove, onWin, onClearWin, isPending }) {
  const [isEditing, setIsEditing] = useState(false);
  const title = offer.supplier_name || offer.brand || "this offer";

  if (isEditing) {
    return (
      <OfferForm
        inline
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
      className={`group flex min-w-0 flex-col gap-2 rounded-xl border p-3 transition-colors ${
        offer.is_winner ? "border-amber-7 bg-amber-a2" : "border-border/60 bg-card hover:border-mauve-8"
      }`}
    >
      <div className="flex min-h-7 items-center justify-between gap-2">
        <span className={`${CAPTION_BASE} tracking-wider text-muted-foreground`}>Offer {index + 1}</span>
        {canEdit && offer.is_winner && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={isPending}
            onClick={onClearWin}
            aria-label={`Clear ${title} as the winner`}
            title="Un-pick the winner, leaving none"
            className="h-auto rounded-lg px-1.5 py-1 text-[11px] font-semibold text-amber-11 hover:bg-amber-a3"
          >
            <X size={12} className="mr-1" aria-hidden="true" />
            Clear winner
          </Button>
        )}
        {canEdit && !offer.is_winner && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={isPending || needsRate || !canPick}
            onClick={() => onWin(offer.id)}
            aria-label={`Mark ${title} the winner`}
            title={
              needsRate
                ? "Add the comparison rate before this offer can win"
                : !canPick
                  ? "Fill or explain all three supplier slots first"
                  : "Mark this offer the winner"
            }
            className="h-auto rounded-lg px-1.5 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-amber-a3 hover:text-amber-11"
          >
            <Award size={12} className="mr-1" aria-hidden="true" />
            Pick winner
          </Button>
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {offer.is_winner && <Award size={14} className="text-amber-11" aria-label="Winning offer" />}
          <span className="text-sm font-bold text-foreground">{offer.supplier_name || offer.brand || "—"}</span>
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
            <span className="rounded-full bg-amber-a3 px-1.5 py-0.5 text-[10px] font-bold text-amber-12">Quote expired</span>
          )}
        </div>
        {offer.supplier_name && offer.brand && <p className="text-xs font-medium text-foreground/70">{offer.brand}</p>}
        {offer.description && <p className="text-xs leading-relaxed text-muted-foreground">{offer.description}</p>}
        {quoted(offer) && (
          <p className="pt-1.5 font-mono text-base font-bold tabular-nums text-foreground">
            {quoted(offer)}
            {foreign && (
              <span className="block font-mono text-[11px] font-normal text-muted-foreground" data-testid="php-figure">
                {offer.php_figure === null || offer.php_figure === undefined
                  ? "No comparison rate yet"
                  : `${pesos(offer.php_figure)} at ${offer.comparison_rate}`}
              </span>
            )}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          {offer.lead_time && <span>Lead time: {offer.lead_time}</span>}
          {offer.valid_until && <span>Valid until {offer.valid_until}</span>}
          {offer.quality_note && <span>Quality: {offer.quality_note}</span>}
        </div>
        {offer.remarks && <p className="text-[11px] italic text-muted-foreground/80">{offer.remarks}</p>}
        <OfferProjection projection={projection} />
        {offer.brochure?.length > 0 && (
          <div className="pt-0.5">
            <AttachmentList attachments={offer.brochure} compact />
          </div>
        )}
      </div>

      {canEdit && (
        <div className="mt-auto flex items-center justify-between border-t border-border/50 pt-2">
          <div className="flex items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={index === 0 || isPending}
              onClick={() => onMove(index, -1)}
              aria-label={`Move ${title} up`}
              title="Move earlier"
              className="h-auto w-auto rounded-lg p-1 text-muted-foreground hover:bg-mauve-a3 hover:text-foreground"
            >
              <ChevronLeft size={14} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={index === count - 1 || isPending}
              onClick={() => onMove(index, 1)}
              aria-label={`Move ${title} down`}
              title="Move later"
              className="h-auto w-auto rounded-lg p-1 text-muted-foreground hover:bg-mauve-a3 hover:text-foreground"
            >
              <ChevronRight size={14} />
            </Button>
          </div>
          <div className="flex items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setIsEditing(true)}
              aria-label={`Edit ${title}`}
              title="Edit"
              className="h-auto w-auto rounded-lg p-1 text-muted-foreground hover:bg-mauve-a3 hover:text-foreground"
            >
              <Pencil size={14} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => onRemove(offer)}
              disabled={isPending}
              aria-label={`Remove ${title}`}
              title="Remove"
              className="h-auto w-auto rounded-lg p-1 text-muted-foreground hover:bg-mauve-a3 hover:text-foreground"
            >
              <Trash2 size={14} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CanvassPanel({ open, onOpenChange, subject, subjectLabel, userId, canEdit, opportunityId, canvasserName: canvasserNameProp = null, onStarted }) {
  const queryClient = useQueryClient();
  const [isAdding, setIsAdding] = useState(false);
  // A new Canvass with no subject is known by its id once its first Offer has started it.
  const [startedId, setStartedId] = useState(null);
  const [productDraft, setProductDraft] = useState(null);
  const [reasonDraft, setReasonDraft] = useState(null);
  const [isSigning, setIsSigning] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [viewingRequest, setViewingRequest] = useState(null);
  // The two questions the record asks first, each a plain confirm dialog: the Offer to remove, and clearing the winner.
  const [removing, setRemoving] = useState(null);
  const [clearing, setClearing] = useState(false);
  const [printing, setPrinting] = useState(false);
  const { user } = useAuth();
  const isApprover = useCanvassApprover(userId);
  const attachments = useFileAttachments({ max: 3 });

  const current = startedId ? { canvassId: startedId } : subject || {};
  const subjectKind = current.canvassId
    ? "canvass"
    : current.componentId
      ? "component"
      : current.requestedItemId
        ? "requestedItem"
        : "new";
  const subjectId = current.canvassId || current.componentId || current.requestedItemId || null;
  const queryKey = ["canvass", subjectKind, subjectId];

  // Opening only reads (ADR 0034): nothing is written until the first Offer is saved.
  const { data: canvass = null, isLoading } = useQuery({
    queryKey,
    queryFn: () => canvassService.get(current),
    enabled: open && Boolean(subjectId),
  });
  // No Component and no Requested Item: the Canvass says itself what it is buying.
  const isBare = subjectKind === "new" || Boolean(canvass && !canvass.component_id && !canvass.requested_item_id);
  const productName = productDraft ?? canvass?.product_name ?? "";
  const title = subjectLabel || canvass?.product_name || (subjectKind === "new" ? "New Canvass" : "");

  const { data: history = [] } = useQuery({
    queryKey: [...queryKey, "signoffHistory", canvass?.id],
    queryFn: () => canvassService.signoffHistory(canvass.id),
    enabled: open && Boolean(canvass?.id),
  });

  const offers = canvass?.offers || [];
  const canReadMoney = Boolean(canvass?.canReadMoney);

  // Offer Projection (#321): only a Canvass on a Component has a row to project. The database serves
  // Purchasing and the Closed Book their figures; the Closed Book's matrix adds the margin and summary.
  const hasComponent = Boolean(canvass?.component_id);
  const { data: projections } = useQuery({
    queryKey: [...queryKey, "projection", canvass?.id],
    queryFn: () => canvassService.projection(canvass.id),
    enabled: open && hasComponent,
    // The markup factor changes on the matrix, not here, so never trust a cached figure.
    staleTime: 0,
  });
  const { data: tier } = useCostingTier(open && hasComponent && projections ? opportunityId : null);
  const { data: matrix } = useCostingMatrix(tier === COSTING_TIER.CLOSED_BOOK ? opportunityId : null);
  const projectionOf = (offer) =>
    projectOffer({
      projection: (projections || []).find((p) => p.offer_id === offer.id),
      componentId: canvass?.component_id,
      matrix,
    });

  const invalidate = () => {
    // Prefix match: the sign-off history is keyed under the Canvass's own key.
    queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: CANVASS_LIST_KEY });
    // A request's items show their Canvass, so what changed here has to reach the request too.
    queryClient.invalidateQueries({ queryKey: ["purchase-request"] });
    queryClient.invalidateQueries({ queryKey: procurementQueueKey });
    if (opportunityId) queryClient.invalidateQueries({ queryKey: costingKeys.canvasses(opportunityId) });
  };
  const onError = (err) => toast.error(err.message);

  // The first Offer starts the Canvass and gives it its number.
  const startMutation = useMutation({
    mutationFn: (input) => canvassService.start(current, { productName }, input, userId),
    onSuccess: (started) => {
      if (subjectKind === "new") setStartedId(started.canvassId);
      setProductDraft(null);
      invalidate();
      toast.success(`Canvass ${started.number} started.`);
      onStarted?.(started);
    },
    onError,
  });

  const productMutation = useMutation({
    mutationFn: (name) => canvassService.setProductName(canvass.id, name),
    onSuccess: () => {
      invalidate();
      setProductDraft(null);
    },
    onError,
  });

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

  // "No other supplier" on an empty slot 2 or 3 (#721); a winner needs the three slots covered.
  const markNoOtherMutation = useMutation({
    mutationFn: ({ slots, reason }) => canvassService.markNoOtherSupplier(canvass.id, slots, reason),
    onSuccess: invalidate,
    onError,
  });
  const clearNoOtherMutation = useMutation({
    mutationFn: (slot) => canvassService.clearNoOtherSupplier(canvass.id, slot),
    onSuccess: invalidate,
    onError,
  });

  // Un-picking leaves no winner and unsigns; the matrix keeps what the old winner filled.
  const clearWinnerMutation = useMutation({
    mutationFn: () => canvassService.clearWinner(canvass.id),
    onSuccess: () => {
      invalidate();
      if (opportunityId) queryClient.invalidateQueries({ queryKey: costingKeys.all(opportunityId) });
      toast.success(
        hasComponent
          ? "Winner cleared. The S0 Evaluation keeps what it filled until a new winner is picked."
          : "Winner cleared.",
      );
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

  // The sheet is prices, so only a reader who received them gets the action. The window opens in the
  // click (popup blockers); the Canvass is read and composed into it afterwards.
  const handlePrint = async () => {
    const printWindow = openCanvassPrintWindow();
    if (!printWindow) {
      toast.error("Allow pop-ups for this site to print the Canvass.");
      return;
    }
    setPrinting(true);
    try {
      await printCanvass({ canvassId: canvass.id }, { printWindow, subjectLabel: title, opportunityId, printedBy: user?.name ?? null });
    } catch (err) {
      toast.error(err?.message || "The Canvass could not be printed.");
    } finally {
      setPrinting(false);
    }
  };

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

  const winner = offers.find((o) => o.is_winner);

  // The request this Canvass became: the Canvasses list already knows its label and status, so a
  // Canvass on a Requested Item reads them from there (shared cache with the Canvasses page).
  const { data: listRows = [] } = useQuery({
    queryKey: CANVASS_LIST_KEY,
    queryFn: () => canvassService.list(),
    enabled: open && Boolean(canvass?.requested_item_id),
  });
  const listRow = canvass?.requested_item_id ? listRows.find((r) => r.id === canvass.id) : null;
  const requestSource = canvass && {
    kind: canvass.component_id ? CANVASS_KIND.COMPONENT : canvass.requested_item_id ? CANVASS_KIND.REQUESTED_ITEM : CANVASS_KIND.NONE,
    winner,
    requestId: listRow?.requestId ?? null,
    requestLabel: listRow?.requestLabel ?? null,
    requestItemStatus: listRow?.requestItemStatus ?? null,
  };
  const isSigned = Boolean(canvass?.signed_off_at);
  const isCreator = Boolean(canvass && userId && canvass.created_by === userId);
  const hasReason = Boolean(String(canvass?.reason ?? "").trim());
  const readyToSign = Boolean(winner) && hasReason;
  const lastSigned = isSigned ? [...history].reverse().find((h) => h.kind === "signed") : null;
  const lastCleared = !isSigned ? [...history].reverse().find((h) => h.kind === "cleared") : null;
  const lastUnlocked = [...history].reverse().find((h) => h.kind === "unlocked");

  // Once a Purchase Request is made from it, the Canvass is what was bought on: offers, winner,
  // reason and product name stop changing (the database refuses them too).
  const isLocked = Boolean(canvass?.locked);
  const isSuperAdmin = Boolean(getPermissionContext(user).isSuperAdmin);
  const requestState = requestSource ? canvassRequestState(requestSource) : null;
  const canChange = canEdit && !isLocked;

  const busy =
    updateMutation.isPending || removeMutation.isPending || reorderMutation.isPending || winnerMutation.isPending || clearWinnerMutation.isPending;
  const reason = reasonDraft ?? canvass?.reason ?? "";

  const subjectKindLabel = canvass?.component_id ? "Component" : canvass?.requested_item_id ? "Requested item" : "Free-standing";
  // The Canvasses page hands over the Canvasser it already lists; opened from a Component, only the person who started it is known.
  const canvasserName = canvasserNameProp ?? listRow?.canvasserName ?? (isCreator ? user?.name : null) ?? null;
  const winnerLabel = winner ? winner.supplier_name || winner.brand || null : null;
  const prId = requestState?.requestId ?? null;
  const offerCount = `${offers.length} offer${offers.length === 1 ? "" : "s"}`;

  // The same state and tone the Canvasses list shows, so a Canvass reads the same in both places.
  const rowState = canvassStateOf({ signedOffAt: canvass?.signed_off_at, requestId: prId });
  const badge = { label: rowState.label, theme: CANVASS_STATE_TONES[rowState.state] };

  const canSignNow = Boolean(canvass) && !isSigned && isApprover && !isCreator && readyToSign;

  const status = !canvass
    ? ""
    : isSigned
      ? "Signed off. Nothing left to do."
      : canSignNow
        ? "Waiting for you: Sign-off"
        : offers.length === 0
          ? "Next: add the first offer"
          : !winner
            ? "Next: pick a winner"
            : !hasReason
              ? "Next: say why this supplier"
              : "Waiting for an approver to sign off";

  const steps = canvass
    ? [
        {
          key: "offers",
          title: "Offers in",
          summary: offers.length ? offerCount : "No offers yet",
          state: offers.length ? STATE.DONE : STATE.CURRENT,
          needsMe: false,
          body: (
            <p className="text-xs text-muted-foreground">
              Compare at least {MIN_CANVASS_OFFERS} suppliers. Add each quote as an offer.
              {canvass.moreOffersWarning ? ` ${canvass.moreOffersWarning}.` : ""}
            </p>
          ),
        },
        {
          key: "winner",
          title: "Winner picked",
          summary: winnerLabel || "No winner picked",
          state: winner ? STATE.DONE : offers.length ? STATE.CURRENT : STATE.WAITING,
          needsMe: false,
          body: <p className="text-xs text-muted-foreground">Pick the winner on its offer card. Changing it unsigns the Canvass.</p>,
        },
        ...(requestState
          ? [
              {
                key: "request",
                title: "Purchase Request",
                summary: requestState.label,
                state: prId ? STATE.DONE : winner ? STATE.CURRENT : STATE.WAITING,
                body: (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-testid="canvass-request-strip">
                    <span>Purchase Request</span>
                    {prId && (
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        onClick={() => setViewingRequest(prId)}
                        className="h-auto gap-0.5 p-0 text-xs font-semibold"
                      >
                        {requestState.requestLabel}
                        <ArrowUpRight size={12} aria-hidden="true" />
                      </Button>
                    )}
                    <CanvassRequestBadge source={requestSource} />
                  </div>
                ),
              },
            ]
          : []),
        {
          key: "signoff",
          title: "Sign-off",
          summary: isSigned ? `Signed off by ${canvass.signer?.name || "—"}` : "Not signed off yet",
          state: isSigned ? STATE.DONE : readyToSign ? STATE.CURRENT : STATE.WAITING,
          needsMe: canSignNow,
          body: (
            <div className="space-y-1.5" data-testid="canvass-signoff">
              {isSigned ? (
                <p className="text-xs font-semibold text-foreground" data-testid="signoff-state">
                  Signed off by {canvass.signer?.name || "—"}
                  {lastSigned && ` on ${lastSigned.offer_count} offer${lastSigned.offer_count === 1 ? "" : "s"}`}.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground" data-testid="signoff-state">
                  Not signed off yet.
                  {lastCleared?.reason && (
                    <span className="ml-1">It was unsigned because: {lastCleared.reason.charAt(0).toLowerCase() + lastCleared.reason.slice(1)}.</span>
                  )}
                </p>
              )}
              {!isSigned && isApprover && isCreator && (
                <p className="text-xs text-muted-foreground">You opened this Canvass, so someone else on the approver list signs it.</p>
              )}
              {!isSigned && isApprover && !isCreator && !readyToSign && (
                <p className="text-xs text-muted-foreground">It needs a winner and a reason before it can be signed.</p>
              )}
              {lastUnlocked && (
                <p className="text-xs text-muted-foreground" data-testid="unlock-history">
                  Unlocked by {lastUnlocked.actor?.name || "a Super Admin"}: {lastUnlocked.reason}
                </p>
              )}
              {canChange && isSigned && (
                <p className="text-xs text-muted-foreground">Changing an offer, a price, the winner or the reason unsigns it.</p>
              )}
            </div>
          ),
          moves: canSignNow ? (
            <Button type="button" onClick={() => setIsSigning(true)} className={APPROVE_CLASS}>
              Sign off
            </Button>
          ) : null,
        },
      ]
    : [];

  const menuItems = [];
  if (canvass && canPrintCanvass(canvass)) {
    menuItems.push({ key: "print", label: "Print", icon: Printer, disabled: printing, onSelect: handlePrint });
  }
  if (canvass && isLocked && isSuperAdmin) {
    menuItems.push({ key: "unlock", label: "Unlock", icon: LockOpen, onSelect: () => setUnlocking(true) });
  }

  return (
    <>
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      size="record"
      crumbs={["Canvass", canvass?.number].filter(Boolean)}
      headerActions={<RecordMoreMenu items={menuItems} />}
    >
      {isLoading && <p className="py-6 text-center text-xs text-muted-foreground">Loading…</p>}

      {!isLoading && !canvass && <RecordHeader name={title || "New Canvass"} />}

      {!isLoading && !canvass && !canEdit && (
        <p className="py-6 text-center text-xs text-muted-foreground">Nobody has started a Canvass here yet.</p>
      )}

      {!isLoading && !canvass && canEdit && (
        <div className="space-y-2.5" data-testid="canvass-not-started">
          {isBare && (
            <Input
              label="What is being bought"
              value={productName}
              onChange={(e) => setProductDraft(e.target.value)}
              placeholder="e.g. Laser printer toner, black"
              containerClassName="min-w-0"
              className={fieldClass}
            />
          )}
          <p className="text-xs text-muted-foreground">
            No offers yet. Saving the first offer starts this Canvass and gives it its number.
          </p>
          <CanvassOffersGrid filled={1} data-testid="offers-grid">
            <OfferForm
              inline
              canReadMoney
              isPending={startMutation.isPending}
              onCancel={() => onOpenChange(false)}
              onSubmit={(input) => {
                if (isBare && !productName.trim()) {
                  toast.error("Say what is being bought first.");
                  return;
                }
                startMutation.mutate(input);
              }}
            />
          </CanvassOffersGrid>
        </div>
      )}

      {!isLoading && canvass && (
        <div className="space-y-6 pb-2">
          <RecordHeader
            reference={canvass.number}
            name={title}
            badge={badge}
            line={[`${subjectKindLabel} subject`, canvasserName && `Canvasser ${canvasserName}`, offerCount].filter(Boolean).join(" · ")}
          />
          <PropertyPills
            items={[
              { key: "canvasser", label: "Canvasser", value: canvasserName },
              { key: "subject", label: "Subject", value: title },
              { key: "winner", label: "Winner", value: winnerLabel },
              { key: "request", label: "Purchase Request", value: prId ? requestState.requestLabel : null },
            ]}
          />
          {isLocked && (
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground" data-testid="canvass-locked-note">
              <Lock size={13} className="shrink-0" aria-hidden="true" />
              <span>
                {CANVASS_LOCKED_MESSAGE}
                {!isSuperAdmin && " Ask a Super Admin to unlock it."}
              </span>
            </p>
          )}

          <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_25rem]">
            <div className="min-w-0 space-y-6">
              {isBare && canChange && (
                <Input
                  label="What is being bought"
                  value={productName}
                  onChange={(e) => setProductDraft(e.target.value)}
                  onBlur={() => {
                    if (productDraft === null) return;
                    if (!productDraft.trim()) {
                      toast.error("A Canvass with no Requested Item needs to say what is being bought.");
                      setProductDraft(null);
                    } else if (productDraft.trim() !== (canvass.product_name || "")) {
                      productMutation.mutate(productDraft);
                    } else {
                      setProductDraft(null);
                    }
                  }}
                  containerClassName="min-w-0"
                  className={fieldClass}
                />
              )}

              <section className="space-y-3">
                <SectionHeading title="Supplier slots" />
                <CanvassSlots
                  offers={offers}
                  marks={canvass.noOtherSupplier || []}
                  canEdit={canChange}
                  isPending={markNoOtherMutation.isPending || clearNoOtherMutation.isPending}
                  onMark={(input) => markNoOtherMutation.mutate(input)}
                  onClear={(slot) => clearNoOtherMutation.mutate(slot)}
                />
              </section>

              <section className="space-y-3">
                <SectionHeading title={`Offers · ${offers.length}`} />
                {canvass.moreOffersWarning && (
                  <p className="text-xs text-amber-12" data-testid="more-offers-warning">
                    {canvass.moreOffersWarning}
                  </p>
                )}
                {!winner && offers.length > 0 && hasComponent && (
                  <p className="text-xs text-muted-foreground" data-testid="no-winner-note">
                    No winner picked. Anything an earlier winner filled on the S0 Evaluation stays until a new winner replaces it.
                  </p>
                )}
                <CanvassOffersGrid filled={offers.length + (canChange ? 1 : 0)} data-testid="offers-grid">
                  {offers.map((offer, index) => (
                    <OfferRow
                      key={offer.id}
                      offer={offer}
                      projection={projectionOf(offer)}
                      index={index}
                      count={offers.length}
                      canEdit={canChange}
                      canReadMoney={canReadMoney}
                      canPick={canPickWinner(offers, canvass.noOtherSupplier || [])}
                      isPending={busy}
                      onUpdate={(id, patch) => updateMutation.mutate({ offerId: id, patch })}
                      onRemove={setRemoving}
                      onMove={move}
                      onWin={(id) => winnerMutation.mutate(id)}
                      onClearWin={() => setClearing(true)}
                    />
                  ))}

                  {canChange && isAdding && (
                    <OfferForm
                      inline
                      canReadMoney={canReadMoney}
                      isPending={addMutation.isPending}
                      onCancel={() => setIsAdding(false)}
                      onSubmit={(input) => addMutation.mutate(input)}
                    />
                  )}

                  {canChange && !isAdding && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setIsAdding(true)}
                      className={`h-auto flex w-full items-center justify-center gap-1.5 rounded-xl border-dashed border-mauve-7 py-2 text-[12px] font-bold text-muted-foreground transition-colors hover:border-mauve-8 hover:bg-mauve-a3 hover:text-foreground ${
                        offers.length > 0 && offers.length % 3 === 0 ? "md:col-span-3" : "min-h-16"
                      }`}
                    >
                      <Plus size={14} /> Add offer
                    </Button>
                  )}
                </CanvassOffersGrid>
              </section>

              <section className="space-y-3">
                <SectionHeading title="Why this supplier" />
                {canChange ? (
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
                ) : hasReason ? (
                  <DetailGrid
                    min="16rem"
                    items={[
                      { label: "Winner", value: winnerLabel },
                      { label: "Reason", value: <span className="whitespace-pre-wrap">{canvass.reason}</span> },
                    ]}
                  />
                ) : (
                  <p className="text-[13px] text-muted-foreground">No reason was written for this supplier.</p>
                )}
              </section>

              <section className="space-y-3">
                <SectionHeading title="Original canvass sheet" />
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
                          className="h-auto p-0 text-[10px] font-semibold text-muted-foreground underline hover:text-foreground"
                        >
                          remove
                        </Button>
                      ))}
                  </div>
                )}
                {(canvass.attachments || []).length === 0 && !canEdit && (
                  <p className="text-[13px] text-muted-foreground">No sheet was attached.</p>
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
              </section>
            </div>

            <aside className="min-w-0 xl:sticky xl:top-2 xl:self-start">
              <YourMoveCard status={status} steps={steps} />
            </aside>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(next) => !next && setRemoving(null)}
        title="Remove this offer?"
        description={`${removing?.supplier_name || removing?.brand || "This offer"} comes off the comparison.`}
        confirmLabel="Remove offer"
        tone="destructive"
        onConfirm={() => {
          removeMutation.mutate(removing.id);
          setRemoving(null);
        }}
      />
      <ConfirmDialog
        open={clearing}
        onOpenChange={setClearing}
        title="Clear the winner?"
        description={`${isSigned ? "This unsigns the Canvass. " : ""}It leaves no winner until you pick one again.`}
        confirmLabel="Clear winner"
        onConfirm={() => {
          clearWinnerMutation.mutate();
          setClearing(false);
        }}
      />
    </ModalShell>

      {unlocking && canvass && (
        <CanvassUnlockDialog open={unlocking} onOpenChange={setUnlocking} canvass={canvass} onUnlocked={invalidate} />
      )}

      {viewingRequest && <PurchaseRequestModal requestId={viewingRequest} onClose={() => setViewingRequest(null)} />}

      {isSigning && canvass && (
        <CanvassSignoffDialog
          open={isSigning}
          onOpenChange={setIsSigning}
          summary={{
            id: canvass.id,
            number: canvass.number,
            subjectLabel: title,
            reason: canvass.reason,
            offerCount: offers.length,
            winnerLabel: winner ? [winner.supplier_name, winner.brand].filter(Boolean).join(" · ") : null,
          }}
          onSigned={invalidate}
        />
      )}
    </>
  );
}
