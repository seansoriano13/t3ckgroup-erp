// The open Task / Group Task / SOR window lives in the address as
// `?open=task:<id>`, so a copied link reopens it and Back closes it.
export const RECORD_LINK_PARAM = "open";

const TYPE_TO_PREFIX = {
  TASK: "task",
  GROUP_TASK: "group-task",
  OPPORTUNITY: "sor",
  OPPORTUNITY_QUICK_VIEW: "sor-quick",
};
const PREFIX_TO_TYPE = Object.fromEntries(Object.entries(TYPE_TO_PREFIX).map(([t, p]) => [p, t]));

export const NO_ACCESS_MESSAGE = "You don't have access to this record, or it no longer exists.";

/** { id, type } -> "task:<id>", or null for a type that has no link. */
export function itemToRecordKey(item) {
  const prefix = item && TYPE_TO_PREFIX[item.type];
  return prefix && item.id ? `${prefix}:${item.id}` : null;
}

/** "task:<id>" -> { id, type }, or null when the key isn't one we know. */
export function recordKeyToItem(key) {
  if (!key) return null;
  const at = key.indexOf(":");
  const type = at > 0 ? PREFIX_TO_TYPE[key.slice(0, at)] : null;
  const id = at > 0 ? key.slice(at + 1) : null;
  return type && id ? { id, type } : null;
}
