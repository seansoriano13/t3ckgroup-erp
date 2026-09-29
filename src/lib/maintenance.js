// Build-time cutover lock. VITE_MAINTENANCE=on blocks everyone except emails in
// VITE_MAINTENANCE_ALLOW (comma-separated). Unset/off = no effect.
export function isMaintenanceBlocked(env, email) {
  if (env.VITE_MAINTENANCE !== "on") return false
  const allow = (env.VITE_MAINTENANCE_ALLOW || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  return !allow.includes((email || "").trim().toLowerCase())
}
