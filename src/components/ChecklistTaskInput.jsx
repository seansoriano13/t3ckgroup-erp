import React, { useState, useRef } from "react";
import { Plus, X, GripVertical, FolderPlus, Trash2 } from "lucide-react";
import { parseChecklistGroups } from "../utils/checklist";
import { Button } from "./ui/button";

let idCounter = 0;
function createLocalId(prefix) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export default function ChecklistTaskInput({
  value,
  onChange,
  name = "taskDescription",
}) {
  const prevPropRef = useRef(value);
  const lastEmittedRef = useRef(value);
  const [groups, setGroups] = useState(() => {
    const parsed = parseChecklistGroups(value);
    if (parsed.length > 0) return parsed;
    return [
      {
        id: `group-0`,
        title: "",
        items: [{ id: `item-0-0`, text: "", checked: false }],
      },
    ];
  });
  const [draggedItem, setDraggedItem] = useState(null); // { gIdx, iIdx }
  const containerRef = useRef(null);

  // Synchronize when external value prop changes from parent (e.g. switching tasks)
  if (value !== prevPropRef.current) {
    prevPropRef.current = value;
    if (value !== lastEmittedRef.current) {
      lastEmittedRef.current = value;
      const parsed = parseChecklistGroups(value);
      setGroups(
        parsed.length > 0
          ? parsed
          : [
              {
                id: `group-0`,
                title: "",
                items: [{ id: `item-0-0`, text: "", checked: false }],
              },
            ],
      );
    }
  }

  const isMultiGroup =
    groups.length > 1 || Boolean(groups[0]?.title?.trim());

  const emitChange = (nextGroups) => {
    const multi =
      nextGroups.length > 1 || Boolean(nextGroups[0]?.title?.trim());

    let outputValue;
    if (!multi && nextGroups.length === 1 && !nextGroups[0].title) {
      // Flat array for complete backwards compatibility
      const flatItems = nextGroups[0].items.map((i) => ({
        text: i.text,
        checked: Boolean(i.checked),
      }));
      outputValue = JSON.stringify(flatItems);
    } else {
      // Grouped array
      outputValue = JSON.stringify(
        nextGroups.map((g) => ({
          id: g.id,
          title: g.title,
          items: g.items.map((i) => ({
            id: i.id,
            text: i.text,
            checked: Boolean(i.checked),
          })),
        })),
      );
    }

    lastEmittedRef.current = outputValue;

    onChange({
      target: {
        name,
        value: outputValue,
      },
    });
  };

  // Section Handlers
  const addSection = () => {
    const nextGroups = [...groups];
    // If the first section has no title and we are adding a 2nd section, give it a default title
    if (nextGroups.length === 1 && !nextGroups[0].title.trim()) {
      nextGroups[0].title = "Phase 1";
    }

    const newGroup = {
      id: createLocalId("group"),
      title: `Phase ${nextGroups.length + 1}`,
      items: [{ id: createLocalId("item"), text: "", checked: false }],
    };

    const updated = [...nextGroups, newGroup];
    setGroups(updated);
    emitChange(updated);

    // Focus the title input of the new section
    setTimeout(() => {
      const titleInputs = containerRef.current?.querySelectorAll(
        'input[data-section-title="true"]',
      );
      titleInputs?.[titleInputs.length - 1]?.focus();
      titleInputs?.[titleInputs.length - 1]?.select();
    }, 0);
  };

  const removeSection = (gIdx) => {
    if (groups.length <= 1) {
      // Clear instead of removing last section
      const updated = [
        {
          id: `group-0`,
          title: "",
          items: [{ id: `item-0-0`, text: "", checked: false }],
        },
      ];
      setGroups(updated);
      emitChange(updated);
      return;
    }

    const updated = groups.filter((_, i) => i !== gIdx);
    setGroups(updated);
    emitChange(updated);
  };

  const handleSectionTitleChange = (gIdx, title) => {
    const nextGroups = [...groups];
    nextGroups[gIdx] = { ...nextGroups[gIdx], title };
    setGroups(nextGroups);
    emitChange(nextGroups);
  };

  // Item Handlers
  const handleItemTextChange = (gIdx, iIdx, text) => {
    const nextGroups = [...groups];
    const group = { ...nextGroups[gIdx] };
    const items = [...group.items];
    items[iIdx] = { ...items[iIdx], text };
    group.items = items;
    nextGroups[gIdx] = group;

    setGroups(nextGroups);
    emitChange(nextGroups);
  };

  const addItem = (gIdx) => {
    const nextGroups = [...groups];
    const group = { ...nextGroups[gIdx] };
    const items = [
      ...group.items,
      { id: createLocalId("item"), text: "", checked: false },
    ];
    group.items = items;
    nextGroups[gIdx] = group;

    setGroups(nextGroups);
    emitChange(nextGroups);
  };

  const removeItem = (gIdx, iIdx) => {
    const nextGroups = [...groups];
    const group = { ...nextGroups[gIdx] };

    if (group.items.length === 1) {
      // Keep at least 1 empty item
      group.items = [
        { id: createLocalId("item"), text: "", checked: false },
      ];
    } else {
      group.items = group.items.filter((_, i) => i !== iIdx);
    }

    nextGroups[gIdx] = group;
    setGroups(nextGroups);
    emitChange(nextGroups);
  };

  // Drag & Drop
  const handleDragStart = (e, gIdx, iIdx) => {
    setDraggedItem({ gIdx, iIdx });
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e, targetGIdx, targetIIdx) => {
    e.preventDefault();
    if (!draggedItem) return;
    const { gIdx: srcGIdx, iIdx: srcIIdx } = draggedItem;

    if (srcGIdx === targetGIdx && srcIIdx === targetIIdx) return;

    const nextGroups = [...groups];
    const srcGroup = { ...nextGroups[srcGIdx], items: [...nextGroups[srcGIdx].items] };
    const [movedItem] = srcGroup.items.splice(srcIIdx, 1);

    if (srcGIdx === targetGIdx) {
      srcGroup.items.splice(targetIIdx, 0, movedItem);
      nextGroups[srcGIdx] = srcGroup;
    } else {
      const targetGroup = {
        ...nextGroups[targetGIdx],
        items: [...nextGroups[targetGIdx].items],
      };
      targetGroup.items.splice(targetIIdx, 0, movedItem);
      nextGroups[srcGIdx] = srcGroup;
      nextGroups[targetGIdx] = targetGroup;
    }

    setGroups(nextGroups);
    emitChange(nextGroups);
    setDraggedItem(null);
  };

  // Detect Paste with Newlines to Auto-Populate multiple items
  const handlePaste = (e, gIdx, iIdx) => {
    const paste = (e.clipboardData || window.clipboardData).getData("text");
    if (paste && paste.includes("\n")) {
      e.preventDefault();
      const lines = paste.split(/\r?\n/).filter((line) => line.trim() !== "");

      if (lines.length > 0) {
        const nextGroups = [...groups];
        const group = { ...nextGroups[gIdx], items: [...nextGroups[gIdx].items] };

        // Replace the current item with the first pasted line
        group.items[iIdx] = { ...group.items[iIdx], text: lines[0] };

        // Add the rest of the lines as new items
        const additionalItems = lines.slice(1).map((line) => ({
          id: createLocalId("item"),
          text: line.trim(),
          checked: false,
        }));

        group.items.splice(iIdx + 1, 0, ...additionalItems);
        nextGroups[gIdx] = group;

        setGroups(nextGroups);
        emitChange(nextGroups);
      }
    }
  };

  return (
    <div ref={containerRef} className="space-y-4">
      {groups.map((group, gIdx) => (
        <div
          key={group.id || gIdx}
          data-group-card="true"
          className={`${
            isMultiGroup
              ? "p-3 rounded-xl bg-muted/20 border border-border/50 space-y-2.5"
              : "space-y-2"
          }`}
        >
          {/* Section Header (only shown if multi-section or titled) */}
          {isMultiGroup && (
            <div className="flex items-center justify-between gap-2 pb-1 border-b border-border/40">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="w-5 h-5 rounded-md bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground shrink-0">
                  {gIdx + 1}
                </span>
                <input
                  type="text"
                  data-section-title="true"
                  value={group.title}
                  onChange={(e) =>
                    handleSectionTitleChange(gIdx, e.target.value)
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      // Focus first item input in this section
                      const groupCard = e.target.closest('[data-group-card="true"]');
                      const inputs = groupCard?.querySelectorAll('input[data-item-input="true"]');
                      inputs?.[0]?.focus();
                    }
                  }}
                  placeholder={`Section title (e.g. Phase ${gIdx + 1})...`}
                  className="bg-transparent border-none outline-none text-xs font-bold text-foreground placeholder:text-muted-foreground/60 w-full"
                />
              </div>

              {groups.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => removeSection(gIdx)}
                  title="Remove section"
                  className="h-auto w-auto text-muted-foreground/60 hover:text-destructive p-1 rounded hover:bg-destructive/10 transition-colors"
                >
                  <Trash2 size={13} />
                </Button>
              )}
            </div>
          )}

          {/* Section Items */}
          <div className="space-y-2">
            {group.items.map((item, iIdx) => (
              <div
                key={item.id || iIdx}
                draggable
                onDragStart={(e) => handleDragStart(e, gIdx, iIdx)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, gIdx, iIdx)}
                className={`flex items-center gap-2.5 group transition-all rounded-xl p-2 bg-card/60 border border-border/40 hover:border-border hover:bg-card ${
                  draggedItem?.gIdx === gIdx && draggedItem?.iIdx === iIdx
                    ? "opacity-40"
                    : ""
                }`}
              >
                <span className="text-muted-foreground cursor-grab active:cursor-grabbing opacity-40 group-hover:opacity-100 shrink-0 p-0.5 hover:bg-muted rounded transition-all">
                  <GripVertical size={14} />
                </span>

                <div className="w-4 h-4 border border-border rounded shrink-0 bg-background/80" />

                <input
                  type="text"
                  data-item-input="true"
                  value={item.text}
                  onChange={(e) =>
                    handleItemTextChange(gIdx, iIdx, e.target.value)
                  }
                  onPaste={(e) => handlePaste(e, gIdx, iIdx)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      e.stopPropagation();

                      // Insert new item right after this one in the same group
                      const nextGroups = [...groups];
                      const grp = { ...nextGroups[gIdx] };
                      const items = [...grp.items];
                      items.splice(iIdx + 1, 0, {
                        id: createLocalId("item"),
                        text: "",
                        checked: false,
                      });
                      grp.items = items;
                      nextGroups[gIdx] = grp;
                      setGroups(nextGroups);
                      emitChange(nextGroups);

                      // Focus the newly created input on next render
                      setTimeout(() => {
                        const groupCard = e.target.closest('[data-group-card="true"]');
                        const inputs = groupCard?.querySelectorAll('input[data-item-input="true"]');
                        inputs?.[iIdx + 1]?.focus();
                      }, 0);
                    } else if (e.key === "Backspace" && e.target.value === "") {
                      e.preventDefault();
                      if (group.items.length > 1) {
                        removeItem(gIdx, iIdx);
                        setTimeout(() => {
                          const groupCard = e.target.closest('[data-group-card="true"]');
                          const inputs = groupCard?.querySelectorAll('input[data-item-input="true"]');
                          inputs?.[Math.max(0, iIdx - 1)]?.focus();
                        }, 0);
                      } else if (iIdx === 0 && isMultiGroup) {
                        // Focus the section title if first item in multi-group is empty
                        const groupCard = e.target.closest('[data-group-card="true"]');
                        const titleInput = groupCard?.querySelector('input[data-section-title="true"]');
                        titleInput?.focus();
                      }
                    }
                  }}
                  placeholder="List detailed condition..."
                  className="flex-1 min-w-0 bg-transparent border-none outline-none text-foreground font-medium text-xs py-1 placeholder:text-muted-foreground transition-all"
                />

                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => removeItem(gIdx, iIdx)}
                  className="h-auto w-auto text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all shrink-0 p-1 rounded hover:bg-destructive/10"
                >
                  <X size={14} />
                </Button>
              </div>
            ))}
          </div>

          {/* Add item button for this section */}
          {isMultiGroup && (
            <div className="pt-1">
              <Button
                type="button"
                variant="ghost"
                onClick={() => addItem(gIdx)}
                className="h-auto flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-all py-1 px-2 rounded-lg hover:bg-muted/60"
              >
                <Plus size={13} /> Add item to this section
              </Button>
            </div>
          )}
        </div>
      ))}

      {/* Footer Controls: Add Item (for flat) & Add Section */}
      <div className="pt-2 flex items-center justify-between gap-2 border-t border-border/30">
        {!isMultiGroup ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => addItem(0)}
            className="h-auto flex items-center gap-1.5 text-xs font-bold text-foreground transition-all py-1.5 px-3 rounded-lg hover:bg-muted"
          >
            <Plus size={15} /> Add Item
          </Button>
        ) : (
          <div />
        )}

        <Button
          type="button"
          variant="ghost"
          onClick={addSection}
          className="h-auto flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-all py-1.5 px-3 rounded-lg hover:bg-muted"
        >
          <FolderPlus size={14} />
          <span>{isMultiGroup ? "Add Another Section" : "Add Section / Steps"}</span>
        </Button>
      </div>
    </div>
  );
}

