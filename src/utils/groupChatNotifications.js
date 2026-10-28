// Chat-message notifications are grouped per chat (record type + record id).
// Storage is unchanged: each message is still its own notification row.
const CHAT_TYPE_RECORD = {
  GROUP_TASK_COMMENT: "GROUP_TASK",
  GROUP_TASK_REACTION: "GROUP_TASK",
  GROUP_TASK_MENTION: "GROUP_TASK",
  COMMITTEE_TASK_COMMENT: "GROUP_TASK",
  TASK_MENTION: "TASK",
};

export const getChatGroupKey = (notif) => {
  const recordType = CHAT_TYPE_RECORD[notif?.type];
  if (!recordType || !notif.reference_id) return null;
  return `${recordType}:${notif.reference_id}`;
};

/**
 * Collapses chat notifications into one row per chat. The row is the newest
 * notification, plus `groupCount` and `groupIds` (all member ids), and
 * `is_read` true only when every member is read. Input order (newest first)
 * is kept; non-chat rows pass through untouched.
 */
export function groupChatNotifications(notifications) {
  const groups = new Map();
  for (const n of notifications) {
    const key = getChatGroupKey(n);
    if (!key) continue;
    const g = groups.get(key) ?? { newest: n, ids: [], unread: 0 };
    if (new Date(n.created_at) > new Date(g.newest.created_at)) g.newest = n;
    g.ids.push(n.id);
    if (!n.is_read) g.unread += 1;
    groups.set(key, g);
  }
  const seen = new Set();
  const out = [];
  for (const n of notifications) {
    const key = getChatGroupKey(n);
    if (!key) {
      out.push(n);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    const g = groups.get(key);
    out.push({
      ...g.newest,
      is_read: g.unread === 0,
      groupCount: g.ids.length,
      groupIds: g.ids,
    });
  }
  return out;
}
