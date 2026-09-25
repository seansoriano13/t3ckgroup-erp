import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { X } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import TabGroup from "../../ui/TabGroup";
import { opportunityService } from "../../../services/opportunityService";
import { supabase } from "../../../lib/supabase";
import { useAuth } from "../../../context/AuthContext";
import { confirmActionToast } from "../../ui/CustomToast";
import { useFileAttachments } from "../../../hooks/useFileAttachments";
import { useMediaQuery } from "../../../hooks/useMediaQuery";
import { employeeService } from "../../../services/employeeService";
import { odooService } from "../../../services/odooService";
import { quotationService } from "../../../services/quotationService";
import { purchasingService } from "../../../services/purchasingService";
import { salesFlowService } from "../../../services/salesFlowService";
import { flowStageTone } from "../../../constants/salesFlow";
import { openRequests } from "../../../constants/procurement";
import { usePipelineStages } from "../../../hooks/usePipelineStages";
import {
  isLostCode,
  formatPHP,
  isValidSalesReference,
  normalizeSalesReference,
  requiresSalesReference,
  SALES_REFERENCE_HINT,
} from "../../../constants/sor";
import { leadSourceService } from "../../../services/leadSourceService";
import { useOpenedTabs } from "./useSorModalData";
import SorModalHeader from "./SorModalHeader";
import { useCanEditSor } from "../../../hooks/useCanEditSor";
import NowTab from "./NowTab";
import JourneyTab from "./JourneyTab";
import ItemsTab from "./ItemsTab";
import DetailsTab from "./DetailsTab";
import SorChatColumn from "./SorChatColumn";
import { pullOdooLines, saveOdooLines, toRow } from "./odooLines";

function estimatedValueSizeClass(displayText) {
  const len = (displayText || "").length;
  if (len >= 17) return "text-xl lg:text-2xl";
  if (len >= 14) return "text-2xl lg:text-3xl";
  return "text-3xl lg:text-4xl";
}

const TABS = [
  { value: "now", label: "Now" },
  { value: "journey", label: "Journey" },
  { value: "items", label: "Items" },
  { value: "details", label: "Details" },
];

/**
 * The SOR modal shell (#298): header, the four-tab scaffold, the chat
 * column, and previous/next navigation. Now holds the old flat modal's
 * content lifted unchanged (#299 redesigns it); Journey/Items/Details are
 * stubs (#300-#302).
 */
