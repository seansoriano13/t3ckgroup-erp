import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  Check,
  Copy,
  ExternalLink,
  FileText,
  Loader2,
  PackageSearch,
  Pencil,
  Truck,
  X,
} from "lucide-react";

import { purchasingService } from "../services/purchasingService";
import { supabase } from "../lib/supabase";
import { AttachmentList } from "./ui/Attachments";
import { AttachmentEvidence } from "./ui/AttachmentEvidence";
import Dropdown from "./ui/Dropdown";
import { FilterTrigger } from "./ui/FilterDropdown";
import Dot from "./ui/Dot";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import StatusBadge from "./StatusBadge";
import ProcurementMetaFooter from "./ProcurementMetaFooter";
import CanvassPanel, { CanvassTriggerButton } from "./CanvassPanel";
import {
  PO_VERIFICATION,
  PROCUREMENT_OUTCOME,
  PROCUREMENT_OUTCOME_LABELS,
  displayOutcome,
  isValidPoNumber,
  normalizePoNumber,
  outcomeRequiresPo,
} from "../constants/procurement";
import { formatDueDate, toLocalDatetimeString } from "../utils/formatDate";
import { STAGE_LABELS } from "../constants/sor";
import { canEditSor } from "../utils/sorPermissions";
import { FieldBox } from "@/components/ui/FieldBox";

/**
 * The deal a requisition was raised from, for the buyer working the task.
 *
 * Purchasing opens a requisition knowing what to buy and nothing about who it
 * is for — the task carries no link back to the SOR, and the answer to "which
 * deal is this?" was a message to whoever raised it. The common case is
 * answered without a click: the Sales Reference and the Company are on the
 * card itself.
 *
 * Read-only by construction. The register is readable org-wide, but editing an
 * SOR is limited to the people on the deal, so the way through to the full
 * record is offered only to someone who could actually act on it — anyone else
 * would land in a form whose saves the database refuses.
 */
function SorSummary({ sor, user }) {
  if (!sor) return null;

  const value = Number(sor.expected_value || 0);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-border/70 bg-muted/30 px-3.5 py-2.5">
      <span className="text-xs font-black tracking-tight text-foreground">
        {sor.sales_reference || "Unreferenced SOR"}
      </span>
      <span className="text-[11px] font-semibold text-muted-foreground">
        {sor.client_name}
      </span>
      {sor.project_title && (
        <span
          className="max-w-[220px] truncate text-[11px] text-muted-foreground/80"
          title={sor.project_title}
        >
          {sor.project_title}
        </span>
      )}
      {sor.status && <StatusBadge status={sor.status} label={STAGE_LABELS[sor.status]} />}
      {value > 0 && (
        <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">
          ₱{value.toLocaleString("en-PH", { maximumFractionDigits: 0 })}
        </span>
      )}
      {sor.deal_owner?.name && (
        <span className="text-[11px] text-muted-foreground/80">
          Deal owner: {sor.deal_owner.name}
        </span>
      )}
      {canEditSor(user, sor) && (
        <Button
          type="button"
          variant="link"
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("OPEN_ENTITY_DETAILS", {
                detail: { id: sor.id, type: "OPPORTUNITY" },
              }),
            )
          }
          className="h-auto p-0 ml-auto inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline"
        >
          View full SOR <ExternalLink size={11} />
        </Button>
      )}
    </div>
  );
}

const OUTCOME_OPTIONS = [
  { value: PROCUREMENT_OUTCOME.IN_PROGRESS, label: "In progress", dot: "bg-amber-9" },
  { value: PROCUREMENT_OUTCOME.PURCHASED, label: "Purchased", dot: "bg-blue-9" },
  { value: PROCUREMENT_OUTCOME.DELIVERED, label: "Delivered", dot: "bg-green-9" },
  { value: PROCUREMENT_OUTCOME.ALREADY_EXISTS, label: "Already in Odoo", dot: "bg-green-9" },
  { value: PROCUREMENT_OUTCOME.SUBSTITUTED, label: "Substituted", dot: "bg-violet-9" },
  { value: PROCUREMENT_OUTCOME.UNAVAILABLE, label: "Cannot source", dot: "bg-red-9" },
];

