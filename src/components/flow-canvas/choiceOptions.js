/** Trimmed options with blank rows dropped — what gets saved. */
export function cleanChoiceOptions(rows) {
  return rows.map((o) => o.trim()).filter(Boolean);
}

/** The first option repeated (case-insensitively), or null. */
export function duplicateChoiceOption(rows) {
  const seen = new Set();
  for (const option of cleanChoiceOptions(rows)) {
    const key = option.toLowerCase();
    if (seen.has(key)) return option;
    seen.add(key);
  }
  return null;
}

export const duplicateOptionMessage = (option) => `"${option}" is a duplicate option.`;

/** Why these rows can't be saved as a choice field's options, or null. */
export function choiceOptionsError(rows) {
  const dup = duplicateChoiceOption(rows);
  if (dup) return duplicateOptionMessage(dup);
  if (cleanChoiceOptions(rows).length < 2) return "A choice needs at least 2 options.";
  return null;
}
