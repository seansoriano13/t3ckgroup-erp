import { useState, useCallback, useEffect, useMemo, useContext, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as dagre from "@dagrejs/dagre";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Upload,
  Eye,
  Lock,
  LockOpen,
  Pencil,
  Plus,
  RotateCcw,
  LayoutGrid,
  Workflow,
  Trash2,
  Check,
  X,
} from "lucide-react";
import toast from "react-hot-toast";

// The service's own Errors and our SQL RAISEs are written for people; only the
// database's generic constraint/permission failures and network drops get translated.
const TECHNICAL_ERRORS = {
  23505: "That name is already used in this Sales Flow. Pick another.",
  23503: "Something else still depends on this, so it can't be changed yet.",
  42501: "You don't have permission to change this Sales Flow.",
};
function flowErrorMessage(err) {
  const friendly = TECHNICAL_ERRORS[err?.code] ||
    (/failed to fetch|network/i.test(err?.message || "") && "Couldn't reach the server. Check your connection and try again.");
  if (friendly) {
    console.error(err);
    return friendly;
  }
  return err?.message || "Something went wrong. Try again.";
}
import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  MarkerType,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { FileInput } from "@/components/ui/FileInput";
import Dropdown from "@/components/ui/Dropdown";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { UPDATE_MODE, idsForUpdateMode } from "@/utils/sorVersionUpdate";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import Spinner from "@/components/ui/Spinner";
import { Tooltip } from "@/components/ui/Tooltip";
import PeoplePicker from "@/components/ui/PeoplePicker";
import { supabase } from "../../lib/supabase";
import { opportunityService } from "../../services/opportunityService";
import { employeeService } from "../../services/employeeService";
import { employeeGroupService } from "../../services/employeeGroupService";
import { flowAccessService } from "../../services/flowAccessService";
import { formatVersionNumber, formatSnapshotVersion } from "../../constants/flowVersion";
import { canvasAccessLens, stageCalledInSelectors } from "../../utils/canvasAccessLens";
import { describeSelector, stageAudience } from "../../utils/stageAudience";
import { actionTitle } from "./flowStageKinds";

import { useFlowData, FlowDataContext, FlowDataProvider } from "./FlowDataContext";
import { useFlowPresence } from "../../hooks/useFlowPresence";
import { entryStage, flowLockBlockers, flowPublishWarnings } from "../../constants/salesFlow";
import { useAuth } from "../../context/AuthContext";
import FlowCanvasNode, { HANDLE_IN, HANDLE_OUT } from "./FlowCanvasNode";
import FlowSatelliteNode from "./FlowSatelliteNode";
import FlowBracketNode from "./FlowBracketNode";
import FlowMoveEdge from "./FlowMoveEdge";
import StageSettingsPanel from "./StageSettingsPanel";
import SorFormBuilder from "./SorFormBuilder";
import FlowAccessSettings from "./FlowAccessSettings";
import DiffSummary from "./FlowSnapshotDiffSummary";
import FlowVersionRail, { FlowVersionStatusChip } from "./FlowVersionRail";
import FlowVersionViewer from "../sor/FlowVersionViewer";
import AddStagePopoverForm from "./AddStagePopoverForm";
import {
  FIELDS,
  GATE,
  RUN,
  bracketNode,
  bracketRuns,
  columnSlots,
  midpointStagePosition,
  nextStagePosition,
  satellitePosition,
  stageBox,
} from "./flowCanvasLayout";
import { CAPTION_BASE } from "@/lib/captionStyle";

const nodeTypes = {
  stage: FlowCanvasNode,
  satellite: FlowSatelliteNode,
  bracket: FlowBracketNode,
};

const edgeTypes = {
  move: FlowMoveEdge,
};

/**
 * One shared empty map, not a fresh `{}` per render: it is the fallback for the
 * batched satellite reads, and those feed the effect that rebuilds every node.
 * A new object each render is a new dependency each render, which is an
 * infinite rebuild loop rather than a missing value.
 */
const NO_SATELLITES = Object.freeze({});
// Which Stage settings tab a satellite opens, by the column it hangs in.
const SATELLITE_TAB = { [GATE]: "conditions", [FIELDS]: "fields", [RUN]: "actions" };
// Same reasoning as NO_SATELLITES above, for the #296 access-lens reads: a
// fresh `[]`/`{}` default on every render while a query is still unsettled
// is a new dependency on every render, which is an infinite rebuild loop of
// the node-building effect below rather than a missing value.
const NO_EMPLOYEES = Object.freeze([]);
const NO_GROUPS = Object.freeze([]);

// A previewed version is fitted clear of what floats over the pane: the top
// bar (with the preview banner) and the Versions rail on the left (w-80 at left-4).
const VERSION_FIT_PADDING = { top: "96px", right: "48px", bottom: "48px", left: "368px" };

const EDGE_COLOR = "var(--mauve-9)";
const SATELLITE_COLOR = {
  [GATE]: "var(--amber-a8)",
  [FIELDS]: "var(--blue-a8)",
  [RUN]: "var(--violet-a8)",
};

const defaultEdgeOptions = {
  type: "move",
  style: { stroke: EDGE_COLOR, strokeWidth: 1.75 },
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: EDGE_COLOR },
};

/**
 * The Flow Canvas (issue #36). The developer and the Operations Manager build
 * the SORS process together on this one screen, against staging.
 *
 * The canvas shows the whole contract of a flow, not just its shape: every
 * Stage carries its conditions below-left, its fields straight below and its
 * actions below-right, drawn as satellites of the Stage that owns them. What
 * blocks a deal from leaving, what it must fill in and what fires when it
 * arrives are properties of a Stage, so they are read in the same glance as the
 * Stage — no panel, no click.
 *
 * Wired to salesFlowService, stageConditionService, stageFieldService and
 * stageActionService.
 * Every question about the flow itself is asked of constants/salesFlow.js, and
 * every question about where a satellite sits is asked of flowCanvasLayout.js,
 * so this component can never disagree with either about the answer.
 */
export default function FlowCanvas() {
  const existingContext = useContext(FlowDataContext);
  const content = (
    <ReactFlowProvider>
      <FlowCanvasInner />
    </ReactFlowProvider>
  );

  if (existingContext) {
    return content;
  }

  return <FlowDataProvider>{content}</FlowDataProvider>;
}

// The last Sale Type a person opened, remembered per person in this browser.
const rememberedSaleTypeKey = (userId) => `flow_canvas_sale_type:${userId}`;
function readRememberedSaleType(userId) {
  if (!userId) return "";
  try {
    return localStorage.getItem(rememberedSaleTypeKey(userId)) || "";
  } catch {
    return "";
  }
}
function writeRememberedSaleType(userId, saleTypeId) {
  if (!userId) return;
  try {
    localStorage.setItem(rememberedSaleTypeKey(userId), saleTypeId);
  } catch {
    /* ignore */
  }
}

