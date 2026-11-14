/**
 * Helper for updating src/data/changelog.json consistently.
 */

export function todayInManila() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date());
}

export function addEntry(existingList, { version, title, changes, date, link, modules } = {}) {
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error("Version must follow major.minor.patch format (e.g. 1.8.0)");
  }

  if (existingList.some((e) => e.version === version)) {
    throw new Error(`${version} is already in the changelog`);
  }

  if (!title || !title.trim()) {
    throw new Error("Entry must include a title");
  }

  const cleanedChanges = (Array.isArray(changes) ? changes : [])
    .map((c) => (typeof c === "string" ? c.trim() : ""))
    .filter(Boolean);

  if (cleanedChanges.length === 0) {
    throw new Error("Entry must have at least one change");
  }

  // What's New navigates to it in-app, so it must be a path, not a URL.
  if (link != null && !/^\/(?!\/)/.test(link)) {
    throw new Error("A link must be a path in the app, starting with /");
  }

  // Menu group or entry keys (e.g. "purchasing", "purchasing.canvasses");
  // What's New opens only for people who can open one. None = everyone.
  const cleanedModules = (Array.isArray(modules) ? modules : [])
    .map((m) => (typeof m === "string" ? m.trim() : ""))
    .filter(Boolean);

  const newEntry = {
    date: date || todayInManila(),
    title: title.trim(),
    version,
    ...(cleanedModules.length ? { modules: cleanedModules } : {}),
    changes: cleanedChanges,
    ...(link ? { link } : {}),
  };

  return [newEntry, ...existingList];
}

// Entries flagged `"env": "staging"` are for staging testers only. Prod
// builds drop them so What's New (which shows the top entry) never leaks one.
export function visibleEntries(list, isStaging) {
  return isStaging ? list : list.filter((e) => e.env !== "staging")
}
