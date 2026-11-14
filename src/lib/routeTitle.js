import { isStaging, isLocal } from "@/lib/appEnv";

const APP = "T3CKGROUP ERP";

// Longest prefix wins. Keep in step with src/pages.
const TITLES = [
  ["/approvals/bid-decisions", "Bid Decisions"],
  ["/approvals/ipas", "IPAS Sign-offs"],
  ["/approvals/leaves", "Time Off & Overtime"],
  ["/approvals/meetings", "Meeting Requests"],
  ["/approvals/tasks", "Task Approvals"],
  ["/approvals/transmittals", "Transmittal Check by"],
  ["/approvals", "Approvals"],
  ["/bug-reports", "Bug Reports"],
  ["/calendar", "Calendar"],
  ["/costing-matrix", "S0 Evaluation"],
  ["/technical", "Technical"],
  ["/flow-versions", "Flow Snapshot"],
  ["/group-tasks/templates", "Group Task Templates"],
  ["/group-tasks", "Group Tasks"],
  ["/hr/management", "HR Management"],
  ["/hr/offsets", "HR Offsets"],
  ["/hr", "HR"],
  ["/login", "Sign in"],
  ["/offsets", "Offsets"],
  ["/profile", "Profile"],
  ["/purchasing/ipas", "IPAS"],
  ["/purchasing", "Purchasing"],
  ["/release-notes", "Release Notes"],
  ["/reset-password", "Reset Password"],
  ["/retail", "Retail"],
  ["/settings", "Settings"],
  ["/sors/commission", "Commission"],
  ["/sors", "SORs"],
  ["/super-admin/activity-log", "Activity Log"],
  ["/super-admin/commission", "Commission"],
  ["/super-admin/flow-canvas", "Flow Canvas"],
  ["/tasks", "Tasks"],
  ["/verify", "Verify"],
];

/** The page's own title, e.g. "HR Management". The phone top bar shows this. */
export function routeLabel(pathname) {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return "Dashboard";
  const hit = TITLES.find(([p]) => path === p || path.startsWith(`${p}/`));
  return hit ? hit[1] : "Page not found";
}

export function routeTitle(pathname) {
  const label = routeLabel(pathname);
  const base = label ? `${label} · ${APP}` : APP;
  if (isStaging) return `[STAGING] ${base}`;
  if (isLocal) return `[LOCAL] ${base}`;
  return base;
}
