/**
 * Where to send someone once they are signed in.
 *
 * AppLayout stamps the route it turned a logged-out visitor away from onto the
 * navigation state, so a bookmarked /tasks link lands back on /tasks instead of
 * dumping them at the dashboard.
 *
 * Only same-site paths are honoured. Navigation state is attacker-reachable —
 * anyone can hand out a link that seeds it — so a protocol-relative "//host" or
 * an absolute URL would turn the login screen into an open redirect.
 */
export function resolvePostLoginPath(from) {
  if (typeof from !== "string") return "/";
  if (!from.startsWith("/") || from.startsWith("//")) return "/";
  // Backslashes are path separators to some browsers, so "/\evil.com" is
  // another spelling of a protocol-relative host.
  if (from.startsWith("/\\")) return "/";
  // Bouncing back to the login screen would strand them on the form they just
  // finished with.
  if (from === "/login" || from.startsWith("/login?")) return "/";
  return from;
}
