import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Archive,
  Flag,
  Lock,
  LockOpen,
  Plus,
  Trash2,
  Workflow,
} from "lucide-react";
import toast from "react-hot-toast";

import { salesFlowService } from "../../services/salesFlowService";
import { entryStage, flowLockBlockers, outgoingStages } from "../../constants/salesFlow";
import { useAuth } from "../../context/AuthContext";

/**
 * The Flow Canvas (issue #36). The developer and the Operations Manager build
 * the CRM process together on this one screen, against staging.
 *
 * WHY THIS IS A STRUCTURED LIST AND NOT A DRAG-AND-DROP NODE GRAPH
 * The canvas is scaffolding, scheduled to be hidden once the flow it produces
 * is implemented (issue #36). A node editor is the most expensive thing to
 * build here and the first thing thrown away. What the Operations Manager
 * actually needs is to see the whole flow for one Sale Type at once and
 * rearrange it without asking anyone — a Stage list, and per Stage the Stages
 * it may move to, gives her both. Edges are drawn by ticking a destination,
 * which also makes a loop back and a skip ahead ordinary rather than a
 * gesture she has to discover.
 *
 * Wired to salesFlowService only — the same "no direct table access from the
 * UI" rule StageRequirementManager and PipelineStageManager already follow.
 * Every question about the flow itself (where deals enter, why it cannot be
 * locked) is asked of constants/salesFlow.js, so this component and the
 * service can never disagree about the answer.
 */
