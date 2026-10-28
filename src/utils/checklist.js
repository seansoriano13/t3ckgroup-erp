/**
 * Checklist helpers for group task assignments and individual tasks.
 *
 * Supports both:
 * 1. Flat checklists: `[{ text, checked }]`
 * 2. Grouped checklists (phases / sections): `[{ id, title, items: [{ id, text, checked }] }]`
 * 3. Legacy formats: `{ items: [...] }` or JSON strings inside task_description
 *
 * All functions normalize data transparently so existing database rows require
 * zero migration or backfilling.
 */

/** Optional per-item extras. Absent on old data, so they are only copied when set. */
function itemExtras(item) {
  const extras = {};
  if (item && typeof item.dueDate === "string" && item.dueDate.trim()) {
    extras.dueDate = item.dueDate.trim().slice(0, 10);
  }
  if (item && typeof item.remarks === "string" && item.remarks.trim()) {
    extras.remarks = item.remarks;
  }
  return extras;
}

/** True when a value is structured as an array of group sections. */
export function isGroupedChecklist(value) {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.some(
    (entry) => entry && typeof entry === "object" && Array.isArray(entry.items),
  );
}

/**
 * Normalises ANY checklist value (jsonb array, grouped array, JSON string, or legacy {items})
 * into a structured array of groups:
 * `[{ id, title, items: [{ id, text, checked }] }]`
 */
export function parseChecklistGroups(value) {
  if (!value) return [];

  let raw = value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return [];
    try {
      raw = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }

  if (!raw) return [];

  // 1. Array of groups: [{ title: '...', items: [...] }]
  if (Array.isArray(raw)) {
    if (raw.length === 0) return [];

    if (isGroupedChecklist(raw)) {
      return raw.map((group, gIdx) => ({
        id: group?.id || `group-${gIdx}`,
        title: typeof group?.title === "string" ? group.title : "",
        items: (Array.isArray(group?.items) ? group.items : []).map((item, iIdx) => ({
          id: item?.id || `item-${gIdx}-${iIdx}`,
          text:
            typeof item?.text === "string"
              ? item.text
              : typeof item === "string"
                ? item
                : "",
          checked: Boolean(item?.checked),
          ...itemExtras(item),
        })),
      }));
    }

    // 2. Flat array of items: [{ text: '...', checked: false }]
    return [
      {
        id: "group-default",
        title: "",
        items: raw.map((item, iIdx) => ({
          id: item?.id || `item-0-${iIdx}`,
          text:
            typeof item?.text === "string"
              ? item.text
              : typeof item === "string"
                ? item
                : "",
          checked: Boolean(item?.checked),
          ...itemExtras(item),
        })),
      },
    ];
  }

  // 3. Legacy object { title, items } or { items }
  if (typeof raw === "object") {
    const items = Array.isArray(raw.items) ? raw.items : [];
    if (items.length === 0 && !raw.title) return [];
    return [
      {
        id: raw.id || "group-default",
        title: typeof raw.title === "string" ? raw.title : "",
        items: items.map((item, iIdx) => ({
          id: item?.id || `item-0-${iIdx}`,
          text:
            typeof item?.text === "string"
              ? item.text
              : typeof item === "string"
                ? item
                : "",
          checked: Boolean(item?.checked),
          ...itemExtras(item),
        })),
      },
    ];
  }

  return [];
}

/**
 * Normalises a checklist value (jsonb array, JSON string, or legacy {items}) to a flat array.
 * If value is grouped, flattens all items across groups.
 * Preserves reference equality for pure flat arrays to satisfy existing contract.
 */
