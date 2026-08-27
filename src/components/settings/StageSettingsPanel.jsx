import { useState } from "react";
import {
  ArrowUpCircle,
  Check,
  Flag,
  ListTodo,
  Octagon,
  Pencil,
  Settings2,
  Trash2,
  Wand2,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import TabGroup from "@/components/ui/TabGroup";
import StageConditionManager from "./StageConditionManager";
import StageActionManager from "./StageActionManager";

/**
 * Everything a single Stage is, opened beside the canvas.
 *
 * The tab is controlled by the canvas rather than owned here, because the
 * canvas is what knows which tab the click meant: selecting a condition
 * satellite opens Conditions, an action satellite opens Actions, and the
 * Stage node itself opens General.
 */

const ROLE_BUTTON =
  "flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-bold transition-colors duration-150 outline outline-1 -outline-offset-1 disabled:cursor-not-allowed disabled:opacity-50";

export default function StageSettingsPanel({
  stage,
  isEntry,
  isWon,
  disabled,
  activeTab = "settings",
  onTabChange,
  onClose,
  onRename,
  onDelete,
  onToggleTerminal,
  onSetEntry,
  onSetWon,
}) {
  // `{ stageId, value }` while the name is being edited, null otherwise. Tying
  // the draft to the Stage it belongs to is what makes selecting a different
  // Stage close the editor — no effect mirroring the prop into state, and no
  // stale draft landing on the wrong Stage.
  const [draft, setDraft] = useState(null);

  if (!stage) return null;

  const isEditingName = draft?.stageId === stage.id;

  const handleSaveName = () => {
    const next = (draft?.value ?? "").trim();
    if (next && next !== stage.name) onRename(next);
    setDraft(null);
  };

  const tabs = [
    { value: "settings", label: "General", icon: Settings2 },
    { value: "conditions", label: "Conditions", icon: ListTodo },
    { value: "actions", label: "Actions", icon: Wand2 },
  ];

  return (
    <aside
      className={cn(
        "absolute inset-y-0 right-0 z-30 flex w-[26rem] max-w-[92vw] flex-col bg-card",
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
            <button
              type="button"
              disabled={disabled}
              onClick={() => setDraft({ stageId: stage.id, value: stage.name })}
              className="group mt-0.5 flex w-full items-center gap-2 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default"
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
            </button>
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
          size="sm"
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
                <button
                  onClick={onSetEntry}
                  disabled={disabled || isEntry}
                  className={cn(
                    ROLE_BUTTON,
                    isEntry
                      ? "bg-blue-a3 text-blue-11 outline-blue-a6"
                      : "text-foreground outline-mauve-6 hover:bg-mauve-a3",
                  )}
                >
                  <ArrowUpCircle size={14} /> {isEntry ? "Deals enter here" : "Make it the entry"}
                </button>

                <button
                  onClick={onSetWon}
                  disabled={disabled}
                  className={cn(
                    ROLE_BUTTON,
                    isWon
                      ? "bg-green-a3 text-green-11 outline-green-a6"
                      : "text-foreground outline-mauve-6 hover:bg-mauve-a3",
                  )}
                >
                  <Flag size={14} /> {isWon ? "Deals are won here" : "Make it the win"}
                </button>

                <button
                  onClick={onToggleTerminal}
                  disabled={disabled}
                  className={cn(
                    ROLE_BUTTON,
                    stage.is_terminal
                      ? "bg-amber-a3 text-amber-11 outline-amber-a6"
                      : "text-foreground outline-mauve-6 hover:bg-mauve-a3",
                  )}
                >
                  {stage.is_terminal ? <Check size={14} /> : <Octagon size={14} />}
                  {stage.is_terminal ? "Deals end here" : "Make it terminal"}
                </button>

                <button
                  onClick={onDelete}
                  disabled={disabled}
                  aria-label="Delete Stage"
                  className={cn(
                    ROLE_BUTTON,
                    "text-destructive outline-destructive/30 hover:bg-destructive/10",
                  )}
                >
                  <Trash2 size={14} /> Delete Stage
                </button>
              </div>
            </section>

            <p className="text-xs leading-relaxed text-muted-foreground">
              A Stage moves a deal on only along the edges drawn from it. Conditions block the
              way out; actions fire on the way in.
            </p>
          </div>
        )}

        {activeTab === "conditions" && (
          <StageConditionManager stageId={stage.id} disabled={disabled} />
        )}

        {activeTab === "actions" && (
          <StageActionManager stageId={stage.id} disabled={disabled} />
        )}
      </div>
    </aside>
  );
}