export default function FlowCanvas() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedSaleTypeId, setSelectedSaleTypeId] = useState("");
  const [newSaleTypeName, setNewSaleTypeName] = useState("");
  const [newStageName, setNewStageName] = useState("");

  const { data: saleTypes, isLoading: loadingTypes } = useQuery({
    queryKey: ["saleTypes"],
    queryFn: () => salesFlowService.getSaleTypes(),
  });

  // Falls back to the first Sale Type until she picks one explicitly —
  // derived on render rather than synced through an effect, so there is no
  // moment where the picker and the loaded flow disagree.
  const effectiveSaleTypeId = selectedSaleTypeId || saleTypes?.[0]?.id || "";

  const { data: canvas } = useQuery({
    queryKey: ["salesFlow", effectiveSaleTypeId],
    queryFn: () => salesFlowService.getFlow(effectiveSaleTypeId),
    enabled: Boolean(effectiveSaleTypeId),
  });

  const stages = canvas?.stages ?? [];
  const edges = canvas?.edges ?? [];
  const flow = canvas?.flow ?? null;
  const isLocked = flow?.state === "locked";
  const entry = entryStage(stages);
  const blockers = flow
    ? flowLockBlockers({ stages, edges, wonStageId: flow.won_stage_id })
    : [];

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["saleTypes"] });
    queryClient.invalidateQueries({ queryKey: ["salesFlow", effectiveSaleTypeId] });
  };

  const createSaleType = useMutation({
    mutationFn: (name) => salesFlowService.createSaleType(name, user?.id),
    onSuccess: () => {
      setNewSaleTypeName("");
      refresh();
      toast.success("Sale Type created.");
    },
    onError: (err) => toast.error(err.message),
  });

  // Every other write on this screen has the same shape — call the service,
  // refresh, toast on failure — so they share one mutation rather than
  // declaring a dozen near-identical ones.
  const mutate = useMutation({
    mutationFn: ({ run }) => run(),
    onSuccess: (_data, variables) => {
      refresh();
      if (variables.message) toast.success(variables.message);
    },
    onError: (err) => toast.error(err.message),
  });

  const run = (fn, message) => mutate.mutate({ run: fn, message });

  const handleAddStage = (e) => {
    e.preventDefault();
    if (!newStageName.trim() || !flow) return;
    run(() => salesFlowService.addStage(flow.id, newStageName, user?.id), "Stage added.");
    setNewStageName("");
  };

  const handleRenameStage = (stage) => {
    const name = window.prompt("Rename this Stage", stage.name);
    if (name === null || name.trim() === stage.name) return;
    run(() => salesFlowService.renameStage(stage.id, name, user?.id));
  };

  const moveStage = (index, direction) => {
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= stages.length) return;

    const order = stages.map((s) => s.id);
    [order[index], order[target]] = [order[target], order[index]];
    run(() => salesFlowService.reorderStages(flow.id, order, user?.id));
  };

  const handleDeleteStage = (stage) => {
    if (!window.confirm(`Delete "${stage.name}"? Every move drawn to or from it goes too.`)) return;
    run(() => salesFlowService.deleteStage(stage.id, user?.id), "Stage deleted.");
  };

  const toggleEdge = (from, to, exists) => {
    const edge = edges.find((e) => e.from_stage_id === from.id && e.to_stage_id === to.id);
    run(() =>
      exists
        ? salesFlowService.removeEdge(edge.id, user?.id)
        : salesFlowService.addEdge(flow.id, from.id, to.id, user?.id),
    );
  };

  const handleLock = () => {
    if (!window.confirm("Lock this flow? It becomes read-only until it is unlocked with a reason.")) {
      return;
    }
    run(() => salesFlowService.lockFlow(flow.id, user?.id), "Flow locked.");
  };

  const handleUnlock = () => {
    const reason = window.prompt("Why is this flow being reopened?");
    if (reason === null) return;
    run(() => salesFlowService.unlockFlow(flow.id, reason, user?.id), "Flow unlocked.");
  };

  return (
    <div className="space-y-5">
      <SaleTypeBar
        saleTypes={saleTypes}
        isLoading={loadingTypes}
        selectedId={effectiveSaleTypeId}
        onSelect={setSelectedSaleTypeId}
        newName={newSaleTypeName}
        onNewNameChange={setNewSaleTypeName}
        onCreate={() => createSaleType.mutate(newSaleTypeName)}
        onRename={(saleType) => {
          const name = window.prompt("Rename this Sale Type", saleType.name);
          if (name === null || name.trim() === saleType.name) return;
          run(() => salesFlowService.renameSaleType(saleType.id, name, user?.id));
        }}
        onArchive={(saleType) => {
          if (!window.confirm(`Archive "${saleType.name}"? Deals that carry it keep reading its name.`)) {
            return;
          }
          run(() => salesFlowService.archiveSaleType(saleType.id, user?.id), "Sale Type archived.");
        }}
      />

      {!effectiveSaleTypeId && !loadingTypes && (
        <EmptyState
          title="No Sale Types yet"
          body="Create one above. The list starts empty on purpose — the system proposes no categories, because the process has to match how the business actually sells."
        />
      )}

      {flow && (
        <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border bg-muted/30 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5">
              <div className="w-6 h-6 rounded-lg bg-muted flex items-center justify-center">
                <Workflow size={14} className="text-foreground" />
              </div>
              <h2 className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">
                Sales Flow
              </h2>
              {isLocked && (
                <span className="text-[10px] font-black uppercase tracking-widest text-amber-600 flex items-center gap-1">
                  <Lock size={11} /> Locked
                </span>
              )}
            </div>

            {isLocked ? (
              <button
                onClick={handleUnlock}
                className="text-xs font-bold text-foreground flex items-center gap-1 hover:bg-muted px-2.5 py-1.5 rounded-lg transition-colors"
              >
                <LockOpen size={14} /> Unlock
              </button>
            ) : (
              <button
                onClick={handleLock}
                disabled={blockers.length > 0}
                title={blockers.join(" ")}
                className="text-xs font-bold text-foreground flex items-center gap-1 hover:bg-muted px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Lock size={14} /> Lock this flow
              </button>
            )}
          </div>

          <div className="p-5 space-y-5">
            <WonStagePicker
              stages={stages}
              wonStageId={flow.won_stage_id}
              disabled={isLocked}
              onChange={(stageId) =>
                run(() => salesFlowService.setWonStage(flow.id, stageId, user?.id))
              }
            />

            {blockers.length > 0 && !isLocked && (
              <ul
                aria-label="Why this flow cannot be locked yet"
                className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-1"
              >
                {blockers.map((blocker) => (
                  <li key={blocker} className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                    {blocker}
                  </li>
                ))}
              </ul>
            )}

            {stages.length === 0 ? (
              <EmptyState
                title="No Stages yet"
                body="Add the first Stage below. Whichever Stage sits at the top is where deals enter this flow."
              />
            ) : (
              <ol aria-label="Stages" className="space-y-3">
                {stages.map((stage, index) => (
                  <StageRow
                    key={stage.id}
                    stage={stage}
                    index={index}
                    stages={stages}
                    edges={edges}
                    isEntry={entry?.id === stage.id}
                    isWon={flow.won_stage_id === stage.id}
                    disabled={isLocked}
                    onRename={() => handleRenameStage(stage)}
                    onMoveUp={() => moveStage(index, "up")}
                    onMoveDown={() => moveStage(index, "down")}
                    onDelete={() => handleDeleteStage(stage)}
                    onToggleTerminal={() =>
                      run(() =>
                        salesFlowService.setStageTerminal(stage.id, !stage.is_terminal, user?.id),
                      )
                    }
                    onToggleEdge={toggleEdge}
                  />
                ))}
              </ol>
            )}

            {!isLocked && (
              <form onSubmit={handleAddStage} className="flex gap-2">
                <input
                  value={newStageName}
                  onChange={(e) => setNewStageName(e.target.value)}
                  placeholder="Name a Stage in your own words…"
                  className="flex-1 h-10 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <button
                  type="submit"
                  className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-bold flex items-center gap-1"
                >
                  <Plus size={14} /> Add Stage
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One Stage: what it is called, what it is (entry, Won, terminal), and every
 * Stage a deal may move to from it. The destinations are the edges — ticking
 * one draws the move, which makes a loop back and a skip ahead ordinary rows
 * rather than gestures she has to discover.
 */
function StageRow({
  stage,
  index,
  stages,
  edges,
  isEntry,
  isWon,
  disabled,
  onRename,
  onMoveUp,
  onMoveDown,
  onDelete,
  onToggleTerminal,
  onToggleEdge,
}) {
  const destinations = outgoingStages(stage.id, stages, edges);
  const destinationIds = new Set(destinations.map((s) => s.id));

  return (
    <li className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={onRename}
            disabled={disabled}
            className="text-sm font-black text-foreground hover:underline disabled:no-underline disabled:cursor-default"
          >
            {stage.name}
          </button>
          {isEntry && <Tag>Deals enter here</Tag>}
          {isWon && (
            <Tag className="text-emerald-700 dark:text-emerald-400">
              <Flag size={10} className="inline mr-0.5" />
              Won
            </Tag>
          )}
          {stage.is_terminal && <Tag>Deals stop here</Tag>}
        </div>

        {!disabled && (
          <div className="flex items-center gap-1">
            <IconButton onClick={onMoveUp} disabled={index === 0} label="Move up">
              <ArrowUp size={14} />
            </IconButton>
            <IconButton onClick={onMoveDown} disabled={index === stages.length - 1} label="Move down">
              <ArrowDown size={14} />
            </IconButton>
            <button
              onClick={onToggleTerminal}
              className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-lg hover:bg-muted transition-colors"
            >
              {stage.is_terminal ? "Not terminal" : "Terminal"}
            </button>
            <IconButton onClick={onDelete} label="Delete Stage">
              <Trash2 size={14} />
            </IconButton>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">
          May move to
        </p>
        {stages.length === 1 ? (
          <p className="text-xs text-muted-foreground">Add another Stage to draw a move.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {stages
              .filter((s) => s.id !== stage.id)
              .map((target) => {
                const drawn = destinationIds.has(target.id);
                return (
                  <button
                    key={target.id}
                    disabled={disabled}
                    onClick={() => onToggleEdge(stage, target, drawn)}
                    className={`text-xs font-bold px-2.5 py-1 rounded-lg border transition-colors disabled:cursor-not-allowed ${
                      drawn
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {target.name}
                  </button>
                );
              })}
          </div>
        )}
        {destinations.length === 0 && !stage.is_terminal && (
          <p className="text-xs text-amber-600">
            Nothing is drawn from this Stage, so a deal that reaches it cannot leave.
          </p>
        )}
      </div>
    </li>
  );
}

function WonStagePicker({ stages, wonStageId, disabled, onChange }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-bold text-muted-foreground">
        Where have we won the deal?
      </label>
      <select
        value={wonStageId || ""}
        disabled={disabled || stages.length === 0}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        className="w-full h-10 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-60"
      >
        <option value="">Not set</option>
        {stages.map((stage) => (
          <option key={stage.id} value={stage.id}>
            {stage.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function SaleTypeBar({
  saleTypes,
  isLoading,
  selectedId,
  onSelect,
  newName,
  onNewNameChange,
  onCreate,
  onRename,
  onArchive,
}) {
  const selected = saleTypes?.find((t) => t.id === selectedId) ?? null;

  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm p-5 space-y-3">
      <h2 className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">
        Sale Types
      </h2>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {saleTypes?.map((saleType) => (
            <button
              key={saleType.id}
              onClick={() => onSelect(saleType.id)}
              className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-colors ${
                saleType.id === selectedId
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {saleType.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <input
          value={newName}
          onChange={(e) => onNewNameChange(e.target.value)}
          placeholder="Name a Sale Type…"
          className="flex-1 min-w-[12rem] h-10 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
        <button
          onClick={onCreate}
          className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-bold flex items-center gap-1"
        >
          <Plus size={14} /> Add Sale Type
        </button>
        {selected && (
          <>
            <button
              onClick={() => onRename(selected)}
              className="h-10 px-3 rounded-lg border border-border text-xs font-bold hover:bg-muted transition-colors"
            >
              Rename
            </button>
            <button
              onClick={() => onArchive(selected)}
              className="h-10 px-3 rounded-lg border border-border text-xs font-bold hover:bg-muted transition-colors flex items-center gap-1"
            >
              <Archive size={13} /> Archive
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const Tag = ({ children, className = "" }) => (
  <span
    className={`text-[10px] font-black uppercase tracking-widest text-muted-foreground ${className}`}
  >
    {children}
  </span>
);

const IconButton = ({ onClick, disabled, label, children }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    title={label}
    className="p-1.5 rounded-lg hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
  >
    {children}
  </button>
);

const EmptyState = ({ title, body }) => (
  <div className="rounded-xl border border-dashed border-border p-6 text-center space-y-1">
    <p className="text-sm font-black text-foreground">{title}</p>
    <p className="text-xs text-muted-foreground max-w-prose mx-auto">{body}</p>
  </div>
);
