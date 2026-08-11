import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  Maximize2,
  Minimize2,
  Paperclip,
  Pencil,
  Send,
  Sparkles,
  Target,
  Trash2,
  X,
} from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import Spinner from "../ui/Spinner";
import Avatar from "../Avatar";
import StatusBadge from "../StatusBadge";
import { opportunityService } from "../../services/opportunityService";
import { useAuth } from "../../context/AuthContext";
import { confirmDeleteToast } from "../ui/CustomToast";
import { AttachmentPreviews, AttachmentList } from "../ui/Attachments";
import { useFileAttachments } from "../../hooks/useFileAttachments";
import { MAX_ATTACHMENT_BYTES, formatBytes } from "../../utils/attachments";
import { getStatusTheme } from "../../constants/status";
import {
  OPPORTUNITY_STAGES,
  PROJECT_TYPE_LABELS,
  formatLeadSource,
  formatPHP,
  isValidSalesReference,
  normalizeSalesReference,
  requiresSalesReference,
  SALES_REFERENCE_HINT,
} from "../../constants/sor";

const TONE_CLASSES = {
  green: { current: "bg-green-9 text-white", completed: "bg-green-9/20 text-green-11 hover:bg-green-9/30" },
  amber: { current: "bg-amber-9 text-white", completed: "bg-amber-9/20 text-amber-11 hover:bg-amber-9/30" },
  blue: { current: "bg-blue-9 text-white", completed: "bg-blue-9/20 text-blue-11 hover:bg-blue-9/30" },
  red: { current: "bg-red-9 text-white", completed: "bg-red-9/20 text-red-11 hover:bg-red-9/30" },
  violet: { current: "bg-violet-9 text-white", completed: "bg-violet-9/20 text-violet-11 hover:bg-violet-9/30" },
  orange: { current: "bg-orange-9 text-white", completed: "bg-orange-9/20 text-orange-11 hover:bg-orange-9/30" },
  mauve: { current: "bg-mauve-9 text-white", completed: "bg-mauve-9/20 text-mauve-11 hover:bg-mauve-9/30" },
};

function Detail({ label, children }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">
        {label}
      </p>
      <div className="text-sm font-semibold text-foreground break-words">
        {children || <span className="text-muted-foreground/60">—</span>}
      </div>
    </div>
  );
}

function Person({ person }) {
  if (!person) return <span className="text-muted-foreground/60">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Avatar name={person.name} src={person.avatar_path} size="xs" />
      {person.name}
    </span>
  );
}

/**
 * `deal_owner` / `sales_director` / `support_1` / `support_2` collapsed to
 * one row per unique person, so someone holding two roles (e.g. Deal Owner
 * and Support Sales 1) gets one row with two badges instead of two rows.
 */
function peopleByRole(o) {
  const byId = new Map();
  const add = (person, role) => {
    if (!person) return;
    const entry = byId.get(person.id);
    if (entry) entry.roles.push(role);
    else byId.set(person.id, { person, roles: [role] });
  };
  add(o.deal_owner, "Deal Owner");
  add(o.sales_director, "Sales Director");
  add(o.support_1, "Support Sales 1");
  add(o.support_2, "Support Sales 2");
  return [...byId.values()];
}

