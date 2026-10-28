import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Dialog } from "@/components/ui/dialog";
import { RecordModalContent } from "@/components/ui/record-modal";
import { opportunityService } from "../../../services/opportunityService";
import { supabase } from "../../../lib/supabase";
import { useAuth } from "../../../context/AuthContext";
import { usePagedChat } from "../../../hooks/usePagedChat";
import { confirmActionToast } from "../../ui/CustomToast";
import { useFileAttachments } from "../../../hooks/useFileAttachments";
import { useMediaQuery } from "../../../hooks/useMediaQuery";
import { employeeService } from "../../../services/employeeService";
import { odooService } from "../../../services/odooService";
import { quotationService } from "../../../services/quotationService";
import { salesFlowService } from "../../../services/salesFlowService";
import { stageFieldService } from "../../../services/stageFieldService";
import { missingStageFields } from "../../../constants/stageGate";
import { flowStageTone } from "../../../constants/salesFlow";
import { usePipelineStages } from "../../../hooks/usePipelineStages";
import {
  isJudgedByStageCode,
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
import LockedSorSlideOver from "../LockedSorSlideOver";
import NoAccessSorSlideOver from "../NoAccessSorSlideOver";
import { hiddenVisits } from "../../../utils/sorHiddenVisits";
import { liveMentionIds, mentionWindowHint } from "../../../utils/mentionWindowHint";
import { useReturnPrompt } from "../useReturnPrompt";
import { useReturnStageIds } from "../useReturnStageIds";
import { useCanEditSor } from "../../../hooks/useCanEditSor";
import SorChatColumn from "./SorChatColumn";
import { pullOdooLines, saveOdooLines, toRow } from "./odooLines";
import SummaryLayout from "./summary/SummaryLayout";

// REMOVE-BEFORE-PROD (ADR 0028): the layout prototype is build-gated. The env
// check sits in the same expression as the import() so Vite folds it to
// `null` and drops the whole ./prototype folder from a production bundle.
const PrototypeShell =
  import.meta.env.VITE_APP_ENV === "staging" || import.meta.env.VITE_APP_ENV === "local"
    ? lazy(() => import("./prototype/PrototypeShell"))
    : null;

function estimatedValueSizeClass(displayText) {
  const len = (displayText || "").length;
  if (len >= 17) return "text-xl lg:text-2xl";
  if (len >= 14) return "text-2xl lg:text-3xl";
  return "text-3xl lg:text-4xl";
}

/**
 * The SOR modal shell (#298): every query, mutation and handler, handed to
 * the Summary layout (./summary) that renders it.
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
  initialView = null,
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

  const { data: accessContact = null } = useQuery({
    queryKey: ["sorAccessContact", id],
    queryFn: () => opportunityService.getAccessContact(id),
    enabled: !!id && isOpen && accessLevel === "none",
  });

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
  const { data: myMentionWindows = [] } = useQuery({
    queryKey: ["myMentionWindowsOn", id, user?.id],
    queryFn: () => opportunityService.getMyMentionWindowsOn(id, user.id),
    enabled: !!id && isOpen && !!user?.id && accessLevel === "participant",
  });
  // #475: the visits this viewer cannot read, marked in the timeline rather
  // than left as a silent gap.
  const { data: visitVisibility } = useQuery({
    queryKey: ["sorVisitVisibility", id],
    queryFn: () => opportunityService.getVisitVisibility(id),
    enabled: !!id && isOpen && (accessLevel === "full" || accessLevel === "participant"),
  });
  const hiddenStageVisits = useMemo(
    () => (visitVisibility ? hiddenVisits(visitVisibility.visits, visitVisibility.visibleIds, accessLevel) : []),
    [visitVisibility, accessLevel],
  );
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
  // #476: who the note being written would open a Mention Window for, so the
  // writer sees the consequence before posting. Only names still in the text.
  const liveMentions = useMemo(() => liveMentionIds(noteMentions, note, user?.id), [noteMentions, note, user?.id]);
  const { data: mentionWindowIds = [] } = useQuery({
    queryKey: ["sorMentionWindowCandidates", id, [...liveMentions].sort().join(",")],
    queryFn: () => opportunityService.getMentionWindowCandidates(id, liveMentions),
    enabled: !!id && isOpen && liveMentions.length > 0 && (accessLevel === "full" || accessLevel === "participant"),
    staleTime: 30_000,
  });
  const mentionAccessHint = useMemo(
    () => mentionWindowHint(noteMentions, mentionWindowIds, { hasVisits: !!visitVisibility?.visits?.length }),
    [noteMentions, mentionWindowIds, visitVisibility],
  );
  // #477: who this SOR has been shared with by Mention, for the Deal Team.
  const { data: mentionShares = [] } = useQuery({
    queryKey: ["sorMentionShares", id],
    queryFn: () => opportunityService.getMentionShares(id),
    enabled: !!id && isOpen && accessLevel === "full",
  });
  const [pendingStage, setPendingStage] = useState("");
  const [lostReason, setLostReason] = useState("");
  const [salesRef, setSalesRef] = useState("");

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

  const [, setActiveTab] = useState("now");
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

    setIsEditing(false);
    setEditForm({});
    attachments.clear();
    setActiveTab("now");
  }

  const handleTabChange = (tab) => {
    markOpened(tab);
    setActiveTab(tab);
  };

  // Pages newest-first. The key extends ["opportunityNotes", id] so the many
  // invalidations of that prefix still refresh it, but stays distinct from the
  // whole-list query the checklist's file picker keeps under the bare key.
  const notesChat = usePagedChat({
    queryKey: ["opportunityNotes", id, "chat"],
    fetchPage: ({ before, limit }) => opportunityService.getNotesPage(id, { before, limit }),
    enabled: !!id && isOpen,
  });
  const notes = notesChat.messages;
  const loadingNotes = notesChat.isLoading;

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

  // A mention is an invitation (it grants read-only access to the record), so
  // the SOR chat's roster offers every employee, on any SOR.
  const { data: currentVisitId = null } = useQuery({
    queryKey: ["sorCurrentVisitId", id],
    queryFn: () => opportunityService.getCurrentStageVisitId(id),
    enabled: !!id && isOpen,
  });

  // Still needed to refuse assigning a task to someone outside the audience.
  const { data: visitAudienceIds = null } = useQuery({
    queryKey: ["sorVisitAudience", id, currentVisitId],
    queryFn: () => opportunityService.getVisitAudienceIds(id, currentVisitId),
    enabled: !!id && !!currentVisitId && isOpen,
  });

  const mentionableEmployees = employees;

  // A Legacy Pipeline deal with no version on record (#414) moves by stage
  // code, as SORs always did: its live flow Stage's gate never applies to it.
  const runsFlow = Boolean(rawOpportunity) && !isJudgedByStageCode(rawOpportunity);

  // Issue #407 — the header's "Clear to move"/"Blocked" badge (and the
  // "Can't move on yet" message under the ribbon) used to be judged on
  // `checklist` alone, i.e. Stage Conditions. A Stage Field is also part of
  // the same Stage Gate (`assertStageGateSatisfied` refuses the move for
  // either), so a required, empty Stage Field read as "clear" right up until
  // the move itself came back refused. Fetched here, not just inside Now's
  // Stage Fields form, so the header can name it before the click.
  const { data: stageFields = [] } = useQuery({
    queryKey: ["stageFields", rawOpportunity?.flow_stage_id],
    queryFn: () => stageFieldService.getForStage(rawOpportunity.flow_stage_id),
    enabled: runsFlow && !!rawOpportunity?.flow_stage_id && isOpen,
  });

  const { data: currentVisitFieldValues = {} } = useQuery({
    queryKey: ["stageFieldValues", currentVisitId],
    queryFn: () => stageFieldService.getValuesForVisit(currentVisitId),
    enabled: !!currentVisitId && isOpen,
  });

  const missingRequiredStageFields = useMemo(
    () =>
      missingStageFields(runsFlow ? stageFields : [], {
        opportunity: rawOpportunity || {},
        visitValues: currentVisitFieldValues,
      }),
    [runsFlow, stageFields, rawOpportunity, currentVisitFieldValues],
  );

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
    // #406 — the register page (src/pages/sors/index.jsx) falls back to a
    // query keyed `["opportunity", id]` for a selected SOR its list query
    // doesn't carry (a Scratch SOR, or any other id outside the loaded
    // register page). Without this, a ribbon move refetched everything
    // above but left that fallback's cached row stale, so the modal kept
    // showing the old stage until a reload.
    queryClient.invalidateQueries({ queryKey: ["opportunity", id] });
    queryClient.invalidateQueries({ queryKey: ["opportunityNotes", id] });
    queryClient.invalidateQueries({ queryKey: ["opportunityItems", id] });
    // Every opened tab's own query lives under this prefix (useSorModalData).
    // A tab never opened stays `enabled: false`, so this can't wake a fetch
    // the reader hasn't asked for.
    queryClient.invalidateQueries({ queryKey: ["sorModalTab"] });
    queryClient.invalidateQueries({ queryKey: ["sorCanEdit"] });
    queryClient.invalidateQueries({ queryKey: ["superAdminActivityLog"] });
    queryClient.invalidateQueries({ queryKey: ["commissionBreakdown", id] });
    queryClient.invalidateQueries({ queryKey: ["opportunityAutomations", id] });
    queryClient.invalidateQueries({ queryKey: ["stageChecklist", id] });
    // A move can hold, resume or cancel the Stage's tasks; the Activity task
    // cards (#399) read each task's live status under these keys.
    queryClient.invalidateQueries({ queryKey: ["globalTask"] });
    queryClient.invalidateQueries({ queryKey: ["globalGroupTask"] });
    // These are keyed by Stage, so a Return to a Stage would otherwise reuse
    // the earlier visit's cached id: the Now tab listed no tasks (it filters
    // by visit), Revert hid itself, and files stamped the old visit.
    queryClient.invalidateQueries({ queryKey: ["revertVisits", id] });
    queryClient.invalidateQueries({ queryKey: ["stageVisitId", id] });
    queryClient.invalidateQueries({ queryKey: ["currentStageVisit", id] });
    queryClient.invalidateQueries({ queryKey: ["followUpStatus", id] });
    // #310: the Now card, Items statuses and Journey read the Purchase Request.
    queryClient.invalidateQueries({ queryKey: ["sor-purchase-request", id] });
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
    mutationFn: ({ next, reason, salesReference, returnChoice }) => opportunityService.updateStatus(id, next, user?.id, { lostReason: reason, salesReference, returnChoice }),
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

  // Issue #390 — every stage control in the modal (the header, and the staging
  // layouts) moves through this, so a Return always reaches the prompt.
  const returnPrompt = useReturnPrompt({
    opportunity: rawOpportunity,
    stages: flowCanvas?.stages,
    enabled: runsFlow,
    move: stageMutation.mutate,
  });
  const stageMover = { ...stageMutation, mutate: returnPrompt.request };
  // A Return is never blocked by the Stage being left, so a stage control
  // leaves these destinations open even while the current Stage is blocked.
  const returnStageIds = useReturnStageIds(rawOpportunity, runsFlow && isOpen);

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
          await saveOdooLines({ opportunity, rows, stock, actorId: user?.id, automatic: true });
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
      date_of_award: opportunity.date_of_award || "",
      date_of_pdi: opportunity.date_of_pdi || "",
      date_of_delivery: opportunity.date_of_delivery || "",
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
  if (accessLevel === "none") {
    return <NoAccessSorSlideOver isOpen={isOpen} onClose={onClose} contact={accessContact} />;
  }
  if (accessLevel === "locked") {
    return <LockedSorSlideOver isOpen={isOpen} onClose={onClose} lockedSummary={lockedSummary} myVisits={myVisits} />;
  }

  if (!opportunity) return null;

  // ADR 0021 / #297: only a full-access caller may move the Stage — a
  // Participant never could (`sor_guard_stage_move` requires 'full'), and a
  // full-access caller shut out of the current Stage by a Restricted Stage
  // is refused by the same guard even though their access level stays
  // 'full'. Both are surfaced here rather than left to a server error.
  const moveDisabled = accessLevel !== "full" || isRestricted;

  const editItemsSum = (editForm.items || []).reduce((sum, it) => (it.removed_from_s0 ? sum : sum + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0)), 0);
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
    stageMutation.mutate({ next, reason: null, salesReference: null });
  };

  const cancelPendingStage = () => {
    setPendingStage("");
    setLostReason("");
    setSalesRef("");
  };

  const isPosting = isUploading || addNoteMutation.isPending;
  // So it gets the pipeline ribbon, not the flow's.
  const isFlowDeal = runsFlow;

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
    autoSyncingOdoo,
    handleRefreshStock,
    refreshingStock,
    onClose,
  };

  const headerProps = {
    opportunity,
    isEditing,
    editForm,
    setEditForm,
    handleEditToggle,
    updateMutation,
    deleteMutation,
    onClose,
    isFlowDeal,
    flowCanvas,
    currentFlowStage,
    currentFlowStageTone,
    pipelineStages,
    stageMutation: stageMover,
    returnStageIds,
    handleStageChange,
    checklist,
    missingRequiredStageFields,
    isOpen,
    hasPrev,
    hasNext,
    onPrev: goPrev,
    onNext: goNext,
    canEdit,
    moveDisabled,
    moveDisabledReason: isRestricted
              ? "This stage is restricted, so the deal can't be moved from here."
              : "You can view this deal's stages but not move it. Ask the deal owner or a manager to move it.",
  };

  const chatColumn = (
    <SorChatColumn
      notes={notes}
      hiddenVisits={hiddenStageVisits}
      loadingNotes={loadingNotes}
      currentUserId={user?.id}
      hasMoreNotes={notesChat.hasMore}
      isFetchingMoreNotes={notesChat.isFetchingMore}
      onLoadMoreNotes={notesChat.loadMore}
      handleMentionClick={handleMentionClick}
      note={note}
      setNote={setNote}
      noteMentions={noteMentions}
      setNoteMentions={setNoteMentions}
      mentionAccessHint={mentionAccessHint}
      employees={mentionableEmployees}
      attachments={attachments}
      fileInputRef={fileInputRef}
      isPosting={isPosting}
      handlePostNote={handlePostNote}
    />
  );

  // #475: a Mention Window says who opened it and when it ends.
  const windowsBanner = (myWindows.length > 0 || myMentionWindows.length > 0) && (
      <div className="shrink-0 border-b border-border/60 bg-violet-a2 px-6 py-2">
        <ul className="space-y-0.5">
          {myMentionWindows.map((m) => (
            <li key={m.id} className="text-xs leading-relaxed text-violet-11">
              {!m.hasVisit ? (
                <>
                  <span className="font-bold">{m.mentionedBy || "Someone"}</span> mentioned you. You see this SOR, read-only.
                </>
              ) : m.closed ? (
                <>
                  <span className="font-bold">{m.mentionedBy || "Someone"}</span> mentioned you at{" "}
                  <span className="font-bold">{m.stageName || "an earlier Stage"}</span>. That Stage has moved on.
                </>
              ) : (
                <>
                  You're viewing <span className="font-bold">{m.stageName || "this Stage"}</span> because{" "}
                  <span className="font-bold">{m.mentionedBy || "someone"}</span> mentioned you. Other Stages are hidden;
                  this ends when the Stage moves.
                </>
              )}
            </li>
          ))}
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
  );

  // Everything the layout renders.
  const layoutProps = {
    ...headerProps,
    headerProps,
    id,
    ctx: tabCtx,
    chatColumn,
    windowsBanner,
    mentionShares,
    notes,
    canViewJourney,
    initialView,
    isWide,
    hasOpened,
    markOpened,
    isRestricted,
    moveDisabledReason: headerProps.moveDisabledReason,
    goPrev,
    goNext,
    // Composer pieces, for layouts that place the note box themselves ("Thread").
    loadingNotes,
    note,
    setNote,
    noteMentions,
    setNoteMentions,
    mentionableEmployees,
    attachments,
    fileInputRef,
    isPosting,
    handlePostNote,
    handleMentionClick,
    openFlowVersion: (snapshotId) => {
      const stage = opportunity.flow_stage_id;
      window.open(`/flow-versions/${snapshotId}${stage ? `?stage=${encodeURIComponent(stage)}` : ""}`, "_blank", "noopener");
    },
  };

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
      <RecordModalContent
        showCloseButton={false}
        className="flex flex-col shadow-[0_12px_40px_-12px_rgba(0,0,0,0.22)]"
      >
        {PrototypeShell ? (
          <Suspense fallback={null}>
            <PrototypeShell p={layoutProps} />
          </Suspense>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <SummaryLayout p={layoutProps} />
          </div>
        )}
        {returnPrompt.dialog}
      </RecordModalContent>
    </Dialog>
  );
}
