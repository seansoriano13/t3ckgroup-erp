import { useState } from "react";
import { ArrowUpCircle, Check, Flag, Octagon, Pencil, Tag, Trash2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import TabGroup from "@/components/ui/TabGroup";
import StageConditionManager from "./StageConditionManager";
import StageActionManager from "./StageActionManager";
import StageFieldManager from "./StageFieldManager";
import StageAccessManager from "./StageAccessManager";
import FollowUpCadenceEditor from "./FollowUpCadenceEditor";
import { SelectField } from "@/components/ui/SelectField";

/**
 * Everything a single Stage is, opened beside the canvas.
 *
 * The tab is controlled by the canvas rather than owned here, because the
 * canvas is what knows which tab the click meant: selecting a condition
 * satellite opens Conditions, an action satellite opens Actions, and the
 * Stage node itself opens General.
 */

const ROLE_BUTTON =
  "h-auto justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-bold outline outline-1 -outline-offset-1 disabled:cursor-not-allowed disabled:opacity-50";

const COLOR_SWATCHES = [
  { value: null, dot: "bg-mauve-8", label: "Default (by role)" },
  { value: "mauve", dot: "bg-mauve-9", label: "Mauve" },
  { value: "amber", dot: "bg-amber-9", label: "Amber" },
  { value: "blue", dot: "bg-blue-9", label: "Blue" },
  { value: "red", dot: "bg-red-9", label: "Red" },
  { value: "violet", dot: "bg-violet-9", label: "Violet" },
  { value: "orange", dot: "bg-orange-9", label: "Orange" },
  { value: "green", dot: "bg-green-9", label: "Green" },
];

export default function StageSettingsPanel({
  stage,
  isEntry,
  isWon,
  disabled,
  bracketOptions = [],
  activeTab = "settings",
  onTabChange,
  onClose,
  onRename,
  onColorChange,
  onBracketChange,
  onDelete,
  onToggleTerminal,
  onSetEntry,
  onSetWon,
  outgoingMoves = [],
  moveTargets = [],
  onAddMove,
  onRemoveMove,
}) {
  // `{ stageId, value }` while the name is being edited, null otherwise. Tying
  // the draft to the Stage it belongs to is what makes selecting a different
  // Stage close the editor — no effect mirroring the prop into state, and no
  // stale draft landing on the wrong Stage.
  const [draft, setDraft] = useState(null);
  // Same shape, for the bracket label — its own draft so typing in one field
  // never stomps a half-finished edit in the other.
  const [bracketDraft, setBracketDraft] = useState(null);

  if (!stage) return null;

  const isEditingName = draft?.stageId === stage.id;
  const isEditingBracket = bracketDraft?.stageId === stage.id;
  const bracketValue = isEditingBracket ? bracketDraft.value : stage.bracket_label || "";

  const handleSaveName = () => {
    const next = (draft?.value ?? "").trim();
    if (next && next !== stage.name) onRename(next);
    setDraft(null);
  };

  const handleSaveBracket = () => {
    const next = (bracketDraft?.value ?? "").trim();
    if (next !== (stage.bracket_label || "")) onBracketChange(next || null);
    setBracketDraft(null);
  };

  // No icons, and the dense size: five labelled tabs have to fit 26rem
  // without scrolling. They did not before, and because TabGroup hides its
  // scrollbar, "Access" simply vanished off the right edge — the per-Stage
  // access settings looked like they did not exist.
  const tabs = [
    { value: "settings", label: "General" },
    { value: "fields", label: "Fields" },
    { value: "conditions", label: "Conditions" },
    { value: "actions", label: "Actions" },
    { value: "access", label: "Access" },
  ];

  return (
    <aside
      className={cn(
        "absolute bottom-0 right-0 top-[4.25rem] z-30 flex w-[26rem] max-w-[92vw] flex-col bg-card",
        "shadow-[-1px_0_0_var(--mauve-6),-24px_0_48px_-32px_rgba(0,0,0,0.5)]",
        "animate-in slide-in-from-right-4 fade-in-0 duration-200 ease-out",
      )}
    >
      <header className="flex items-start gap-3 border-b border-mauve-5 px-5 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">
            Stage
          </p>
          {isEditingName && !disabled ? (
            <Input
              autoFocus
              value={draft.value}
              onChange={(e) => setDraft({ stageId: stage.id, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveName();
                if (e.key === "Escape") setDraft(null);
              }}
              onBlur={handleSaveName}
              aria-label="Stage name"
              className="mt-1 h-9 text-base font-bold"
            />
          ) : (
            <Button
              type="button"
              variant="ghost"
              disabled={disabled}
              onClick={() => setDraft({ stageId: stage.id, value: stage.name })}
              className="group mt-0.5 h-auto w-full justify-start gap-2 rounded-md p-0 text-left hover:bg-transparent disabled:cursor-default"
            >
              <h2 className="truncate text-lg font-bold tracking-[-0.015em] text-foreground">
                {stage.name}
              </h2>
              {!disabled && (
                <Pencil
                  size={13}
                  className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                />
              )}
            </Button>
          )}
        </div>

        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close Stage panel">
          <X />
        </Button>
      </header>

      <div className="border-b border-mauve-5 px-4 py-3">
        <TabGroup
          tabs={tabs}
          activeTab={activeTab}
          onChange={onTabChange}
          variant="pill"
          size="xs"
          fullWidth
        />
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto overflow-x-hidden">
        {activeTab === "settings" && (
          <div className="space-y-5 p-5">
            <section className="space-y-2.5">
              <h3 className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">
                Role in the flow
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="ghost"
                  onClick={onSetEntry}
                  disabled={disabled}
                  className={cn(
                    ROLE_BUTTON,
                    isEntry
                      ? "bg-blue-a3 text-blue-11 outline-blue-a6 hover:bg-blue-a3 hover:text-blue-11"
                      : "text-foreground outline-mauve-6 hover:bg-mauve-a3",
                  )}
                >
                  <ArrowUpCircle size={14} /> {isEntry ? "Deals enter here" : "Make it the entry"}
                </Button>

                <Button
                  variant="ghost"
                  onClick={onSetWon}
                  disabled={disabled}
                  className={cn(
                    ROLE_BUTTON,
                    isWon
                      ? "bg-green-a3 text-green-11 outline-green-a6 hover:bg-green-a3 hover:text-green-11"
                      : "text-foreground outline-mauve-6 hover:bg-mauve-a3",
                  )}
                >
                  <Flag size={14} /> {isWon ? "Deals are won here" : "Make it the win"}
                </Button>

                <Button
                  variant="ghost"
                  onClick={onToggleTerminal}
                  disabled={disabled}
                  className={cn(
                    ROLE_BUTTON,
                    stage.is_terminal
                      ? "bg-amber-a3 text-amber-11 outline-amber-a6 hover:bg-amber-a3 hover:text-amber-11"
                      : "text-foreground outline-mauve-6 hover:bg-mauve-a3",
                  )}
                >
                  {stage.is_terminal ? <Check size={14} /> : <Octagon size={14} />}
                  {stage.is_terminal ? "Deals end here" : "Make it terminal"}
                </Button>

                <Button
                  variant="ghost"
                  onClick={onDelete}
                  disabled={disabled}
                  aria-label="Delete Stage"
                  className={cn(
                    ROLE_BUTTON,
                    "text-destructive outline-destructive/30 hover:bg-destructive/10 hover:text-destructive",
                  )}
                >
                  <Trash2 size={14} /> Delete Stage
                </Button>
              </div>
            </section>

            {/* The form twin of dragging a connection on the canvas, so a move can be
                made (and read back) without a pointer. */}
            {onAddMove && (
              <section className="space-y-2.5">
                <h3 className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">
                  Deals can move to
                </h3>
                {outgoingMoves.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No moves yet{stage.is_terminal ? ", and none are needed: deals end here." : ". Deals here have nowhere to go."}
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {outgoingMoves.map((move) => (
                      <li
                        key={move.id}
                        className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-foreground outline outline-1 -outline-offset-1 outline-mauve-6"
                      >
                        <span className="truncate">{move.name}</span>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={disabled}
                          onClick={() => onRemoveMove(move)}
                          aria-label={`Remove move to ${move.name}`}
                        >
                          <X size={14} />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                {!disabled && moveTargets.length > 0 && (
                  <SelectField
                    aria-label="Add a move to another Stage"
                    value={null}
                    onChange={(next) => next && onAddMove(next)}
                    options={moveTargets.map((target) => ({ value: target.id, label: target.name }))}
                    placeholder="Add a move to…"
                    className="w-full"
                  />
                )}
              </section>
            )}

            <section className="space-y-2.5">
              <h3 className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">
                Color
              </h3>
              <div className="flex flex-wrap gap-2">
                {COLOR_SWATCHES.map((swatch) => (
                  <Button
                    key={swatch.value ?? "default"}
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled}
                    onClick={() => onColorChange(swatch.value)}
                    aria-label={swatch.label}
                    title={swatch.label}
                    className={cn(
                      "rounded-full outline outline-1 -outline-offset-1 outline-mauve-6 transition-transform hover:scale-110 disabled:cursor-not-allowed disabled:opacity-50",
                      (stage.color ?? null) === swatch.value && "outline-2 outline-primary",
                    )}
                  >
                    <span className={cn("size-4 rounded-full", swatch.dot)} />
                  </Button>
                ))}
              </div>
            </section>

            <section className="space-y-2.5">
              <h3 className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">
                <Tag size={11} /> Bracket
              </h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Groups this Stage under a shared heading — Stages carrying the same text read as
                one bracket wherever the flow's Stages are shown in order. Context only; nothing
                else in the flow reads it.
              </p>
              <div className="flex items-center gap-1.5">
                <Input
                  value={bracketValue}
                  disabled={disabled}
                  list="stage-bracket-options"
                  placeholder="e.g. Pre-Sales"
                  onChange={(e) => setBracketDraft({ stageId: stage.id, value: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveBracket();
                    if (e.key === "Escape") setBracketDraft(null);
                  }}
                  onBlur={handleSaveBracket}
                  aria-label="Bracket label"
                  className="h-9 text-sm"
                />
                {stage.bracket_label && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled}
                    onClick={() => {
                      setBracketDraft(null);
                      onBracketChange(null);
                    }}
                    aria-label="Clear bracket"
                  >
                    <X size={14} />
                  </Button>
                )}
              </div>
              <datalist id="stage-bracket-options">
                {bracketOptions.map((label) => (
                  <option key={label} value={label} />
                ))}
              </datalist>
            </section>

            <p className="text-xs leading-relaxed text-muted-foreground">
              A Stage moves a deal on only along the edges drawn from it. Conditions block the
              way out; actions fire on the way in.
            </p>

            <FollowUpCadenceEditor stageId={stage.id} disabled={disabled} />
          </div>
        )}

        {activeTab === "fields" && (
          <StageFieldManager stageId={stage.id} disabled={disabled} />
        )}

        {activeTab === "conditions" && (
          <StageConditionManager stageId={stage.id} disabled={disabled} />
        )}

        {activeTab === "actions" && (
          <StageActionManager stageId={stage.id} disabled={disabled} />
        )}

        {activeTab === "access" && (
          <StageAccessManager stageId={stage.id} flowId={stage.flow_id} disabled={disabled} />
        )}
      </div>
    </aside>
  );
}
