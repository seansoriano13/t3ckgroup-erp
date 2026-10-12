import { useState } from "react";
import { ExternalLink } from "@/components/ui/external-link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  Award,
  ExternalLink as ExternalLinkIcon,
  Pencil,
  Plus,
  ShoppingCart,
  Star,
  Trash2,
  X,
} from "lucide-react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { AttachmentField, AttachmentList } from "./ui/Attachments";
import { confirmActionToast, confirmDeleteToast } from "./ui/CustomToast";
import { useFileAttachments } from "../hooks/useFileAttachments";
import { projectEvaluationService } from "../services/projectEvaluationService";
import {
  MIN_CANVASS_OFFERS,
  canvassNeedsMoreOffers,
} from "../constants/projectEvaluation";
import { Input } from "@/components/ui/input";

import { Textarea } from "@/components/ui/textarea";
import { CAPTION_BASE } from "@/lib/captionStyle";
/**
 * Canvass (issue #46, Inclusion side #47) — the three-or-more supplier
 * comparison, recorded as structured Offers instead of an ad-hoc sheet nobody
 * can produce later as evidence.
 *
 * `subject` is exactly one of `{ procurementRequestId }` or `{ inclusionId }`
 * — projectEvaluationService.subjectColumns enforces this the same way the
 * database's CHECK does (migration 0059).
 */

const money = (value) =>
  value === null || value === undefined || value === "" ? "—" : `₱${Number(value).toLocaleString()}`;