function OutcomeDropdown({
  value,
  onChange,
  disabled = false,
  className = "",
  usePortal = false,
}) {
  const currentOutcome =
    OUTCOME_OPTIONS.find((o) => o.value === value) || {
      value: "",
      label: "Select status / outcome...",
      dot: "bg-mauve-8",
    };

  return (
    <Dropdown
      disabled={disabled}
      usePortal={usePortal}
      className={`z-100 ${className}`}
      trigger={({ isOpen, disabled: isTriggerDisabled }) => (
        <FilterTrigger
          label={currentOutcome.label}
          isActive={Boolean(value)}
          isOpen={isOpen}
          icon={() => <Dot size="w-2 h-2" color={currentOutcome.dot} />}
          disabled={isTriggerDisabled}
        />
      )}
    >
      {({ close }) => (
        <div className="p-1 space-y-0.5">
          {OUTCOME_OPTIONS.map((opt) => {
            const isSelected = value === opt.value;
            return (
              <Button
                key={opt.value}
                type="button"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  if (onChange) onChange(opt.value);
                  close();
                }}
                className={`h-auto w-full flex items-center justify-between gap-2.5 px-3 py-2 rounded-lg text-[13px] font-semibold transition-all active:scale-95 cursor-pointer ${
                  isSelected
                    ? "bg-muted text-foreground font-bold hover:bg-muted"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Dot size="w-2 h-2" color={opt.dot} />
                  <span>{opt.label}</span>
                </div>
                {isSelected && (
                  <div className="flex items-center gap-1.5 ml-auto">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground border border-border bg-card px-1.5 py-0.5 rounded-md">
                      Current
                    </span>
                    <Check size={13} className="text-foreground" />
                  </div>
                )}
              </Button>
            );
          })}
        </div>
      )}
    </Dropdown>
  );
}

/**
 * Trigger + dialog for a Procurement Request's Canvass (issue #46), together
 * so OpenRow and ResolvedRow each add one line rather than wiring dialog
 * state twice.
 */
function CanvassLauncher({ request, canEdit, userId }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <CanvassTriggerButton onClick={() => setOpen(true)} />
      {open && (
        <CanvassPanel
          open={open}
          onOpenChange={setOpen}
          subject={{ procurementRequestId: request.id }}
          subjectLabel={request.requested_name}
          userId={userId}
          canEdit={canEdit}
        />
      )}
    </>
  );
}

/**
 * Outcome editing form with labeled fields, UI components, and Odoo verification lock.
 */
function ProcurementEditForm({
  request,
  initialOutcome = "",
  onSave,
  onCancel,
  isPending,
}) {
  const [outcome, setOutcome] = useState(initialOutcome || request.outcome || "");
  const [poNumber, setPoNumber] = useState(request.po_number || "");
  const [odooProductRef, setOdooProductRef] = useState(
    request.odoo_product_ref || "",
  );
  const [eta, setEta] = useState(request.eta || "");
  const [note, setNote] = useState(request.outcome_note || "");

  const initialCleanedPo = normalizePoNumber(request.po_number);
  const [liveVerification, setLiveVerification] = useState({
    status: request.verification || (initialCleanedPo ? PO_VERIFICATION.PENDING_VERIFICATION : PO_VERIFICATION.UNVERIFIED),
    productRef: request.odoo_product_ref || null,
    vendor: request.odoo_vendor || null,
    eta: request.eta || null,
    unitPrice: null,
    isChecking: false,
    checkedPo: initialCleanedPo || "",
  });

  const needsPo = outcomeRequiresPo(outcome);

  const handleOutcomeChange = (nextOutcome) => {
    setOutcome(nextOutcome);
    if (nextOutcome === PROCUREMENT_OUTCOME.IN_PROGRESS) {
      setPoNumber("");
      setLiveVerification({
        status: PO_VERIFICATION.UNVERIFIED,
        productRef: null,
        vendor: null,
        eta: null,
        unitPrice: null,
        isChecking: false,
        checkedPo: "",
      });
      setOdooProductRef("");
    }
  };

  useEffect(() => {
    const cleaned = normalizePoNumber(poNumber);
    if (!cleaned || !isValidPoNumber(cleaned)) {
      // Clearing the field has to clear what Odoo said about the old number,
      // or a stale "Confirmed in Odoo" stays on screen against a PO that is no
      // longer typed. Deriving this instead would mean re-plumbing every
      // reader of liveVerification through a second source of truth.
      setLiveVerification({
        status: PO_VERIFICATION.UNVERIFIED,
        productRef: null,
        vendor: null,
        eta: null,
        unitPrice: null,
        isChecking: false,
        checkedPo: "",
      });
      return;
    }

    if (
      cleaned === liveVerification.checkedPo &&
      liveVerification.status === PO_VERIFICATION.VERIFIED &&
      liveVerification.productRef
    ) {
      return;
    }

    const timer = setTimeout(async () => {
      setLiveVerification((prev) => ({ ...prev, isChecking: true }));
      try {
        const res = await purchasingService.verifyPoNumber(cleaned);
        setLiveVerification({
          status: res.state,
          productRef: res.productRef || null,
          vendor: res.vendor || null,
          eta: res.eta || null,
          unitPrice: res.unitPrice || null,
          isChecking: false,
          checkedPo: cleaned,
        });

        if (res.state === PO_VERIFICATION.VERIFIED) {
          if (res.productRef) setOdooProductRef(res.productRef);
          if (res.eta) setEta(res.eta);
        }
      } catch {
        setLiveVerification({
          status: PO_VERIFICATION.PENDING_VERIFICATION,
          productRef: null,
          vendor: null,
          eta: null,
          unitPrice: null,
          isChecking: false,
          checkedPo: cleaned,
        });
      }
    }, 400);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poNumber]);

  const isOdooVerified =
    liveVerification.status === PO_VERIFICATION.VERIFIED &&
    Boolean(liveVerification.productRef) &&
    normalizePoNumber(poNumber) === liveVerification.checkedPo;

  const handleFormSubmit = (e) => {
    e?.preventDefault();
    if (needsPo && !poNumber.trim()) return;
    const isProgress = outcome === PROCUREMENT_OUTCOME.IN_PROGRESS;
    onSave({
      outcome,
      poNumber: isProgress ? "" : poNumber,
      odooProductRef: isProgress ? "" : isOdooVerified ? liveVerification.productRef : odooProductRef,
      eta: isProgress ? null : eta || null,
      note,
    });
  };

  return (
    <form
      onSubmit={handleFormSubmit}
      className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-xs"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-bold text-foreground">{request.requested_name}</p>
          <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/60 px-2 py-0.5 text-xs font-semibold text-foreground">
            Qty: {Number(request.requested_quantity) || 0} {request.requested_unit || "unit"}
          </span>
        </div>
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onCancel}
            className="h-auto w-auto rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="Cancel editing"
          >
            <X size={14} />
          </Button>
        )}
      </div>

      {request.requested_description && (
        <div className="space-y-1 rounded-lg bg-muted/40 p-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
            Sales Specifications
          </span>
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">
            {request.requested_description}
          </p>
        </div>
      )}

      {request.requested_images && request.requested_images.length > 0 && (
        <AttachmentList attachments={request.requested_images} />
      )}

      <div className="space-y-1.5">
        <FieldBox label={<>Status / Outcome <span className="text-destructive">*</span></>} />
        <OutcomeDropdown value={outcome} onChange={handleOutcomeChange} />
      </div>

      {outcome && (
        <div className="space-y-4 pt-1">
          {/* PO Number Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <FieldBox label={<>Odoo PO Number {needsPo && <span className="text-destructive">*</span>}</>} />
              {liveVerification.isChecking ? (
                <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                  <Loader2 size={11} className="animate-spin" /> Checking PO in Odoo...
                </span>
              ) : isOdooVerified ? (
                <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                  <Check size={11} /> Verified from Odoo PO
                </span>
              ) : liveVerification.status === PO_VERIFICATION.NOT_FOUND ? (
                <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                  PO not found in Odoo
                </span>
              ) : null}
            </div>
            <Input
              aria-label="PO Number"
              value={poNumber}
              onChange={(e) => setPoNumber(e.target.value)}
              placeholder="e.g. P01234"
              className="font-mono h-[42px] px-3.5 py-2 text-sm"
            />
          </div>

          {/* Odoo Product & Supplier Details Card */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <FieldBox label="Odoo Product Reference" />
              {isOdooVerified && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    navigator.clipboard.writeText(liveVerification.productRef || "");
                    toast.success("Copied product name to clipboard!");
                  }}
                  className="h-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  title="Copy product name"
                >
                  <Copy size={11} />
                  <span>Copy</span>
                </Button>
              )}
            </div>
            {isOdooVerified ? (
              <div className="space-y-2">
                <Input
                  readOnly
                  aria-label="Odoo product name"
                  value={liveVerification.productRef || ""}
                  className="h-[42px] cursor-default bg-muted/30 px-3.5 py-2 text-sm font-semibold"
                />
                <p className="text-[11px] text-muted-foreground">
                  Populated from PO {liveVerification.checkedPo || normalizePoNumber(poNumber)}
                </p>
                {(liveVerification.vendor || liveVerification.eta) && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {liveVerification.vendor && (
                      <span>
                        Vendor: <span className="font-medium text-foreground">{liveVerification.vendor}</span>
                      </span>
                    )}
                    {liveVerification.eta && (
                      <span>
                        PO Date: <span className="font-medium text-foreground">{formatDueDate(liveVerification.eta)}</span>
                      </span>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-muted/10 p-3 text-xs italic text-muted-foreground/70">
                Will populate automatically upon PO verification
              </div>
            )}
          </div>

          {/* ETA Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <FieldBox label="Estimated Arrival (ETA)" />
              {isOdooVerified && liveVerification.eta ? (
                <span className="text-[11px] font-normal text-muted-foreground">
                  Auto-populated: <span className="font-medium text-foreground">{formatDueDate(liveVerification.eta)}</span>
                </span>
              ) : eta ? (
                <span className="text-[11px] font-medium text-muted-foreground">
                  {formatDueDate(eta)}
                </span>
              ) : null}
            </div>
            <Input
              type="datetime-local"
              aria-label="ETA"
              value={eta ? toLocalDatetimeString(eta) : ""}
              onChange={(e) => setEta(e.target.value)}
              className="h-[42px] px-3.5 py-2 text-sm"
            />
          </div>

          {/* Remarks */}
          <div className="space-y-1.5">
            <FieldBox label="Purchasing Remarks (Optional)" />
            <Textarea
              aria-label="Purchasing remarks"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Notes, supplier lead times, or remarks for sales team..."
              className="px-3.5 py-2.5 text-sm min-h-[90px]"
            />
          </div>

          <div className="flex items-center gap-2 pt-2">
            <Button
              type="submit"
              disabled={isPending || (needsPo && !poNumber.trim())}
              className="h-auto flex-1 rounded-lg px-4 py-2.5 text-xs font-semibold shadow-xs disabled:opacity-50 transition-colors"
            >
              {needsPo && !poNumber.trim()
                ? "Enter PO number to save"
                : request.outcome
                  ? "Save changes"
                  : outcome === PROCUREMENT_OUTCOME.IN_PROGRESS
                    ? "Set to in progress"
                    : "Record outcome"}
            </Button>
            {onCancel && (
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                className="h-auto rounded-lg bg-background px-4 py-2.5 text-xs font-semibold text-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}
    </form>
  );
}

function ResolvedRow({ request, onResolve, isPending, userId, canEdit }) {
  const [isEditing, setIsEditing] = useState(false);
  const [initialOutcomeToOpen, setInitialOutcomeToOpen] = useState(request.outcome);

  const handleSave = async (payload) => {
    try {
      await onResolve(payload);
      setIsEditing(false);
    } catch {
      // Error handled by caller / mutation
    }
  };

  const handleQuickMarkPurchased = () => {
    setInitialOutcomeToOpen(PROCUREMENT_OUTCOME.PURCHASED);
    setIsEditing(true);
  };

  const handleOpenEdit = () => {
    setInitialOutcomeToOpen(request.outcome);
    setIsEditing(true);
  };

  const handleQuickMarkDelivered = () => {
    handleSave({
      outcome: PROCUREMENT_OUTCOME.DELIVERED,
      poNumber: request.po_number || "",
      odooProductRef: request.odoo_product_ref || "",
      eta: request.eta || null,
      note: request.outcome_note || "",
    });
  };

  if (isEditing) {
    return (
      <ProcurementEditForm
        request={request}
        initialOutcome={initialOutcomeToOpen}
        onSave={handleSave}
        onCancel={() => setIsEditing(false)}
        isPending={isPending}
      />
    );
  }

  const images = request.requested_images || [];

  return (
    <div className="group space-y-2.5 rounded-xl border border-border bg-card px-4 py-3 shadow-xs transition-colors hover:border-border/80">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">
            {request.requested_name}
          </p>
          <span className="shrink-0 inline-flex items-center gap-1 rounded-md border border-border bg-muted/60 px-2 py-0.5 text-xs font-semibold text-foreground">
            Qty: {Number(request.requested_quantity) || 0} {request.requested_unit || "unit"}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Status Badge (Standardized StatusBadge Component) */}
          <StatusBadge
            status={request.outcome}
            label={PROCUREMENT_OUTCOME_LABELS[request.outcome] || request.outcome}
          />

          <CanvassLauncher request={request} canEdit={canEdit} userId={userId} />

          {/* Prominent Action Button for In Progress */}
          {request.outcome === PROCUREMENT_OUTCOME.IN_PROGRESS && (
            <Button
              type="button"
              onClick={handleQuickMarkPurchased}
              className="h-auto inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white shadow-xs hover:bg-blue-700 active:bg-blue-800 transition-colors"
            >
              <FileText size={13} />
              <span>Record PO</span>
            </Button>
          )}

          {/* High-emphasis Action Button for Purchased -> Delivered */}
          {request.outcome === PROCUREMENT_OUTCOME.PURCHASED && (
            <Button
              type="button"
              disabled={isPending}
              onClick={handleQuickMarkDelivered}
              className="h-auto inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 transition-colors"
            >
              <Truck size={13} />
              <span>Mark Delivered</span>
            </Button>
          )}

          {/* Edit Button */}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={handleOpenEdit}
            aria-label={`Edit outcome for ${request.requested_name}`}
            className="h-auto w-auto inline-flex items-center gap-1 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Edit details"
          >
            <Pencil size={13} />
          </Button>
        </div>
      </div>

      {request.requested_description && (
        <div className="space-y-0.5 border-l-2 border-border pl-2.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
            Sales Specifications
          </span>
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">
            {request.requested_description}
          </p>
        </div>
      )}
      {images.length > 0 && <AttachmentEvidence attachments={images} />}

      <ProcurementMetaFooter request={request} />
    </div>
  );
}

function OpenRow({ request, onResolve, isPending, userId, canEdit }) {
  const [isEditing, setIsEditing] = useState(false);
  const [initialOutcomeToOpen, setInitialOutcomeToOpen] = useState("");

  const handleOutcomeChange = async (nextOutcome) => {
    if (nextOutcome === PROCUREMENT_OUTCOME.IN_PROGRESS) {
      await onResolve({
        outcome: PROCUREMENT_OUTCOME.IN_PROGRESS,
        poNumber: "",
        odooProductRef: "",
        eta: null,
        note: "",
      });
      return;
    }
    setInitialOutcomeToOpen(nextOutcome);
    setIsEditing(true);
  };

  const handleSave = async (payload) => {
    try {
      await onResolve(payload);
      setIsEditing(false);
    } catch {
      // Error handled by caller / mutation
    }
  };

  if (isEditing) {
    return (
      <ProcurementEditForm
        request={request}
        initialOutcome={initialOutcomeToOpen}
        onSave={handleSave}
        onCancel={() => setIsEditing(false)}
        isPending={isPending}
      />
    );
  }

  const { raw: statusRaw, label: statusLabel } = displayOutcome(request);
  const images = request.requested_images || [];

  return (
    <div className="group space-y-2.5 rounded-xl border border-border bg-card px-4 py-3 shadow-xs transition-colors hover:border-border/80">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">
            {request.requested_name}
          </p>
          <span className="shrink-0 inline-flex items-center gap-1 rounded-md border border-border bg-muted/60 px-2 py-0.5 text-xs font-semibold text-foreground">
            Qty: {Number(request.requested_quantity) || 0} {request.requested_unit || "unit"}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusBadge status={statusRaw} label={statusLabel} />

          <CanvassLauncher request={request} canEdit={canEdit} userId={userId} />

          <OutcomeDropdown
            value=""
            disabled={isPending}
            onChange={handleOutcomeChange}
          />
        </div>
      </div>

      {request.requested_description && (
        <div className="space-y-0.5 border-l-2 border-border pl-2.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
            Sales Specifications
          </span>
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">
            {request.requested_description}
          </p>
        </div>
      )}
      {images.length > 0 && <AttachmentEvidence attachments={images} />}

      <ProcurementMetaFooter request={request} />
    </div>
  );
}

export default function ProcurementResolutionPanel({
  taskId,
  userId,
  user,
  canEditCanvass = false,
  onSubmittingChange,
  onDeliveredComplete,
}) {
  const queryClient = useQueryClient();

  const { data: requests = [] } = useQuery({
    queryKey: ["procurement", "task", taskId],
    queryFn: () => purchasingService.listForTask(taskId),
    enabled: !!taskId,
  });

  const { data: sor } = useQuery({
    queryKey: ["procurement", "task", taskId, "sor"],
    queryFn: () => purchasingService.sorForTask(taskId),
    enabled: !!taskId,
  });

  useEffect(() => {
    if (!taskId) return;
    const channel = supabase
      .channel(`procurement_task_${taskId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "sor_procurement_requests",
        },
        (payload) => {
          if (payload.new?.task_id === taskId || payload.old?.task_id === taskId) {
            queryClient.invalidateQueries({ queryKey: ["procurement", "task", taskId] });
            queryClient.invalidateQueries({ queryKey: ["task", taskId] });
            queryClient.invalidateQueries({ queryKey: ["taskDetails", taskId] });
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [taskId, queryClient]);

  const resolveMutation = useMutation({
    mutationFn: ({ requestId, payload }) =>
      purchasingService.resolveRequest(requestId, payload, userId),
    onMutate: () => {
      onSubmittingChange?.(true);
    },
    onSettled: () => {
      onSubmittingChange?.(false);
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["procurement", "task", taskId] });
      queryClient.invalidateQueries({
        queryKey: ["procurement", "opportunity", updated.opportunity_id],
      });
      // Invalidate task queries so task status updates to Awaiting Approval immediately
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      queryClient.invalidateQueries({ queryKey: ["taskDetails", taskId] });
      queryClient.invalidateQueries({ queryKey: ["dashboardTasks"] });

      if (updated.outcome === PROCUREMENT_OUTCOME.IN_PROGRESS) {
        toast.success("Procurement marked as in progress.");
        return;
      }
      if (updated.outcome === PROCUREMENT_OUTCOME.DELIVERED) {
        toast.success("Marked as delivered.");
        if (updated.taskAutoSubmitted) {
          onDeliveredComplete?.(updated);
        }
        return;
      }
      if (!updated.po_number) {
        toast.success("Outcome recorded.");
        return;
      }
      if (updated.verification === PO_VERIFICATION.VERIFIED) {
        toast.success(`${updated.po_number} confirmed in Odoo.`);
        return;
      }
      if (updated.verification === PO_VERIFICATION.NOT_FOUND) {
        toast(`${updated.po_number} was saved, but not found in Odoo. Check for typos.`);
        return;
      }
      toast.success("Saved. Odoo unreachable — will re-verify automatically.");
    },
    onError: (err) => {
      toast.error(err?.message || "Failed to record outcome.");
    },
  });

  if (!requests.length) return null;

  const open = requests.filter((r) => !r.outcome);
  const inProgress = requests.filter((r) => r.outcome === PROCUREMENT_OUTCOME.IN_PROGRESS);
  const delivered = requests.filter(
    (r) =>
      r.outcome === PROCUREMENT_OUTCOME.DELIVERED ||
      r.outcome === PROCUREMENT_OUTCOME.ALREADY_EXISTS ||
      r.outcome === PROCUREMENT_OUTCOME.SUBSTITUTED ||
      r.outcome === PROCUREMENT_OUTCOME.UNAVAILABLE,
  );
  const purchased = requests.filter(
    (r) => r.outcome === PROCUREMENT_OUTCOME.PURCHASED,
  );

  const resolved = requests.filter((r) => r.outcome);
  const isFullyDelivered = requests.length > 0 && delivered.length === requests.length;

  return (
    <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
      <SorSummary sor={sor} user={user} />

      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          <PackageSearch size={13} /> Products to source
        </p>
        <span className="text-[10.5px] font-semibold tracking-wide text-muted-foreground tabular-nums">
          {resolved.length}/{requests.length} done
          {delivered.length > 0 && ` · ${delivered.length} delivered`}
          {purchased.length > 0 && ` · ${purchased.length} purchased`}
          {inProgress.length > 0 && ` · ${inProgress.length} in progress`}
        </span>
      </div>

      {isFullyDelivered && (
        <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          Every product has been delivered or resolved. Task auto-submitted for review.
        </p>
      )}

      <div className="space-y-2.5">
        {open.map((r) => (
          <OpenRow
            key={r.id}
            request={r}
            isPending={resolveMutation.isPending}
            userId={userId}
            canEdit={canEditCanvass}
            onResolve={(payload) =>
              resolveMutation.mutate({ requestId: r.id, payload })
            }
          />
        ))}
        {resolved.map((r) => (
          <ResolvedRow
            key={r.id}
            request={r}
            isPending={resolveMutation.isPending}
            userId={userId}
            canEdit={canEditCanvass}
            onResolve={(payload) =>
              resolveMutation.mutateAsync({ requestId: r.id, payload })
            }
          />
        ))}
      </div>
    </div>
  );
}
