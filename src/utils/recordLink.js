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

/**
 * "<kind>:<id>" -> { kind, id }, or null when either side is missing. An id may
 * contain colons, so only the first one splits. The one parser behind every
 * address of this shape (`?open=`, `?chat=`, `?entry=`).
 */
export function splitKindId(value) {
  if (!value) return null;
  const at = value.indexOf(":");
  if (at < 1 || at === value.length - 1) return null;
  return { kind: value.slice(0, at), id: value.slice(at + 1) };
}

/** "task:<id>" -> { id, type }, or null when the key isn't one we know. */
export function recordKeyToItem(key) {
  const parts = splitKindId(key);
  const type = parts ? PREFIX_TO_TYPE[parts.kind] : null;
  return type ? { id: parts.id, type } : null;
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

export const OPEN_ENTITY_EVENT = "OPEN_ENTITY_DETAILS";

/**
 * Asks GlobalDetailManager to open a record window: `{ id, type }`, plus an
 * optional `view`, `tab`, `searchTerm` and so on. The one place the event is
 * dispatched from a page, so the window's address is always written the same way.
 */
export function openRecordWindow(detail) {
  window.dispatchEvent(new CustomEvent(OPEN_ENTITY_EVENT, { detail }));
}
