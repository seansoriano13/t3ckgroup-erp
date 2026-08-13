import React, { useState } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import HighlightText from "./HighlightText";

function parseDescriptionData(desc) {
  if (!desc) {
    return { description: desc, items: [], title: "", isJson: false, isObjectFormat: false };
  }

  // Handle already-parsed arrays (from Supabase JSONB or resolveChecklist)
  if (Array.isArray(desc)) {
    return { description: desc, items: desc, title: "", isJson: true, isObjectFormat: false };
  }

  // Handle already-parsed objects
  if (typeof desc === "object" && Array.isArray(desc.items)) {
    return {
      description: desc,
      items: desc.items,
      title: desc.title || "",
      isJson: true,
      isObjectFormat: true,
    };
  }

  // Handle JSON strings (legacy or from direct input)
  if (typeof desc === "string") {
    try {
      const trimmed = desc.trim();
      if (trimmed.startsWith("[")) {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return { description: desc, items: parsed, title: "", isJson: true, isObjectFormat: false };
        }
      } else if (trimmed.startsWith("{")) {
        const parsed = JSON.parse(trimmed);
        if (parsed && Array.isArray(parsed.items)) {
          return {
            description: desc,
            items: parsed.items,
            title: parsed.title || "",
            isJson: true,
            isObjectFormat: true,
          };
        }
      }
    } catch (e) {
      console.error("Checklist parse error:", e);
    }
  }

  return { description: desc, items: [], title: "", isJson: false, isObjectFormat: false };
}

export default function ChecklistTaskRenderer({
  description,
  onInlineCheck,
  isOwner,
  disabled,
  searchTerm,
}) {
  const [taskState, setTaskState] = useState(() => parseDescriptionData(description));

  let currentTaskState = taskState;
  if (description !== taskState.description) {
    currentTaskState = parseDescriptionData(description);
    setTaskState(currentTaskState);
  }

  const { title, items, isJson, isObjectFormat } = currentTaskState;

  const handleCheck = (indexToToggle) => {
    if (disabled || !isOwner) return;
    if (!isJson) return; // Cannot inline-check legacy plaintext

    const newItems = items.map((item, i) => {
      if (i === indexToToggle) {
        return { ...item, checked: !item.checked };
      }
      return item;
    });

    setTaskState((prev) => ({ ...prev, items: newItems })); // Optimistic UI update

    // Save backwards compatible to the format they originally used
    if (isObjectFormat) {
      onInlineCheck(JSON.stringify({ title, items: newItems }));
    } else {
      onInlineCheck(JSON.stringify(newItems));
    }
  };

  if (!isJson) {
    return (
      <div className="bg-muted/30 p-6 rounded-2xl border border-border text-foreground leading-relaxed text-[15px] whitespace-pre-wrap shadow-sm">
        <HighlightText text={description} search={searchTerm} />
      </div>
    );
  }

  return (
    <>
      {title && (
        <div className="pb-3 border-b border-border/50 mb-3">
          <h4 className="font-extrabold text-foreground uppercase tracking-wider text-[11px]">
            <HighlightText text={title} search={searchTerm} />
          </h4>
        </div>
      )}
      <div className="space-y-2">
        {items.map((item, i) => (
          <div
            key={i}
            className={`flex items-center gap-3 py-2 px-4 rounded-xl transition-all duration-300 border ${item.checked ? "bg-muted/20 opacity-60 border-transparent" : "bg-card shadow-sm border-border/40 hover:border-border"}`}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleCheck(i);
              }}
              disabled={disabled || !isOwner}
              className={`shrink-0 transition-all duration-300 active:scale-75 disabled:cursor-not-allowed flex items-center justify-center`}
            >
              {item.checked ? (
                <div className="w-5 h-5 rounded-full bg-green-600 flex items-center justify-center shadow-lg shadow-green-5">
                  <CheckCircle2 size={12} className="text-primary-foreground" />
                </div>
              ) : (
                <div className="w-5 h-5 rounded-full border-2 border-mauve-5 bg-card hover:border-mauve-8 hover:scale-110 transition-all" />
              )}
            </button>
            <span
              className={`flex-1 min-w-0 font-medium text-[13px] leading-tight ${item.checked ? "line-through text-muted-foreground" : "text-foreground"}`}
            >
              <HighlightText text={item.text} search={searchTerm} />
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
