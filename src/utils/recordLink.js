// The open Task / Group Task / SOR window lives in the address as
// `?open=task:<id>`, so a copied link reopens it and Back closes it.
export const RECORD_LINK_PARAM = "open";
// The tab of the open record (`&view=chat`). Generic: any kind may read it.
export const RECORD_VIEW_PARAM = "view";

const TYPE_TO_PREFIX = {
  TASK: "task",
  GROUP_TASK: "group-task",
  OPPORTUNITY: "sor",
  OPPORTUNITY_QUICK_VIEW: "sor-quick",
  PURCHASE_REQUEST: "pr",
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

/**
 * Writes the open record (and its tab) into a copy of `params`.
 * `key` null closes the record; a null `view` drops the tab.
 */
export function withRecord(params, key, view = null) {
  const next = new URLSearchParams(params);
  if (key) next.set(RECORD_LINK_PARAM, key);
  else next.delete(RECORD_LINK_PARAM);
  if (key && view) next.set(RECORD_VIEW_PARAM, view);
  else next.delete(RECORD_VIEW_PARAM);
  return next;
}

const RECORD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `id` looks like a record id (a uuid). A malformed one counts as not found: no request is sent. */
export function isRecordId(id) {
  return typeof id === "string" && RECORD_ID_RE.test(id);
}