export function parseChecklist(value) {
  if (!value) return [];

  if (Array.isArray(value)) {
    if (isGroupedChecklist(value)) {
      return value.flatMap((g) => (Array.isArray(g?.items) ? g.items : []));
    }
    return value;
  }

  if (typeof value === "object") {
    return Array.isArray(value.items) ? value.items : [];
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        if (isGroupedChecklist(parsed)) {
          return parsed.flatMap((g) => (Array.isArray(g?.items) ? g.items : []));
        }
        return parsed;
      }
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

/**
 * Returns comprehensive progress metrics including step/group awareness:
 * { total, checked, isGrouped, activeStepIndex, totalSteps, groups }
 */
export function getChecklistProgress(value) {
  const groups = parseChecklistGroups(value);
  if (groups.length === 0) {
    return {
      total: 0,
      checked: 0,
      isGrouped: false,
      activeStepIndex: 0,
      totalSteps: 0,
      groups: [],
    };
  }

  let total = 0;
  let checked = 0;
  let activeStepIndex = -1;

  const groupStats = groups.map((g, idx) => {
    const gTotal = g.items.length;
    const gChecked = g.items.filter((i) => i?.checked).length;
    total += gTotal;
    checked += gChecked;
    const isCompleted = gTotal > 0 && gChecked === gTotal;

    if (activeStepIndex === -1 && !isCompleted && gTotal > 0) {
      activeStepIndex = idx;
    }

    return {
      id: g.id,
      title: g.title,
      index: idx,
      total: gTotal,
      checked: gChecked,
      isCompleted,
    };
  });

  if (activeStepIndex === -1) {
    activeStepIndex = Math.max(0, groupStats.length - 1);
  }

  const isGrouped = groups.length > 1 || Boolean(groups[0]?.title?.trim());

  return {
    total,
    checked,
    isGrouped,
    activeStepIndex,
    totalSteps: groups.length,
    groups: groupStats,
  };
}

/** True when a checklist holds at least one item with actual text across all groups. */
export function hasChecklistContent(value) {
  return parseChecklist(value).some((i) => i?.text?.trim());
}

/**
 * Prepares a grouped or flat checklist for database persistence:
 * - Strips empty items
 * - If resetChecked is true, resets all items to checked: false (used by templates)
 * - If only 1 group with no title, flattens to [{ text, checked }] to maintain 100%
 *   binary compatibility with legacy data
 */
export function cleanChecklistForSave(value, { resetChecked = false } = {}) {
  const groups = parseChecklistGroups(value);
  if (groups.length === 0) return null;

  const cleanedGroups = groups
    .map((g, gIdx) => {
      const validItems = g.items
        .filter(
          (item) =>
            item && typeof item.text === "string" && item.text.trim() !== "",
        )
        .map((item, iIdx) => ({
          id: item.id || `item-${gIdx}-${iIdx}`,
          text: item.text.trim(),
          checked: resetChecked ? false : Boolean(item.checked),
          ...itemExtras(item),
        }));

      return {
        id: g.id || `group-${gIdx}`,
        title: (g.title || "").trim(),
        items: validItems,
      };
    })
    .filter((g) => g.items.length > 0 || g.title !== "");

  if (cleanedGroups.length === 0) return null;

  // Single untitled group -> persist as flat array for backwards compatibility
  if (cleanedGroups.length === 1 && !cleanedGroups[0].title) {
    return cleanedGroups[0].items.map((i) => ({
      text: i.text,
      checked: i.checked,
      ...itemExtras(i),
    }));
  }

  return cleanedGroups;
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

  const rawDescription =
    member.taskDescription ?? member.task_description ?? "";
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


/**
 * Returns an error message when any checklist item's due date falls after the
 * task's Due Date, otherwise null. Dates compare as calendar days (YYYY-MM-DD).
 * A task with no Due Date has no limit.
 */
export function checklistDueDateError(checklist, taskDueDate) {
  if (!taskDueDate) return null;
  const limit = String(taskDueDate).slice(0, 10);
  const late = parseChecklistGroups(checklist)
    .flatMap((g) => g.items)
    .find((i) => i.dueDate && i.dueDate > limit);
  if (!late) return null;
  return `Checklist item "${late.text}" is due after the task's Due Date (${limit}).`;
}
