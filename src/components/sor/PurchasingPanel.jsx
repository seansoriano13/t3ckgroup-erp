import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  AtSign,
  ChevronDown,
  ExternalLink,
  ImagePlus,
  Minus,
  Pencil,
  Plus,
  Send,
  Trash2,
  UserPlus,
  Users,
  X,
  Paperclip,
} from "lucide-react";

import { purchasingService } from "../../services/purchasingService";
import { projectEvaluationService } from "../../services/projectEvaluationService";
import { employeeService } from "../../services/employeeService";
import { supabase } from "../../lib/supabase";
import { cn } from "@/lib/utils";
import Dropdown from "../ui/Dropdown";
import { FilterOptionList } from "../ui/FilterDropdown";
import { AttachmentPreviews } from "../ui/Attachments";
import { AttachmentEvidence } from "../ui/AttachmentEvidence";
import { useFileAttachments } from "../../hooks/useFileAttachments";
import { ALLOWED_EXTENSIONS_STRING } from "../../utils/attachments";
import { confirmDeleteToast } from "../ui/CustomToast";
import StatusBadge from "../StatusBadge";
import ProcurementMetaFooter from "../ProcurementMetaFooter";
import {
  PROCUREMENT_OUTCOME_LABELS,
  REQUEST_UNITS,
  displayOutcome,
  isTerminalOutcome,
  procurementAffinity,
} from "../../constants/procurement";
import { outstandingInclusions } from "../../constants/projectEvaluation";
import { useAuth } from "../../context/AuthContext";
import { canEditSor } from "../../utils/sorPermissions";
import { Button } from "@/components/ui/button";

let draftSeq = 0;
const blankDraft = (seed = {}) => ({
  key: `draft-${(draftSeq += 1)}`,
  product_name: "",
  quantity: 1,
  unit: "unit",
  description: "",
  // Issue #45. Set only when the draft was started from a row on the client's
  // breakdown; null is the ordinary case and means "raised on its own".
  inclusionId: null,
  ...seed,
});

