import { useState, useCallback, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import dagre from "dagre";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  Lock,
  LockOpen,
  Pencil,
  Plus,
  Sparkles,
  Workflow,
  Trash2,
  Check,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import {
  ReactFlow,
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
import { Input } from "@/components/ui/input";
import Dropdown from "@/components/ui/Dropdown";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Spinner from "@/components/ui/Spinner";
import { Tooltip } from "@/components/ui/Tooltip";

import { salesFlowService } from "../../services/salesFlowService";
import { stageConditionService } from "../../services/stageConditionService";
import { stageActionService } from "../../services/stageActionService";
import { entryStage, flowLockBlockers } from "../../constants/salesFlow";
import { useAuth } from "../../context/AuthContext";
import FlowCanvasNode, { HANDLE_IN, HANDLE_OUT } from "./FlowCanvasNode";
import FlowSatelliteNode from "./FlowSatelliteNode";
import FlowMoveEdge from "./FlowMoveEdge";
import StageSettingsPanel from "./StageSettingsPanel";
import {
  GATE,
  RUN,
  columnSlots,
  satellitePosition,
  stageBox,
} from "./flowCanvasLayout";

const nodeTypes = {
  stage: FlowCanvasNode,
  satellite: FlowSatelliteNode,
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

const EDGE_COLOR = "var(--mauve-9)";
const SATELLITE_COLOR = { [GATE]: "var(--amber-a8)", [RUN]: "var(--violet-a8)" };

const defaultEdgeOptions = {
  type: "move",
  style: { stroke: EDGE_COLOR, strokeWidth: 1.75 },
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: EDGE_COLOR },
};

/**
 * The Flow Canvas (issue #36). The developer and the Operations Manager build
 * the CRM process together on this one screen, against staging.
 *
 * The canvas shows the whole contract of a flow, not just its shape: every
 * Stage carries its conditions below-left and its actions below-right, drawn
 * as satellites of the Stage that owns them. What blocks a deal from leaving
 * and what fires when it arrives are properties of a Stage, so they are read in
 * the same glance as the Stage — no panel, no click.
 *
 * Wired to salesFlowService, stageConditionService and stageActionService.
 * Every question about the flow itself is asked of constants/salesFlow.js, and
 * every question about where a satellite sits is asked of flowCanvasLayout.js,
 * so this component can never disagree with either about the answer.
 */
export default function FlowCanvas() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedSaleTypeId, setSelectedSaleTypeId] = useState("");
  const [newSaleTypeName, setNewSaleTypeName] = useState("");
  const [newStageName, setNewStageName] = useState("");
  // { nodeId, stageId, tab } — one selection covers the Stage and its satellites,
  // because clicking a condition should open the Stage that owns it.
  const [selection, setSelection] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [dialogValue, setDialogValue] = useState("");
  const [toolbarMode, setToolbarMode] = useState("select");
  const [inlineValue, setInlineValue] = useState("");

  const { data: saleTypes, isLoading: loadingTypes } = useQuery({
    queryKey: ["saleTypes", "all"],
    queryFn: () => salesFlowService.getSaleTypes({ includeArchived: true }),
  });

  const effectiveSaleTypeId = selectedSaleTypeId || saleTypes?.[0]?.id || "";

  const { data: canvas, isLoading: loadingCanvas } = useQuery({
    queryKey: ["salesFlow", effectiveSaleTypeId],
    queryFn: () => salesFlowService.getFlow(effectiveSaleTypeId),
    enabled: Boolean(effectiveSaleTypeId),
  });

  const stages = useMemo(() => canvas?.stages ?? [], [canvas?.stages]);
  const edges = useMemo(() => canvas?.edges ?? [], [canvas?.edges]);
  const flow = canvas?.flow ?? null;
  const isLocked = flow?.state === "locked";
  const entry = entryStage(stages);
  const blockers = flow
    ? flowLockBlockers({ stages, edges, wonStageId: flow.won_stage_id })
    : [];

  const stageIds = useMemo(() => stages.map((s) => s.id), [stages]);
  const stageKey = useMemo(() => [...stageIds].sort().join(","), [stageIds]);

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

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["saleTypes"] });
    queryClient.invalidateQueries({ queryKey: ["saleTypes", "all"] });
    queryClient.invalidateQueries({ queryKey: ["salesFlow", effectiveSaleTypeId] });
    queryClient.invalidateQueries({ queryKey: ["stageConditionsByStage"] });
    queryClient.invalidateQueries({ queryKey: ["stageActionsByStage"] });
  }, [queryClient, effectiveSaleTypeId]);

  const createSaleType = useMutation({
    mutationFn: (name) => salesFlowService.createSaleType(name, user?.id),
    onSuccess: () => {
      setNewSaleTypeName("");
      refresh();
      toast.success("Sale Type created.");
    },
    onError: (err) => toast.error(err.message),
  });

  const { mutate: doRun } = useMutation({
    mutationFn: ({ run }) => run(),
    onSuccess: (_data, variables) => {
      refresh();
      if (variables.message) toast.success(variables.message);
    },
    onError: (err) => toast.error(err.message),
  });

  const run = useCallback((fn, message) => doRun({ run: fn, message }), [doRun]);

  /** Opens the one dialog, seeded for whichever question is being asked. */
  const ask = useCallback((config) => {
    setDialogValue(config.initialValue ?? "");
    setDialog(config);
  }, []);

  const selectedStage = stages.find((s) => s.id === selection?.stageId) ?? null;

  const handleAddStage = (e) => {
    e.preventDefault();
    if (!newStageName.trim() || !flow) return;

    // Stagger new nodes so a run of them does not land on one another.
    const offset = (stages.length * 24) % 240;

    run(
      () => salesFlowService.addStage(flow.id, newStageName, user?.id, 120 + offset, 140 + offset),
      "Stage added."
    );
    setNewStageName("");
  };

  const setAsEntryStage = useCallback((stageId) => {
    const order = stages.map((s) => s.id);
    const targetIdx = order.indexOf(stageId);
    if (targetIdx <= 0) return; // Already first, or not in this flow.

    order.splice(targetIdx, 1);
    order.unshift(stageId);

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

  const handleLock = () => {
    ask({
      title: "Lock this flow?",
      description:
        "It becomes read-only — no Stages, moves, conditions or actions can be changed until somebody unlocks it and says why.",
      confirmLabel: "Lock flow",
      onConfirm: () => run(() => salesFlowService.lockFlow(flow.id, user?.id), "Flow locked."),
    });
  };

  const handleUnlock = () => {
    ask({
      title: "Reopen this flow?",
      description: "The reason is recorded against the flow, so later readers know what changed and why.",
      confirmLabel: "Unlock flow",
      field: { label: "Reason", placeholder: "e.g. Post-qualification now needs a second signatory" },
      required: true,
      onConfirm: (reason) =>
        run(() => salesFlowService.unlockFlow(flow.id, reason, user?.id), "Flow unlocked."),
    });
  };

  const handleRemoveEdge = useCallback(
    (edgeId) => {
      if (isLocked) return;
      run(() => salesFlowService.removeEdge(edgeId, user?.id), "Move removed.");
    },
    [isLocked, user?.id, run]
  );

  // --- React Flow state ------------------------------------------------------

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState([]);

  useEffect(() => {
    const nodes = [];
    const satelliteEdges = [];

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
        { column: RUN, items: actionsByStage[stage.id] ?? [], variant: "action", addLabel: "Action" },
      ];

      columns.forEach(({ column, items, variant, addLabel }) => {
        const { shown, overflow } = columnSlots(items.length);

        items.slice(0, shown).forEach((item, i) => {
          addSatellite(stage, column, i, `sat:${stage.id}:${column}:${item.id}`, {
            variant,
            [variant]: item,
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
        if (isSelected && !isLocked && overflow === 0) {
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
      },
    }));

    setRfNodes(nodes);
    setRfEdges([...satelliteEdges, ...flowEdges]);
  }, [
    stages,
    edges,
    flow,
    isLocked,
    entry,
    conditionsByStage,
    actionsByStage,
    selection,
    handleRemoveEdge,
    setRfNodes,
    setRfEdges,
  ]);

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
      // Only Stage-to-Stage is a move. A satellite is a property of its Stage,
      // and the schema has nowhere to put an edge that ends on one.
      if (isLocked || !stageIdSet.has(params.source) || !stageIdSet.has(params.target)) return;
      run(() => salesFlowService.addEdge(flow.id, params.source, params.target, user?.id));
    },
    [isLocked, flow, user?.id, run, stageIdSet]
  );

  const onEdgesDelete = useCallback(
    (edgesToDelete) => {
      if (isLocked) return;
      edgesToDelete
        .filter((edge) => !edge.id.startsWith("satedge:"))
        .forEach((edge) => run(() => salesFlowService.removeEdge(edge.id, user?.id)));
    },
    [isLocked, user?.id, run]
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
      tab: node.data.column === GATE ? "conditions" : "actions",
    });
  }, []);

  const onPaneClick = useCallback(() => setSelection(null), []);

  const handleAutoLayout = useCallback(() => {
    if (isLocked || stages.length === 0) return;

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
  }, [isLocked, stages, edges, conditionsByStage, actionsByStage, user?.id, refresh]);

  const selectedSaleType = saleTypes?.find((t) => t.id === effectiveSaleTypeId) ?? null;
  const showEmptySaleTypes = !effectiveSaleTypeId && !loadingTypes;

  return (
    <div className="relative flex h-full min-h-[34rem] w-full flex-col overflow-hidden bg-mauve-3">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
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
        fitView
        fitViewOptions={{ padding: 0.24, maxZoom: 1 }}
        minZoom={0.15}
        maxZoom={1.75}
        panOnScroll
        selectionOnDrag={false}
        proOptions={{ hideAttribution: false }}
        attributionPosition="bottom-left"
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
        {stages.length > 1 && (
          <MiniMap
            pannable
            zoomable
            position="top-right"
            className="!top-20 !right-4 !mb-0 !h-24 !w-40 !rounded-xl !bg-card"
            maskColor="var(--mauve-a4)"
            nodeColor={(node) =>
              node.type === "stage" ? "var(--mauve-9)" : "var(--mauve-6)"
            }
            nodeStrokeWidth={0}
            nodeBorderRadius={4}
          />
        )}
      </ReactFlow>

      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-3">
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
                  value={inlineValue}
                  onChange={e => setInlineValue(e.target.value)}
                  className="h-8 w-40 text-xs font-bold"
                />
                <Button type="submit" size="icon-sm" variant="ghost" className="text-green-600 hover:text-green-700 hover:bg-green-100 dark:hover:bg-green-900/30">
                  <Check size={14} />
                </Button>
                <Button type="button" size="icon-sm" variant="ghost" onClick={() => setToolbarMode("select")}>
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
                    <button
                      className={cn(
                        "flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-bold transition-colors hover:bg-mauve-a3",
                        "outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                        selectedSaleType?.archived_at && "opacity-60"
                      )}
                    >
                      <span className="truncate max-w-[200px]">
                        {selectedSaleType ? selectedSaleType.name : "Select Sale Type"}
                      </span>
                      <ChevronDown size={14} className="text-muted-foreground" />
                    </button>
                  }
                >
                  {({ close }) => (
                    <div className="flex max-h-[60vh] flex-col overflow-y-auto">
                      {saleTypes?.map((saleType) => (
                        <button
                          key={saleType.id}
                          onClick={() => {
                            setSelectedSaleTypeId(saleType.id);
                            setSelection(null);
                            close();
                          }}
                          className={cn(
                            "flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-semibold transition-colors hover:bg-mauve-a3",
                            saleType.id === effectiveSaleTypeId && "bg-foreground text-background hover:bg-foreground hover:text-background",
                            saleType.archived_at && "opacity-60"
                          )}
                        >
                          {saleType.name} {saleType.archived_at && "(Archived)"}
                        </button>
                      ))}
                    </div>
                  )}
                </Dropdown>

                {selectedSaleType && (
                  <>
                    <Tooltip content="Rename inline">
                      <Button
                        variant="ghost"
                        size="icon-sm"
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
                          <Button variant="ghost" size="icon-sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive">
                            <Trash2 size={14} />
                          </Button>
                        }
                      >
                        {({ close }) => (
                          <div className="flex flex-col gap-1">
                            <button
                              onClick={() => {
                                close();
                                ask({
                                  title: `Restore “${selectedSaleType.name}”?`,
                                  description: "It will be active and offered on new deals again.",
                                  confirmLabel: "Restore",
                                  onConfirm: () => run(() => salesFlowService.restoreSaleType(selectedSaleType.id, user?.id), "Sale Type restored."),
                                });
                              }}
                              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-semibold text-foreground transition-colors hover:bg-mauve-a3"
                            >
                              <ArchiveRestore size={15} className="text-muted-foreground" />
                              Restore
                            </button>
                            <button
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
                              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-semibold text-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                            >
                              <Trash2 size={15} className="text-destructive/80" />
                              Delete permanently
                            </button>
                          </div>
                        )}
                      </Dropdown>
                    ) : (
                      <Tooltip content="Archive">
                        <Button
                          variant="ghost"
                          size="icon-sm"
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
                        <p className="mb-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground">
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
              </>
            )}
          </div>
        </div>

        {flow && (
          <div className="pointer-events-auto flex shrink-0 items-center gap-1 rounded-2xl bg-card/85 p-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_28px_-18px_rgba(0,0,0,0.4)] backdrop-blur-md">
            {isLocked ? (
              <>
                <span className="flex items-center gap-1.5 rounded-xl bg-amber-a3 px-2.5 py-1.5 text-[11px] font-black uppercase tracking-[0.12em] text-amber-11">
                  <Lock size={12} strokeWidth={3} /> Locked
                </span>
                <Button variant="ghost" size="lg" onClick={handleUnlock}>
                  <LockOpen /> Unlock
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="lg"
                  onClick={handleAutoLayout}
                  disabled={stages.length === 0}
                >
                  <Sparkles /> Tidy layout
                </Button>
                {/* The span carries the tooltip: a disabled button emits no
                    pointer events, so the reason it is disabled would never
                    be readable from the control itself. */}
                <Tooltip
                  content={blockers.length > 0 ? blockers.join(" ") : null}
                  side="bottom"
                >
                  <span className="inline-flex">
                    <Button
                      variant="ghost"
                      size="lg"
                      onClick={handleLock}
                      disabled={blockers.length > 0}
                    >
                      <Lock /> Lock this flow
                    </Button>
                  </span>
                </Tooltip>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Why this flow is not lockable yet ───────────────────────────── */}
      {blockers.length > 0 && !isLocked && (
        <ul
          aria-label="Why this flow cannot be locked yet"
          className="pointer-events-none absolute left-3 top-[4.25rem] z-10 max-w-sm space-y-1 rounded-2xl bg-amber-a3 px-4 py-3 backdrop-blur-md"
        >
          {blockers.map((blocker) => (
            <li key={blocker} className="text-xs font-semibold leading-relaxed text-amber-11">
              • {blocker}
            </li>
          ))}
        </ul>
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
          body="Name the first Stage below. Drag a node to place it, drag from its right edge to another node's left edge to draw a move, and select a Stage to hang conditions and actions off it."
        />
      )}

      {loadingCanvas && !flow && effectiveSaleTypeId && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <Spinner size="md" />
        </div>
      )}

      {/* ── Add-Stage dock ──────────────────────────────────────────────── */}
      {flow && !isLocked && (
        <form
          onSubmit={handleAddStage}
          className="absolute bottom-4 left-4 z-20 flex items-center gap-2 rounded-2xl bg-card/85 p-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_28px_-18px_rgba(0,0,0,0.4)] backdrop-blur-md"
        >
          <Input
            value={newStageName}
            onChange={(e) => setNewStageName(e.target.value)}
            placeholder="Name a Stage in your own words…"
            className="h-9 w-64 border-transparent bg-transparent"
          />
          <Button type="submit" size="lg" disabled={!newStageName.trim()}>
            <Plus /> Add Stage
          </Button>
        </form>
      )}

      {/* ── Stage panel ─────────────────────────────────────────────────── */}
      {selectedStage && flow && (
        <StageSettingsPanel
          stage={selectedStage}
          isEntry={entry?.id === selectedStage.id}
          isWon={flow.won_stage_id === selectedStage.id}
          disabled={isLocked}
          activeTab={selection.tab}
          onTabChange={(tab) => setSelection((prev) => ({ ...prev, tab }))}
          onClose={() => setSelection(null)}
          onRename={(name) =>
            run(() => salesFlowService.renameStage(selectedStage.id, name, user?.id))
          }
          onDelete={() => handleDeleteStage(selectedStage)}
          onToggleTerminal={() => handleToggleTerminal(selectedStage)}
          onSetEntry={() => setAsEntryStage(selectedStage.id)}
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
