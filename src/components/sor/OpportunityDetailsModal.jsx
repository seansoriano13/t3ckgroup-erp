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
  Download,
  Link2,
  ExternalLink,
  FileDown,
} from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import Spinner from "../ui/Spinner";
import Avatar from "../Avatar";
import StatusBadge from "../StatusBadge";
import { opportunityService } from "../../services/opportunityService";
import { useAuth } from "../../context/AuthContext";
import { confirmDeleteToast, confirmActionToast } from "../ui/CustomToast";
import { AttachmentPreviews, AttachmentList } from "../ui/Attachments";
import { useFileAttachments } from "../../hooks/useFileAttachments";
import { MAX_ATTACHMENT_BYTES, formatBytes } from "../../utils/attachments";
import { getStatusTheme } from "../../constants/status";
import Dropdown from "../ui/Dropdown";
import { FilterOptionList, FilterTrigger } from "../ui/FilterDropdown";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { employeeService } from "../../services/employeeService";
import { odooService } from "../../services/odooService";
import { quotationService } from "../../services/quotationService";
import OpportunityItemsEditor from "./OpportunityItemsEditor";
import {
  OPPORTUNITY_STAGES,
  PROJECT_TYPE_LABELS,
  PROJECT_TYPES,
  formatLeadSource,
  formatPHP,
  isValidSalesReference,
  normalizeSalesReference,
  requiresSalesReference,
  SALES_REFERENCE_HINT,
} from "../../constants/sor";
import { leadSourceService } from "../../services/leadSourceService";

const TONE_CLASSES = {
  green: { current: "bg-green-9 text-white", completed: "bg-green-9/20 text-green-11 hover:bg-green-9/30" },
  amber: { current: "bg-amber-9 text-white", completed: "bg-amber-9/20 text-amber-11 hover:bg-amber-9/30" },
  blue: { current: "bg-blue-9 text-white", completed: "bg-blue-9/20 text-blue-11 hover:bg-blue-9/30" },
  red: { current: "bg-red-9 text-white", completed: "bg-red-9/20 text-red-11 hover:bg-red-9/30" },
  violet: { current: "bg-violet-9 text-white", completed: "bg-violet-9/20 text-violet-11 hover:bg-violet-9/30" },
  orange: { current: "bg-orange-9 text-white", completed: "bg-orange-9/20 text-orange-11 hover:bg-orange-9/30" },
  mauve: { current: "bg-mauve-9 text-white", completed: "bg-mauve-9/20 text-mauve-11 hover:bg-mauve-9/30" },
};

function Detail({ label, children, isEditing, control, wrapperClass = "w-full" }) {
  if (isEditing) {
    return (
      <div className={`bg-muted/30 border border-border rounded-xl p-3 flex flex-col group focus-within:border-mauve-7 focus-within:ring-1 ring-mauve-7 transition-all ${wrapperClass}`}>
        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1 block">
          {label}
        </label>
        {control}
      </div>
    );
  }
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
  const total = items.reduce((sum, it) => sum + ((Number(it.quantity) || 0) * (Number(it.unit_price) || 0)), 0);
  return (
    <div className="border border-border rounded-xl overflow-x-auto">
      <div className="min-w-[500px] divide-y divide-border">
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
        <div className="grid grid-cols-12 gap-2 px-3 py-2.5 items-center text-sm bg-muted/10 border-t border-border">
          <span className="col-span-10 text-right font-bold text-muted-foreground uppercase tracking-widest text-[9px]">Product Line Total</span>
          <span className="col-span-2 text-right font-black text-foreground">
            {formatPHP(total)}
          </span>
        </div>
      </div>
    </div>
  );
}

