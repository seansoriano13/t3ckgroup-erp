/**
 * The address of one SOR: its own page on the register, open on `view` ("pms",
 * …) when given. Every SOR reference shown inside another record's window is a
 * plain link to this, so following it leaves that window instead of opening the
 * SOR underneath it, and Ctrl-click opens it in a new tab.
 */
export function sorHref(sorId, view = null) {
  if (!sorId) return null;
  const params = new URLSearchParams({ record: sorId });
  if (view) params.set("view", view);
  return `/sors?${params.toString()}`;
}
