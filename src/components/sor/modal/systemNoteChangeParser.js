// Splits a SYSTEM note's `metadata.changes` into field-change lines (parsed
// into label/from/to for an arrow render) and product-change lines, which
// use the already-structured `metadata.productChanges`
// (src/services/opportunityService.js's updateOpportunity) instead of
// re-parsing the "Added/Removed/Modified product(s): ..." strings.

const PRODUCT_LINE_RE = /^(Added|Removed|Modified|Odoo renamed) product\(s\):/i;

// Matches every shape updateOpportunity's `changes` array produces:
// `Lead Source changed from "Website" to "Referral"`, `Expected Value
// changed from ₱100,000 to ₱200,000`, and the metadata-key form
// `po_remarks from "foo" to "bar"` / `po_remarks from nothing to "bar"`.
const FIELD_CHANGE_RE = /^(.+?)\s+(?:changed from|from)\s+(.+?)\s+to\s+(.+)$/i;

function unquote(value) {
  const trimmed = value.trim().replace(/\.$/, "");
  const match = trimmed.match(/^"(.*)"$/);
  if (match) return match[1] || "None";
  if (trimmed.toLowerCase() === "nothing") return "None";
  return trimmed;
}

export function parseFieldChange(line) {
  const match = line.match(FIELD_CHANGE_RE);
  if (!match) return null;
  return { label: match[1].trim(), from: unquote(match[2]), to: unquote(match[3]) };
}

export function splitNoteChanges(metadata) {
  const changes = metadata?.changes || [];
  const productChanges = metadata?.productChanges || [];
  const fieldChanges = changes.filter((c) => !PRODUCT_LINE_RE.test(c)).map((raw) => parseFieldChange(raw) || { raw });

  const byType = { added: [], removed: [], modified: [], renamed: [] };
  for (const pc of productChanges) {
    if (byType[pc.type]) byType[pc.type].push(pc);
  }

  return { fieldChanges, productCategories: byType };
}

export const CATEGORY_META = {
  added: { label: "Added", theme: "green" },
  removed: { label: "Removed", theme: "red" },
  modified: { label: "Modified", theme: "blue" },
  renamed: { label: "Renamed", theme: "violet" },
};

export const CATEGORY_ORDER = ["renamed", "added", "removed", "modified"];
