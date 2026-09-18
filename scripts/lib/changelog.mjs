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

export function addEntry(existingList, { version, title, changes, date } = {}) {
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

  const newEntry = {
    date: date || todayInManila(),
    title: title.trim(),
    version,
    changes: cleanedChanges,
  };

  return [newEntry, ...existingList];
}