/** A request already sent, with whatever purchasing has said about it. */
function RequestEditRow({ request, onSave, onCancel, isPending }) {
  const [productName, setProductName] = useState(request.requested_name || "");
  const [quantity, setQuantity] = useState(Number(request.requested_quantity) || 1);
  const [unit, setUnit] = useState(request.requested_unit || "unit");
  const [description, setDescription] = useState(request.requested_description || "");
  const [existingImages, setExistingImages] = useState(request.requested_images || []);
  const attachments = useFileAttachments();

  const handleSave = async (e) => {
    e?.preventDefault();
    if (!productName.trim()) {
      toast.error("Please enter a product name.");
      return;
    }
    const uploaded = await attachments.upload();
    const finalImages = [...existingImages, ...uploaded];
    onSave({
      product_name: productName.trim(),
      quantity,
      unit,
      description: description.trim(),
      images: finalImages,
    });
  };

  const removeExistingImage = (idx) => {
    setExistingImages((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <form
      onSubmit={handleSave}
      onPaste={(e) => attachments.addFromPaste(e)}
      className="space-y-3 rounded-lg border border-mauve-6 bg-mauve-2 p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-wider text-foreground">
          Edit request
        </span>
        <Button
          type="button"
          onClick={onCancel}
          variant="ghost" size="icon-xs"
          aria-label="Cancel editing"
        >
          <X size={13} />
        </Button>
      </div>

      <input
        value={productName}
        onChange={(e) => setProductName(e.target.value)}
        placeholder="Product name"
        className="w-full border-b border-border/80 bg-transparent pb-1.5 text-[14px] font-semibold text-foreground outline-none transition-colors focus:border-mauve-9"
      />

      <div className="flex items-center gap-2">
        <QuantityStepper label="Quantity" value={quantity} onChange={setQuantity} />
        <Dropdown
          className="w-24"
          trigger={({ isOpen }) => <UnitPill unit={unit} isOpen={isOpen} />}
        >
          {({ close }) => (
            <FilterOptionList
              options={REQUEST_UNITS.map((u) => ({ value: u, label: u }))}
              value={unit}
              onChange={(u) => setUnit(u)}
              close={close}
            />
          )}
        </Dropdown>
      </div>

      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        placeholder="Specs, brand, client notes..."
        className="w-full resize-none bg-transparent text-[12.5px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/50"
      />

      {existingImages.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {existingImages.map((img, i) => (
            <div
              key={img.url || i}
              className="group flex items-center gap-1.5 rounded-md bg-mauve-3 px-2 py-1 text-[11px] text-foreground"
            >
              <span className="max-w-[110px] truncate">{img.name || `Image ${i + 1}`}</span>
              <Button
                type="button"
                onClick={() => removeExistingImage(i)}
                variant="ghost" className="h-auto"
                title="Remove image"
              >
                <X size={11} />
              </Button>
            </div>
          ))}
        </div>
      )}

      {attachments.files.length > 0 && (
        <AttachmentPreviews files={attachments.files} onRemove={attachments.removeFile} />
      )}

      <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2">
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground">
          <Paperclip size={13} />
          <span>Attach file</span>
          <input
            type="file"
            multiple
            accept={ALLOWED_EXTENSIONS_STRING}
            className="sr-only"
            onChange={(e) => attachments.addFromInput(e)}
          />
        </label>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={onCancel}
            variant="ghost" className="h-auto"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isPending || !productName.trim()}
            variant="default"
          >
            {isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </form>
  );
}

/** A request row displaying status badge, quantity with unit name, visible View Task button, and actions. */
function RequestRow({ request, onEdit, onDelete, canEdit, isPending }) {
  const [isEditing, setIsEditing] = useState(false);
  const [isOpen, setIsOpen] = useState(() => !isTerminalOutcome(request.outcome));
  const qty = Number(request.requested_quantity) || 0;
  const unit = request.requested_unit || "unit";
  const images = request.requested_images || [];

  const { raw: statusRaw, label: statusLabel } = displayOutcome(request);

  const hasDetail = Boolean(
    request.requested_description ||
    images.length > 0 ||
    request.po_number ||
    request.odoo_vendor ||
    request.odoo_product_ref ||
    request.eta ||
    request.outcome_note ||
    request.assignee?.name,
  );

  if (isEditing) {
    return (
      <RequestEditRow
        request={request}
        onSave={async (payload) => {
          await onEdit(request.id, payload);
          setIsEditing(false);
        }}
        onCancel={() => setIsEditing(false)}
        isPending={isPending}
      />
    );
  }

  return (
    <div className="group/row rounded-lg border border-transparent transition-colors hover:border-border/60 hover:bg-mauve-2/70">
      <div
        onClick={() => hasDetail && setIsOpen((v) => !v)}
        className={cn(
          "flex flex-wrap items-center justify-between gap-2 px-2.5 py-2.5 rounded-lg transition-colors",
          hasDetail && "cursor-pointer hover:bg-mauve-3/40",
        )}
      >
        <Button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (hasDetail) setIsOpen((v) => !v);
          }}
          variant="ghost" className="min-w-0 flex-1 text-left h-auto justify-start"
          aria-expanded={hasDetail ? isOpen : undefined}
        >
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
            {request.requested_name}
          </span>

          <StatusBadge status={statusRaw} label={statusLabel} />

          <span className="shrink-0 rounded-md bg-mauve-3 px-2 py-0.5 text-[11.5px] font-medium text-foreground">
            {qty} {unit}
          </span>
        </Button>

        <div
          onClick={(e) => e.stopPropagation()}
          className="flex shrink-0 items-center gap-1.5"
        >
          {request.task_id && (
            <Button
              type="button"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("OPEN_ENTITY_DETAILS", {
                    detail: { id: request.task_id, type: "TASK" },
                  }),
                )
              }
              variant="outline" className="inline-flex"
              title="Open purchasing task"
            >
              <ExternalLink size={11} />
              <span>View Task</span>
            </Button>
          )}

          {canEdit && (
            <div className="flex items-center gap-0.5">
              <Button
                type="button"
                onClick={() => setIsEditing(true)}
                aria-label={`Edit ${request.requested_name}`}
                variant="ghost" size="icon-xs"
                title="Edit request"
              >
                <Pencil size={12} />
              </Button>
              <Button
                type="button"
                onClick={() =>
                  confirmDeleteToast(
                    "Cancel Procurement Request",
                    `Are you sure you want to cancel the request for "${request.requested_name}"?`,
                    () => onDelete(request.id),
                  )
                }
                aria-label={`Delete ${request.requested_name}`}
                variant="ghost" size="icon-xs"
                title="Cancel request"
              >
                <Trash2 size={12} />
              </Button>
            </div>
          )}

          {hasDetail && (
            <Button
              type="button"
              onClick={() => setIsOpen((v) => !v)}
              aria-label={isOpen ? "Collapse" : "Expand"}
              variant="ghost" size="icon-xs" className="shrink-0"
            >
              <ChevronDown
                size={13}
                className={cn("transition-transform duration-150", isOpen && "rotate-180")}
              />
            </Button>
          )}
        </div>
      </div>

      {hasDetail && (
        <div
          className="reveal"
          data-open={isOpen}
          data-settled={isOpen}
        >
          <div>
            <div
              className="reveal-body space-y-2 border-t border-border/40 px-3 py-2.5"
              inert={!isOpen ? "" : undefined}
              aria-hidden={!isOpen || undefined}
            >
              {request.requested_description && (
                <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground">
                  {request.requested_description}
                </p>
              )}
              {images.length > 0 && <AttachmentEvidence attachments={images} />}
              <ProcurementMetaFooter request={request} divider={false} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function UnitPill({ unit, isOpen }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium transition-colors",
        isOpen ? "bg-mauve-4 text-foreground" : "text-muted-foreground hover:bg-mauve-3 hover:text-foreground",
      )}
    >
      {unit}
      <ChevronDown size={11} />
    </span>
  );
}

