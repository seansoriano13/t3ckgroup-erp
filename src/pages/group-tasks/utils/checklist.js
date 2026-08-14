/**
 * Checklist helpers for group task assignments.
 *
 * Group task members now store a description and a checklist in separate
 * columns, matching regular tasks. Before that split, task_description held
 * either plain text or a serialised checklist array, so values coming back from
 * older rows can still be strings. Everything here tolerates both.
 */

/** Normalises a checklist value (jsonb array, JSON string, or legacy {items}) to an array. */
export function parseChecklist(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;

  if (typeof value === "object") {
    return Array.isArray(value.items) ? value.items : [];
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.items)) return parsed.items;
    } catch {
      // Not valid JSON — treat as no checklist.
    }
  }

  return [];
}

/** Returns { total, checked } for a checklist value. Used for the rail's "3/5". */
export function countChecklist(value) {
  const items = parseChecklist(value);
  return {
    total: items.length,
    checked: items.filter((i) => i?.checked).length,
  };
}

/** True when a checklist holds at least one item with actual text. */
export function hasChecklistContent(value) {
  return parseChecklist(value).some((i) => i?.text?.trim());
}