function OfferForm({ initial, onSubmit, onCancel, isPending }) {
  const [brand, setBrand] = useState(initial?.brand || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [sourceLink, setSourceLink] = useState(initial?.source_link || "");
  const [unitPrice, setUnitPrice] = useState(initial?.unit_price ?? "");
  const [leadTime, setLeadTime] = useState(initial?.lead_time || "");
  const [qualityNote, setQualityNote] = useState(initial?.quality_note || "");
  const [remarks, setRemarks] = useState(initial?.remarks || "");
  const [existingBrochure, setExistingBrochure] = useState(initial?.brochure || []);
  const attachments = useFileAttachments({ max: 3 });

  const canSubmit = brand.trim() || description.trim();

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    const uploaded = await attachments.upload();
    onSubmit({
      brand: brand.trim(),
      description: description.trim(),
      sourceLink: sourceLink.trim(),
      unitPrice: unitPrice === "" ? null : Number(unitPrice),
      leadTime: leadTime.trim(),
      qualityNote: qualityNote.trim(),
      remarks: remarks.trim(),
      brochure: [...existingBrochure, ...uploaded],
    });
  };

  return (
    <form
      onSubmit={submit}
      className="space-y-2.5 rounded-xl border border-dashed border-mauve-7 bg-muted/20 p-3"
    >
      <div className="grid grid-cols-2 gap-2">
        <Input
          autoFocus
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          placeholder="Brand / supplier"
          containerClassName="min-w-0" className="h-auto rounded-md border border-border bg-card px-2.5 py-1.5 text-[13px] font-semibold text-foreground outline-none focus:border-mauve-8"
        />
        <Input
          value={sourceLink}
          onChange={(e) => setSourceLink(e.target.value)}
          placeholder="Source link (optional)"
          containerClassName="min-w-0" className="h-auto rounded-md border border-border bg-card px-2.5 py-1.5 text-[13px] text-foreground outline-none focus:border-mauve-8"
        />
      </div>

      <Textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        placeholder="Description"
        className="min-h-0 resize-none rounded-md px-2.5 py-1.5 text-[12.5px] md:text-[12.5px]"
      />

      <div className="grid grid-cols-3 gap-2">
        <Input
          type="number"
          min="0"
          step="any"
          value={unitPrice}
          onChange={(e) => setUnitPrice(e.target.value)}
          placeholder="Unit price"
          containerClassName="min-w-0" className="h-auto rounded-md border border-border bg-card px-2.5 py-1.5 text-[13px] text-foreground outline-none focus:border-mauve-8"
        />
        <Input
          value={leadTime}
          onChange={(e) => setLeadTime(e.target.value)}
          placeholder="Lead time"
          containerClassName="min-w-0" className="h-auto rounded-md border border-border bg-card px-2.5 py-1.5 text-[13px] text-foreground outline-none focus:border-mauve-8"
        />
        <Input
          value={qualityNote}
          onChange={(e) => setQualityNote(e.target.value)}
          placeholder="Quality note"
          containerClassName="min-w-0" className="h-auto rounded-md border border-border bg-card px-2.5 py-1.5 text-[13px] text-foreground outline-none focus:border-mauve-8"
        />
      </div>

      <Textarea
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

function OfferRow({ offer, canEdit, onMarkWinner, onUpdate, onRemove, isPending }) {
  const [isEditing, setIsEditing] = useState(false);

  if (isEditing) {
    return (
      <OfferForm
        initial={offer}
        isPending={isPending}
        onCancel={() => setIsEditing(false)}
        onSubmit={(patch) => {
          onUpdate(offer.id, patch);
          setIsEditing(false);
        }}
      />
    );
  }

  return (
    <div
      className={`group flex items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
        offer.is_winner
          ? "border-amber-7 bg-amber-a2"
          : "border-border/60 bg-card hover:border-mauve-8"
      }`}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        disabled={!canEdit || isPending || offer.is_winner}
        onClick={() => onMarkWinner(offer.id)}
        aria-label={offer.is_winner ? "Winning offer" : `Mark ${offer.brand || "this offer"} the winner`}
        title={offer.is_winner ? "Winning offer" : "Mark as winner"}
        className="h-auto w-auto mt-0.5 shrink-0 rounded-full p-1 transition-colors disabled:cursor-default hover:bg-transparent"
      >
        {offer.is_winner ? (
          <Award size={16} className="text-amber-11" />
        ) : (
          <Star
            size={16}
            className="text-mauve-8 opacity-0 group-hover:opacity-100 hover:text-amber-9"
          />
        )}
      </Button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-bold text-foreground">{offer.brand || "—"}</span>
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
          <span className="ml-auto shrink-0 text-sm font-bold tabular-nums text-foreground">
            {money(offer.unit_price)}
          </span>
        </div>
        {offer.description && (
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{offer.description}</p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          {offer.lead_time && <span>Lead time: {offer.lead_time}</span>}
          {offer.quality_note && <span>Quality: {offer.quality_note}</span>}
        </div>
        {offer.remarks && (
          <p className="mt-1 text-[11px] italic text-muted-foreground/80">{offer.remarks}</p>
        )}
        {offer.brochure?.length > 0 && (
          <div className="mt-1.5">
            <AttachmentList attachments={offer.brochure} compact />
          </div>
        )}
      </div>

      {canEdit && (
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => setIsEditing(true)}
            aria-label={`Edit ${offer.brand || "offer"}`}
            className="h-auto w-auto rounded-lg p-1 text-muted-foreground hover:bg-mauve-a3 hover:text-foreground"
          >
            <Pencil size={13} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() =>
              confirmDeleteToast(
                "Remove this offer?",
                `${offer.brand || "This offer"} comes off the comparison.`,
                () => onRemove(offer.id),
              )
            }
            disabled={isPending}
            className="h-auto w-auto rounded-lg p-1 text-muted-foreground hover:bg-red-a3 hover:text-red-11"
          >
            <Trash2 size={13} />
          </Button>
        </div>
      )}
    </div>
  );
}

export default function CanvassPanel({ open, onOpenChange, subject, subjectLabel, userId, canEdit }) {
  const queryClient = useQueryClient();
  const [isAdding, setIsAdding] = useState(false);

  const queryKey = ["canvass", subject?.procurementRequestId || subject?.inclusionId];

  const { data: canvass, isLoading } = useQuery({
    queryKey,
    queryFn: () => projectEvaluationService.getCanvass(subject),
    enabled: open && Boolean(subject?.procurementRequestId || subject?.inclusionId),
  });

  const offers = canvass?.offers || [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const ensureCanvass = async () => {
    if (canvass) return canvass;
    return projectEvaluationService.getOrCreateCanvass(subject, userId);
  };

  const addMutation = useMutation({
    mutationFn: async (input) => {
      const c = await ensureCanvass();
      return projectEvaluationService.addOffer(c.id, input, userId);
    },
    onSuccess: () => {
      invalidate();
      setIsAdding(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ offerId, patch }) => projectEvaluationService.updateOffer(offerId, patch),
    onSuccess: invalidate,
    onError: (err) => toast.error(err.message),
  });

  const removeMutation = useMutation({
    mutationFn: (offerId) => projectEvaluationService.removeOffer(offerId),
    onSuccess: () => {
      invalidate();
      toast.success("Offer removed.");
    },
    onError: (err) => toast.error(err.message),
  });

  const winnerMutation = useMutation({
    mutationFn: (offerId) => projectEvaluationService.markWinner(canvass.id, offerId),
    onSuccess: () => {
      invalidate();
      // Issue #47/#48: winning an Inclusion's Canvass re-stamps that
      // Inclusion's cost server-side, which the Project Evaluation's base
      // cost and margin roll up from. Without this, both breakdowns keep
      // showing the old figures until something unrelated happens to
      // invalidate their own queries — up to the 15-minute staleTime.
      // Harmless no-op when the subject is a Procurement Request, since
      // nothing reads these keys then. Unscoped by opportunityId (unlike
      // InclusionsPanel's own invalidate, which has it to hand) because this
      // component only knows the Inclusion/Procurement Request id, not which
      // SOR it belongs to.
      queryClient.invalidateQueries({ queryKey: ["inclusions"] });
      queryClient.invalidateQueries({ queryKey: ["projectEvaluation"] });
      toast.success("Winner recorded.");
    },
    onError: (err) => toast.error(err.message),
  });

  const attachMutation = useMutation({
    mutationFn: async (descriptor) => {
      const c = await ensureCanvass();
      return projectEvaluationService.addCanvassAttachment(c.id, descriptor);
    },
    onSuccess: invalidate,
    onError: (err) => toast.error(err.message),
  });

  const detachMutation = useMutation({
    mutationFn: (url) => projectEvaluationService.removeCanvassAttachment(canvass.id, url),
    onSuccess: invalidate,
    onError: (err) => toast.error(err.message),
  });

  const signOffMutation = useMutation({
    mutationFn: async () => {
      const c = await ensureCanvass();
      return projectEvaluationService.signOffCanvass(c.id, userId);
    },
    onSuccess: () => {
      invalidate();
      toast.success("Canvass signed off.");
    },
    onError: (err) => toast.error(err.message),
  });

  const attachments = useFileAttachments({ max: 3 });

  const handleAttach = async () => {
    const uploaded = await attachments.upload();
    for (const descriptor of uploaded) {
      await attachMutation.mutateAsync(descriptor);
    }
    attachments.clear();
  };

  const doSignOff = () => signOffMutation.mutate();

  const handleSignOff = () => {
    if (canvassNeedsMoreOffers(offers)) {
      confirmActionToast(
        "Fewer than 3 offers recorded",
        `Policy is to compare at least ${MIN_CANVASS_OFFERS} suppliers. Sign off anyway?`,
        "Sign off anyway",
        "sign-off-under-minimum",
        doSignOff,
      );
      return;
    }
    doSignOff();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart size={16} />
            Canvass — {subjectLabel}
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
          {isLoading && (
            <p className="py-6 text-center text-xs text-muted-foreground">Loading…</p>
          )}

          {!isLoading && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">
                  {offers.length} offer{offers.length === 1 ? "" : "s"}
                  {canvassNeedsMoreOffers(offers) && (
                    <span className="ml-1.5 text-amber-11">
                      · policy asks for at least {MIN_CANVASS_OFFERS}
                    </span>
                  )}
                </span>
                {canvass?.signed_off_at && (
                  <span className="text-[11px] font-semibold text-green-11">
                    Signed off by {canvass.signer?.name || "—"}
                  </span>
                )}
              </div>

              <div className="space-y-1.5">
                {offers.map((offer) => (
                  <OfferRow
                    key={offer.id}
                    offer={offer}
                    canEdit={canEdit}
                    isPending={updateMutation.isPending || removeMutation.isPending || winnerMutation.isPending}
                    onMarkWinner={(id) => winnerMutation.mutate(id)}
                    onUpdate={(id, patch) => updateMutation.mutate({ offerId: id, patch })}
                    onRemove={(id) => removeMutation.mutate(id)}
                  />
                ))}
              </div>

              {canEdit && isAdding && (
                <OfferForm
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
                  className="h-auto flex w-full items-center justify-center gap-1.5 rounded-xl border-dashed border-mauve-7 py-2 text-[12px] font-bold text-muted-foreground transition-colors hover:border-primary hover:bg-primary/5 hover:text-primary"
                >
                  <Plus size={14} /> Add offer
                </Button>
              )}

              <div className="space-y-1.5 border-t border-border/60 pt-3">
                <span className={`${CAPTION_BASE} tracking-wider text-muted-foreground`}>
                  Original canvass sheet
                </span>
                {(canvass?.attachments || []).length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <AttachmentList attachments={canvass.attachments} compact />
                    {canEdit &&
                      canvass.attachments.map((file) => (
                        <Button
                          key={file.url}
                          type="button"
                          variant="link"
                          onClick={() => detachMutation.mutate(file.url)}
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

        {canEdit && (
          <div className="flex items-center justify-end gap-2 border-t border-border/60 pt-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="h-auto rounded-lg px-3 py-1.5 text-[12px] font-semibold text-muted-foreground hover:text-foreground"
            >
              Close
            </Button>
            <Button
              type="button"
              onClick={handleSignOff}
              disabled={signOffMutation.isPending || Boolean(canvass?.signed_off_at)}
              className="h-auto rounded-lg px-3.5 py-1.5 text-[12px] font-bold disabled:opacity-40"
            >
              {canvass?.signed_off_at ? "Signed off" : "Sign off"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function CanvassTriggerButton({ onClick, offerCount }) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      className="h-auto inline-flex items-center gap-1.5 rounded-md bg-card px-2 py-1 text-[11px] font-semibold text-foreground transition-colors hover:bg-mauve-3"
      title="Compare suppliers"
    >
      <ShoppingCart size={11} />
      <span>{offerCount > 0 ? `Canvass (${offerCount})` : "Canvass"}</span>
    </Button>
  );
}