/**
 * Quantity as a compact pill stepper — strong mauve styling.
 */
function QuantityStepper({ value, onChange, label }) {
  const n = Number(value) || 1;
  const step = (by) => onChange(Math.max(1, n + by));

  return (
    <div className="inline-flex h-7 items-center gap-0.5 rounded-md bg-mauve-3 px-0.5">
      <Button
        type="button"
        aria-label={`Decrease ${label}`}
        disabled={n <= 1}
        onClick={() => step(-1)}
        variant="ghost" size="icon-xs"
      >
        <Minus size={12} />
      </Button>
      <input
        aria-label={label}
        inputMode="numeric"
        value={n}
        onChange={(e) => {
          const next = parseInt(e.target.value.replace(/\D/g, ""), 10);
          onChange(Number.isNaN(next) ? 1 : Math.max(1, next));
        }}
        className="h-full w-6 bg-transparent text-center text-[12.5px] font-semibold text-foreground outline-none"
      />
      <Button
        type="button"
        aria-label={`Increase ${label}`}
        onClick={() => step(1)}
        variant="ghost" size="icon-xs"
      >
        <Plus size={12} />
      </Button>
    </div>
  );
}

/**
 * One product being asked for, mid-composition.
 */
function DraftRow({ draft, index, canRemove, onChange, onRemove, attachments, nameRef }) {
  const fileRef = useRef(null);

  return (
    <div
      onPaste={(e) => attachments.addFromPaste(e)}
      className="group/row py-3 first:pt-0"
    >
      <div className="flex items-start gap-2">
        <input
          ref={nameRef}
          aria-label={`Product name ${index + 1}`}
          value={draft.product_name}
          onChange={(e) => onChange({ ...draft, product_name: e.target.value })}
          placeholder="What does the client need?"
          className="min-w-0 flex-1 bg-transparent text-[14px] font-semibold text-foreground outline-none placeholder:font-medium placeholder:text-muted-foreground/40"
        />
        {canRemove && (
          <Button
            type="button"
            aria-label={`Remove product ${index + 1}`}
            onClick={onRemove}
            variant="ghost" size="icon-xs" className="shrink-0 opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100"
          >
            <Trash2 size={13} />
          </Button>
        )}
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <QuantityStepper
          label={`Quantity ${index + 1}`}
          value={draft.quantity}
          onChange={(quantity) => onChange({ ...draft, quantity })}
        />
        <Dropdown
          className="w-24"
          trigger={({ isOpen }) => <UnitPill unit={draft.unit} isOpen={isOpen} />}
        >
          {({ close }) => (
            <FilterOptionList
              options={REQUEST_UNITS.map((u) => ({ value: u, label: u }))}
              value={draft.unit}
              onChange={(unit) => onChange({ ...draft, unit })}
              close={close}
            />
          )}
        </Dropdown>
      </div>

      <textarea
        aria-label={`Description ${index + 1}`}
        value={draft.description}
        onChange={(e) => onChange({ ...draft, description: e.target.value })}
        rows={2}
        placeholder="Specs, brand, the wording the client used — paste a screenshot straight in"
        className="mt-2 w-full resize-none bg-transparent text-[12.5px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/50"
      />

      {attachments.files.length > 0 && (
        <div className="mt-2">
          <AttachmentPreviews files={attachments.files} onRemove={attachments.removeFile} />
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        multiple
        accept={ALLOWED_EXTENSIONS_STRING}
        className="hidden"
        onChange={(e) => {
          attachments.addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <Button
        type="button"
        onClick={() => fileRef.current?.click()}
        variant="ghost" className="mt-1.5 h-auto"
      >
        <ImagePlus size={12} />
        Attach a screenshot
      </Button>
    </div>
  );
}

/**
 * Assignee field typeahead over buyers and teams.
 */
function AssigneeField({ options, value, onChange, placeholder = "Mention a buyer or team" }) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
    return pool.slice(0, 6);
  }, [options, query]);

  useEffect(() => {
    const onDocDown = (e) => {
      if (!boxRef.current?.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  const choose = (option) => {
    onChange(option);
    setQuery("");
    setIsOpen(false);
  };

  if (value) {
    return (
      <div className="flex h-9 items-center gap-2 rounded-md bg-mauve-3 px-2.5">
        {value.kind === "team" ? (
          <Users size={13} className="shrink-0 text-muted-foreground" />
        ) : (
          <UserPlus size={13} className="shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-foreground">
          {value.label}
        </span>
        <Button
          type="button"
          aria-label="Clear recipient"
          onClick={() => onChange(null)}
          variant="ghost" size="icon-xs" className="shrink-0"
        >
          <X size={13} />
        </Button>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="flex h-9 items-center gap-2 rounded-md bg-mauve-2 px-2.5 transition-colors focus-within:bg-mauve-3">
        <AtSign size={13} className="shrink-0 text-muted-foreground" />
        <input
          aria-label="Send to"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={(e) => {
            if (!isOpen && (e.key === "ArrowDown" || e.key === "Enter")) {
              setIsOpen(true);
              return;
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, matches.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && matches[active]) {
              e.preventDefault();
              choose(matches[active]);
            } else if (e.key === "Escape") {
              setIsOpen(false);
            }
          }}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-[12.5px] font-medium text-foreground outline-none placeholder:text-muted-foreground/50"
        />
      </div>

      {isOpen && (
        <ul
          role="listbox"
          aria-label="Recipients"
          className="popover-enter absolute bottom-full left-0 z-[60] mb-1.5 max-h-[220px] w-full overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-2.5 text-[13px] text-muted-foreground">
              Nobody matches that
            </li>
          ) : (
            matches.map((o, i) => (
              <li key={o.id}>
                <Button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(o)}
                  variant="ghost" className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12.5px] font-medium transition-colors",
                    i === active ? "bg-mauve-4 text-foreground" : "text-muted-foreground hover:bg-mauve-3",
                  )}
                >
                  {o.kind === "team" ? (
                    <Users size={13} className="shrink-0" />
                  ) : (
                    <UserPlus size={13} className="shrink-0" />
                  )}
                  <span className="truncate">{o.label}</span>
                </Button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

export default function PurchasingPanel({ opportunity, isRequired = false }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [isComposing, setIsComposing] = useState(false);
  const [isSettled, setIsSettled] = useState(false);
  const [drafts, setDrafts] = useState(() => [blankDraft()]);
  const [recipient, setRecipient] = useState(null);
  const [assignTo, setAssignTo] = useState(null);
  const composerRef = useRef(null);
  const firstFieldRef = useRef(null);

  const openComposer = () => {
    setIsComposing(true);
    // Autofocus only if nothing else has taken focus by the time these two
    // animation frames fire: the trigger button itself unmounts as soon as
    // the composer opens, which drops focus to <body> in the ordinary case,
    // but two frames is also enough time for someone (or, in tests,
    // userEvent) to have clicked into a real field already — grabbing focus
    // back from that mid-keystroke would silently redirect whatever they're
    // typing into the wrong input.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        composerRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
        if (document.activeElement === document.body) {
          firstFieldRef.current?.focus({ preventScroll: true });
        }
      }),
    );
  };

  const bucketA = useFileAttachments({ max: 5 });
  const bucketB = useFileAttachments({ max: 5 });
  const bucketC = useFileAttachments({ max: 5 });
  const buckets = useMemo(() => [bucketA, bucketB, bucketC], [bucketA, bucketB, bucketC]);
  const MAX_DRAFTS = buckets.length;

  const { data: requests = [] } = useQuery({
    queryKey: ["procurementRequests", opportunity?.id],
    queryFn: () => purchasingService.listForOpportunity(opportunity.id),
    enabled: !!opportunity?.id,
  });

  useEffect(() => {
    if (!opportunity?.id) return;
    const channel = supabase
      .channel(`procurement_opp_${opportunity.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "sor_procurement_requests",
        },
        (payload) => {
          if (
            payload.new?.opportunity_id === opportunity.id ||
            payload.old?.opportunity_id === opportunity.id
          ) {
            queryClient.invalidateQueries({
              queryKey: ["procurementRequests", opportunity.id],
            });
            queryClient.invalidateQueries({
              queryKey: ["opportunityNotes", opportunity.id],
            });
            // Issue #45: an outcome can move an Inclusion's completeness, so
            // the breakdown's figure has to refetch with the request list.
            queryClient.invalidateQueries({
              queryKey: ["inclusions", opportunity.id],
            });
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [opportunity?.id, queryClient]);

  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => employeeService.getAllEmployees(),
  });

  // Issue #45. The breakdown is the list of things the client actually asked
  // for, so an item still missing from it is the most likely thing anybody is
  // about to send to purchasing. Starting the draft here is what carries the
  // link, and the link is what lets purchasing's answer come back on its own.
  const { data: inclusions = [] } = useQuery({
    queryKey: ["inclusions", opportunity?.id],
    queryFn: () => projectEvaluationService.listInclusions(opportunity.id),
    enabled: Boolean(opportunity?.id),
  });

  const recipients = useMemo(() => {
    const people = employees
      .map((e) => ({
        id: `person:${e.id}`,
        kind: "person",
        employeeId: e.id,
        affinity: procurementAffinity(e),
        label: `${e.name}${e.subDepartment ? ` — ${e.subDepartment}` : e.department ? ` — ${e.department}` : ""
          }`,
      }))
      .sort((a, b) => a.affinity - b.affinity || a.label.localeCompare(b.label));

    const seen = new Map();
    employees.forEach((e) => {
      if (!e.department) return;
      const key = `${e.department}||${e.subDepartment || ""}`;
      if (seen.has(key)) return;
      seen.set(key, {
        id: `team:${key}`,
        kind: "team",
        department: e.department,
        subDepartment: e.subDepartment || null,
        affinity: procurementAffinity(e),
        label: e.subDepartment ? `${e.department} › ${e.subDepartment}` : e.department,
      });
    });

    return [...people, ...seen.values()].sort(
      (a, b) =>
        a.affinity - b.affinity ||
        (a.kind === b.kind ? 0 : a.kind === "person" ? -1 : 1) ||
        a.label.localeCompare(b.label),
    );
  }, [employees]);

  const peopleOnly = useMemo(() => recipients.filter((r) => r.kind === "person"), [recipients]);

  const unassigned = requests.filter((r) => !r.assigned_to && !r.outcome);
  const isHead = user?.is_head || user?.isHead || user?.isSuperAdmin;
  const resolvedCount = requests.filter((r) => r.outcome).length;
  const allResolved = requests.length > 0 && resolvedCount === requests.length;
  // null means "follow the requests" — a finished set folds itself away. Once
  // the user has clicked the chevron their choice wins, which an effect that
  // re-synced on every resolution would have overridden under their hands.
  const [foldOverride, setFoldOverride] = useState(null);
  const isFolded = foldOverride ?? allResolved;

  const named = drafts.filter((d) => d.product_name.trim());

  // Outstanding rows on the breakdown that nobody has drafted yet. Offering one
  // that is already in the composer would invite two requests for one item.
  const drafted = new Set(drafts.map((d) => d.inclusionId).filter(Boolean));
  const unsourced = outstandingInclusions(inclusions).filter((i) => !drafted.has(i.id));
  const isComposerFull =
    drafts.length >= MAX_DRAFTS && drafts.some((d) => d.product_name.trim());

  const startFromInclusion = (inclusion) => {
    const seed = {
      product_name: inclusion.description,
      quantity: Number(inclusion.quantity) || 1,
      unit: inclusion.unit || "unit",
      description: inclusion.note || "",
      inclusionId: inclusion.id,
    };
    // An untouched first draft is filled rather than added to, so picking one
    // item does not leave an empty row above it.
    //
    // The cap is MAX_DRAFTS because there are exactly that many attachment
    // buckets and the submit path indexes them by draft position — a fourth
    // draft would read an undefined bucket and take the whole send down.
    setDrafts((prev) => {
      if (prev.length === 1 && !prev[0].product_name.trim()) return [blankDraft(seed)];
      if (prev.length >= MAX_DRAFTS) return prev;
      return [...prev, blankDraft(seed)];
    });
  };

  const resetComposer = () => {
    buckets.forEach((b) => b.clear());
    setDrafts([blankDraft()]);
    setRecipient(null);
    setIsSettled(false);
    setIsComposing(false);
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const withImages = await Promise.all(
        drafts.map(async (d, i) =>
          d.product_name.trim()
            ? {
              product_name: d.product_name.trim(),
              quantity: Number(d.quantity) || 1,
              unit: d.unit,
              description: d.description.trim(),
              inclusionId: d.inclusionId || null,
              images: await buckets[i].upload(),
            }
            : null,
        ),
      );

      return purchasingService.createRequest({
        opportunityId: opportunity.id,
        items: withImages.filter(Boolean),
        assigneeId: recipient?.kind === "person" ? recipient.employeeId : null,
        department: recipient?.kind === "team" ? recipient.department : null,
        subDepartment: recipient?.kind === "team" ? recipient.subDepartment : null,
        requesterId: user?.id,
      });
    },
    onSuccess: (rows) => {
      queryClient.invalidateQueries({ queryKey: ["procurementRequests", opportunity.id] });
      queryClient.invalidateQueries({ queryKey: ["inclusions", opportunity.id] });
      queryClient.invalidateQueries({ queryKey: ["opportunityNotes", opportunity.id] });
      const toTeam = recipient?.kind === "team";
      resetComposer();
      toast.success(
        toTeam
          ? `Queued ${rows.length} product${rows.length === 1 ? "" : "s"} — the team head will name a buyer.`
          : `Sent ${rows.length} product${rows.length === 1 ? "" : "s"} to purchasing.`,
      );
    },
    onError: (err) => toast.error(err.message),
  });

  const assignMutation = useMutation({
    mutationFn: () =>
      purchasingService.assignRequests(
        unassigned.map((r) => r.id),
        assignTo?.employeeId,
        user?.id,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["procurementRequests", opportunity.id] });
      queryClient.invalidateQueries({ queryKey: ["inclusions", opportunity.id] });
      setAssignTo(null);
      toast.success("Buyer assigned and task opened.");
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ requestId, payload }) =>
      purchasingService.updateRequest(requestId, payload, user?.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["procurementRequests", opportunity.id] });
      queryClient.invalidateQueries({ queryKey: ["inclusions", opportunity.id] });
      queryClient.invalidateQueries({ queryKey: ["opportunityNotes", opportunity.id] });
      queryClient.invalidateQueries({ queryKey: ["procurement"] });
      toast.success("Procurement request updated.");
    },
    onError: (err) => toast.error(err.message || "Failed to update request."),
  });

  const deleteMutation = useMutation({
    mutationFn: (requestId) =>
      purchasingService.deleteRequest(requestId, user?.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["procurementRequests", opportunity.id] });
      queryClient.invalidateQueries({ queryKey: ["inclusions", opportunity.id] });
      queryClient.invalidateQueries({ queryKey: ["opportunityNotes", opportunity.id] });
      queryClient.invalidateQueries({ queryKey: ["procurement"] });
      toast.success("Procurement request cancelled.");
    },
    onError: (err) => toast.error(err.message || "Failed to cancel request."),
  });

  const isSending = createMutation.isPending || buckets.some((b) => b.isUploading);
  const canSend = named.length > 0 && !!recipient && !isSending;

  if (!opportunity) return null;
  if (!isRequired && requests.length === 0) return null;

  return (
    <div className="rounded-xl border border-border/50 p-6 space-y-3">
      {requests.length > 0 && (
        <div className="flex items-center justify-between">
          <Button
            type="button"
            onClick={() => setFoldOverride(!isFolded)}
            variant="ghost" className="h-auto"
          >
            <ChevronDown
              size={12}
              className={cn("transition-transform duration-150", isFolded && "-rotate-90")}
            />
            Procurement Requests
          </Button>
          <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">
            {resolvedCount}/{requests.length} Resolved
          </span>
        </div>
      )}

      {(!isFolded || requests.length === 0) && (
        <>
          {requests.length > 0 && (
            <div className="space-y-2">
              {requests.map((r) => {
                const isRowEditable =
                  !r.po_number &&
                  (!r.outcome || r.outcome === "IN_PROGRESS");
                const canEdit =
                  isRowEditable &&
                  (user?.id === r.requested_by || canEditSor(user, opportunity));

                return (
                  <RequestRow
                    key={r.id}
                    request={r}
                    onEdit={(id, payload) =>
                      updateMutation.mutateAsync({ requestId: id, payload })
                    }
                    onDelete={(id) => deleteMutation.mutateAsync(id)}
                    canEdit={canEdit}
                    isPending={updateMutation.isPending || deleteMutation.isPending}
                  />
                );
              })}
            </div>
          )}

          {unassigned.length > 0 && isHead && (
            <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5">
              <p className="flex items-center gap-1.5 text-[12px] font-semibold text-amber-600 dark:text-amber-400">
                <UserPlus size={12} />
                {unassigned.length} product{unassigned.length === 1 ? "" : "s"} need a buyer
              </p>
              <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                  <AssigneeField
                    options={peopleOnly}
                    value={assignTo}
                    onChange={setAssignTo}
                    placeholder="Assign to a buyer"
                  />
                </div>
                <Button
                  type="button"
                  disabled={!assignTo || assignMutation.isPending}
                  onClick={() => assignMutation.mutate()}
                  variant="default" className="shrink-0"
                >
                  Assign
                </Button>
              </div>
            </div>
          )}

          {!isComposing && (
            <Button
              type="button"
              onClick={openComposer}
              variant="ghost" className="h-auto"
            >
              <Plus size={13} />
              Request a product
            </Button>
          )}

          <div
            ref={composerRef}
            className="reveal"
            data-open={isComposing}
            data-settled={isSettled}
            onTransitionEnd={(e) => {
              if (e.propertyName === "grid-template-rows") setIsSettled(isComposing);
            }}
          >
            <div>
              <div
                className="reveal-body rounded-lg border border-border/70 bg-card/60 p-3"
                inert={!isComposing}
                aria-hidden={!isComposing || undefined}
              >
                <p className="pb-3 text-[11px] leading-relaxed text-muted-foreground">
                  For products the company does not carry yet — everything on the
                  product list already exists in Odoo.
                </p>

                {unsourced.length > 0 && (
                  <div className="mb-3 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      From the breakdown
                    </span>
                    {unsourced.map((inclusion) => (
                      <Button
                        key={inclusion.id}
                        type="button"
                        onClick={() => startFromInclusion(inclusion)}
                        disabled={isComposerFull}
                        variant="ghost" className="max-w-[14rem] truncate h-auto"
                        title={
                          isComposerFull
                            ? `Send these ${MAX_DRAFTS} first — the composer takes ${MAX_DRAFTS} products at a time.`
                            : inclusion.description
                        }
                      >
                        + {inclusion.description}
                      </Button>
                    ))}
                  </div>
                )}

                <div className="divide-y divide-border/60">
                  {drafts.map((draft, i) => (
                    <DraftRow
                      key={draft.key}
                      draft={draft}
                      index={i}
                      nameRef={i === 0 ? firstFieldRef : undefined}
                      canRemove={drafts.length > 1}
                      attachments={buckets[i]}
                      onChange={(next) =>
                        setDrafts((prev) => prev.map((d, j) => (j === i ? next : d)))
                      }
                      onRemove={() => {
                        buckets[i].clear();
                        setDrafts((prev) => prev.filter((_, j) => j !== i));
                      }}
                    />
                  ))}
                </div>

                {drafts.length < MAX_DRAFTS && (
                  <Button
                    type="button"
                    onClick={() => setDrafts((prev) => [...prev, blankDraft()])}
                    variant="ghost" className="mt-2 h-auto"
                  >
                    <Plus size={13} /> Add another product
                  </Button>
                )}

                <div className="sticky bottom-0 z-10 mt-4 flex items-center gap-2 border-t border-border/70 bg-card pt-3 pb-1">
                  <div className="min-w-0 flex-1">
                    <AssigneeField
                      options={recipients}
                      value={recipient}
                      onChange={setRecipient}
                    />
                  </div>
                  <Button
                    type="button"
                    onClick={resetComposer}
                    variant="ghost" className="shrink-0 h-auto"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    disabled={!canSend}
                    onClick={() => createMutation.mutate()}
                    variant="default" className="shrink-0"
                  >
                    <Send size={12} />
                    {isSending
                      ? "Sending…"
                      : named.length === 0
                        ? "Name a product"
                        : `Send ${named.length}`}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

