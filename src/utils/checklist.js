/**
 * Checklist helpers for group task assignments.
 *
 * Group task members now store a description and a checklist in separate
 * columns, matching regular tasks. Before that split, task_description held
 * either plain text or a serialised checklist array, so values coming back from
 * older rows can still be strings. Everything here tolerates both.
 *
 * Lives under src/utils rather than src/pages/group-tasks/utils because
 * groupTaskTemplateService (a service, not a page) needs it too — services
 * never reach into src/pages/** elsewhere in this codebase, so this stays the
 * shared, layer-neutral home.
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

/** True when a string is really a serialised checklist rather than prose. */
function looksLikeJson(value) {
  if (typeof value !== "string") return false;
  const t = value.trim();
  return (t.startsWith("[") || t.startsWith("{")) && parseChecklist(t).length > 0;
}

/**
 * Reads an assignment's description and checklist regardless of which side of
 * the 0016 backfill the row is on.
 *
 * Rows created after the split keep prose in task_description and items in
 * checklist. Rows predating it still have the serialised checklist sitting in
 * task_description with nothing in the checklist column. Reading through this
 * means the app works before, during and after the backfill, so the migration
 * and the deploy do not have to be ordered against each other.
 */
export function resolveAssignment(member) {
  if (!member) return { description: "", checklist: [] };

  const rawDescription = member.taskDescription ?? member.task_description ?? "";
  const items = parseChecklist(member.checklist);

  if (items.length > 0) {
    return { description: rawDescription, checklist: items };
  }

  // Nothing in the checklist column — the description may be a pre-split
  // checklist, in which case it is not prose and must not be shown as such.
  if (looksLikeJson(rawDescription)) {
    return { description: "", checklist: parseChecklist(rawDescription) };
  }

  return { description: rawDescription, checklist: [] };
}