export default function SorModal({
  isOpen,
  onClose,
  opportunity: rawOpportunity,
  opportunityId,
  accessLevel: accessLevelProp,
  lockedSummary: lockedSummaryProp,
  siblingIds,
  onNavigate,
}) {
  const { user } = useAuth();
  const id = rawOpportunity?.id || opportunityId;

  // ADR 0021 / #297: full | participant | locked | none. The register and
  // Board already pass a full-access-only opportunity (RLS filters them out
  // there), so a caller that already knows the level (GlobalDetailManager)
  // can skip this fetch by passing it; anyone else falls back to asking
  // `sor_access_level` directly.
  const { data: fetchedAccessLevel } = useQuery({
    queryKey: ["sorAccessLevel", id],
    queryFn: () => opportunityService.getAccessLevel(id),
    enabled: !!id && isOpen && accessLevelProp == null,
  });
  const accessLevel = accessLevelProp ?? fetchedAccessLevel ?? "full";
  const canEdit = useCanEditSor(id, { enabled: isOpen && accessLevel === "full" });

  // Also doubles as the full/participant "This stage is restricted" flag —
  // see `isRestricted` below and NowTab's banner.
  const { data: fetchedLockedSummary } = useQuery({
    queryKey: ["sorLockedSummary", id],
    queryFn: () => opportunityService.getLockedSummary(id),
    enabled: !!id && isOpen && lockedSummaryProp == null,
  });
  const lockedSummary = lockedSummaryProp ?? fetchedLockedSummary ?? null;
  const isRestricted = !!lockedSummary?.is_restricted;

  const { data: myVisits = [] } = useQuery({
    queryKey: ["sorMyVisits", id],
    queryFn: () => opportunityService.getMyVisits(id),
    enabled: !!id && isOpen && accessLevel === "locked",
  });

  // ADR 0021 / #297: a Participant's Journey tab is gated by the owning
  // flow's `journey_viewers` setting — full access always sees it, so this
  // only needs asking at participant level.
  const { data: canViewJourneyFetched } = useQuery({
    queryKey: ["sorCanViewJourney", id],
    queryFn: () => opportunityService.getCanViewJourney(id),
    enabled: !!id && isOpen && accessLevel === "participant",
  });
  const canViewJourney = accessLevel === "full" ? true : accessLevel === "participant" ? !!canViewJourneyFetched : false;

  // ADR 0021 / Q7: a called-in person is told WHY they can see this deal and
  // HOW FAR that reaches. Without it the access window is invisible to the one
  // person it governs — they cannot tell a Stage they keep from one they are
  // about to lose. Only asked at the two levels that have a window.
  const { data: myWindows = [] } = useQuery({
    queryKey: ["myWindowsOn", id, user?.id],
    queryFn: () => opportunityService.getMyWindowsOn(id, user.id),
    enabled: !!id && isOpen && !!user?.id && (accessLevel === "participant" || accessLevel === "locked"),
  });
  const { stages: allStages } = usePipelineStages({ includeInactive: true });
  const pipelineStages = useMemo(
    () => allStages.filter((s) => s.is_active || s.code === rawOpportunity?.status),
    [allStages, rawOpportunity?.status],
  );
  const stageLabel = useCallback(
    (code) => pipelineStages.find((s) => s.code === code)?.label || code,
    [pipelineStages],
  );
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [noteMentions, setNoteMentions] = useState([]);
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
  const [autoSyncingOdoo, setAutoSyncingOdoo] = useState(false);
  const hasAutoSynced = useRef(new Set());
  const pendingStockRef = useRef(null);
  const [refreshingStock, setRefreshingStock] = useState(false);
  const attachments = useFileAttachments();
  const { files, isUploading } = attachments;
  const fileInputRef = useRef(null);

  const [activeTab, setActiveTab] = useState("now");
  const { markOpened, hasOpened } = useOpenedTabs("now");
  const isWide = useMediaQuery("(min-width: 1100px)");

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
    setActiveTab("now");
  }

  const handleTabChange = (tab) => {
    markOpened(tab);
    setActiveTab(tab);
  };

  const { data: notes = [], isLoading: loadingNotes } = useQuery({
    queryKey: ["opportunityNotes", id],
    queryFn: () => opportunityService.getNotes(id),
    enabled: !!id && isOpen,
  });

  const notesContainerRef = useRef(null);

  useEffect(() => {
    if (!id || !isOpen) return;
    const channel = supabase
      .channel(`opportunity_logs_${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sales_opportunity_logs", filter: `opportunity_id=eq.${id}` },
        () => queryClient.invalidateQueries({ queryKey: ["opportunityNotes", id] }),
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [id, isOpen, queryClient]);

  useEffect(() => {
    if (notesContainerRef.current) {
      notesContainerRef.current.scrollTop = notesContainerRef.current.scrollHeight;
    }
  }, [notes.length, loadingNotes, isOpen]);

  // The Product List is Items' to load (#301), and edit mode's — the form
  // carries the whole list into Save. `handleEditToggle` fetches it before
  // the form opens, so this staying idle until then can't empty the list.
  const { data: items = [], isLoading: itemsLoading } = useQuery({
    queryKey: ["opportunityItems", id, accessLevel],
    queryFn: () =>
      accessLevel === "participant" ? opportunityService.getParticipantItems(id) : opportunityService.getItems(id),
    enabled: !!id && isOpen && accessLevel !== "locked" && (hasOpened("items") || isEditing),
  });

  const { data: checklist = [] } = useQuery({
    queryKey: ["stageChecklist", id, rawOpportunity?.flow_stage_id || rawOpportunity?.status],
    queryFn: () => opportunityService.getStageChecklist(id, rawOpportunity),
    enabled: !!id && isOpen && accessLevel !== "locked",
  });

  const { data: flowCanvas } = useQuery({
    queryKey: ["salesFlow", rawOpportunity?.sale_type_id],
    queryFn: () => salesFlowService.getFlow(rawOpportunity.sale_type_id),
    enabled: !!rawOpportunity?.sale_type_id && isOpen,
  });
  const currentFlowStage = flowCanvas?.stages?.find((s) => s.id === rawOpportunity?.flow_stage_id) || null;
  const currentFlowStageTone = flowCanvas ? flowStageTone(currentFlowStage, flowCanvas.flow, flowCanvas.stages) : "mauve";

  const requiresInclusions = checklist.some((c) => c.condition.kind === "inclusions");
  const requiresPurchasing = checklist.some((c) => c.condition.kind === "purchasing");

  const { data: procurementRequests = [] } = useQuery({
    queryKey: ["procurementRequests", id],
    queryFn: () => purchasingService.listForOpportunity(id),
    enabled: !!id && isOpen && accessLevel !== "locked",
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => employeeService.getAllEmployees(),
    enabled: isOpen,
  });

  // ADR 0021 / #297: `sor_participant_record` carries only ids, not the
  // joined employee objects the register's own select attaches (registrar,
  // deal_owner, closing_sales, support_1, support_2, sales_director) — the
  // tabs below (PeopleRoster, the header) read those objects, not the ids.
  // Resolved from `employees`, which every signed-in caller can already read
  // regardless of SOR access.
  const opportunity = useMemo(() => {
    if (!rawOpportunity) return rawOpportunity;
    if (accessLevel !== "participant") return rawOpportunity;
    const byId = (empId) => employees.find((e) => e.id === empId) || null;
    return {
      ...rawOpportunity,
      registrar: byId(rawOpportunity.registered_by),
      deal_owner: byId(rawOpportunity.deal_owner_id),
      closing_sales: byId(rawOpportunity.closing_sales_id),
      support_1: byId(rawOpportunity.support_sales_1_id),
      support_2: byId(rawOpportunity.support_sales_2_id),
      sales_director: byId(rawOpportunity.sales_director_id),
    };
  }, [rawOpportunity, accessLevel, employees]);

  // ADR 0021 / #295: the SOR chat's mention roster offers only people who
  // can see the current Stage Visit — `sor_visit_audience`, not every
  // employee. A legacy pipeline deal has no Stage Visit to scope by
  // (`currentVisitId` stays null), so its roster is left as the full
  // employee list rather than restricted to nobody.
  const { data: currentVisitId = null } = useQuery({
    queryKey: ["sorCurrentVisitId", id],
    queryFn: () => opportunityService.getCurrentStageVisitId(id),
    enabled: !!id && isOpen,
  });

  const { data: visitAudienceIds = null } = useQuery({
    queryKey: ["sorVisitAudience", id, currentVisitId],
    queryFn: () => opportunityService.getVisitAudienceIds(id, currentVisitId),
    enabled: !!id && !!currentVisitId && isOpen,
  });

  const mentionableEmployees = useMemo(() => {
    if (!currentVisitId) return employees;
    if (!visitAudienceIds) return [];
    const allowed = new Set(visitAudienceIds);
    return employees.filter((e) => allowed.has(e.id));
  }, [employees, currentVisitId, visitAudienceIds]);

  // Only Details shows or edits a Lead Source (#302), so it waits for Details.
  const { data: activeLeadSources = [] } = useQuery({
    queryKey: ["leadSources", "active"],
    queryFn: () => leadSourceService.getActiveLeadSources(),
    enabled: isOpen && hasOpened("details"),
  });

  const { data: automationTasks = { individualTasks: [], groupTasks: [] } } = useQuery({
    queryKey: ["opportunityAutomations", id],
    queryFn: () => opportunityService.getAutomationTasks(id),
    enabled: !!id && isOpen,
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["opportunities"] });
    queryClient.invalidateQueries({ queryKey: ["globalOpportunity", id] });
    queryClient.invalidateQueries({ queryKey: ["opportunityNotes", id] });
    queryClient.invalidateQueries({ queryKey: ["opportunityItems", id] });
    // Every opened tab's own query lives under this prefix (useSorModalData).
    // A tab never opened stays `enabled: false`, so this can't wake a fetch
    // the reader hasn't asked for.
    queryClient.invalidateQueries({ queryKey: ["sorModalTab"] });
    queryClient.invalidateQueries({ queryKey: ["superAdminActivityLog"] });
    queryClient.invalidateQueries({ queryKey: ["commissionBreakdown", id] });
    queryClient.invalidateQueries({ queryKey: ["opportunityAutomations", id] });
    queryClient.invalidateQueries({ queryKey: ["stageChecklist", id] });
  }, [queryClient, id]);

  const handleMentionClick = (person) => {
    if (!person?.name) return;
    // ADR 0021 / #295: clicking a past author's name to mention them is the
    // same mention surface as typing `@` — it must not offer someone the
    // roster itself would not, e.g. a Participant whose window has since
    // closed. Only enforced once the audience is known (`currentVisitId` set
    // and `visitAudienceIds` loaded); a legacy deal with no Stage Visit is
    // left unrestricted, same as the roster above.
    if (currentVisitId && visitAudienceIds && person.id && !visitAudienceIds.includes(person.id)) {
      return;
    }
    const name = person.name;
    const mentionTag = `@${name}`;
    setNote((prev) => {
      const trimmed = prev.trimEnd();
      if (!trimmed) return `${mentionTag} `;
      if (trimmed.includes(mentionTag)) return `${prev} `;
      return `${trimmed} ${mentionTag} `;
    });
    if (person.id) {
      setNoteMentions((prev) => (prev.some((m) => m.id === person.id || m.name === name) ? prev : [...prev, person]));
    } else {
      const matched = mentionableEmployees.find((e) => e.name === name);
      if (matched) {
        setNoteMentions((prev) => (prev.some((m) => m.id === matched.id || m.name === matched.name) ? prev : [...prev, matched]));
      }
    }
  };

  const addNoteMutation = useMutation({
    mutationFn: ({ content, attachments: uploaded, mentions }) =>
      opportunityService.addNote(id, user?.id, content, uploaded, mentions),
    onSuccess: () => {
      setNote("");
      setNoteMentions([]);
      attachments.clear();
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: (data) => opportunityService.updateOpportunity(id, data, user?.id),
    onSuccess: async () => {
      setIsEditing(false);
      setEditForm({});
      if (pendingStockRef.current) {
        const stock = pendingStockRef.current;
        pendingStockRef.current = null;
        try {
          await opportunityService.saveStockSnapshot(id, stock, user?.id);
        } catch (err) {
          console.error("Could not save Odoo stock snapshot", err);
        }
      }
      invalidate();
      toast.success("Opportunity updated.");
    },
    onError: (err) => toast.error(err.message),
  });

  const stageMutation = useMutation({
    mutationFn: ({ next, reason, salesReference }) => opportunityService.updateStatus(id, next, user?.id, reason, salesReference),
    onSuccess: (data, variables) => {
      setPendingStage("");
      setLostReason("");
      setSalesRef("");
      invalidate();
      toast.success("Stage updated.");
      if (data?.failedStageActions?.length > 0) {
        toast(`Moved, but these automations failed — create them by hand: ${data.failedStageActions.join(", ")}.`, { icon: "⚠️", duration: 8000 });
      }
      const isLeavingLead = opportunity?.status === "LEAD" && variables?.next !== "LEAD";
      if (isLeavingLead) {
        const isStrategic = opportunity?.project_type === "STRATEGIC";
        const missing = [];
        if (!opportunity?.deal_owner_id && !opportunity?.deal_owner?.id) missing.push(isStrategic ? "Deal Owner / Originator" : "Deal Owner");
        if (isStrategic && !opportunity?.closing_sales_id && !opportunity?.closing_sales?.id) missing.push("Closing Salesperson");
        if (!opportunity?.sales_director_id && !opportunity?.sales_director?.id) missing.push("Sales Director");
        if (missing.length > 0) {
          toast(`Advisory: Deal is missing ${missing.join(", ")} — commission shares will remain unattributed until filled.`, { icon: "⚠️", duration: 6000 });
        }
      }
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
    setShareUrl(null);
  }, [opportunity?.id, opportunity?.sales_reference]);

  useEffect(() => {
    if (!isOpen || !opportunity?.sales_reference || !id) return;
    const ref = normalizeSalesReference(opportunity.sales_reference);
    if (!isValidSalesReference(ref)) return;
    if (hasAutoSynced.current.has(ref)) return;

    let isMounted = true;
    const syncOdoo = async () => {
      hasAutoSynced.current.add(ref);
      setAutoSyncingOdoo(true);
      try {
        const { problem, rows, stock } = await pullOdooLines(ref);
        if (!problem && isMounted) {
          await saveOdooLines({ opportunity, rows, stock, actorId: user?.id });
          invalidate();
        }
      } catch (err) {
        console.error("Auto-sync Odoo failed", err);
      } finally {
        if (isMounted) setAutoSyncingOdoo(false);
      }
    };
    syncOdoo();
    return () => {
      isMounted = false;
    };
  }, [isOpen, id, opportunity, user?.id, invalidate]);

  // ←/→ step to siblingIds' neighbour, skipped while a text field is focused
  // so it doesn't fight with normal cursor movement while typing.
  useEffect(() => {
    if (!isOpen || !siblingIds?.length || !onNavigate) return;
    const handleKeyDown = (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      // Anything that owns its own arrow keys (fields, selects, tabs, menus, the stage ribbon) keeps them.
      const el = document.activeElement;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      if (el?.closest?.('[role="tab"],[role="tablist"],[role="menu"],[role="menuitem"],[role="listbox"],[role="option"],[role="slider"],[data-stage-ribbon]')) return;
      const index = siblingIds.indexOf(id);
      if (index === -1) return;
      const nextIndex = e.key === "ArrowLeft" ? index - 1 : index + 1;
      if (nextIndex < 0 || nextIndex >= siblingIds.length) return;
      onNavigate(siblingIds[nextIndex]);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, siblingIds, onNavigate, id]);

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
    addNoteMutation.mutate({ content, attachments: uploaded, mentions: noteMentions });
  };

  const executeOdooFetch = async (ref) => {
    setFetchingOdoo(true);
    try {
      const { problem, rows, stock, quotation } = await pullOdooLines(ref);
      if (problem) {
        toast.error(problem);
        return;
      }
      setEditForm((f) => ({ ...f, items: rows }));
      pendingStockRef.current = stock;
      toast.success(`Pulled ${rows.length} item(s) from ${quotation}.`);
    } catch (err) {
      toast.error(err.message || "Could not reach Odoo — enter items manually.");
    } finally {
      setFetchingOdoo(false);
    }
  };

  const handleRefreshStock = async () => {
    const productIds = items.map((it) => it.odoo_product_id).filter((pid) => Number.isInteger(pid));
    if (!productIds.length) {
      toast.error("No Odoo-linked products on this Product List to check.");
      return;
    }
    setRefreshingStock(true);
    try {
      const result = await odooService.fetchStock(productIds);
      if (!result?.success) {
        toast.error(result?.message || "Could not refresh stock from Odoo.");
        return;
      }
      await opportunityService.saveStockSnapshot(id, result.stock, user?.id);
      invalidate();
      toast.success("Stock refreshed.");
    } catch (err) {
      toast.error(err.message || "Could not reach Odoo to refresh stock.");
    } finally {
      setRefreshingStock(false);
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
        () => executeOdooFetch(ref),
      );
    } else {
      executeOdooFetch(ref);
    }
  };

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
    const tab = window.open("about:blank", "_blank");
    setBuildingLink(true);
    try {
      const url = await ensureShareLink();
      if (!url) {
        tab?.close();
        return;
      }
      if (tab) {
        tab.opener = null;
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
        toast.error(`Copy failed. Link: ${url}`, { duration: 15000 });
      }
    } catch (err) {
      toast.error(err.message || "Could not reach Odoo.");
    } finally {
      setBuildingLink(false);
    }
  };

  const handleDownloadQuotation = async () => {
    if (downloadStep) return;
    setDownloadStep("Starting…");
    try {
      const { blob, filename, warnings, notices, documentCount } = await quotationService.buildQuotationPdf(opportunity.sales_reference, {
        onProgress: ({ current, total, label }) => setDownloadStep(total ? `${current}/${total} — ${label}` : label),
        requestedByEmail: user?.email,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      if (warnings.length) {
        toast.error(`Downloaded without ${warnings.length} brochure(s): ${warnings.join("; ")}`, { duration: 15000 });
      } else {
        toast.success(`${filename} — quotation plus ${documentCount} brochure(s).`);
      }
      if (notices.length) toast(notices.join(" "), { duration: 12000 });
    } catch (err) {
      toast.error(err.message || "Could not build the quotation PDF.");
    } finally {
      setDownloadStep(null);
    }
  };

  const handleEditToggle = async () => {
    if (isEditing) {
      setIsEditing(false);
      setEditForm({});
      return;
    }
    // Fresh, not whatever is cached: Save writes this list back whole, and the
    // Items tab may never have been opened — or Odoo's auto-sync may have
    // replaced the list since it was. Opening the form before this resolves
    // is what used to let an early Save store an empty Product List.
    let current;
    try {
      current = await queryClient.fetchQuery({
        queryKey: ["opportunityItems", id],
        queryFn: () => opportunityService.getItems(id),
      });
    } catch (err) {
      toast.error(err.message || "Could not load the Product List to edit.");
      return;
    }
    setIsEditing(true);
    setEditForm({
      project_title: opportunity.project_title || "",
      client_name: opportunity.client_name || "",
      lead_source: opportunity.lead_source || "",
      lead_source_detail: opportunity.lead_source_detail || "",
      project_type: opportunity.project_type || "SSP",
      registration_date: opportunity.registration_date || "",
      expected_award_date: opportunity.expected_award_date || "",
      po_date: opportunity.po_date || "",
      contact_person: opportunity.contact_person || "",
      sales_reference: opportunity.sales_reference || "",
      deal_owner_id: opportunity.deal_owner_id || "",
      closing_sales_id: opportunity.closing_sales_id || "",
      sales_director_id: opportunity.sales_director_id || "",
      support_sales_1_id: opportunity.support_sales_1_id || "",
      support_sales_2_id: opportunity.support_sales_2_id || "",
      items: current.map(toRow),
    });
  };

  // ADR 0021 / #297: a locked viewer gets the summary plus their own past
  // visits, nothing else — no tabs, no chat, no edit. Returned here, after
  // every hook above has run unconditionally, so the branch never changes
  // this component's hook order.
  if (!id) return null;
  if (accessLevel === "locked") {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          showCloseButton={false}
          className="flex w-full max-w-[95vw] flex-col gap-0 overflow-hidden rounded-2xl p-0 md:max-w-[560px]"
        >
          <div className="flex items-start justify-between gap-4 border-b border-border/60 px-6 py-4">
            <div className="min-w-0">
              {lockedSummary?.sales_reference && (
                <p className="truncate font-mono text-xs font-bold text-primary">{lockedSummary.sales_reference}</p>
              )}
              <h2 className="truncate text-lg font-black text-foreground">{lockedSummary?.project_title || "This SOR"}</h2>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              className="shrink-0 text-muted-foreground"
            >
              <X size={15} />
            </Button>
          </div>

          <div className="space-y-5 overflow-y-auto p-6">
            {isRestricted && (
              <div className="rounded-xl border border-amber-400/40 bg-amber-500/5 px-3 py-2.5 text-[13px] font-semibold text-amber-11">
                This stage is restricted.
              </div>
            )}

            <div>
              <p className="mb-1 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">Current Stage</p>
              <p className="text-sm font-semibold text-foreground">{lockedSummary?.current_stage_name || "—"}</p>
            </div>

            <div>
              <p className="mb-2 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">Your visits</p>
              {myVisits.length === 0 ? (
                <p className="text-sm text-muted-foreground/70">No visits recorded.</p>
              ) : (
                <ul className="space-y-2">
                  {myVisits.map((v) => (
                    <li
                      key={v.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm"
                    >
                      <span className="font-medium text-foreground">{v.flow_stages?.name || "Stage"}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {v.entered_at ? new Date(v.entered_at).toLocaleDateString() : ""}
                        {v.left_at ? ` – ${new Date(v.left_at).toLocaleDateString()}` : " – present"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!opportunity) return null;

  // ADR 0021 / #297: only a full-access caller may move the Stage — a
  // Participant never could (`sor_guard_stage_move` requires 'full'), and a
  // full-access caller shut out of the current Stage by a Restricted Stage
  // is refused by the same guard even though their access level stays
  // 'full'. Both are surfaced here rather than left to a server error.
  const moveDisabled = accessLevel !== "full" || isRestricted;

  const editItemsSum = (editForm.items || []).reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0);
  const estimatedValueDisplay = isEditing ? formatPHP(editItemsSum) : formatPHP(opportunity.expected_value);
  const estimatedValueSize = estimatedValueSizeClass(estimatedValueDisplay);

  const isLostPending = isLostCode(pendingStage);
  const needsSalesRef = !!pendingStage && requiresSalesReference(opportunity.status, pendingStage) && !opportunity.sales_reference;
  const salesRefValid = isValidSalesReference(salesRef);

  const handleSaveField = async (column, value) => {
    await opportunityService.saveRecordField(id, column, value, user?.id);
    invalidate();
  };

  const handleStageChange = (next) => {
    if (moveDisabled) return;
    if (!next || next === opportunity.status) return;
    if (isLostCode(next) || (requiresSalesReference(opportunity.status, next) && !opportunity.sales_reference)) {
      setPendingStage(next);
      // The confirm step lives on Now — bring it into view, wherever the Move was started.
      handleTabChange("now");
      return;
    }
    const stillOpen = openRequests(procurementRequests);
    if (stillOpen.length && !isLostCode(next)) {
      confirmActionToast(
        "Purchasing hasn't answered yet",
        `${stillOpen.length} product${stillOpen.length === 1 ? " is" : "s are"} still with purchasing. Moving to ${stageLabel(next)} means quoting ${
          stillOpen.length === 1 ? "it" : "them"
        } before anyone has confirmed ${stillOpen.length === 1 ? "it" : "they"} can be sourced.`,
        "Move anyway",
        "warning",
        () => stageMutation.mutate({ next, reason: null, salesReference: null }),
      );
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
  const isFlowDeal = Boolean(opportunity.sale_type_id);

  const siblingIndex = siblingIds?.indexOf(id) ?? -1;
  const hasPrev = siblingIndex > 0;
  const hasNext = siblingIndex !== -1 && siblingIndex < (siblingIds?.length ?? 0) - 1;
  const goPrev = () => hasPrev && onNavigate(siblingIds[siblingIndex - 1]);
  const goNext = () => hasNext && onNavigate(siblingIds[siblingIndex + 1]);

  const tabCtx = {
    opportunity,
    id,
    accessLevel,
    isRestricted,
    user,
    isEditing,
    editForm,
    setEditForm,
    employees,
    activeLeadSources,
    checklist,
    requiresInclusions,
    requiresPurchasing,
    automationTasks,
    invalidate,
    handleSaveField,
    isLostPending,
    lostReason,
    setLostReason,
    needsSalesRef,
    salesRef,
    setSalesRef,
    salesRefValid,
    pendingStage,
    stageLabel,
    cancelPendingStage,
    stageMutation,
    estimatedValueDisplay,
    estimatedValueSize,
    buildingLink,
    handlePreviewQuotation,
    handleCopyQuotationLink,
    downloadStep,
    handleDownloadQuotation,
    fetchingOdoo,
    handleFetchFromOdoo,
    items,
    itemsLoading,
    isExpanded,
    autoSyncingOdoo,
    handleRefreshStock,
    refreshingStock,
    onClose,
  };

  const chatColumn = (
    <SorChatColumn
      notes={notes}
      loadingNotes={loadingNotes}
      notesContainerRef={notesContainerRef}
      handleMentionClick={handleMentionClick}
      note={note}
      setNote={setNote}
      noteMentions={noteMentions}
      setNoteMentions={setNoteMentions}
      employees={mentionableEmployees}
      attachments={attachments}
      fileInputRef={fileInputRef}
      isPosting={isPosting}
      handlePostNote={handlePostNote}
    />
  );

  // ADR 0021 / #297: a Participant shut out of Journey by the flow's
  // journey_viewers setting gets no Journey tab at all — not one that opens
  // to nothing.
  const visibleTabs = canViewJourney ? TABS : TABS.filter((t) => t.value !== "journey");
  const tabsWithChat = isWide ? visibleTabs : [...visibleTabs, { value: "chat", label: "Chat" }];

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open, details) => {
        if (open) return;
        // In edit mode Esc backs out of the edit (unsaved fields dropped) instead of closing the whole record.
        if (isEditing && details?.reason === "escape-key") {
          details.cancel?.();
          handleEditToggle();
          return;
        }
        onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        style={isExpanded ? { width: "100vw", height: "100vh" } : undefined}
        className={cn(
          "flex flex-col gap-0 overflow-hidden p-0 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.22)] outline-none transition-all duration-300",
          isExpanded ? "!max-w-none !max-h-none !rounded-none !border-0" : "w-full max-w-[95vw] md:max-w-[1200px] max-h-[90vh] rounded-2xl",
        )}
      >
        <SorModalHeader
          opportunity={opportunity}
          isEditing={isEditing}
          editForm={editForm}
          setEditForm={setEditForm}
          handleEditToggle={handleEditToggle}
          updateMutation={updateMutation}
          deleteMutation={deleteMutation}
          isExpanded={isExpanded}
          setIsExpanded={setIsExpanded}
          onClose={onClose}
          isFlowDeal={isFlowDeal}
          flowCanvas={flowCanvas}
          currentFlowStage={currentFlowStage}
          currentFlowStageTone={currentFlowStageTone}
          pipelineStages={pipelineStages}
          stageMutation={stageMutation}
          handleStageChange={handleStageChange}
          checklist={checklist}
          isOpen={isOpen}
          hasPrev={hasPrev}
          hasNext={hasNext}
          onPrev={goPrev}
          onNext={goNext}
          canEdit={canEdit}
          moveDisabled={moveDisabled}
          moveDisabledReason={
            isRestricted
              ? "This stage is restricted, so the deal can't be moved from here."
              : "You can view this deal's stages but not move it. Ask the deal owner or a manager to move it."
          }
        />

        {myWindows.length > 0 && (
          <div className="shrink-0 border-b border-border/60 bg-violet-a2 px-6 py-2">
            <ul className="space-y-0.5">
              {myWindows.map((w) => (
                <li key={w.id} className="text-xs leading-relaxed text-violet-11">
                  Called in at{" "}
                  <span className="font-bold">{w.calledInAtStageName || "this deal"}</span> — you see{" "}
                  {w.reachLabel}
                  {w.closedAt ? ". This window has closed." : "."}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 border-b border-border/60 px-6 pt-3">
              <TabGroup tabs={tabsWithChat} activeTab={activeTab} onChange={handleTabChange} variant="underline" />
            </div>
            {/*
              Each opened tab stays mounted and is hidden rather than
              unmounted, so a half-typed Stage Field survives a look at the
              Journey (#207's default decision). Items scrolls inside itself
              — its sticky header has to outlive a 157-line list — so the
              panel area clips and each tab owns its own scroll.
            */}
            <div className="min-h-0 flex-1 overflow-hidden">
              <div className={activeTab === "now" ? "h-full overflow-y-auto" : "hidden"}>
                <NowTab ctx={tabCtx} />
              </div>
              {canViewJourney && hasOpened("journey") && (
                <div className={activeTab === "journey" ? "h-full overflow-y-auto" : "hidden"}>
                  <JourneyTab opportunityId={id} hasOpened={hasOpened} onGoToNow={() => handleTabChange("now")} />
                </div>
              )}
              {hasOpened("items") && (
                <div className={activeTab === "items" ? "h-full" : "hidden"}>
                  <ItemsTab ctx={tabCtx} hasOpened={hasOpened} />
                </div>
              )}
              {hasOpened("details") && (
                <div className={activeTab === "details" ? "h-full overflow-y-auto" : "hidden"}>
                  <DetailsTab ctx={tabCtx} />
                </div>
              )}
              {!isWide && activeTab === "chat" && <div className="h-full">{chatColumn}</div>}
            </div>
          </div>

          {isWide && <div className="w-[340px] shrink-0 border-l border-border/60">{chatColumn}</div>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
