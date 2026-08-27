import React, { useState, useEffect } from "react";
import { Plus, X, GripVertical } from "lucide-react";

export default function ChecklistTaskInput({
  value,
  onChange,
  name = "taskDescription",
}) {
  const [items, setItems] = useState([]);
  const [draggedIndex, setDraggedIndex] = useState(null);

  // Parse JSON on mount — supports both legacy {title, items} and plain array formats
  useEffect(() => {
    try {
      if (value) {
        const trimmed = value.trim();
        if (trimmed.startsWith("[")) {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            queueMicrotask(() => setItems(parsed));
            return;
          }
        } else if (trimmed.startsWith("{")) {
          // Legacy format: {title, items} — migrate items out, title is now a native field
          const parsed = JSON.parse(trimmed);
          if (parsed && Array.isArray(parsed.items)) {
            queueMicrotask(() => setItems(parsed.items));
            return;
          }
        }
      }
    } catch {
      // Not valid JSON, ignore
    }
    // Starting state
    if (!value && items.length === 0) {
      queueMicrotask(() => setItems([{ text: "", checked: false }]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only on mount

  const emitChange = (newItems) => {
    onChange({
      target: {
        name,
        value: JSON.stringify(newItems),
      },
    });
  };

  const handleTextChange = (index, newText) => {
    const newItems = [...items];
    newItems[index].text = newText;
    setItems(newItems);
    emitChange(newItems);
  };

  const addItem = () => {
    const newItems = [...items, { text: "", checked: false }];
    setItems(newItems);
    emitChange(newItems);
  };

  const removeItem = (index) => {
    if (items.length === 1) return; // Always keep at least 1
    const newItems = items.filter((_, i) => i !== index);
    setItems(newItems);
    emitChange(newItems);
  };

  // Drag and Drop Handlers
  const handleDragStart = (e, index) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
    // Set transparent drag image or basic format
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e, targetIndex) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) return;

    const newItems = [...items];
    const draggedItem = newItems[draggedIndex];
    newItems.splice(draggedIndex, 1);
    newItems.splice(targetIndex, 0, draggedItem);

    setItems(newItems);
    emitChange(newItems);
    setDraggedIndex(null);
  };

  // Detect Paste with Newlines to Auto-Populate multiple items
  const handlePaste = (e, index) => {
    const paste = (e.clipboardData || window.clipboardData).getData("text");
    if (paste && paste.includes("\n")) {
      e.preventDefault();
      const lines = paste.split(/\r?\n/).filter((line) => line.trim() !== "");

      if (lines.length > 0) {
        const newItems = [...items];
        // Replace the current item with the first pasted line
        newItems[index].text = lines[0];

        // Add the rest of the lines as new items
        const additionalItems = lines.slice(1).map((line) => ({
          text: line.trim(),
          checked: false,
        }));

        newItems.splice(index + 1, 0, ...additionalItems);
        setItems(newItems);
        emitChange(newItems);
      }
    }
  };

  return (
    <>
      <div className="space-y-2 pb-2">
        {items.map((item, index) => (
          <div
            key={index}
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={(e) => handleDragOver(e)}
            onDrop={(e) => handleDrop(e, index)}
            className={`flex items-center gap-3 group transition-all rounded-xl p-2.5 bg-muted/30 border border-transparent hover:border-border hover:bg-muted/50 ${draggedIndex === index ? "opacity-50" : ""}`}
          >
            <span className="text-muted-foreground cursor-grab active:cursor-grabbing opacity-50 group-hover:opacity-100 shrink-0 p-1 hover:bg-muted rounded-md transition-all">
              <GripVertical size={16} />
            </span>
            <div className="w-5 h-5 border border-border rounded-md shrink-0 bg-card shadow-sm" />
            <input
              type="text"
              value={item.text}
              onChange={(e) => handleTextChange(index, e.target.value)}
              onPaste={(e) => handlePaste(e, index)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  // Insert a new item right after this one and focus it
                  const newItems = [...items];
                  newItems.splice(index + 1, 0, { text: "", checked: false });
                  setItems(newItems);
                  emitChange(newItems);
                  // Focus the newly created input on next render
                  setTimeout(() => {
                    const inputs = e.target
                      .closest(".space-y-2")
                      ?.querySelectorAll('input[type="text"]');
                    inputs?.[index + 1]?.focus();
                  }, 0);
                } else if (e.key === "Backspace" && e.target.value === "") {
                  e.preventDefault();
                  if (items.length > 1) {
                    const newItems = items.filter((_, i) => i !== index);
                    setItems(newItems);
                    emitChange(newItems);
                    setTimeout(() => {
                      const inputs = e.target
                        .closest(".space-y-2")
                        ?.querySelectorAll('input[type="text"]');
                      inputs?.[Math.max(0, index - 1)]?.focus();
                    }, 0);
                  }
                }
              }}
              placeholder="List detailed condition..."
              className="flex-1 bg-transparent border-none outline-none text-foreground font-medium text-sm py-1 placeholder:text-muted-foreground transition-all"
            />
            <button
              type="button"
              onClick={() => removeItem(index)}
              className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all shrink-0 p-1.5 rounded-lg hover:bg-destructive/10"
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>

      <div className="pt-3 ">
        <div className="flex justify-between items-center">
          <button
            type="button"
            onClick={addItem}
            className="flex items-center gap-2 text-xs font-bold text-mauve-10 transition-all py-2 px-3 rounded-lg hover:bg-mauve-3"
          >
            <Plus size={16} /> Add Item
          </button>
        </div>
      </div>
    </>
  );
}