function PeopleRoster({ opportunity }) {
  const people = peopleByRole(opportunity);

  if (people.length === 0) {
    return <p className="text-sm text-muted-foreground/60">No one assigned yet.</p>;
  }

  return (
    <div className="space-y-3">
      {people.map(({ person, roles }) => (
        <div key={person.id} className="flex items-center gap-3">
          <Avatar name={person.name} src={person.avatar_path} size="sm" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{person.name}</p>
            <div className="flex flex-wrap gap-1 mt-0.5">
              {roles.map((role) => (
                <span
                  key={role}
                  className="text-[10px] font-bold text-muted-foreground bg-muted rounded-full px-1.5 py-0.5"
                >
                  {role}
                </span>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ItemsList({ items }) {
  if (!items.length) return null;
  return (
    <div className="border border-border rounded-xl overflow-hidden divide-y divide-border">
      <div className="grid grid-cols-12 gap-2 px-3 py-1.5 bg-muted/40 text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
        <span className="col-span-6">Product</span>
        <span className="col-span-2 text-right">Qty</span>
        <span className="col-span-2 text-right">Unit Price</span>
        <span className="col-span-2 text-right">Total</span>
      </div>
      {items.map((it) => (
        <div
          key={it.id}
          className="grid grid-cols-12 gap-2 px-3 py-2 items-center text-sm"
        >
          <span className="col-span-6 text-foreground font-medium truncate">
            {it.product_name}
            {it.unit && (
              <span className="text-muted-foreground font-normal"> ({it.unit})</span>
            )}
          </span>
          <span className="col-span-2 text-right text-muted-foreground">
            {it.quantity}
          </span>
          <span className="col-span-2 text-right text-muted-foreground">
            {formatPHP(it.unit_price)}
          </span>
          <span className="col-span-2 text-right font-bold text-foreground">
            {formatPHP(Number(it.quantity) * Number(it.unit_price))}
          </span>
        </div>
      ))}
    </div>
  );
}

function formatWhen(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Layout ported from the ERP CRM's OpportunityDetailsModal — Dialog/DialogContent
 * primitive, expand-to-fullscreen toggle, a hero Estimated Value box + Deal
 * Details facts grid + deduped People roster, and a chevron-shaped Pipeline
 * Stage tracker that auto-scrolls to the active stage. The ERP's version has
 * no items/sales-reference/lost-reason fields (CRM v1 dropped them) and its
 * Log Notes panel is an inert "Coming soon" placeholder — here those stay
 * fully wired: Product List keeps its own section below the tiered grid, the
 * stage tracker's onClick routes through the existing lost-reason /
 * sales-reference gating instead of mutating directly, and Log Notes keeps
 * its real composer and attachments.
 */
export default function OpportunityDetailsModal({
  isOpen,
  onClose,
  opportunity,
  onEdit,
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [pendingStage, setPendingStage] = useState("");
  const [lostReason, setLostReason] = useState("");
  const [salesRef, setSalesRef] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);
  const attachments = useFileAttachments();
  const { files, isUploading } = attachments;
  const fileInputRef = useRef(null);
  const scrollRef = useRef(null);
  const activeChevronRef = useRef(null);

  const id = opportunity?.id;

  // This component stays mounted while only the Dialog content unmounts, so
  // without this the draft note, its pending files, and a half-answered stage
  // prompt would carry over to the next opportunity opened. Render-phase sync
  // rather than an effect, matching OpportunityFormModal.
  const currentKey = `${id || "none"}:${isOpen}`;
  const [draftKey, setDraftKey] = useState(currentKey);

  if (currentKey !== draftKey) {
    setDraftKey(currentKey);
    setNote("");
    setPendingStage("");
    setLostReason("");
    setSalesRef("");
    setIsExpanded(false);
    attachments.clear();
  }

  const { data: notes = [], isLoading: loadingNotes } = useQuery({
    queryKey: ["opportunityNotes", id],
    queryFn: () => opportunityService.getNotes(id),
    enabled: !!id && isOpen,
  });

  const { data: items = [] } = useQuery({
    queryKey: ["opportunityItems", id],
    queryFn: () => opportunityService.getItems(id),
    enabled: !!id && isOpen,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["opportunities"] });
    queryClient.invalidateQueries({ queryKey: ["opportunityNotes", id] });
  };

  const addNoteMutation = useMutation({
    mutationFn: ({ content, attachments }) =>
      opportunityService.addNote(id, user?.id, content, attachments),
    onSuccess: () => {
      setNote("");
      attachments.clear();
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const stageMutation = useMutation({
    mutationFn: ({ next, reason, salesReference }) =>
      opportunityService.updateStatus(id, next, user?.id, reason, salesReference),
    onSuccess: () => {
      setPendingStage("");
      setLostReason("");
      setSalesRef("");
      invalidate();
      toast.success("Stage updated.");
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => opportunityService.deleteOpportunity(id, user?.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["opportunities"] });
      toast.success("Opportunity deleted.");
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  useEffect(() => {
    if (!isOpen) return;

    // Small delay ensures DialogContent is fully mounted and dimensions are available
    const timer = setTimeout(() => {
      if (scrollRef.current && activeChevronRef.current) {
        const container = scrollRef.current;
        const activeEl = activeChevronRef.current;
        const scrollLeft = activeEl.offsetLeft - container.clientWidth * 0.2;
        container.scrollTo({ left: Math.max(0, scrollLeft), behavior: "smooth" });
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [opportunity?.status, isOpen]);

  const handlePostNote = async () => {
    const content = note.trim();
    if (!content && files.length === 0) return;
    if (isUploading || addNoteMutation.isPending) return;

    let uploaded = [];
    try {
      uploaded = await attachments.upload();
    } catch (err) {
      toast.error(`Upload failed: ${err.message}`);
      return;
    }

    addNoteMutation.mutate({ content, attachments: uploaded });
  };

  if (!opportunity) return null;

  const isLostPending = pendingStage === "CLOSED_LOST";
  const needsSalesRef =
    !!pendingStage &&
    requiresSalesReference(opportunity.status, pendingStage) &&
    !opportunity.sales_reference;
  const salesRefValid = isValidSalesReference(salesRef);

  const handleStageChange = (next) => {
    if (!next || next === opportunity.status) return;
    // Both branches need something typed before the move can be written, so
    // they park the choice in `pendingStage` and prompt for it inline.
    if (
      next === "CLOSED_LOST" ||
      (requiresSalesReference(opportunity.status, next) && !opportunity.sales_reference)
    ) {
      setPendingStage(next);
      return;
    }
    stageMutation.mutate({ next, reason: null, salesReference: null });
  };

  const cancelPendingStage = () => {
    setPendingStage("");
    setLostReason("");
    setSalesRef("");
  };

  const isPosting = isUploading || addNoteMutation.isPending;

  const currentIndex = OPPORTUNITY_STAGES.findIndex((s) => s.value === opportunity.status);
  const lastIndex = OPPORTUNITY_STAGES.length - 1;

  const stageControl = (
    <div className="relative w-full">
      <div ref={scrollRef} className="overflow-x-auto pb-2">
        <ul className="flex h-11 min-w-full w-max gap-[2px]">
          {OPPORTUNITY_STAGES.map((s, index) => {
            const isCompleted = index < currentIndex;
            const isCurrent = index === currentIndex;
            const isUpcoming = index > currentIndex;

            const tone = getStatusTheme(s.value);
            const classes = TONE_CLASSES[tone] || TONE_CLASSES.mauve;

            return (
              <li
                key={s.value}
                ref={isCurrent ? activeChevronRef : undefined}
                onClick={() => {
                  if (!stageMutation.isPending && s.value !== opportunity.status) {
                    handleStageChange(s.value);
                  }
                }}
                className={cn(
                  "relative flex flex-none cursor-pointer items-center justify-center px-5 text-[11px] font-bold tracking-wider uppercase transition-all duration-200",
                  isCompleted && classes.completed,
                  isCurrent && cn(classes.current, "shadow-inner"),
                  isUpcoming && "bg-muted text-muted-foreground hover:bg-muted/80",
                  stageMutation.isPending && "pointer-events-none opacity-50",
                )}
                style={{
                  clipPath:
                    index === 0
                      ? "polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%)"
                      : index === lastIndex
                        ? "polygon(0 0, 100% 0, 100% 100%, 0 100%, 14px 50%)"
                        : "polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%, 14px 50%)",
                }}
              >
                <span
                  className={cn(
                    "flex items-center gap-1.5 whitespace-nowrap",
                    index > 0 && index < lastIndex && "pl-2",
                    index === lastIndex && "pl-3",
                  )}
                >
                  {isCurrent && (
                    <div className="size-1.5 shrink-0 animate-pulse rounded-full bg-white" />
                  )}
                  {s.label}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      {stageMutation.isPending && (
        <div className="absolute inset-0 flex items-center justify-center rounded-md bg-background/50 backdrop-blur-[1px]">
          <Spinner size="sm" />
        </div>
      )}
    </div>
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        // The base popup stays centered via `top-1/2 left-1/2` + a
        // translate(-50%,-50%) that tw-animate-css's enter/exit animation
        // also drives, so that translate can't be reliably overridden.
        // Sizing the box to the full viewport instead of fighting the
        // transform: centering a box exactly the size of its container
        // places it exactly at the container's edges, so this only needs
        // to override width/height — the untouched centering does the rest.
        style={isExpanded ? { width: "100vw", height: "100vh" } : undefined}
        className={cn(
          "flex flex-col gap-0 overflow-hidden p-0 shadow-[0_10px_40px_-10px_rgba(79,70,229,0.15)] outline-none transition-all duration-300",
          isExpanded
            ? "!max-w-none !max-h-none !rounded-none !border-0"
            : "w-[1024px] !max-w-[1024px] max-h-[90vh] rounded-2xl",
        )}
      >
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border/60 px-6 pt-5 pb-4">
          <div className="min-w-0">
            <div className="mb-1.5 flex items-center gap-2">
              <div className="flex size-[18px] shrink-0 items-center justify-center rounded bg-primary/10 text-primary">
                <Target size={11} strokeWidth={2.5} />
              </div>
              <span className="font-mono text-xs font-bold text-primary">
                {opportunity.opportunity_no}
              </span>
              <StatusBadge status={opportunity.status} />
            </div>
            <h2 className="truncate text-lg font-black text-foreground">
              {opportunity.project_title}
            </h2>
            <p className="truncate text-xs font-medium text-muted-foreground">
              {opportunity.client_name}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={() => onEdit(opportunity)}
              title="Edit"
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
            >
              <Pencil size={14} />
            </button>
            <button
              onClick={() =>
                confirmDeleteToast(
                  `Delete ${opportunity.opportunity_no}?`,
                  "The record is archived, not erased.",
                  () => deleteMutation.mutate(),
                )
              }
              title="Delete"
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/80 hover:text-red-500"
            >
              <Trash2 size={14} />
            </button>
            <button
              onClick={() => setIsExpanded((v) => !v)}
              title={isExpanded ? "Collapse" : "Expand"}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
            >
              {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            <button
              onClick={onClose}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div
          className={cn(
            "min-h-0 flex-1 space-y-7 overflow-y-auto p-6",
            isExpanded && "mx-auto w-full max-w-7xl px-12 py-10",
          )}
        >
          {/* Pipeline Stage Tracker */}
          <div className="w-full">
            <p className="mb-2.5 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
              Pipeline Stage
            </p>
            {stageControl}

            {isLostPending && (
              <div className="mt-3 flex items-end gap-2">
                <div className="flex-1 rounded-xl border border-border bg-muted/30 p-3 focus-within:border-mauve-7">
                  <label className="mb-1 block text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
                    Reason for loss
                  </label>
                  <input
                    autoFocus
                    value={lostReason}
                    onChange={(e) => setLostReason(e.target.value)}
                    placeholder="e.g. Lost to lower bid"
                    className="w-full bg-transparent text-sm font-medium text-foreground outline-none"
                  />
                </div>
                <button
                  disabled={!lostReason.trim() || stageMutation.isPending}
                  onClick={() =>
                    stageMutation.mutate({
                      next: "CLOSED_LOST",
                      reason: lostReason.trim(),
                      salesReference: null,
                    })
                  }
                  className="h-10 rounded-xl bg-primary px-4 text-[13px] font-bold text-primary-foreground transition-all hover:bg-primary-hover disabled:opacity-50"
                >
                  Confirm
                </button>
                <button
                  onClick={cancelPendingStage}
                  className="h-10 rounded-xl px-3 text-[13px] font-bold text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            )}

            {needsSalesRef && (
              <div className="mt-3">
                <div className="flex items-end gap-2">
                  <div className="flex-1 rounded-xl border border-border bg-muted/30 p-3 focus-within:border-mauve-7">
                    <label className="mb-1 block text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
                      Sales Reference
                      <span className="ml-0.5 text-red-500">*</span>
                    </label>
                    <input
                      autoFocus
                      value={salesRef}
                      onChange={(e) => setSalesRef(e.target.value.toUpperCase())}
                      placeholder="e.g. S01237"
                      className="w-full bg-transparent font-mono text-sm font-medium text-foreground uppercase outline-none"
                    />
                  </div>
                  <button
                    disabled={!salesRefValid || stageMutation.isPending}
                    onClick={() =>
                      stageMutation.mutate({
                        next: pendingStage,
                        reason: null,
                        salesReference: normalizeSalesReference(salesRef),
                      })
                    }
                    className="h-10 rounded-xl bg-primary px-4 text-[13px] font-bold text-primary-foreground transition-all hover:bg-primary-hover disabled:opacity-50"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={cancelPendingStage}
                    className="h-10 rounded-xl px-3 text-[13px] font-bold text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </button>
                </div>
                <p
                  className={cn(
                    "mt-1.5 text-[11px] leading-relaxed",
                    salesRef && !salesRefValid
                      ? "font-semibold text-red-500"
                      : "text-muted-foreground",
                  )}
                >
                  {salesRef && !salesRefValid
                    ? SALES_REFERENCE_HINT
                    : `Enter the Odoo sales quotation number to confirm a quotation exists before moving to ${
                        OPPORTUNITY_STAGES.find((s) => s.value === pendingStage)?.label ||
                        pendingStage
                      }.`}
                </p>
              </div>
            )}
          </div>

          {opportunity.lost_reason && (
            <div className="rounded-xl border border-red-400/40 bg-red-500/5 px-3 py-2.5">
              <p className="mb-1 text-[10px] font-bold tracking-widest text-red-500 uppercase">
                Lost Reason
              </p>
              <p className="text-sm text-foreground">{opportunity.lost_reason}</p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Left Box: Estimated Value */}
            <div className="flex min-w-0 flex-col justify-center rounded-xl border border-border bg-muted/30 p-6 lg:col-span-1">
              <p className="mb-2 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
                Estimated Value
              </p>
              <p className="text-3xl font-black tracking-tight break-words text-foreground tabular-nums lg:text-4xl">
                {formatPHP(opportunity.expected_value)}
              </p>
            </div>

            {/* Right Box: Deal Details */}
            <div className="rounded-xl border border-border/50 p-6 lg:col-span-2">
              <p className="mb-4 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
                Deal Details
              </p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
                <Detail label="Lead Source">
                  {formatLeadSource(opportunity.lead_source, opportunity.lead_source_detail)}
                </Detail>
                <Detail label="Sales Division">
                  {PROJECT_TYPE_LABELS[opportunity.project_type]}
                </Detail>
                <Detail label="Date Registered">{opportunity.registration_date}</Detail>
                <Detail label="Expected Award">{opportunity.expected_award_date}</Detail>
                <Detail label="Contact Person">{opportunity.contact_person}</Detail>
                <Detail label="Sales Reference">
                  {opportunity.sales_reference ? (
                    <span className="font-mono">{opportunity.sales_reference}</span>
                  ) : opportunity.status === "LEAD" ? (
                    <span className="text-xs font-medium text-amber-11">Required to qualify</span>
                  ) : null}
                </Detail>
              </div>
            </div>

            {/* Left Box 2: People Roster */}
            <div className="rounded-xl border border-border/50 p-6 lg:col-span-1">
              <p className="mb-4 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
                People
              </p>
              <PeopleRoster opportunity={opportunity} />
            </div>

            {/* Right Box 2: Log Notes */}
            <div className="flex flex-col rounded-xl border border-border/50 p-6 lg:col-span-2">
              <p className="mb-4 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
                Log Notes
              </p>

              <div className="min-h-[120px] flex-1 overflow-y-auto">
                {loadingNotes ? (
                  <Spinner size="sm" />
                ) : notes.length === 0 ? (
                  <p className="text-xs text-muted-foreground/70 italic">No notes yet.</p>
                ) : (
                  <ul className="space-y-3">
                    {notes.map((n) => (
                      <li key={n.id} className="flex gap-2.5">
                        {n.type === "SYSTEM" ? (
                          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                            <Sparkles size={12} />
                          </div>
                        ) : (
                          <Avatar name={n.author?.name} src={n.author?.avatar_path} size="sm" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-semibold text-muted-foreground">
                            {n.author?.name || (n.type === "SYSTEM" ? "System" : "Unknown")}
                            <span className="font-normal text-muted-foreground/60">
                              {" · "}
                              {formatWhen(n.created_at)}
                            </span>
                          </p>
                          {n.content && (
                            <p
                              className={cn(
                                "text-sm break-words",
                                n.type === "SYSTEM"
                                  ? "text-muted-foreground italic"
                                  : "text-foreground",
                              )}
                            >
                              {n.content}
                            </p>
                          )}
                          <AttachmentList
                            attachments={n.metadata?.attachments}
                            className={n.content ? "mt-2" : "mt-1"}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="mt-4">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handlePostNote();
                  }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      attachments.addFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />

                  {files.length > 0 && (
                    <div className="mb-2">
                      <AttachmentPreviews
                        files={files}
                        onRemove={attachments.removeFile}
                        disabled={isPosting}
                      />
                    </div>
                  )}

                  <div className="flex items-end gap-2">
                    <div className="flex-1 rounded-xl border border-border bg-muted/30 p-3.5 focus-within:border-mauve-7">
                      <textarea
                        rows={2}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        onPaste={attachments.addFromPaste}
                        placeholder="Add a note — client meeting, bid status, follow-up…"
                        className="w-full resize-none bg-transparent text-sm font-medium text-foreground placeholder:text-muted-foreground/50 outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      title={`Attach files (max ${attachments.max})`}
                      disabled={isPosting || files.length >= attachments.max}
                      onClick={() => fileInputRef.current?.click()}
                      className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/30 text-muted-foreground transition-all hover:border-mauve-7 hover:text-foreground disabled:opacity-50"
                    >
                      <Paperclip size={15} />
                    </button>
                    <button
                      type="submit"
                      disabled={(!note.trim() && files.length === 0) || isPosting}
                      className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-4 text-[13px] font-bold text-primary-foreground transition-all hover:bg-primary-hover disabled:opacity-50"
                    >
                      {isPosting ? <Spinner size="sm" /> : <Send size={13} />}
                      {isUploading ? "Uploading" : "Post"}
                    </button>
                  </div>
                  <p className="mt-1.5 text-[10px] text-muted-foreground/70">
                    Attach or paste up to {attachments.max} files —{" "}
                    {formatBytes(MAX_ATTACHMENT_BYTES)} each.
                  </p>
                </form>
              </div>
            </div>
          </div>

          {items.length > 0 && (
            <div className="rounded-xl border border-border/50 p-6">
              <p className="mb-4 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
                Product List
              </p>
              <ItemsList items={items} />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