function FlowCanvasInner() {
  const { user } = useAuth();
  const {
    salesFlow: salesFlowService,
    stageCondition: stageConditionService,
    stageAction: stageActionService,
    stageField: stageFieldService,
    presenceScope: contextPresenceScope,
  } = useFlowData();
  const queryClient = useQueryClient();
  const [selectedSaleTypeId, setSelectedSaleTypeId] = useState("");
  const [rememberedSaleTypeId] = useState(() => readRememberedSaleType(user?.id));
  const [newSaleTypeName, setNewSaleTypeName] = useState("");
  // { nodeId, stageId, tab } — one selection covers the Stage and its satellites,
  // because clicking a condition should open the Stage that owns it.
  const [selection, setSelection] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [dialogValue, setDialogValue] = useState("");
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishNote, setPublishNote] = useState("");
  // Set after a minor publish that has SORs to offer moving up (issue #190):
  // { targetSnapshotId, majorLabel, targetLabel, count }. Never set after a
  // major publish or a first publish — the offer is opt-in, so nothing here
  // moves a deal until the Operations Manager accepts it.
  const [moveOffer, setMoveOffer] = useState(null);
  const [offerMode, setOfferMode] = useState(UPDATE_MODE.ALL);
  const [offerPicked, setOfferPicked] = useState([]);
  const [moveResult, setMoveResult] = useState(null);
  // { done, total, targetLabel } while a move is running, else null. Drives
  // the progress dialog that cannot be dismissed (issue #190 follow-up).
  const [moveProgress, setMoveProgress] = useState(null);
  const [toolbarMode, setToolbarMode] = useState("select");
  const [inlineValue, setInlineValue] = useState("");
  // The Flow Snapshot currently drawn read-only on the canvas (issue #193),
  // or null while the draft is shown. Cleared whenever the Sale Type changes
  // so switching flows never leaves one flow's version pinned over another's.
  const [viewingSnapshot, setViewingSnapshot] = useState(null);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  // Collapsed by default (issue #194) — archived Sale Types stay out of the
  // way of the working list until someone asks to see them.
  const [showArchivedTypes, setShowArchivedTypes] = useState(false);
  // Issue #296: who the Operations Manager is previewing the canvas as — a
  // single resolvePeople.js selector, or null for "nobody, show everything".
  const [viewAsSelector, setViewAsSelector] = useState(null);

  const { data: saleTypes, isLoading: loadingTypes } = useQuery({
    queryKey: ["saleTypes", "all"],
    queryFn: () => salesFlowService.getSaleTypes({ includeArchived: true }),
  });

  const activeSaleTypes = useMemo(() => saleTypes?.filter((t) => !t.archived_at) ?? [], [saleTypes]);
  const archivedSaleTypes = useMemo(() => saleTypes?.filter((t) => t.archived_at) ?? [], [saleTypes]);

  // A remembered Sale Type that has since been archived or deleted is ignored.
  const rememberedActiveId = activeSaleTypes.find((t) => t.id === rememberedSaleTypeId)?.id;
  const effectiveSaleTypeId = selectedSaleTypeId || rememberedActiveId || saleTypes?.[0]?.id || "";

  const pickSaleType = useCallback(
    (id) => {
      setSelectedSaleTypeId(id);
      writeRememberedSaleType(user?.id, id);
    },
    [user?.id]
  );

  const { data: canvas, isLoading: loadingCanvas } = useQuery({
    queryKey: ["salesFlow", effectiveSaleTypeId],
    queryFn: () => salesFlowService.getFlow(effectiveSaleTypeId),
    enabled: Boolean(effectiveSaleTypeId),
  });

  const stages = useMemo(() => canvas?.stages ?? [], [canvas?.stages]);
  const edges = useMemo(() => canvas?.edges ?? [], [canvas?.edges]);
  const flow = canvas?.flow ?? null;
  const entry = entryStage(stages);
  const isLocked = flow?.state === "locked";
  const lockBlockers = useMemo(
    () => (flow && !isLocked ? flowLockBlockers({ stages, edges, wonStageId: flow.won_stage_id }) : []),
    [flow, isLocked, stages, edges],
  );

  const stageIds = useMemo(() => stages.map((s) => s.id), [stages]);
  const stageKey = useMemo(() => [...stageIds].sort().join(","), [stageIds]);

  // The number the next publish would create (ADR 0020), straight from the
  // database rule so the button's caption and the result can't disagree.
  //
  // Keyed on the flow alone, and refetched by `refresh()` below. It used to
  // derive the key from the draft's shape (stage ids, edge count, Won Stage),
  // which meant a rename, a condition/action/field edit, or a rewire that
  // kept the same number of edges changed nothing the key could see: the
  // publish dialog, the version rail and the status chip all kept showing a
  // stale diff until the canvas was remounted by a reload.
  const { data: versionPreview } = useQuery({
    queryKey: ["flowVersionPreview", flow?.id],
    queryFn: () => salesFlowService.previewVersion(flow.id),
    enabled: Boolean(flow?.id) && !isLocked,
  });
  const publishLabel = versionPreview ? `Publish ${versionPreview.label}` : "Publish";

  // Said before Publish, not only after: a minor publish offers every deal on this
  // major a move up, and the person publishing should know how many that is.
  const isMinorPublish = Boolean(versionPreview && versionPreview.minor > 0);
  const { data: dealsOfferedMove } = useQuery({
    queryKey: ["flowDealsOnMajor", flow?.id, versionPreview?.major],
    queryFn: () => opportunityService.countOpportunitiesOnFlowMajor(flow.id, versionPreview.major),
    enabled: publishOpen && Boolean(flow?.id) && isMinorPublish,
  });
  const stageNameFor = useCallback(
    (stageId) => stages.find((s) => s.id === stageId)?.name || stageId,
    [stages],
  );

  // One request per flow rather than one per Stage: a twelve-Stage flow drew
  // twenty-four requests on every switch when each node fetched its own.
  const { data: conditionsByStage = NO_SATELLITES } = useQuery({
    queryKey: ["stageConditionsByStage", stageKey],
    queryFn: () => stageConditionService.getForStages(stageIds),
    enabled: stageIds.length > 0,
  });

  const { data: actionsByStage = NO_SATELLITES } = useQuery({
    queryKey: ["stageActionsByStage", stageKey],
    queryFn: () => stageActionService.getForStages(stageIds),
    enabled: stageIds.length > 0,
  });

  // Told in the publish dialog; never stops a publish (#463).
  const publishWarnings = useMemo(
    () => flowPublishWarnings({ stages, edges, conditionsByStage, actionsByStage }),
    [stages, edges, conditionsByStage, actionsByStage],
  );

  // Live fields only (archived ones are not part of the Stage any more). The
  // key is the one the Fields tab and `refresh` already invalidate.
  const { data: fieldsByStage = NO_SATELLITES } = useQuery({
    queryKey: ["stageFieldsByStage", stageKey],
    queryFn: () => stageFieldService.getForStages(stageIds),
    enabled: stageIds.length > 0,
  });

  // Issue #296: every Stage's restriction config in one round trip — the eye
  // chip and the "View as" lens both need it, and neither is worth a query
  // per Stage.
  const { data: stageAccessByStage = NO_SATELLITES } = useQuery({
    queryKey: ["stageAccessByStage", stageKey],
    queryFn: () => flowAccessService.getForStages(stageIds),
    enabled: stageIds.length > 0,
  });

  // The flow-level Always sees, so a node can say "Everyone" when everyone is
  // in it. Same key as the toolbar's Access settings, so saving there
  // refreshes the nodes too.
  const { data: flowAccess } = useQuery({
    queryKey: ["flowAccess", flow?.id],
    queryFn: () => flowAccessService.getForFlow(flow.id),
    enabled: Boolean(flow?.id),
  });

  // Shares its cache with PeoplePicker's own reads below, so opening "View
  // as" costs nothing extra once the picker has been opened once.
  const { data: allEmployees = NO_EMPLOYEES } = useQuery({
    queryKey: ["employees"],
    queryFn: () => employeeService.getAllEmployees(),
  });
  const { data: allGroups = NO_GROUPS } = useQuery({
    queryKey: ["employeeGroups", "all"],
    queryFn: () => employeeGroupService.list({ includeArchived: true }),
  });

  const groupMembersById = useMemo(
    () => Object.fromEntries(allGroups.map((g) => [g.id, { employeeIds: g.memberIds || [] }])),
    [allGroups],
  );

  // Every Stage's own call-ins (issue #294's Stage Participant windows),
  // read off the same condition/action rows the satellites below already
  // fetched — not a separate query, and not stored on the Stage itself.
  const calledInByStage = useMemo(
    () =>
      Object.fromEntries(
        stages.map((s) => [
          s.id,
          stageCalledInSelectors(conditionsByStage[s.id], actionsByStage[s.id]),
        ]),
      ),
    [stages, conditionsByStage, actionsByStage],
  );

  const groupsById = useMemo(
    () => Object.fromEntries(allGroups.map((g) => [g.id, g])),
    [allGroups],
  );

  const stageNameById = useMemo(
    () => Object.fromEntries(stages.map((s) => [s.id, s.name])),
    [stages],
  );

  // Who can see each Stage, by name — what the node's audience strip reads,
  // and the same shape the Stage's Access tab builds for itself. Flow-level
  // "Always sees" is passed in only so a node can say "Everyone".
  const audienceByStage = useMemo(
    () =>
      Object.fromEntries(
        stages.map((s) => [
          s.id,
          stageAudience({
            stageAccess: stageAccessByStage[s.id],
            flowAccess,
            conditions: conditionsByStage[s.id],
            actions: actionsByStage[s.id],
            employees: allEmployees,
            groupMembersById,
            groupsById,
            stageNameById,
            actionLabel: actionTitle,
          }),
        ]),
      ),
    [
      stages,
      stageAccessByStage,
      flowAccess,
      conditionsByStage,
      actionsByStage,
      allEmployees,
      groupMembersById,
      groupsById,
      stageNameById,
    ],
  );

  // The identity "View as" is previewing, named the way the roster names it,
  // so a Stage can say "Hidden from Sales Director" rather than only dimming.
  const viewAsLabel = useMemo(
    () =>
      viewAsSelector
        ? describeSelector(viewAsSelector, { employees: allEmployees, groupsById })
        : null,
    [viewAsSelector, allEmployees, groupsById],
  );

  // canvasAccessLens is pure: this is the one place its input snapshot is
  // assembled, from the same access rows the strip above reads.
  const accessLens = useMemo(
    () =>
      canvasAccessLens({
        snapshotLikeDraft: {
          stages: stages.map((s) => ({
            id: s.id,
            shutOutRoles: stageAccessByStage[s.id]?.shutOutRoles || [],
            excludedGroupIds: stageAccessByStage[s.id]?.excludedGroupIds || [],
            calledIn: calledInByStage[s.id] || [],
          })),
          employees: allEmployees,
          groupMembersById,
          alwaysSees: flowAccess?.alwaysSees || [],
          alwaysEdits: flowAccess?.alwaysEdits || [],
        },
        selector: viewAsSelector,
      }),
    [stages, stageAccessByStage, flowAccess, calledInByStage, allEmployees, groupMembersById, viewAsSelector],
  );

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["saleTypes"] });
    queryClient.invalidateQueries({ queryKey: ["saleTypes", "all"] });
    queryClient.invalidateQueries({ queryKey: ["salesFlow", effectiveSaleTypeId] });
    queryClient.invalidateQueries({ queryKey: ["stageConditionsByStage"] });
    queryClient.invalidateQueries({ queryKey: ["stageActionsByStage"] });
    queryClient.invalidateQueries({ queryKey: ["stageFields"] });
    queryClient.invalidateQueries({ queryKey: ["stageFieldsByStage"] });
    // "What changed since the last version" — every write on this canvas can
    // move it, so it is refetched on every write rather than inferred from a
    // query key built out of the draft's shape.
    queryClient.invalidateQueries({ queryKey: ["flowVersionPreview"] });
    queryClient.invalidateQueries({ queryKey: ["flowDraftSnapshotData"] });
    // The version rail's own reads (issue #192) — none of the tables the
    // realtime subscription above watches is `flow_snapshots`, so a publish,
    // restore or reopen would otherwise leave the rail showing a stale
    // history until something else forced a refetch.
    queryClient.invalidateQueries({ queryKey: ["flowSnapshots", flow?.id] });
    queryClient.invalidateQueries({ queryKey: ["flowSnapshotUsage", flow?.id] });
    queryClient.invalidateQueries({ queryKey: ["flowUnlockEvents", flow?.id] });
  }, [queryClient, effectiveSaleTypeId, flow?.id]);

  const { screenToFlowPosition, flowToScreenPosition } = useReactFlow();

  // --- React Flow state ------------------------------------------------------
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState([]);

  // Peer presence is scoped per Sale Type: everyone editing the same live flow
  // sees each other's avatars and drags. `presenceScope` from the provider is
  // null (#186 removed the Sandbox that supplied one), so the fallback below
  // builds the scope from the active Sale Type.
  const applyPeerDrag = useCallback(
    ({ nodeId, position }) => {
      setRfNodes((nodes) => nodes.map((node) => (node.id === nodeId ? { ...node, position } : node)));
    },
    [setRfNodes],
  );

  const effectivePresenceScope =
    contextPresenceScope || (effectiveSaleTypeId ? `live_${effectiveSaleTypeId}` : null);

  const { peers, cursors, publishCursor, publishNodeDrag } = useFlowPresence({
    scopeId: effectivePresenceScope,
    user,
    onPeerNodeDrag: applyPeerDrag,
  });

  // The flow lives in tables, so this canvas hears about changes another
  // browser made to them via postgres_changes.
  useEffect(() => {
    if (!effectiveSaleTypeId || contextPresenceScope) return undefined;

    const channel = supabase.channel(`flow_canvas_${effectiveSaleTypeId}`);

    channel
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_flows' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'flow_stages' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'flow_edges' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stage_conditions' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'flow_stage_actions' }, refresh)
      .subscribe();

    return () => {
      channel.unsubscribe();
      supabase.removeChannel(channel);
    };
  }, [effectiveSaleTypeId, contextPresenceScope, refresh]);

  const handlePointerMove = useCallback(
    (event) => {
      publishCursor(screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    },
    [publishCursor, screenToFlowPosition],
  );

  const createSaleType = useMutation({
    mutationFn: (name) => salesFlowService.createSaleType(name, user?.id),
    onSuccess: () => {
      setNewSaleTypeName("");
      refresh();
      toast.success("Sale Type created.");
    },
    onError: (err) => toast.error(flowErrorMessage(err)),
  });

  const importInputRef = useRef(null);

  const exportFlowFile = useMutation({
    mutationFn: async () => {
      const file = await salesFlowService.exportFlow(flow?.id);
      const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(selectedSaleType?.name || "flow").replace(/[^\w-]+/g, "-")}.flow-snapshot.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
    onError: (err) => toast.error(flowErrorMessage(err)),
  });

  const importFlowFile = useMutation({
    mutationFn: async (file) => {
      const text = await file.text();
      const name = file.name.replace(/\.(flow-snapshot\.)?json$/i, "");
      return salesFlowService.importFlowFile(text, name, user?.id);
    },
    onSuccess: () => {
      refresh();
      toast.success("Flow imported as a new draft.");
    },
    onError: (err) => toast.error(flowErrorMessage(err)),
  });

  const duplicateFlow = useMutation({
    mutationFn: () =>
      salesFlowService.duplicateFlow(flow?.id, `${selectedSaleType?.name} (copy)`, user?.id),
    onSuccess: () => {
      refresh();
      toast.success("Flow duplicated as a new draft.");
    },
    onError: (err) => toast.error(flowErrorMessage(err)),
  });

  const { mutate: doRun } = useMutation({
    mutationFn: ({ run }) => run(),
    onSuccess: (_data, variables) => {
      refresh();
      if (variables.message) toast.success(variables.message);
    },
    onError: (err) => toast.error(flowErrorMessage(err)),
  });

  const run = useCallback((fn, message) => doRun({ run: fn, message }), [doRun]);

  // Publish gets its own mutation, rather than running through `run` above,
  // because the post-publish "move deals up" offer (issue #190) needs the
  // published snapshot's version numbers — `run`'s success handler only
  // knows the toast message, not the mutation's result.
  const publishFlow = useMutation({
    // Takes the note as a mutate() argument, not read from `publishNote`
    // state inside the closure: closing the popover resets that state right
    // after `onConfirm`, and TanStack Query re-reads `mutationFn` from the
    // latest render before this actually executes — a closure over state
    // here would race that reset and publish an empty note.
    mutationFn: (note) => salesFlowService.publishFlow(flow?.id, user?.id, note),
    onSuccess: async (result) => {
      refresh();
      toast.success("Flow published.");
      setPublishNote("");

      const snapshot = result?.snapshot;
      // Only a minor publish is safe to offer moving deals onto (ADR 0020):
      // a fresh major (version_minor === 0, including the very first v1.0)
      // may drop a Stage or change the Won Stage, so an earlier deal could
      // be stranded or have its Realized timing shift.
      if (!snapshot || snapshot.version_minor === 0) return;

      const sors = await opportunityService.listOpportunitiesEligibleForVersionMove(snapshot.id);
      if (sors.length > 0) {
        setOfferMode(UPDATE_MODE.ALL);
        setOfferPicked([]);
        setMoveOffer({
          targetSnapshotId: snapshot.id,
          majorLabel: `${snapshot.version}.x`,
          targetLabel: formatVersionNumber(snapshot.version, snapshot.version_minor),
          sors,
        });
      }
    },
    onError: (err) => toast.error(flowErrorMessage(err)),
  });

  // Restore into draft (issue #187's all-or-nothing, id-keeping RPC), fired
  // from the read-only version banner (issue #193) — the one place restore
  // lives now that the rail's per-row Restore is gone.
  const restoreMutation = useMutation({
    mutationFn: (snapshotId) => salesFlowService.restoreSnapshot(flow.id, snapshotId, user?.id),
    onSuccess: () => {
      refresh();
      toast.success("Working draft reverted to this version.");
      setRestoreConfirmOpen(false);
      setViewingSnapshot(null);
    },
    onError: (err) => {
      setRestoreConfirmOpen(false);
      toast.error(flowErrorMessage(err));
    },
  });

  const acceptMoveOffer = useMutation({
    mutationFn: ({ targetSnapshotId, targetLabel, ids }) =>
      opportunityService.updateSorVersions(ids, targetSnapshotId, {
        queryClient,
        onProgress: ({ done, total }) => setMoveProgress({ done, total, targetLabel }),
      }),
    onSuccess: (result) => {
      setMoveResult(result);
      setMoveOffer(null);
    },
    onError: (err) => toast.error(flowErrorMessage(err)),
    onSettled: () => setMoveProgress(null),
  });

  // A move in flight is lost to a reload or a closed tab — each batch is
  // safe, but the rest never runs — so ask the browser to confirm before
  // leaving. Moving to another page inside the app doesn't stop it.
  const moveRunning = acceptMoveOffer.isPending;
  useEffect(() => {
    if (!moveRunning) return undefined;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [moveRunning]);

  /** Opens the one dialog, seeded for whichever question is being asked. */
  const ask = useCallback((config) => {
    setDialogValue(config.initialValue ?? "");
    setDialog(config);
  }, []);

  const selectedStage = stages.find((s) => s.id === selection?.stageId) ?? null;

  const bracketOptions = useMemo(
    () =>
      [...new Set(stages.map((s) => s.bracket_label).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [stages],
  );

  // The canvas-level plus (issue #195): a Stage with no incoming move, so it
  // is only staggered against its siblings rather than placed after any one
  // of them.
  const addUnconnectedStage = useCallback(
    async (name) => {
      const offset = (stages.length * 24) % 240;
      await salesFlowService.addStage(flow.id, name, user?.id, 120 + offset, 140 + offset);
      refresh();
      toast.success("Stage added.");
    },
    [flow, stages.length, user?.id, refresh]
  );

  // A Stage's own outgoing plus (issue #195): creates the Stage placed to its
  // right and the move from it in one step, so nobody has to hunt for a
  // handle afterwards.
  const addStageAfter = useCallback(
    async (sourceStage, name) => {
      const { x, y } = nextStagePosition(sourceStage, stages);
      const newStage = await salesFlowService.addStage(flow.id, name, user?.id, x, y);
      await salesFlowService.addEdge(flow.id, sourceStage.id, newStage.id, user?.id);
      refresh();
      toast.success("Stage added.");
    },
    [flow, stages, user?.id, refresh]
  );

  // A move's own midpoint plus (issue #196): turns A → B into A → New → B in
  // one step, the most common edit to an existing process — a missing Stage
  // between two that are already connected.
  const insertStageOnEdge = useCallback(
    async (edge, name) => {
      const source = stages.find((s) => s.id === edge.from_stage_id);
      const target = stages.find((s) => s.id === edge.to_stage_id);
      const { x, y } = midpointStagePosition(source, target, stages);
      await salesFlowService.insertStageOnMove(edge.id, name, user?.id, x, y);
      refresh();
      toast.success("Stage added.");
    },
    [stages, user?.id, refresh]
  );

  const setAsEntryStage = useCallback((stageId) => {
    const order = [...stages].map((s) => s.id);
    const targetIdx = order.indexOf(stageId);
    if (targetIdx === -1) return;

    if (targetIdx === 0) {
      // Toggle off: move the current entry stage to the end, if there are others.
      if (order.length <= 1) return;
      order.shift();
      order.push(stageId);
    } else {
      // Toggle on: move this stage to the front.
      order.splice(targetIdx, 1);
      order.unshift(stageId);
    }

    run(() => salesFlowService.reorderStages(flow.id, order, user?.id), "Entry stage updated.");
  }, [stages, flow, user?.id, run]);

  const handleDeleteStage = useCallback((stage) => {
    ask({
      title: `Delete “${stage.name}”?`,
      description:
        "Every move drawn to or from it goes too, along with its conditions and its actions. Deals already sitting on it keep the Stage name they were given.",
      confirmLabel: "Delete Stage",
      tone: "destructive",
      onConfirm: () => {
        setSelection(null);
        run(() => salesFlowService.deleteStage(stage.id, user?.id), "Stage deleted.");
      },
    });
  }, [user?.id, run, ask]);

  const handleToggleTerminal = useCallback((stage) => {
    run(() => salesFlowService.setStageTerminal(stage.id, !stage.is_terminal, user?.id));
  }, [user?.id, run]);

  const handleRemoveEdge = useCallback(
    (edgeId) => {
      run(() => salesFlowService.removeEdge(edgeId, user?.id), "Move removed.");
    },
    [user?.id, run]
  );

  useEffect(() => {
    const nodes = [];
    const satelliteEdges = [];

    // Brackets first and at a negative zIndex: a pure annotation drawn above a
    // consecutive run of Stages sharing its label, so it has to sit behind
    // every real node rather than compete with them for clicks. One brace per
    // run, not per label — a label reused past an intervening Stage draws two
    // braces, the same rule the deal modal's stage control follows (#182).
    bracketRuns(stages).forEach((run) => {
      if (run.label) nodes.push(bracketNode(run));
    });

    // Parents first: React Flow reads `parentId` against nodes already in the
    // array, so a satellite listed before its Stage would render at the origin.
    stages.forEach((stage) => {
      nodes.push({
        id: stage.id,
        type: "stage",
        position: { x: stage.pos_x ?? 0, y: stage.pos_y ?? 0 },
        selected: selection?.nodeId === stage.id,
        data: {
          stage,
          isEntry: entry?.id === stage.id,
          isWon: flow?.won_stage_id === stage.id,
          disabled: isLocked,
          conditionCount: (conditionsByStage[stage.id] ?? []).length,
          actionCount: (actionsByStage[stage.id] ?? []).length,
          fieldCount: (fieldsByStage[stage.id] ?? []).length,
          hasOutgoing: edges.some((e) => e.from_stage_id === stage.id),
          canAddStage: !isLocked,
          onAddStage: (name) => addStageAfter(stage, name),
          // Issue #294: a condition or action calling in from this Stage had
          // its access window's chosen end Stage deleted and fell back to
          // "calling Stage left" — surfaced here rather than only inside the
          // settings panel, so it's seen without opening it.
          hasAccessFallbackWarning:
            [...(conditionsByStage[stage.id] ?? []), ...(actionsByStage[stage.id] ?? [])].some(
              (item) => item.config?.accessFallbackWarning,
            ),
          // Who can see this Stage, named on the node itself, plus the
          // "View as" verdict for whoever is currently being previewed.
          audience: audienceByStage[stage.id],
          accessLensState: viewAsSelector ? accessLens[stage.id] : null,
          viewAsLabel: viewAsSelector ? viewAsLabel : null,
          onOpenAccess: () =>
            setSelection({ nodeId: stage.id, stageId: stage.id, tab: "access" }),
        },
        draggable: !isLocked,
      });
    });

    const addSatellite = (stage, column, index, id, data) => {
      nodes.push({
        id,
        type: "satellite",
        parentId: stage.id,
        position: satellitePosition(column, index),
        selected: selection?.nodeId === id,
        draggable: false,
        deletable: false,
        connectable: false,
        data: { ...data, column, stageId: stage.id },
      });
      satelliteEdges.push({
        id: `satedge:${id}`,
        source: stage.id,
        sourceHandle: column,
        target: id,
        type: "smoothstep",
        pathOptions: { borderRadius: 14 },
        deletable: false,
        selectable: false,
        focusable: false,
        reconnectable: false,
        style: {
          stroke: SATELLITE_COLOR[column],
          strokeWidth: 1.5,
          strokeDasharray: "4 5",
        },
        markerEnd: undefined,
      });
    };

    stages.forEach((stage) => {
      const isSelected = selection?.stageId === stage.id;

      const columns = [
        { column: GATE, items: conditionsByStage[stage.id] ?? [], variant: "condition", addLabel: "Condition" },
        { column: FIELDS, items: fieldsByStage[stage.id] ?? [], variant: "field", addLabel: "Field" },
        { column: RUN, items: actionsByStage[stage.id] ?? [], variant: "action", addLabel: "Action" },
      ];

      columns.forEach(({ column, items, variant, addLabel }) => {
        const { shown, overflow } = columnSlots(items.length);

        items.slice(0, shown).forEach((item, i) => {
          addSatellite(stage, column, i, `sat:${stage.id}:${column}:${item.id}`, {
            variant,
            [variant]: item,
            // Issue #411 — actionSummary names a single-employee Decider by
            // looking them up here, rather than always saying "the assignee".
            ...(variant === "action" ? { employees: allEmployees } : {}),
          });
        });

        if (overflow > 0) {
          addSatellite(stage, column, shown, `sat:${stage.id}:${column}:more`, {
            variant: "overflow",
            overflow,
          });
        }

        // The empty slot is an affordance, not decoration — so it appears only
        // on the Stage being worked on, and never on a locked flow.
        if (isSelected && overflow === 0 && !isLocked) {
          addSatellite(stage, column, items.length, `sat:${stage.id}:${column}:add`, {
            variant: "add",
            addLabel,
          });
        }
      });
    });

    const stageName = Object.fromEntries(stages.map((s) => [s.id, s.name]));

    const flowEdges = edges.map((e) => ({
      id: e.id,
      source: e.from_stage_id,
      target: e.to_stage_id,
      // Named on both ends. Left to React Flow, an edge with no handle named
      // resolves to the first source handle on the node — the gate anchor
      // underneath it — and the move draws from the wrong side of the Stage.
      sourceHandle: HANDLE_OUT,
      targetHandle: HANDLE_IN,
      deletable: !isLocked,
      reconnectable: !isLocked,
      data: {
        disabled: isLocked,
        fromName: stageName[e.from_stage_id],
        toName: stageName[e.to_stage_id],
        onDelete: (edgeId) => handleRemoveEdge(edgeId),
        canInsertStage: !isLocked && !viewingSnapshot,
        onInsertStage: (name) => insertStageOnEdge(e, name),
      },
    }));

    setRfNodes(nodes);
    setRfEdges([...satelliteEdges, ...flowEdges]);
  }, [
    stages,
    edges,
    flow,
    entry,
    conditionsByStage,
    actionsByStage,
    fieldsByStage,
    stageAccessByStage,
    audienceByStage,
    accessLens,
    viewAsSelector,
    viewAsLabel,
    selection,
    isLocked,
    viewingSnapshot,
    addStageAfter,
    insertStageOnEdge,
    handleRemoveEdge,
    setRfNodes,
    setRfEdges,
    allEmployees,
  ]);

  const onNodeDrag = useCallback(
    (_event, node) => {
      if (isLocked || node.type !== "stage") return;
      publishNodeDrag(node.id, node.position);
    },
    [isLocked, publishNodeDrag]
  );

  const onNodeDragStop = useCallback(
    (_event, node) => {
      if (isLocked || node.type !== "stage") return;
      salesFlowService
        .updateStagePosition(node.id, node.position.x, node.position.y, user?.id)
        .catch((err) => {
          console.error(err);
          toast.error("That Stage's new position could not be saved. Move it again to retry.");
        });
    },
    [isLocked, user?.id]
  );

  const stageIdSet = useMemo(() => new Set(stageIds), [stageIds]);

  const onConnect = useCallback(
    (params) => {
      if (isLocked) return;
      // Only Stage-to-Stage is a move. A satellite is a property of its Stage,
      // and the schema has nowhere to put an edge that ends on one.
      if (!stageIdSet.has(params.source) || !stageIdSet.has(params.target)) return;
      run(() => salesFlowService.addEdge(flow.id, params.source, params.target, user?.id));
    },
    [isLocked, flow, user?.id, run, stageIdSet]
  );

  const onEdgesDelete = useCallback(
    (edgesToDelete) => {
      if (isLocked) return;
      // Backspace deletes instantly, so every removal offers an Undo that re-adds the move.
      edgesToDelete
        .filter((edge) => !edge.id.startsWith("satedge:"))
        .forEach((edge) =>
          run(async () => {
            await salesFlowService.removeEdge(edge.id, user?.id);
            toast(
              (t) => (
                <span className="flex items-center gap-3 text-sm">
                  Move removed.
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0 font-bold underline underline-offset-2"
                    onClick={() => {
                      toast.dismiss(t.id);
                      run(() => salesFlowService.addEdge(flow.id, edge.source, edge.target, user?.id), "Move restored.");
                    }}
                  >
                    Undo
                  </Button>
                </span>
              ),
              { duration: 6000 },
            );
          }),
        );
    },
    [isLocked, flow, user?.id, run]
  );

  /**
   * Rerouting a move: the same edge, pointed somewhere else.
   *
   * The new end is drawn before the old one is cut, so a reroute that the flow
   * refuses — onto a satellite, back onto the same Stage, or as a duplicate of
   * a move that already exists — leaves the original move standing rather than
   * silently deleting it.
   */
  const onReconnect = useCallback(
    (oldEdge, connection) => {
      if (isLocked) return;
      if (!stageIdSet.has(connection.source) || !stageIdSet.has(connection.target)) return;
      if (connection.source === connection.target) {
        toast.error("A Stage cannot move to itself.");
        return;
      }
      if (
        connection.source === oldEdge.source &&
        connection.target === oldEdge.target
      ) {
        return;
      }

      run(async () => {
        await salesFlowService.addEdge(flow.id, connection.source, connection.target, user?.id);
        await salesFlowService.removeEdge(oldEdge.id, user?.id);
      }, "Move rerouted.");
    },
    [isLocked, stageIdSet, flow, user?.id, run]
  );

  const onNodeClick = useCallback((_event, node) => {
    if (node.type === "stage") {
      setSelection((prev) => ({
        nodeId: node.id,
        stageId: node.id,
        tab: prev?.stageId === node.id ? prev.tab : "settings",
      }));
      return;
    }
    setSelection({
      nodeId: node.id,
      stageId: node.data.stageId,
      tab: SATELLITE_TAB[node.data.column],
    });
  }, []);

  const onPaneClick = useCallback(() => setSelection(null), []);

  const handleAutoLayout = useCallback(() => {
    if (stages.length === 0) return;

    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "LR", nodesep: 64, ranksep: 120 });
    g.setDefaultEdgeLabel(() => ({}));

    // A Stage is as wide and as tall as its satellites make it — laying out the
    // bare node would tuck every condition column under its neighbour.
    const boxes = {};
    stages.forEach((stage) => {
      const box = stageBox({
        conditionCount: (conditionsByStage[stage.id] ?? []).length,
        actionCount: (actionsByStage[stage.id] ?? []).length,
        fieldCount: (fieldsByStage[stage.id] ?? []).length,
      });
      boxes[stage.id] = box;
      g.setNode(stage.id, { width: box.width, height: box.height });
    });

    edges.forEach((edge) => g.setEdge(edge.from_stage_id, edge.to_stage_id));

    dagre.layout(g);

    const updates = stages.map((stage) => {
      const laid = g.node(stage.id);
      const box = boxes[stage.id];
      return salesFlowService.updateStagePosition(
        stage.id,
        Math.round(laid.x - box.width / 2 + box.offsetX),
        Math.round(laid.y - box.height / 2 + box.offsetY),
        user?.id
      );
    });

    Promise.all(updates)
      .then(() => {
        refresh();
        toast.success("Layout tidied.");
      })
      .catch((err) => {
        console.error(err);
        toast.error("The layout could not be saved. Try again.");
      });
  }, [stages, edges, conditionsByStage, actionsByStage, fieldsByStage, user?.id, refresh]);

  const selectedSaleType = saleTypes?.find((t) => t.id === effectiveSaleTypeId) ?? null;
  const showEmptySaleTypes = !effectiveSaleTypeId && !loadingTypes;

  return (
    <div 
      className="relative flex h-full min-h-[34rem] w-full flex-col overflow-hidden bg-mauve-3"
      onPointerMove={handlePointerMove}
    >
      {viewingSnapshot ? (
        // A Flow Snapshot, drawn read-only (issue #193) — reusing the #191
        // viewer rather than toggling this editor's ReactFlow into some
        // read-only mode. See FlowVersionViewer's own note on why: this
        // canvas reads/writes through FlowDataContext and a mutable service
        // surface a frozen document has nothing to call.
        // Keyed per version, so switching versions frames the new one afresh.
        <FlowVersionViewer
          key={viewingSnapshot.id}
          snapshotData={viewingSnapshot.snapshot_data}
          fitPadding={VERSION_FIT_PADDING}
        />
      ) : (
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onConnect={onConnect}
          onEdgesDelete={onEdgesDelete}
          onReconnect={onReconnect}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          connectionRadius={28}
          edgesReconnectable={!isLocked}
          nodesConnectable={!isLocked}
          nodesDraggable={!isLocked}
          elementsSelectable={true}
          fitView
          fitViewOptions={{ padding: 0.24, maxZoom: 1 }}
          minZoom={0.15}
          maxZoom={1.75}
          panOnScroll
          selectionOnDrag={false}
          proOptions={{ hideAttribution: true }}
          deleteKeyCode={["Backspace", "Delete"]}
          className="flow-canvas"
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1.4}
            color="var(--mauve-7)"
          />
          <Controls
            showInteractive={false}
            position="bottom-right"
            className="!bottom-4 !right-4 !shadow-none"
          />

          {/* Render peer cursors */}
        {peers.map((peer) => {
          const cursor = cursors[peer.userId];
          if (!cursor) return null;
          const screenPos = flowToScreenPosition(cursor);
          return (
            <div
              key={peer.userId}
              className="pointer-events-none fixed z-[9999] flex items-center gap-1 transition-all duration-75 ease-linear"
              style={{
                left: screenPos.x,
                top: screenPos.y,
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill={peer.color} stroke="white" strokeWidth="2" xmlns="http://www.w3.org/2000/svg">
                <path d="M4 4l7.07 17 2.51-7.39L21 11.07z" />
              </svg>
              <span
                className="rounded-full px-2 py-0.5 text-xs font-bold text-white shadow-sm"
                style={{ backgroundColor: peer.color }}
              >
                {peer.name}
              </span>
            </div>
          );
        })}
          {stages.length > 1 && (
            <MiniMap
              pannable
              zoomable
              position="bottom-right"
              className="!bottom-24 !right-4 !mb-0 !h-24 !w-36 !rounded-xl !bg-card/90 shadow-md border border-border backdrop-blur-sm"
              maskColor="var(--mauve-a4)"
              nodeColor={(node) =>
                node.type === "stage" ? "var(--mauve-9)" : "var(--mauve-6)"
              }
              nodeStrokeWidth={0}
              nodeBorderRadius={4}
            />
          )}
        </ReactFlow>
      )}

      {/* ── Version-viewing banner (issue #193) ────────────────────────── */}
      {flow && viewingSnapshot && (
        <div className="pointer-events-none absolute inset-x-0 top-[4.25rem] z-30 flex justify-center px-3 2xl:top-3">
          <div className="pointer-events-auto flex items-center gap-2.5 rounded-2xl bg-card/95 px-4 py-2 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_28px_-18px_rgba(0,0,0,0.4)] backdrop-blur-md">
            <div className="flex items-center gap-2">
              <span className={`rounded-md bg-blue-500/15 px-1.5 py-0.5 ${CAPTION_BASE} tracking-wider text-blue-600 dark:text-blue-400`}>
                Preview
              </span>
              <p className="text-sm font-bold text-foreground">
                Viewing {formatSnapshotVersion(viewingSnapshot)} — read-only
              </p>
            </div>
            <div className="mx-1 h-4 w-px bg-border" />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setViewingSnapshot(null)}
                            className="gap-1.5 font-medium shadow-sm"
            >
              <ArrowLeft size={14} />
              {isLocked ? "Back to live flow" : "Back to draft"}
            </Button>
            <Tooltip content={isLocked ? "Edit draft first to revert to this version." : "Replace current draft with this version's stages and edges."}>
              <span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isLocked}
                  onClick={() => setRestoreConfirmOpen(true)}
                  aria-label="Revert to this version"
                  className="gap-1.5 text-muted-foreground hover:text-foreground"
                >
                  <RotateCcw size={13} />
                  Revert to this version
                </Button>
              </span>
            </Tooltip>
          </div>
        </div>
      )}

      {/* ── Version rail (issue #192) ───────────────────────────────────── */}
      {flow && (
        <FlowVersionRail
          flow={flow}
          stages={stages}
          edges={edges}
          saleTypeName={selectedSaleType?.name}
          salesFlowService={salesFlowService}
          versionPreview={versionPreview}
          stageNameFor={stageNameFor}
          onViewVersion={setViewingSnapshot}
          viewingSnapshotId={viewingSnapshot?.id}
        />
      )}

      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-4 px-4 py-3">
        <div className="pointer-events-auto flex min-w-0 items-center gap-1.5 rounded-2xl bg-card/85 p-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_28px_-18px_rgba(0,0,0,0.4)] backdrop-blur-md">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Workflow size={16} strokeWidth={2.5} />
          </div>

          <div className="flex items-center gap-1">
            {loadingTypes ? (
              <span className="px-2 text-xs font-semibold text-muted-foreground">Loading…</span>
            ) : toolbarMode === "rename" ? (
              <form
                className="flex items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!inlineValue.trim()) return;
                  run(() => salesFlowService.renameSaleType(selectedSaleType.id, inlineValue, user?.id), "Sale Type renamed.");
                  setToolbarMode("select");
                }}
              >
                <Input
                  autoFocus
                  aria-label="Sale Type name"
                  value={inlineValue}
                  onChange={e => setInlineValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setToolbarMode("select");
                    }
                  }}
                  className="h-8 w-40 text-xs font-bold"
                />
                <Button type="submit" size="icon-sm" variant="ghost" aria-label="Save name" className="text-green-11 hover:text-green-12 hover:bg-green-3">
                  <Check size={14} />
                </Button>
                <Button type="button" size="icon-sm" variant="ghost" aria-label="Cancel rename" onClick={() => setToolbarMode("select")}>
                  <X size={14} />
                </Button>
              </form>
            ) : (
              <>
                <Dropdown
                  usePortal
                  placement="bottom-start"
                  popoverClassName="popover-enter z-[10001] w-64 rounded-2xl bg-popover p-2 shadow-2xl ring-1 ring-mauve-6"
                  trigger={
                    <Button
                      type="button"
                      variant="ghost"
                      className={cn(
                        "h-auto gap-2 rounded-xl px-3 py-1.5 text-xs font-bold",
                        selectedSaleType?.archived_at && "opacity-60"
                      )}
                    >
                      <span className="truncate max-w-[200px]">
                        {selectedSaleType ? selectedSaleType.name : "Select Sale Type"}
                      </span>
                      <ChevronDown size={14} className="text-muted-foreground" />
                    </Button>
                  }
                >
                  {({ close }) => (
                    <div className="flex max-h-[60vh] flex-col overflow-y-auto">
                      {activeSaleTypes.map((saleType) => (
                        <Button
                          key={saleType.id}
                          type="button"
                          variant="ghost"
                          onClick={() => {
                            pickSaleType(saleType.id);
                            setSelection(null);
                            setViewingSnapshot(null);
                            close();
                          }}
                          className={cn(
                            "h-auto justify-start gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-semibold",
                            saleType.id === effectiveSaleTypeId && "bg-foreground text-background hover:bg-foreground hover:text-background"
                          )}
                        >
                          {saleType.name}
                        </Button>
                      ))}

                      {archivedSaleTypes.length > 0 && (
                        <div className="mt-1 border-t border-border pt-1">
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setShowArchivedTypes((v) => !v)}
                            className="h-auto w-full justify-start gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold text-muted-foreground"
                          >
                            <ChevronRight
                              size={12}
                              className={cn("transition-transform", showArchivedTypes && "rotate-90")}
                            />
                            {showArchivedTypes ? "Hide" : "Show"} archived ({archivedSaleTypes.length})
                          </Button>

                          {showArchivedTypes &&
                            archivedSaleTypes.map((saleType) => (
                              <Button
                                key={saleType.id}
                                type="button"
                                variant="ghost"
                                onClick={() => {
                                  pickSaleType(saleType.id);
                                  setSelection(null);
                                  setViewingSnapshot(null);
                                  close();
                                }}
                                className={cn(
                                  "h-auto justify-start gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-semibold opacity-60",
                                  saleType.id === effectiveSaleTypeId && "bg-foreground text-background opacity-100 hover:bg-foreground hover:text-background"
                                )}
                              >
                                {saleType.name} (Archived)
                              </Button>
                            ))}
                        </div>
                      )}
                    </div>
                  )}
                </Dropdown>

                {selectedSaleType?.archived_at && (
                  <span className={`rounded-full bg-muted px-2 py-0.5 ${CAPTION_BASE} tracking-wide text-muted-foreground`}>
                    Archived
                  </span>
                )}

                {selectedSaleType && (
                  <>
                    <Tooltip content="Rename inline">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Rename Sale Type"
                        onClick={() => {
                          setInlineValue(selectedSaleType.name);
                          setToolbarMode("rename");
                        }}
                      >
                        <Pencil size={14} className="text-muted-foreground" />
                      </Button>
                    </Tooltip>

                    {selectedSaleType.archived_at ? (
                      <Dropdown
                        usePortal
                        placement="bottom-start"
                        popoverClassName="popover-enter z-[10001] w-48 rounded-2xl bg-popover p-2 shadow-2xl ring-1 ring-mauve-6"
                        trigger={
                          <Button variant="ghost" size="icon-sm" aria-label="Restore or delete archived Sale Type" title="Restore or delete">
                            <ArchiveRestore size={14} className="text-muted-foreground" />
                          </Button>
                        }
                      >
                        {({ close }) => (
                          <div className="flex flex-col gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => {
                                close();
                                ask({
                                  title: `Restore “${selectedSaleType.name}”?`,
                                  description: "It will be active and offered on new deals again.",
                                  confirmLabel: "Restore",
                                  onConfirm: () => run(() => salesFlowService.restoreSaleType(selectedSaleType.id, user?.id), "Sale Type restored."),
                                });
                              }}
                              className="h-auto justify-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-semibold text-foreground"
                            >
                              <ArchiveRestore size={15} className="text-muted-foreground" />
                              Restore
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => {
                                close();
                                ask({
                                  title: `Delete “${selectedSaleType.name}”?`,
                                  description: "This will permanently remove the Sale Type and its flow. This cannot be undone.",
                                  confirmLabel: "Delete",
                                  tone: "destructive",
                                  onConfirm: () => {
                                    setSelection(null);
                                    run(async () => {
                                      await salesFlowService.deleteSaleType(selectedSaleType.id, user?.id);
                                      setSelectedSaleTypeId("");
                                    }, "Sale Type deleted.");
                                  }
                                });
                              }}
                              className="h-auto justify-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-semibold text-foreground hover:bg-destructive/10 hover:text-destructive"
                            >
                              <Trash2 size={15} className="text-destructive/80" />
                              Delete permanently
                            </Button>
                          </div>
                        )}
                      </Dropdown>
                    ) : (
                      <Tooltip content="Archive">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Archive Sale Type"
                          onClick={() => {
                            ask({
                              title: `Archive “${selectedSaleType.name}”?`,
                              description: "It stops being offered on new deals. Deals that already carry it keep reading its name.",
                              confirmLabel: "Archive",
                              tone: "destructive",
                              onConfirm: () => run(() => salesFlowService.archiveSaleType(selectedSaleType.id, user?.id), "Sale Type archived.")
                            });
                          }}
                        >
                          <Archive size={14} className="text-muted-foreground" />
                        </Button>
                      </Tooltip>
                    )}
                  </>
                )}

                <div className="mx-1 h-4 w-px bg-border" />

                <Dropdown
                  usePortal
                  placement="bottom-start"
                  popoverClassName="popover-enter z-[10001] w-80 rounded-2xl bg-popover p-3 shadow-2xl ring-1 ring-mauve-6"
                  trigger={
                    <Button variant="ghost" size="icon-sm" aria-label="New Sale Type">
                      <Plus size={14} />
                    </Button>
                  }
                >
                  {({ close }) => (
                    <div className="flex flex-col gap-3">
                      <div>
                        <p className="mb-1.5 text-label font-black uppercase tracking-[0.16em] text-muted-foreground">
                          New Sale Type
                        </p>
                        <form
                          className="flex gap-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (!newSaleTypeName.trim()) return;
                            createSaleType.mutate(newSaleTypeName);
                            close();
                          }}
                        >
                          <Input
                            value={newSaleTypeName}
                            onChange={(e) => setNewSaleTypeName(e.target.value)}
                            placeholder="Name a Sale Type…"
                            className="h-9"
                          />
                          <Button type="submit" size="lg" className="shrink-0">
                            <Plus size={14} /> Add
                          </Button>
                        </form>
                      </div>
                    </div>
                  )}
                </Dropdown>

                <Tooltip content="Import flow from file" side="bottom">
                  <FileInput
                    ref={importInputRef}
                    accept="application/json,.json"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Import flow"
                    onFiles={([file]) => importFlowFile.mutate(file)}
                  >
                    <Upload size={14} />
                  </FileInput>
                </Tooltip>
                {flow && (
                  <>
                    <Tooltip content="Export flow to file" side="bottom">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Export flow"
                        onClick={() => exportFlowFile.mutate()}
                      >
                        <Download size={14} />
                      </Button>
                    </Tooltip>
                    <Tooltip content="Duplicate flow" side="bottom">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Duplicate flow"
                        onClick={() => duplicateFlow.mutate()}
                      >
                        <Copy size={14} />
                      </Button>
                    </Tooltip>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {flow && (
          <div className="pointer-events-auto flex shrink-0 items-center gap-2 rounded-2xl bg-card/85 p-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_28px_-18px_rgba(0,0,0,0.4)] backdrop-blur-md">
            {peers.length > 0 && (
              <div className="ml-1 mr-2 flex -space-x-2">
                {peers.map((peer) => (
                  <Tooltip key={peer.userId} content={peer.name} side="bottom">
                    <div
                      className="flex size-7 items-center justify-center rounded-full border-2 border-card text-[10px] font-bold text-white shadow-sm"
                      style={{ backgroundColor: peer.color }}
                    >
                      {peer.name.charAt(0).toUpperCase()}
                    </div>
                  </Tooltip>
                ))}
              </div>
            )}
            <FlowVersionStatusChip
              flow={flow}
              saleTypeName={selectedSaleType?.name}
              versionPreview={versionPreview}
              salesFlowService={salesFlowService}
              stageNameFor={stageNameFor}
            />

            {!viewingSnapshot && (
              <>
                <div className="mx-1 h-4 w-px bg-border" />

                <Button
                  variant="ghost"
                  size="lg"
                  onClick={handleAutoLayout}
                  disabled={stages.length === 0 || isLocked}
                >
                  <LayoutGrid /> Tidy layout
                </Button>

                <SorFormBuilder flow={flow} />

                <FlowAccessSettings flowId={flow.id} disabled={isLocked} />

                {/* Issue #296: preview the canvas as a role/group/person — a
                    pure canvasAccessLens verdict per Stage, not a live
                    session, so it works before anything is published. */}
                <Dropdown
                  usePortal
                  placement="bottom-start"
                  popoverClassName="popover-enter z-[10001] w-80 rounded-2xl bg-popover p-3 shadow-2xl ring-1 ring-mauve-6"
                  trigger={
                    <Tooltip content="View as">
                      <Button
                        variant={viewAsSelector ? "secondary" : "ghost"}
                        size="icon-sm"
                        aria-label="View as"
                      >
                        <Eye size={14} />
                      </Button>
                    </Tooltip>
                  }
                >
                  {() => (
                    <div className="space-y-2">
                      <p className="text-label font-black uppercase tracking-[0.16em] text-muted-foreground">
                        View as
                      </p>
                      <PeoplePicker
                        value={viewAsSelector ? [viewAsSelector] : []}
                        onChange={(next) => setViewAsSelector(next[next.length - 1] || null)}
                        allowRoles
                        placeholder="Pick a role, group, or person"
                      />
                      {viewAsSelector && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full"
                          onClick={() => setViewAsSelector(null)}
                        >
                          Clear
                        </Button>
                      )}
                    </div>
                  )}
                </Dropdown>

                <div className="mx-1 h-4 w-px bg-border" />

                {isLocked ? (
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() =>
                      ask({
                        title: "Edit draft?",
                        description:
                          "Deals already running an older Flow Snapshot keep using it. This just reopens the canvas for editing. You'll be asked what changed when you publish.",
                        confirmLabel: "Edit draft",
                        onConfirm: () =>
                          run(() => salesFlowService.reopenFlow(flow.id, null, user?.id), "Draft reopened."),
                      })
                    }
                  >
                    <LockOpen /> Edit draft
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="lg"
                    disabled={lockBlockers.length > 0}
                    onClick={() => setPublishOpen(true)}
                  >
                    <Lock /> {publishLabel}
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Lock blockers ───────────────────────────────────────────────── */}
      {flow && !isLocked && !viewingSnapshot && lockBlockers.length > 0 && (
        <div className="pointer-events-none absolute left-1/2 top-16 z-20 -translate-x-1/2">
          <ul className="pointer-events-auto space-y-0.5 rounded-2xl bg-card/90 px-3.5 py-2.5 text-xs text-muted-foreground shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_28px_-18px_rgba(0,0,0,0.4)] backdrop-blur-md">
            {lockBlockers.map((blocker) => (
              <li key={blocker}>• {blocker}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Empty states ────────────────────────────────────────────────── */}
      {showEmptySaleTypes && (
        <CanvasEmptyState
          title="No Sale Types yet"
          body="Add one from the menu beside the logo. The list starts empty on purpose — the system proposes no categories, because the process has to match how the business actually sells."
        />
      )}

      {flow && stages.length === 0 && (
        <CanvasEmptyState
          title="No Stages yet"
          body="Use the plus in the corner to name your first Stage. Once one exists, use the plus on its edge to add the next Stage and draw the move in one step."
        />
      )}

      {loadingCanvas && !flow && effectiveSaleTypeId && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <Spinner size="md" />
        </div>
      )}

      {/* ── Add-Stage plus (issue #195) ───────────────────────────────── */}
      {flow && !isLocked && !viewingSnapshot && (
        <div className="absolute bottom-4 left-4 z-20">
          <Dropdown
            usePortal
            placement="top-start"
            popoverClassName="popover-enter z-[10001] w-80 rounded-2xl bg-popover p-3 shadow-2xl ring-1 ring-mauve-6"
            trigger={
              <Button
                size="sm"
                aria-label="Add Stage"
                className="gap-2 rounded-2xl bg-card/90 px-3.5 py-2 text-xs font-bold text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_28px_-18px_rgba(0,0,0,0.4)] backdrop-blur-md hover:bg-card"
              >
                <Plus size={15} /> Add Stage
              </Button>
            }
          >
            {({ close }) => <AddStagePopoverForm onSubmit={addUnconnectedStage} close={close} />}
          </Dropdown>
        </div>
      )}

      {/* ── Stage panel (hidden while viewing a version — FlowVersionViewer
           opens its own read-only Stage panel) ────────────────────────── */}
      {selectedStage && flow && !viewingSnapshot && (
        <StageSettingsPanel
          stage={selectedStage}
          isEntry={entry?.id === selectedStage.id}
          isWon={flow.won_stage_id === selectedStage.id}
          isAward={flow.award_stage_id === selectedStage.id}
          disabled={isLocked}
          bracketOptions={bracketOptions}
          activeTab={selection.tab}
          onTabChange={(tab) => setSelection((prev) => ({ ...prev, tab }))}
          onClose={() => setSelection(null)}
          onRename={(name) =>
            run(() => salesFlowService.renameStage(selectedStage.id, name, user?.id))
          }
          onColorChange={(color) =>
            run(() => salesFlowService.updateStageColor(selectedStage.id, color, user?.id))
          }
          onBracketChange={(label) =>
            run(() => salesFlowService.updateStageBracket(selectedStage.id, label, user?.id))
          }
          onDelete={() => handleDeleteStage(selectedStage)}
          outgoingMoves={edges
            .filter((e) => e.from_stage_id === selectedStage.id)
            .map((e) => ({ id: e.id, to: e.to_stage_id, name: stageNameFor(e.to_stage_id) }))}
          moveTargets={stages.filter(
            (s) =>
              s.id !== selectedStage.id &&
              !edges.some((e) => e.from_stage_id === selectedStage.id && e.to_stage_id === s.id),
          )}
          onAddMove={(toId) =>
            run(() => salesFlowService.addEdge(flow.id, selectedStage.id, toId, user?.id), `Move to ${stageNameFor(toId)} added.`)
          }
          onRemoveMove={(move) =>
            onEdgesDelete([{ id: move.id, source: selectedStage.id, target: move.to }])
          }
          onToggleTerminal={() => handleToggleTerminal(selectedStage)}
          onToggleAutoMove={() =>
            run(() => salesFlowService.setStageAutoMove(selectedStage.id, !selectedStage.auto_move, user?.id))
          }
          onSetTerminalOutcome={(outcome) =>
            run(() => salesFlowService.setStageTerminalOutcome(selectedStage.id, outcome, user?.id))
          }
          onSetEntry={() => setAsEntryStage(selectedStage.id)}
          onSetAward={() =>
            run(() =>
              salesFlowService.setAwardStage(
                flow.id,
                flow.award_stage_id === selectedStage.id ? null : selectedStage.id,
                user?.id
              )
            )
          }
          onSetWon={() =>
            run(() =>
              salesFlowService.setWonStage(
                flow.id,
                flow.won_stage_id === selectedStage.id ? null : selectedStage.id,
                user?.id
              )
            )
          }
        />
      )}

      <ConfirmDialog
        open={Boolean(dialog)}
        onOpenChange={(open) => !open && setDialog(null)}
        title={dialog?.title}
        description={dialog?.description}
        confirmLabel={dialog?.confirmLabel}
        tone={dialog?.tone}
        confirmDisabled={Boolean(dialog?.required) && !dialogValue.trim()}
        onConfirm={() => dialog?.onConfirm?.(dialogValue.trim())}
      >
        {dialog?.field && (
          <Input
            autoFocus
            label={dialog.field.label}
            placeholder={dialog.field.placeholder}
            value={dialogValue}
            onChange={(e) => setDialogValue(e.target.value)}
          />
        )}
      </ConfirmDialog>

      {/* ── Publish popover (issue #189) ───────────────────────────────── */}
      <ConfirmDialog
        open={publishOpen}
        onOpenChange={(open) => {
          setPublishOpen(open);
          if (!open) setPublishNote("");
        }}
        title={publishLabel}
        description={
          isMinorPublish && dealsOfferedMove > 0
            ? `Publishing freezes this draft as a new Flow Snapshot. ${dealsOfferedMove} deal${dealsOfferedMove === 1 ? "" : "s"} on v${versionPreview.major}.x will be offered a move up afterwards. Nothing moves unless you accept.`
            : versionPreview && !isMinorPublish
              ? "Publishing freezes this draft as a new major Flow Snapshot. Deals already running an older version stay on it and are not offered a move."
              : "Publishing freezes this draft as a new Flow Snapshot. Deals already running an older version keep using it."
        }
        confirmLabel="Publish"
        confirmDisabled={!versionPreview || versionPreview.hasChanges === false}
        onConfirm={() => publishFlow.mutate(publishNote.trim() || null)}
        className="sm:max-w-3xl max-h-[85vh] flex flex-col p-6 gap-5"
        footerClassName="-mx-6 -mb-6 p-6 sm:px-6 sm:py-4 mt-auto shrink-0"
      >
        <div className="space-y-4 flex-1 min-h-0 flex flex-col">
          <Input
            autoFocus
            label="Note (optional)"
            placeholder="Why this version exists…"
            value={publishNote}
            onChange={(e) => setPublishNote(e.target.value)}
          />
          {publishWarnings.length > 0 && (
            <div
              role="status"
              className="rounded-xl border border-amber-6 bg-amber-3 px-4 py-3 text-sm text-foreground shrink-0"
            >
              <p className="mb-1 text-label text-amber-12">
                Worth a look before publishing
              </p>
              <ul className="space-y-0.5">
                {publishWarnings.map((warning) => (
                  <li key={warning}>• {warning}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="rounded-xl border border-border bg-muted/30 p-5 flex-1 min-h-0 flex flex-col">
            <p className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground shrink-0">
              Changes since the latest version
            </p>
            {/* No max-height of its own: the dialog is already capped at 85vh
                and lays out as a column with a fixed header and footer, so
                this is the one part that scrolls. A second, smaller cap here
                made a long change list overflow the dialog instead of
                scrolling inside it. */}
            <div className="flex-1 min-h-0 overflow-y-auto pr-2 scrollbar-thin">
              {versionPreview?.diff ? (
                <DiffSummary
                  result={versionPreview.diff}
                  stageName={stageNameFor}
                  emptyMessage="This draft is identical to the latest version — nothing to publish."
                  className="space-y-3"
                />
              ) : (
                <Spinner size="sm" />
              )}
            </div>
          </div>
        </div>
      </ConfirmDialog>

      {/* ── Revert to this version, from the version banner ─────── */}
      <ConfirmDialog
        open={restoreConfirmOpen}
        onOpenChange={setRestoreConfirmOpen}
        title={`Revert to ${viewingSnapshot ? formatSnapshotVersion(viewingSnapshot) : ""}?`}
        description="This replaces your working draft with this version's stages, moves, and rules. The live published flow will not change until you publish."
        confirmLabel="Revert"
        tone="destructive"
        onConfirm={() => restoreMutation.mutate(viewingSnapshot.id)}
      />

      {/* ── Update-SORs offer, after a minor publish (issues #190, #743) ──── */}
      {(() => {
        const sors = moveOffer?.sors ?? [];
        const chosenIds = idsForUpdateMode(offerMode, sors.map((o) => o.id), offerPicked);
        const modes = [
          [UPDATE_MODE.ALL, "Update all SORs"],
          [UPDATE_MODE.ONLY, "Update only the ones I pick"],
          [UPDATE_MODE.ALL_BUT, "Update all except the ones I pick"],
        ];
        return (
          <ConfirmDialog
            open={Boolean(moveOffer)}
            onOpenChange={(open) => {
              if (!open) setMoveOffer(null);
            }}
            title={`Update ${sors.length} SOR${sors.length === 1 ? "" : "s"} on ${moveOffer?.majorLabel} to ${moveOffer?.targetLabel}?`}
            description="Every earlier version in this major contains every Stage of the new one and shares its Won Stage, so no deal can be stranded and no deal's Realized timing changes. This is opt-in — nothing is updated unless you choose to."
            confirmLabel={`Update ${chosenIds.length} SOR${chosenIds.length === 1 ? "" : "s"}`}
            confirmDisabled={chosenIds.length === 0}
            onConfirm={() =>
              acceptMoveOffer.mutate({
                targetSnapshotId: moveOffer?.targetSnapshotId,
                targetLabel: moveOffer?.targetLabel,
                ids: chosenIds,
              })
            }
          >
            <div className="space-y-3 text-sm">
              <div role="group" aria-label="Which SORs" className="flex flex-wrap gap-2">
                {modes.map(([value, label]) => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={offerMode === value ? "default" : "outline"}
                    aria-pressed={offerMode === value}
                    onClick={() => setOfferMode(value)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              {offerMode !== UPDATE_MODE.ALL && (
                <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
                  {sors.map((o) => {
                    const text = [o.sales_reference, o.client_name, o.project_title].filter(Boolean).join(" · ");
                    return (
                      <li key={o.id} className="flex items-center gap-2">
                        <Checkbox
                          aria-label={text}
                          checked={offerPicked.includes(o.id)}
                          onCheckedChange={(checked) =>
                            setOfferPicked((prev) =>
                              checked ? [...prev, o.id] : prev.filter((x) => x !== o.id),
                            )
                          }
                        />
                        <span className="truncate">{text}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </ConfirmDialog>
        );
      })()}

      {/* ── Move progress ────────────────────────────────────────────────── */}
      {/* Not dismissable: closing it would hide the only sign a move is still
          running, and leaving the page mid-move stops it. */}
      <Dialog open={Boolean(moveProgress)} onOpenChange={() => {}} disablePointerDismissal>
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>
              {`Updating ${moveProgress?.total} SOR${moveProgress?.total === 1 ? "" : "s"} to ${moveProgress?.targetLabel}`}
            </DialogTitle>
            <DialogDescription>
              Keep this page open until it finishes. Closing or reloading it stops the update; the
              SORs not yet updated stay on their current version.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div
              role="progressbar"
              aria-label="Update progress"
              aria-valuemin={0}
              aria-valuemax={moveProgress?.total ?? 0}
              aria-valuenow={moveProgress?.done ?? 0}
              className="h-2 w-full overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-foreground transition-[width] duration-300"
                style={{
                  width: `${moveProgress?.total ? (moveProgress.done / moveProgress.total) * 100 : 0}%`,
                }}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {`Updated ${moveProgress?.done ?? 0} of ${moveProgress?.total ?? 0}`}
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Move result summary ──────────────────────────────────────────── */}
      <ConfirmDialog
        open={Boolean(moveResult)}
        onOpenChange={(open) => {
          if (!open) setMoveResult(null);
        }}
        title="SORs updated"
        confirmLabel="Done"
        onConfirm={() => setMoveResult(null)}
      >
        <div className="space-y-2 text-sm">
          <p>{moveResult?.succeeded?.length ?? 0} updated successfully.</p>
          {moveResult?.failed?.length > 0 && (
            <div className="space-y-1">
              <p className="font-semibold text-destructive">{moveResult.failed.length} failed:</p>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                {moveResult.failed.map((f) => (
                  <li key={f.id}>{f.reason}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </ConfirmDialog>
    </div>
  );
}

const CanvasEmptyState = ({ title, body }) => (
  <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
    <div className="max-w-md rounded-2xl bg-card/80 px-8 py-7 text-center shadow-[0_1px_2px_rgba(0,0,0,0.04),0_16px_40px_-24px_rgba(0,0,0,0.45)] backdrop-blur-sm">
      <p className="text-base font-bold tracking-[-0.01em] text-foreground">{title}</p>
      <p className="mx-auto mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  </div>
);
