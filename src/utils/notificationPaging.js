// The bell loads the newest NOTIFICATION_PAGE notifications. Live arrivals are
// added on top, but the list never grows past what is already loaded, so a tab
// left open for days cannot pile up hundreds of rows in memory.
export const NOTIFICATION_PAGE = 50;

export function addLiveNotification(list = [], incoming) {
  if (!incoming) return list;
  const rest = list.filter((n) => n.id !== incoming.id);
  return [incoming, ...rest].slice(0, Math.max(NOTIFICATION_PAGE, list.length));
}

// Older rows fetched by "Load older" go on the end; rows already shown are skipped.
export function appendOlderNotifications(list = [], older = []) {
  const have = new Set(list.map((n) => n.id));
  return [...list, ...older.filter((n) => !have.has(n.id))];
}

// True when the list is full, so more unread items may be waiting past it.
export const mayHaveMore = (list = []) => list.length >= NOTIFICATION_PAGE;
