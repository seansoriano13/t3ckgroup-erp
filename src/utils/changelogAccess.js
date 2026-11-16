import { getFilteredNavigationGroups } from "@/constants/navigation";

// What's New is filtered by the side menu's own checks (spec #1000, E2): a
// release entry may list `modules`, and the popup opens only when one of them
// is something the person can open. A module is a menu group key
// ("purchasing") or a menu entry key ("purchasing.canvasses"). An entry with
// no `modules` is for everyone.
export function entryTouchesUser(entry, user) {
  const modules = entry?.modules;
  if (!Array.isArray(modules) || modules.length === 0) return true;

  const groups = getFilteredNavigationGroups(user);
  const openable = new Set();
  for (const group of groups) {
    openable.add(group.key);
    for (const link of group.links) if (link.key) openable.add(link.key);
  }
  return modules.some((m) => openable.has(m));
}

// A release the popup skipped is marked seen, but Release Notes keeps a dot
// until the person opens it. Per person, per browser, like the dismissed key.
export const CHANGELOG_UNREAD_EVENT = "changelog-unread-changed";
const unreadKey = (userId) => `changelog_unread_${userId}`;

export function getUnreadVersion(userId) {
  try {
    return localStorage.getItem(unreadKey(userId));
  } catch {
    return null;
  }
}

export function setUnreadVersion(userId, version) {
  try {
    if (version) localStorage.setItem(unreadKey(userId), version);
    else localStorage.removeItem(unreadKey(userId));
  } catch {
    /* storage can be blocked; the dot is a convenience */
  }
  window.dispatchEvent(new Event(CHANGELOG_UNREAD_EVENT));
}
