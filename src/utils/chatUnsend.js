export const UNSEND_WINDOW_MS = 15 * 60 * 1000;
export const REMOVED_TEXT = "Message removed";

/** True when the message was unsent (the database sets metadata.removed). */
export function isMessageRemoved(entry) {
  return entry?.metadata?.removed === true;
}

/**
 * The sender can unsend their own comment within 15 minutes of sending it.
 * The database enforces the same rule; this only decides whether to show the option.
 */
export function canUnsend(entry, currentUserId, now = Date.now()) {
  if (!entry || !currentUserId) return false;
  if (entry.type && entry.type !== "COMMENT") return false;
  if (isMessageRemoved(entry)) return false;
  if (entry.authorId !== currentUserId) return false;
  const sent = new Date(entry.createdAt ?? entry.created_at).getTime();
  if (Number.isNaN(sent)) return false;
  return now - sent <= UNSEND_WINDOW_MS;
}
