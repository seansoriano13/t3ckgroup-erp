import React, { useState, useMemo } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Check } from "lucide-react";
import HighlightText from "./HighlightText";
import { Button } from "./ui/button";
import { parseChecklistGroups, getChecklistProgress } from "../utils/checklist";

export default function ChecklistTaskRenderer({
  description,
  onInlineCheck,
  isOwner,
  disabled,
  searchTerm,
}) {
  // Parse incoming value into structured groups
  const initialGroups = useMemo(
    () => parseChecklistGroups(description),
    [description],
  );

  const [localGroups, setLocalGroups] = useState(initialGroups);
  const [userExpanded, setUserExpanded] = useState({});

  // Sync with prop changes
  const currentGroups = useMemo(() => {
    return parseChecklistGroups(description);
  }, [description]);

  // Keep localGroups in sync when description prop changes
  const [prevDesc, setPrevDesc] = useState(description);
  if (description !== prevDesc) {
    setPrevDesc(description);
    setLocalGroups(currentGroups);
  }

  const isChecklist = localGroups.length > 0;
  const isMultiPhase = localGroups.length > 1;

  const progress = useMemo(
    () => getChecklistProgress(localGroups),
    [localGroups],
  );

  const toggleSection = (groupId) => {
    setUserExpanded((prev) => ({
      ...prev,
      [groupId]: !isSectionExpanded(groupId),
    }));
  };

  const isSectionExpanded = (groupId) => {
    if (typeof userExpanded[groupId] === "boolean") {
      return userExpanded[groupId];
    }
    // Default smart-collapse behavior:
    // If not multi-phase, always open.
    if (!isMultiPhase) return true;

    const groupStat = progress.groups.find((g) => g.id === groupId);
    if (!groupStat) return true;

    // Completed groups are collapsed by default
    if (groupStat.isCompleted) return false;

    // Active group is expanded by default
    return groupStat.index === progress.activeStepIndex;
  };

  const handleCheck = (groupId, itemId) => {
    if (disabled || !isOwner || !isChecklist) return;

    const nextGroups = localGroups.map((group) => {
      if (group.id !== groupId) return group;
      return {
        ...group,
        items: group.items.map((item) => {
          if (item.id !== itemId) return item;
          return { ...item, checked: !item.checked };
        }),
      };
    });

    setLocalGroups(nextGroups); // Optimistic UI update

    if (onInlineCheck) {
      if (!isMultiPhase && nextGroups.length === 1 && !nextGroups[0].title) {
        // Save as flat array for backward-compatibility
        const flatItems = nextGroups[0].items.map((i) => ({
          text: i.text,
          checked: i.checked,
        }));
        onInlineCheck(JSON.stringify(flatItems));
      } else {
        onInlineCheck(JSON.stringify(nextGroups));
      }
    }
  };

  // Plaintext prose fallback (when value is not a checklist)
  if (!isChecklist) {
    if (!description || typeof description !== "string") return null;
    return (
      <div className="bg-muted/30 p-6 rounded-2xl border border-border text-foreground leading-relaxed text-[15px] whitespace-pre-wrap shadow-sm">
        <HighlightText text={description} search={searchTerm} />
      </div>
    );
  }

  // SINGLE SECTION / FLAT CHECKLIST: 100% visible, zero accordion clutter
  if (!isMultiPhase) {
    const singleGroup = localGroups[0];
    const hasTitle = Boolean(singleGroup?.title?.trim());
    return (
      <div className="space-y-2">
        {hasTitle && (
          <div className="flex items-center justify-between pb-1.5 border-b border-border/40 text-xs font-bold text-foreground">
            <span>
              <HighlightText text={singleGroup.title} search={searchTerm} />
            </span>
            <span className="text-[11px] text-muted-foreground font-medium">
              {singleGroup.items.filter((i) => i.checked).length}/
              {singleGroup.items.length}
            </span>
          </div>
        )}
        {singleGroup.items.map((item, i) => (
          <ChecklistItemRow
            key={item.id || i}
            item={item}
            disabled={disabled}
            isOwner={isOwner}
            searchTerm={searchTerm}
            onToggle={() => handleCheck(singleGroup.id, item.id)}
          />
        ))}
      </div>
    );
  }

  // MULTI-SECTION / GROUPED CHECKLIST (Smart Progressive Disclosure)
  const percentComplete =
    progress.total > 0
      ? Math.round((progress.checked / progress.total) * 100)
      : 0;

  return (
    <div className="space-y-3">
      {/* Sleek Minimalist Progress Header */}
      <div className="bg-muted/30 rounded-xl p-3 border border-border/60 shadow-sm">
        <div className="flex items-center justify-between text-xs mb-2">
          <span className="font-bold text-foreground flex items-center gap-1.5">
            <span>Phase {progress.activeStepIndex + 1} of {progress.totalSteps}</span>
            {percentComplete === 100 ? (
              <span className="text-[10px] bg-green-500/15 text-green-700 dark:text-green-400 font-bold px-1.5 py-0.5 rounded">
                All Complete
              </span>
            ) : (
              <span className="text-muted-foreground font-medium">
                · {localGroups[progress.activeStepIndex]?.title || "Current"}
              </span>
            )}
          </span>
          <span className="text-muted-foreground font-semibold">
            {progress.checked}/{progress.total} items ({percentComplete}%)
          </span>
        </div>
        <div className="w-full bg-muted/60 h-1.5 rounded-full overflow-hidden">
          <div
            className="h-full bg-green-600 dark:bg-green-500 transition-all duration-500 rounded-full"
            style={{ width: `${percentComplete}%` }}
          />
        </div>
      </div>

      {/* Grouped Sections */}
      <div className="space-y-2.5">
        {localGroups.map((group, gIdx) => {
          const groupStat = progress.groups[gIdx];
          const isCompleted = groupStat?.isCompleted;
          const isActive = gIdx === progress.activeStepIndex && !isCompleted;
          const expanded = isSectionExpanded(group.id);
          const checkedInGroup =
            group.items.filter((i) => i.checked).length;
          const totalInGroup = group.items.length;
          const groupTitle =
            group.title?.trim() || (gIdx === 0 ? "General" : `Phase ${gIdx + 1}`);

          return (
            <div
              key={group.id || gIdx}
              className={`rounded-xl border transition-all duration-200 overflow-hidden ${
                isActive
                  ? "bg-card border-border shadow-sm"
                  : isCompleted
                    ? "bg-muted/15 border-border/40"
                    : "bg-muted/20 border-border/40"
              }`}
            >
              {/* Section Header Accordion Trigger */}
              <Button
                type="button"
                variant="ghost"
                onClick={() => toggleSection(group.id)}
                className="h-auto w-full justify-between px-3.5 py-2.5 flex items-center text-left hover:bg-muted/40 rounded-none transition-colors"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {/* Status Indicator Icon */}
                  {isCompleted ? (
                    <div className="w-4 h-4 rounded-full bg-green-600/15 text-green-700 dark:text-green-400 flex items-center justify-center shrink-0">
                      <Check size={10} strokeWidth={3} />
                    </div>
                  ) : isActive ? (
                    <div className="w-4 h-4 rounded-full bg-foreground/10 text-foreground flex items-center justify-center shrink-0">
                      <div className="w-2 h-2 rounded-full bg-foreground" />
                    </div>
                  ) : (
                    <div className="w-4 h-4 rounded-full border border-muted-foreground/40 flex items-center justify-center shrink-0 text-[9px] font-bold text-muted-foreground">
                      {gIdx + 1}
                    </div>
                  )}

                  <span
                    className={`text-xs font-bold truncate ${
                      isCompleted
                        ? "text-muted-foreground line-through decoration-muted-foreground/40"
                        : isActive
                          ? "text-foreground"
                          : "text-muted-foreground"
                    }`}
                  >
                    <HighlightText text={groupTitle} search={searchTerm} />
                  </span>

                  <span className="text-[11px] text-muted-foreground/70 font-medium">
                    ({checkedInGroup}/{totalInGroup})
                  </span>
                </div>

                <div className="flex items-center gap-1.5 text-muted-foreground shrink-0 text-[11px] font-medium">
                  <span>{expanded ? "Hide" : "Show"}</span>
                  {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </div>
              </Button>

              {/* Section Items (Collapsible Content) */}
              {expanded && (
                <div className="p-3 pt-1 space-y-2 border-t border-border/30 animate-slide-down">
                  {group.items.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic px-2 py-1">
                      No items in this section.
                    </p>
                  ) : (
                    group.items.map((item, iIdx) => (
                      <ChecklistItemRow
                        key={item.id || iIdx}
                        item={item}
                        disabled={disabled}
                        isOwner={isOwner}
                        searchTerm={searchTerm}
                        onToggle={() => handleCheck(group.id, item.id)}
                      />
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChecklistItemRow({ item, disabled, isOwner, searchTerm, onToggle }) {
  return (
    <div
      className={`flex items-center gap-3 py-2 px-3.5 rounded-xl transition-all duration-300 border ${
        item.checked
          ? "bg-muted/20 opacity-60 border-transparent"
          : "bg-card shadow-sm border-border/40 hover:border-border"
      }`}
    >
      <Button
        type="button"
        variant="ghost"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        disabled={disabled || !isOwner}
        className="h-auto w-auto p-0 shrink-0 transition-all duration-300 active:scale-75 disabled:cursor-not-allowed hover:bg-transparent"
      >
        {item.checked ? (
          <div className="w-5 h-5 rounded-full bg-green-600 flex items-center justify-center shadow-md">
            <CheckCircle2 size={12} className="text-white" />
          </div>
        ) : (
          <div className="w-5 h-5 rounded-full border-2 border-mauve-5 bg-card hover:border-mauve-8 hover:scale-110 transition-all" />
        )}
      </Button>
      <span
        className={`flex-1 min-w-0 font-medium text-[13px] leading-tight ${
          item.checked
            ? "line-through text-muted-foreground"
            : "text-foreground"
        }`}
      >
        <HighlightText text={item.text} search={searchTerm} />
      </span>
    </div>
  );
}