function formatLongDate(dateString) {
  if (!dateString) return "";
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
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

const toRow = (item) => ({
  product_name: item.product_name || "",
  unit: item.unit || "",
  quantity: item.quantity ?? 1,
  unit_price: item.unit_price ?? "",
});

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
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [fetchingOdoo, setFetchingOdoo] = useState(false);
  const [buildingLink, setBuildingLink] = useState(false);
  const [shareUrl, setShareUrl] = useState(null);
  const [downloadStep, setDownloadStep] = useState(null);
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
    setIsEditing(false);
    setEditForm({});
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

  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => employeeService.getAllEmployees(),
    enabled: isOpen,
  });

  const { data: activeLeadSources = [] } = useQuery({
    queryKey: ["leadSources", "active"],
    queryFn: () => leadSourceService.getActiveLeadSources(),
    enabled: isOpen,
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

  const updateMutation = useMutation({
    mutationFn: (data) =>
      opportunityService.updateOpportunity(id, data, user?.id),
    onSuccess: () => {
      setIsEditing(false);
      setEditForm({});
      invalidate();
      toast.success("Opportunity updated.");
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

  // The modal is reused across opportunities, so a cached link would otherwise
  // follow the previous one. Editing the reference invalidates it too.
  useEffect(() => {
    setShareUrl(null);
  }, [opportunity?.id, opportunity?.sales_reference]);

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

  const executeOdooFetch = async (ref) => {
    setFetchingOdoo(true);
    try {
      const result = await odooService.fetchOrderLines(ref);
      if (!result?.success) {
        toast.error(
          result?.message ||
          "Could not fetch items from Odoo — enter them manually.",
        );
        return;
      }
      setEditForm(f => ({ ...f, items: result.items.map(toRow) }));
      toast.success(
        `Pulled ${result.items.length} item(s) from ${result.order?.name || ref}.`,
      );
    } catch (err) {
      toast.error(err.message || "Could not reach Odoo — enter items manually.");
    } finally {
      setFetchingOdoo(false);
    }
  };

  const handleFetchFromOdoo = () => {
    const ref = normalizeSalesReference(editForm.sales_reference);
    if (!isValidSalesReference(ref)) {
      toast.error(SALES_REFERENCE_HINT);
      return;
    }
    const hasItems = editForm.items?.some((it) => (it.product_name || "").trim());
    if (hasItems) {
      confirmActionToast(
        "Overwrite Products?",
        "This replaces the current Product List with the items from Odoo. Continue?",
        "Continue",
        "warning",
        () => executeOdooFetch(ref)
      );
    } else {
      executeOdooFetch(ref);
    }
  };

  // The portal page renders live from Odoo and its access_token is the whole
  // credential, so the link is only ever handed to a signed-in employee to
  // pass on deliberately.
  //
  // Resolved once per opportunity and kept — previewing and then copying is the
  // normal sequence, and it shouldn't cost two Odoo round trips.
  const ensureShareLink = async () => {
    if (shareUrl) return shareUrl;
    const result = await odooService.fetchShareLink(opportunity.sales_reference);
    if (!result?.success) {
      toast.error(result?.message || "Could not build the quotation link.");
      return null;
    }
    setShareUrl(result.url);
    return result.url;
  };

  const handlePreviewQuotation = async () => {
    if (buildingLink) return;
    // Opened synchronously — a window.open after the await reads as unrequested
    // to the popup blocker. No "noopener" feature here: passing it makes
    // window.open return null by spec, and we need the handle to navigate.
    const tab = window.open("about:blank", "_blank");
    setBuildingLink(true);
    try {
      const url = await ensureShareLink();
      if (!url) {
        tab?.close();
        return;
      }
      if (tab) {
        tab.opener = null; // the handle is only needed until it is pointed somewhere
        tab.location.href = url;
      } else {
        toast.error(`Pop-up blocked. Link: ${url}`, { duration: 15000 });
      }
    } catch (err) {
      tab?.close();
      toast.error(err.message || "Could not reach Odoo.");
    } finally {
      setBuildingLink(false);
    }
  };

  const handleCopyQuotationLink = async () => {
    if (buildingLink) return;
    setBuildingLink(true);
    try {
      const url = await ensureShareLink();
      if (!url) return;
      try {
        await navigator.clipboard.writeText(url);
        toast.success("Customer link copied.");
      } catch {
        // Clipboard is unavailable outside a secure context — show the link so
        // it can still be copied by hand rather than losing the lookup.
        toast.error(`Copy failed. Link: ${url}`, { duration: 15000 });
      }
    } catch (err) {
      toast.error(err.message || "Could not reach Odoo.");
    } finally {
      setBuildingLink(false);
    }
  };

  // Odoo's own PDF Quote puts the brochures ahead of the quotation and that
  // order cannot be changed on Odoo Online, so the document is reassembled
  // here with the quotation first.
  const handleDownloadQuotation = async () => {
    if (downloadStep) return;
    setDownloadStep("Starting…");
    try {
      const { blob, filename, warnings, notices, documentCount } =
        await quotationService.buildQuotationPdf(opportunity.sales_reference, {
          onProgress: ({ current, total, label }) =>
            setDownloadStep(total ? `${current}/${total} — ${label}` : label),
        });

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);

      if (warnings.length) {
        // A datasheet that will not parse is skipped rather than failing the
        // download, but the salesperson has to know it is missing.
        toast.error(
          `Downloaded without ${warnings.length} brochure(s): ${warnings.join("; ")}`,
          { duration: 15000 },
        );
      } else {
        toast.success(`${filename} — quotation plus ${documentCount} brochure(s).`);
      }

      // Separate from the warning above on purpose: nothing is missing here,
      // the brochures just could not be moved behind the quotation. Reporting
      // it as a failed download would overstate it.
      if (notices.length) {
        toast(notices.join(" "), { duration: 12000 });
      }
    } catch (err) {
      toast.error(err.message || "Could not build the quotation PDF.");
    } finally {
      setDownloadStep(null);
    }
  };

  const handleEditToggle = () => {
    if (isEditing) {
      setIsEditing(false);
      setEditForm({});
    } else {
      setIsEditing(true);
      setEditForm({
        project_title: opportunity.project_title || "",
        client_name: opportunity.client_name || "",
        expected_value: opportunity.expected_value || "",
        lead_source: opportunity.lead_source || "",
        lead_source_detail: opportunity.lead_source_detail || "",
        project_type: opportunity.project_type || "SSP",
        registration_date: opportunity.registration_date || "",
        expected_award_date: opportunity.expected_award_date || "",
        contact_person: opportunity.contact_person || "",
        sales_reference: opportunity.sales_reference || "",
        deal_owner_id: opportunity.deal_owner_id || "",
        sales_director_id: opportunity.sales_director_id || "",
        support_sales_1_id: opportunity.support_sales_1_id || "",
        support_sales_2_id: opportunity.support_sales_2_id || "",
        items: items.map(toRow)
      });
    }
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
        <ul className="flex h-11 min-w-full w-max gap-[2px] mb-2">
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
            : "w-full max-w-[95vw] md:max-w-[1024px] max-h-[90vh] rounded-2xl",
        )}
      >
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border/60 px-6 pt-5 pb-4">
          <div className="min-w-0">
            <div className="mb-1.5 flex items-center gap-2">
              <div className="flex size-[18px] shrink-0 items-center justify-center rounded bg-primary/10 text-primary">
                <Target size={11} strokeWidth={2.5} />
              </div>
              {/* The Sales Reference is the only S0#### number shown anywhere.
                  opportunity_no used to sit here and shared that exact format
                  while pointing at unrelated Odoo orders — see migration 0012. */}
              {opportunity.sales_reference ? (
                <span className="font-mono text-xs font-bold text-primary">
                  {opportunity.sales_reference}
                </span>
              ) : (
                <span className="truncate text-xs font-bold text-muted-foreground">
                  {opportunity.client_name}
                </span>
              )}
              <StatusBadge status={opportunity.status} />
            </div>
            {isEditing ? (
              <div className="space-y-2 mt-2 max-w-xl">
                <input
                  value={editForm.project_title}
                  onChange={(e) => setEditForm(f => ({ ...f, project_title: e.target.value }))}
                  className="w-full text-lg font-black text-foreground bg-transparent border-b border-border/50 focus:border-primary focus:outline-none placeholder:text-muted-foreground/30"
                  placeholder="Project Title"
                  autoFocus
                />
                <input
                  value={editForm.client_name}
                  onChange={(e) => setEditForm(f => ({ ...f, client_name: e.target.value }))}
                  className="w-full text-xs font-medium text-muted-foreground bg-transparent border-b border-border/50 focus:border-primary focus:outline-none placeholder:text-muted-foreground/30"
                  placeholder="Client Name"
                />
              </div>
            ) : (
              <>
                <h2 className="truncate text-lg font-black text-foreground">
                  {opportunity.project_title}
                </h2>
                <p className="truncate text-xs font-medium text-muted-foreground">
                  {opportunity.client_name}
                </p>
              </>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {isEditing ? (
              <>
                <button
                  onClick={handleEditToggle}
                  className="rounded-md px-3 py-1.5 text-xs font-bold text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  onClick={() => updateMutation.mutate(editForm)}
                  disabled={updateMutation.isPending}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground transition-all hover:bg-primary-hover disabled:opacity-50"
                >
                  {updateMutation.isPending ? "Saving..." : "Save"}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleEditToggle}
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
              </>
            )}
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
                    : `Enter the Odoo sales quotation number to confirm a quotation exists before moving to ${OPPORTUNITY_STAGES.find((s) => s.value === pendingStage)?.label ||
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

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 items-start">

            {/* LEFT COLUMN */}
            <div className="flex flex-col gap-6 lg:col-span-1">
              {/* Left Box: Estimated Value */}
              <div className="flex min-w-0 flex-col justify-center rounded-xl border border-border bg-muted/30 p-6 ">
                <p className="mb-2 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
                  Estimated Value
                </p>
                {isEditing ? (
                  <div className="flex items-center text-3xl font-black tracking-tight text-foreground lg:text-4xl">
                    <span className="mr-2 text-muted-foreground/50">₱</span>
                    <input
                      type="text"
                      value={(() => {
                        const val = editForm.expected_value;
                        if (!val) return "";
                        const parts = val.toString().split(".");
                        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
                        return parts.join(".");
                      })()}
                      onChange={(e) => {
                        let raw = e.target.value.replace(/[^0-9.]/g, '');
                        const parts = raw.split('.');
                        if (parts.length > 2) raw = parts[0] + '.' + parts.slice(1).join('');
                        setEditForm(f => ({ ...f, expected_value: raw }));
                      }}
                      className="w-full bg-transparent outline-none tabular-nums placeholder:text-muted-foreground/30"
                      placeholder="0.00"
                    />
                  </div>
                ) : (
                  <p className="text-3xl font-black tracking-tight break-words text-foreground tabular-nums lg:text-4xl">
                    {formatPHP(opportunity.expected_value)}
                  </p>
                )}
              </div>
              {/* Left Box 1b: Customer quotation link. Odoo's portal page shows
                  the quotation with every product brochure beneath it, so this
                  is what sales sends instead of an attachment. Needs a Sales
                  Reference to resolve the order, so it stays hidden until
                  there is one. */}
              {!isEditing && opportunity.sales_reference && (
                <div className="flex flex-col gap-2 rounded-xl border border-border/50 p-3">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={buildingLink}
                      onClick={handlePreviewQuotation}
                      className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-muted/50 px-4 py-3 text-[13px] font-bold text-foreground transition-all hover:bg-muted disabled:opacity-50"
                    >
                      {buildingLink ? <Spinner size="sm" /> : <ExternalLink size={15} />}
                      Preview Quotation
                    </button>
                    <button
                      type="button"
                      disabled={buildingLink}
                      onClick={handleCopyQuotationLink}
                      title="Copy the customer link"
                      aria-label="Copy the customer link"
                      className="flex items-center justify-center rounded-lg border border-border px-3 text-muted-foreground transition-all hover:bg-muted/50 hover:text-foreground disabled:opacity-50"
                    >
                      <Link2 size={15} />
                    </button>
                  </div>
                  <button
                    type="button"
                    disabled={!!downloadStep}
                    onClick={handleDownloadQuotation}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-4 py-3 text-[13px] font-bold text-muted-foreground transition-all hover:bg-muted/50 hover:text-foreground disabled:opacity-50"
                  >
                    {downloadStep ? <Spinner size="sm" /> : <FileDown size={15} />}
                    Download Full PDF
                  </button>
                  {downloadStep && (
                    <p className="truncate text-center text-[11px] text-muted-foreground">
                      {downloadStep}
                    </p>
                  )}
                </div>
              )}
              {/* Left Box 2: People Roster */}
              <div className="rounded-xl border border-border/50 p-6 ">
                <p className="mb-4 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
                  People
                </p>
                {isEditing ? (
                  <div className="space-y-4">
                    <Detail
                      label="Deal Owner"
                      isEditing={isEditing}
                      control={
                        <Dropdown
                          usePortal
                          className="w-full"
                          trigger={({ isOpen }) => (
                            <div className="w-full h-full flex items-center justify-between bg-transparent text-sm font-medium outline-none cursor-pointer">
                              <span className={editForm.deal_owner_id ? "text-foreground" : "text-muted-foreground/50"}>
                                {editForm.deal_owner_id ? employees.find(e => e.id === editForm.deal_owner_id)?.name : "Unassigned"}
                              </span>
                            </div>
                          )}
                        >
                          {({ close }) => (
                            <FilterOptionList
                              options={employees.map(e => ({ value: e.id, label: e.name }))}
                              value={editForm.deal_owner_id}
                              onChange={(val) => setEditForm(f => ({ ...f, deal_owner_id: val }))}
                              close={close}
                            />
                          )}
                        </Dropdown>
                      }
                    />
                    <Detail
                      label="Sales Director"
                      isEditing={isEditing}
                      control={
                        <Dropdown
                          usePortal
                          className="w-full"
                          trigger={({ isOpen }) => (
                            <div className="w-full h-full flex items-center justify-between bg-transparent text-sm font-medium outline-none cursor-pointer">
                              <span className={editForm.sales_director_id ? "text-foreground" : "text-muted-foreground/50"}>
                                {editForm.sales_director_id ? employees.find(e => e.id === editForm.sales_director_id)?.name : "Unassigned"}
                              </span>
                            </div>
                          )}
                        >
                          {({ close }) => (
                            <FilterOptionList
                              options={employees.map(e => ({ value: e.id, label: e.name }))}
                              value={editForm.sales_director_id}
                              onChange={(val) => setEditForm(f => ({ ...f, sales_director_id: val }))}
                              close={close}
                            />
                          )}
                        </Dropdown>
                      }
                    />
                    <Detail
                      label="Support Sales 1"
                      isEditing={isEditing}
                      control={
                        <Dropdown
                          usePortal
                          className="w-full"
                          trigger={({ isOpen }) => (
                            <div className="w-full h-full flex items-center justify-between bg-transparent text-sm font-medium outline-none cursor-pointer">
                              <span className={editForm.support_sales_1_id ? "text-foreground" : "text-muted-foreground/50"}>
                                {editForm.support_sales_1_id ? employees.find(e => e.id === editForm.support_sales_1_id)?.name : "Unassigned"}
                              </span>
                            </div>
                          )}
                        >
                          {({ close }) => (
                            <FilterOptionList
                              options={employees.map(e => ({ value: e.id, label: e.name }))}
                              value={editForm.support_sales_1_id}
                              onChange={(val) => setEditForm(f => ({ ...f, support_sales_1_id: val }))}
                              close={close}
                            />
                          )}
                        </Dropdown>
                      }
                    />
                    <Detail
                      label="Support Sales 2"
                      isEditing={isEditing}
                      control={
                        <Dropdown
                          usePortal
                          className="w-full"
                          trigger={({ isOpen }) => (
                            <div className="w-full h-full flex items-center justify-between bg-transparent text-sm font-medium outline-none cursor-pointer">
                              <span className={editForm.support_sales_2_id ? "text-foreground" : "text-muted-foreground/50"}>
                                {editForm.support_sales_2_id ? employees.find(e => e.id === editForm.support_sales_2_id)?.name : "Unassigned"}
                              </span>
                            </div>
                          )}
                        >
                          {({ close }) => (
                            <FilterOptionList
                              options={employees.map(e => ({ value: e.id, label: e.name }))}
                              value={editForm.support_sales_2_id}
                              onChange={(val) => setEditForm(f => ({ ...f, support_sales_2_id: val }))}
                              close={close}
                            />
                          )}
                        </Dropdown>
                      }
                    />
                  </div>
                ) : (
                  <PeopleRoster opportunity={opportunity} />
                )}
              </div>
            </div>

            {/* RIGHT COLUMN */}
            <div className="flex flex-col gap-6 lg:col-span-2">
              {/* Right Box: Deal Details */}
              <div className="rounded-xl border border-border/50 p-6 ">
                <p className="mb-4 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
                  Deal Details
                </p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
                  <Detail
                    label="Lead Source"
                    isEditing={isEditing}
                    control={
                      <Dropdown
                        usePortal
                        className="w-full"
                        trigger={({ isOpen }) => (
                          <div className="w-full h-full flex items-center justify-between bg-transparent text-sm font-medium outline-none cursor-pointer min-w-0">
                            <span className={`truncate ${editForm.lead_source ? "text-foreground" : "text-muted-foreground/50"}`}>
                              {editForm.lead_source ? activeLeadSources.find(l => l.value === editForm.lead_source)?.label || editForm.lead_source : "Select..."}
                            </span>
                          </div>
                        )}
                      >
                        {({ close }) => (
                          <FilterOptionList
                            options={activeLeadSources.map(s => ({ value: s.value, label: s.label }))}
                            value={editForm.lead_source}
                            onChange={(val) => setEditForm(f => ({ ...f, lead_source: val }))}
                            close={close}
                          />
                        )}
                      </Dropdown>
                    }
                  >
                    {formatLeadSource(opportunity.lead_source, opportunity.lead_source_detail, activeLeadSources)}
                  </Detail>

                  {editForm.lead_source === "OTHERS" && isEditing && (
                    <Detail
                      label="Referral"
                      isEditing={isEditing}
                      control={
                        <input
                          type="text"
                          value={editForm.lead_source_detail}
                          onChange={(e) => setEditForm(f => ({ ...f, lead_source_detail: e.target.value }))}
                          className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none font-medium"
                          placeholder="Specify..."
                        />
                      }
                    />
                  )}

                  <Detail
                    label="Sales Division"
                    isEditing={isEditing}
                    control={
                      <Dropdown
                        usePortal
                        className="w-full"
                        trigger={({ isOpen }) => (
                          <div className="w-full h-full flex items-center justify-between bg-transparent text-sm font-medium outline-none cursor-pointer min-w-0">
                            <span className={`truncate ${editForm.project_type ? "text-foreground" : "text-muted-foreground/50"}`}>
                              {editForm.project_type ? PROJECT_TYPES.find(pt => pt.value === editForm.project_type)?.label : "Select..."}
                            </span>
                          </div>
                        )}
                      >
                        {({ close }) => (
                          <FilterOptionList
                            options={PROJECT_TYPES}
                            value={editForm.project_type}
                            onChange={(val) => setEditForm(f => ({ ...f, project_type: val }))}
                            close={close}
                          />
                        )}
                      </Dropdown>
                    }
                  >
                    <span className="block truncate" title={PROJECT_TYPE_LABELS[opportunity.project_type]}>
                      {PROJECT_TYPE_LABELS[opportunity.project_type]}
                    </span>
                  </Detail>
                  <Detail
                    label="Date Registered"
                    isEditing={isEditing}
                    control={
                      <Dropdown
                        usePortal
                        placement="bottom-start"
                        className="w-full"
                        trigger={({ isOpen }) => (
                          <div className="w-full h-full flex items-center bg-transparent text-sm font-medium outline-none cursor-pointer">
                            <span className={editForm.registration_date ? "text-foreground" : "text-muted-foreground/50"}>
                              {editForm.registration_date || "Select date..."}
                            </span>
                          </div>
                        )}
                      >
                        {({ close }) => (
                          <div className="p-1">
                            <DatePicker
                              selected={editForm.registration_date ? new Date(editForm.registration_date) : null}
                              onChange={(date) => {
                                if (!date) {
                                  setEditForm(f => ({ ...f, registration_date: "" }));
                                } else {
                                  const y = date.getFullYear();
                                  const m = String(date.getMonth() + 1).padStart(2, "0");
                                  const d = String(date.getDate()).padStart(2, "0");
                                  setEditForm(f => ({ ...f, registration_date: `${y}-${m}-${d}` }));
                                }
                                close();
                              }}
                              inline
                            />
                          </div>
                        )}
                      </Dropdown>
                    }
                  >
                    {formatLongDate(opportunity.registration_date)}
                  </Detail>
                  <Detail
                    label="Purchase Date/Order"
                    isEditing={isEditing}
                    control={
                      <Dropdown
                        usePortal
                        placement="bottom-start"
                        className="w-full"
                        trigger={({ isOpen }) => (
                          <div className="w-full h-full flex items-center bg-transparent text-sm font-medium outline-none cursor-pointer">
                            <span className={editForm.expected_award_date ? "text-foreground" : "text-muted-foreground/50"}>
                              {editForm.expected_award_date || "Select date..."}
                            </span>
                          </div>
                        )}
                      >
                        {({ close }) => (
                          <div className="p-1">
                            <DatePicker
                              selected={editForm.expected_award_date ? new Date(editForm.expected_award_date) : null}
                              onChange={(date) => {
                                if (!date) {
                                  setEditForm(f => ({ ...f, expected_award_date: "" }));
                                } else {
                                  const y = date.getFullYear();
                                  const m = String(date.getMonth() + 1).padStart(2, "0");
                                  const d = String(date.getDate()).padStart(2, "0");
                                  setEditForm(f => ({ ...f, expected_award_date: `${y}-${m}-${d}` }));
                                }
                                close();
                              }}
                              inline
                            />
                          </div>
                        )}
                      </Dropdown>
                    }
                  >
                    {formatLongDate(opportunity.expected_award_date)}
                  </Detail>
                  <Detail
                    label="Contact Person"
                    isEditing={isEditing}
                    control={
                      <input
                        type="text"
                        required
                        value={editForm.contact_person}
                        onChange={(e) => setEditForm(f => ({ ...f, contact_person: e.target.value }))}
                        className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none font-medium"
                        placeholder="e.g. Juan Dela Cruz"
                      />
                    }
                  >
                    {opportunity.contact_person}
                  </Detail>

                  {isEditing ? (
                    <div className="flex gap-2 items-stretch col-span-1 sm:col-span-2 md:col-span-1 lg:col-span-2 xl:col-span-1 2xl:col-span-2">
                      <Detail
                        label="Sales Reference"
                        isEditing={true}
                        wrapperClass="flex-1"
                        control={
                          <input
                            type="text"
                            value={editForm.sales_reference}
                            onChange={(e) => setEditForm(f => ({ ...f, sales_reference: e.target.value.toUpperCase() }))}
                            className="w-full bg-transparent text-sm font-mono text-foreground placeholder:text-muted-foreground/50 outline-none font-medium uppercase"
                            placeholder="e.g. S01237"
                          />
                        }
                      />
                      <button
                        type="button"
                        disabled={fetchingOdoo || !editForm.sales_reference}
                        onClick={handleFetchFromOdoo}
                        className="h-full min-h-[66px] px-4 rounded-xl border border-border flex items-center gap-2 text-[13px] font-bold text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all shrink-0"
                      >
                        {fetchingOdoo ? <Spinner size="sm" /> : <Download size={16} />}
                        <span className="hidden sm:inline">Fetch Items</span>
                      </button>
                    </div>
                  ) : (
                    <Detail label="Sales Reference">
                      {opportunity.sales_reference ? (
                        <span className="font-mono">{opportunity.sales_reference}</span>
                      ) : opportunity.status === "LEAD" ? (
                        <span className="text-xs font-medium text-amber-11">Required to qualify</span>
                      ) : null}
                    </Detail>
                  )}
                </div>
              </div>
              {/* Right Box 2: Log Notes */}
              <div className="flex flex-col rounded-xl border border-border/50 p-6 ">
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
                            {n.type === "SYSTEM" && n.metadata?.changes?.length > 0 ? (
                              <ul className="mt-0.5 space-y-0.5">
                                {n.metadata.changes.map((change, idx) => (
                                  <li
                                    key={idx}
                                    className="text-sm text-muted-foreground italic break-words"
                                  >
                                    · {change}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              n.content && (
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
                              )
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
          </div>

          {(items.length > 0 || isEditing) && (
            <div className="rounded-xl border border-border/50 p-6">
              {isEditing ? (
                <OpportunityItemsEditor
                  items={editForm.items || []}
                  onChange={(newItems) => setEditForm(f => ({ ...f, items: newItems }))}
                />
              ) : (
                <>
                  <p className="mb-4 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
                    Product List
                  </p>
                  <ItemsList items={items} />
                </>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
